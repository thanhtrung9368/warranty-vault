import Foundation

// MARK: - DeadlineUrgency

/// How loud a row should be. Kept separate from SwiftUI colors so the mapping
/// is testable and the widget target owns the actual palette.
public enum DeadlineUrgency: String, Equatable, Sendable {
    case expired
    case today
    case soon
    case later
}

// MARK: - DeadlineWidgetRow

/// One already-rendered widget row. The view layer only lays it out; every
/// string (including the plural form) is decided here.
public struct DeadlineWidgetRow: Equatable, Sendable, Identifiable {
    public let warrantyId: String
    public let deviceId: String
    public let deviceName: String
    public let days: Int
    public let daysText: String
    public let urgency: DeadlineUrgency

    public var id: String { warrantyId }

    public init(
        warrantyId: String,
        deviceId: String,
        deviceName: String,
        days: Int,
        daysText: String,
        urgency: DeadlineUrgency
    ) {
        self.warrantyId = warrantyId
        self.deviceId = deviceId
        self.deviceName = deviceName
        self.days = days
        self.daysText = daysText
        self.urgency = urgency
    }
}

// MARK: - DeadlineWidgetPresentation

/// The complete, already-localized state of one widget render.
public struct DeadlineWidgetPresentation: Equatable, Sendable {
    public enum State: Equatable, Sendable {
        /// The app has never written a snapshot (fresh install, signed out, or
        /// the App Group entitlement is missing).
        case notConfigured
        /// A real answer: nothing expires inside the window. Not an error.
        case empty
        case deadlines([DeadlineWidgetRow])
    }

    public let state: State
    public let title: String
    /// Explanation for `notConfigured` / `empty`; `nil` when rows exist.
    public let message: String?
    /// `"As of 09:41"` / `"Tính đến 09:41"` when the snapshot is old enough
    /// that presenting it as live would be dishonest. `nil` while fresh.
    public let asOfText: String?
    /// A stronger nudge once the snapshot is two days old.
    public let refreshHint: String?

    public var rows: [DeadlineWidgetRow] {
        if case let .deadlines(rows) = state { return rows }
        return []
    }

    public var isStale: Bool { asOfText != nil }

    public init(
        state: State,
        title: String,
        message: String?,
        asOfText: String?,
        refreshHint: String?
    ) {
        self.state = state
        self.title = title
        self.message = message
        self.asOfText = asOfText
        self.refreshHint = refreshHint
    }
}

// MARK: - DeadlineWidgetRules

/// The rules the widget (and the Siri "what expires next" intent) share.
///
/// The widget extension itself cannot be unit-tested here, so every decision
/// that can be wrong — the day arithmetic, the plural labels, the empty state,
/// when a snapshot stops being "live" — lives in this file and is covered by
/// `DeadlineWidgetTests`.
public enum DeadlineWidgetRules {
    /// Six hours is long enough that a normal foreground refresh never shows
    /// the caveat, and short enough that a widget left alone overnight is
    /// honest by morning. The timeline also adds an entry exactly at this
    /// instant, so the label appears without waiting for the next midnight.
    public static let staleAfter: TimeInterval = 6 * 60 * 60

    /// After two days, "as of" alone undersells the problem: warranty dates may
    /// have moved (a device added, a warranty extended). Show the refresh nudge.
    public static let severelyStaleAfter: TimeInterval = 48 * 60 * 60

    public static let smallLimit = 3
    public static let mediumLimit = 4

    // MARK: Copy

    public static func widgetTitle(language: AppLanguage) -> String {
        L.t("Sắp hết hạn", language: language)
    }

    public static func galleryDescription(language: AppLanguage) -> String {
        L.t("Bảo hành sắp hết hạn, ngay trên màn hình chính.", language: language)
    }

    public static func emptyTitle(language: AppLanguage) -> String {
        L.t("Không có gì sắp hết hạn", language: language)
    }

    public static func notConfiguredMessage(language: AppLanguage) -> String {
        L.t("Mở ứng dụng một lần để đồng bộ hạn bảo hành.", language: language)
    }

    public static func emptyMessage(windowDays: Int, language: AppLanguage) -> String {
        L.p("Không có nhắc nhở nào trong %d ngày tới.", language: language, windowDays)
    }

    public static func refreshHint(language: AppLanguage) -> String {
        L.t("Mở Warrly để cập nhật", language: language)
    }

    // MARK: Days

