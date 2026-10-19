import Foundation

// MARK: - WarrantyExpirySource

/// Where an expiry answer came from. The difference is user-visible: a live
/// read is a fact from the server, the cached path is explicitly a snapshot.
public enum WarrantyExpirySource: Equatable, Sendable {
    /// The server's warranty list for this device.
    case live([Warranty])
    /// The App Group snapshot's list projection, with its capture time.
    case cache(endDate: Date, capturedAt: Date)
    /// No server answer and no cached device.
    case unavailable
}

// MARK: - WarrantyExpiryAnswer

public struct WarrantyExpiryAnswer: Equatable, Sendable {
    public let text: String
    public let endDate: Date?
    public let isFromCache: Bool

    public init(text: String, endDate: Date?, isFromCache: Bool) {
        self.text = text
        self.endDate = endDate
        self.isFromCache = isFromCache
    }
}

// MARK: - WarrantyExpiryRules

/// The pure answer behind "when does X expire?".
///
/// Kept in the Kit because the App Intent itself is a thin transport: it gets
/// the device id from `DeviceEntity`, tries one authenticated read, and hands
/// the result to this rule. If the read fails it falls back to the widget
/// snapshot and says so — never presenting yesterday's projection as today's
/// server answer.
public enum WarrantyExpiryRules {

    /// The device's whole-unit end: max `endDate` across its warranty packages.
    /// Same rule as `StatsRollup.effectiveWarrantyEnd` and the list projection.
    public static func effectiveEnd(_ warranties: [Warranty]) -> Date? {
        warranties.map(\.endDate).max()
    }

    public static func answer(
        deviceName: String,
        source: WarrantyExpirySource,
        now: Date = Date(),
        language: AppLanguage,
        calendar: Calendar = .current
    ) -> WarrantyExpiryAnswer {
        switch source {
        case let .live(warranties):
            guard let end = effectiveEnd(warranties) else {
                return WarrantyExpiryAnswer(
                    text: L.t("Chưa ghi bảo hành cho %@.", language: language, deviceName),
                    endDate: nil,
                    isFromCache: false
                )
            }
            return WarrantyExpiryAnswer(
                text: sentence(
                    deviceName: deviceName,
                    endDate: end,
                    now: now,
                    language: language,
                    calendar: calendar
                ),
                endDate: end,
                isFromCache: false
            )

        case let .cache(endDate, capturedAt):
            let days = DeadlineWidgetRules.daysRemaining(
                endDate: endDate,
                now: now,
                calendar: calendar
            )
            let daysText = DeadlineWidgetRules.daysLabel(days: days, language: language)
            let formattedDate = dateText(for: endDate, language: language, calendar: calendar)
            let stamp = DeadlineWidgetRules.asOfStamp(
                capturedAt: capturedAt,
                now: now,
                language: language,
                calendar: calendar
            )
            return WarrantyExpiryAnswer(
                text: L.t("Theo dữ liệu lưu trên máy (%1$@), %2$@ hết hạn ngày %3$@ — %4$@.", language: language, stamp, deviceName, formattedDate, daysText),
                endDate: endDate,
                isFromCache: true
            )

        case .unavailable:
            return WarrantyExpiryAnswer(
                text: L.t("Không đọc được dữ liệu bảo hành. Mở Warrly để thử lại.", language: language),
                endDate: nil,
                isFromCache: false
            )
        }
    }

    /// The answer to "what expires next?", read from the App Group snapshot.
    /// Unlike the per-device answer this never calls the network; the dialog
    /// carries the snapshot's "as of" line when it is old.
    public static func nextDeadlineAnswer(
        snapshot: DeadlineSnapshot?,
        now: Date = Date(),
        language: AppLanguage,
        calendar: Calendar = .current
    ) -> String {
        let presentation = DeadlineWidgetRules.presentation(
            snapshot: snapshot,
            now: now,
            limit: 1,
            language: language,
            calendar: calendar
        )

        switch presentation.state {
        case .notConfigured:
            return DeadlineWidgetRules.notConfiguredMessage(language: language)
        case .empty:
            return presentation.message
                ?? DeadlineWidgetRules.emptyMessage(
                    windowDays: DeadlineSnapshotBuilder.windowDays,
                    language: language
                )
        case let .deadlines(rows):
            guard let row = rows.first else {
                return DeadlineWidgetRules.emptyMessage(
                    windowDays: DeadlineSnapshotBuilder.windowDays,
                    language: language
                )
            }
            var text = L.t("Mốc gần nhất: %1$@ — %2$@.", language: language, row.deviceName, row.daysText)
            if let asOf = presentation.asOfText {
                text += " " + asOf
            }
            return text
        }
    }

    /// A localized, numeric-free date for the spoken answer. `.medium` gives
    /// "19 thg 10, 2026" in Vietnamese and "Oct 19, 2026" in English; the
    /// timezone is the caller's so the day cannot move.
    public static func dateText(
        for date: Date,
        language: AppLanguage,
        calendar: Calendar = .current
    ) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: language == .vi ? "vi_VN" : "en_US")
        formatter.timeZone = calendar.timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }

    // MARK: Private

    private static func sentence(
        deviceName: String,
        endDate: Date,
        now: Date,
        language: AppLanguage,
        calendar: Calendar
    ) -> String {
        let days = DeadlineWidgetRules.daysRemaining(
            endDate: endDate,
            now: now,
            calendar: calendar
        )
        let daysText = DeadlineWidgetRules.daysLabel(days: days, language: language)
        let formattedDate = dateText(for: endDate, language: language, calendar: calendar)
        return L.t("%1$@ hết hạn ngày %2$@ — %3$@.", language: language, deviceName, formattedDate, daysText)
    }
}