    /// Whole calendar days from `now` to `endDate`, measured between local
    /// midnights. `0` means "expires today", `-2` means "expired two days ago".
    ///
    /// Deliberately not `timeInterval / 86_400`: a 23-hour day across a DST
    /// boundary would round to the wrong day and make a widget disagree with
    /// the row beside it in the app (`WVFormat.daysUntil` uses the same rule).
    public static func daysRemaining(
        endDate: Date,
        now: Date,
        calendar: Calendar = .current
    ) -> Int {
        calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: now),
            to: calendar.startOfDay(for: endDate)
        ).day ?? 0
    }

    /// The full-sentence label. Reuses the app's existing `Còn %d ngày` plural
    /// so a widget and a reminder row cannot say the number differently.
    public static func daysLabel(days: Int, language: AppLanguage) -> String {
        if days < 0 {
            return L.p("Đã hết hạn %d ngày", language: language, abs(days))
        }
        if days == 0 {
            return L.t("Hết hạn hôm nay", language: language)
        }
        if days == 1 {
            return L.t("Hết hạn ngày mai", language: language)
        }
        return L.p("Còn %d ngày", language: language, days)
    }

    public static func urgency(days: Int) -> DeadlineUrgency {
        if days < 0 { return .expired }
        if days == 0 { return .today }
        if days <= 7 { return .soon }
        return .later
    }

    // MARK: Staleness

    public static func age(capturedAt: Date, now: Date) -> TimeInterval {
        max(0, now.timeIntervalSince(capturedAt))
    }

    public static func isStale(capturedAt: Date, now: Date) -> Bool {
        age(capturedAt: capturedAt, now: now) >= staleAfter
    }

    public static func isSeverelyStale(capturedAt: Date, now: Date) -> Bool {
        age(capturedAt: capturedAt, now: now) >= severelyStaleAfter
    }

    /// A compact absolute stamp, not a relative one. "2 hours ago" would need
    /// the timeline to wake every hour to stay true; an absolute time is
    /// correct no matter when the system chooses to redraw.
    public static func asOfStamp(
        capturedAt: Date,
        now: Date,
        language: AppLanguage,
        calendar: Calendar = .current
    ) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        if calendar.isDate(capturedAt, inSameDayAs: now) {
            formatter.dateFormat = "HH:mm"
        } else {
            // Day/month order follows the UI language. Numeric on purpose: the
            // widget gallery has no room for a localized month name and the
            // stamp must be identical in a test on any machine.
            formatter.dateFormat = language == .vi ? "HH:mm d/M" : "HH:mm M/d"
        }
        return formatter.string(from: capturedAt)
    }

    public static func asOfText(
        capturedAt: Date,
        now: Date,
        language: AppLanguage,
        calendar: Calendar = .current
    ) -> String? {
        guard isStale(capturedAt: capturedAt, now: now) else { return nil }
        let stamp = asOfStamp(
            capturedAt: capturedAt,
            now: now,
            language: language,
            calendar: calendar
        )
        return L.t("Tính đến %@", language: language, stamp)
    }

    // MARK: Presentation

    /// Renders the whole state. `limit` is family-dependent (3 for small, 4 for
    /// medium) and is applied here so the view cannot accidentally draw a fifth
    /// row into a small widget.
    public static func presentation(
        snapshot: DeadlineSnapshot?,
        now: Date,
        limit: Int,
        language: AppLanguage,
        calendar: Calendar = .current
    ) -> DeadlineWidgetPresentation {
        guard let snapshot else {
            return DeadlineWidgetPresentation(
                state: .notConfigured,
                title: widgetTitle(language: language),
                message: notConfiguredMessage(language: language),
                asOfText: nil,
                refreshHint: nil
            )
        }

        let asOf = asOfText(
            capturedAt: snapshot.capturedAt,
            now: now,
            language: language,
            calendar: calendar
        )
        let hint = isSeverelyStale(capturedAt: snapshot.capturedAt, now: now)
            ? refreshHint(language: language)
            : nil

        guard !snapshot.deadlines.isEmpty else {
            return DeadlineWidgetPresentation(
                state: .empty,
                title: emptyTitle(language: language),
                message: emptyMessage(windowDays: snapshot.windowDays, language: language),
                asOfText: asOf,
                refreshHint: hint
            )
        }

        let rows = snapshot.deadlines
            .sorted { lhs, rhs in
                if lhs.endDate != rhs.endDate { return lhs.endDate < rhs.endDate }
                return lhs.deviceName.localizedCaseInsensitiveCompare(rhs.deviceName)
                    == .orderedAscending
            }
            .prefix(max(1, limit))
            .map { deadline in
                let days = daysRemaining(
                    endDate: deadline.endDate,
                    now: now,
                    calendar: calendar
                )
                return DeadlineWidgetRow(
                    warrantyId: deadline.warrantyId,
                    deviceId: deadline.deviceId,
                    deviceName: deadline.deviceName,
                    days: days,
                    daysText: daysLabel(days: days, language: language),
                    urgency: urgency(days: days)
                )
            }

        return DeadlineWidgetPresentation(
            state: .deadlines(Array(rows)),
            title: widgetTitle(language: language),
            message: nil,
            asOfText: asOf,
            refreshHint: hint
        )
    }
}
