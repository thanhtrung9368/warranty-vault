import Foundation

// MARK: - DeadlineAccessoryStat

/// One bucket the Lock Screen accessory shows: an already-localized label and
/// its number. The extension only lays these out.
public struct DeadlineAccessoryStat: Equatable, Sendable, Identifiable {
    /// Stable identity for `ForEach`; not user-visible.
    public let id: String
    public let title: String
    public let count: Int

    public var value: String { String(count) }

    public init(id: String, title: String, count: Int) {
        self.id = id
        self.title = title
        self.count = count
    }
}

// MARK: - DeadlineAccessoryPresentation

/// The complete, already-localized state of the Lock Screen accessory families.
///
/// **Privacy rule:** this type carries numbers and generic labels only. A
/// device name must never reach it — the accessory families render before the
/// phone is unlocked, so a name here would be readable by anyone holding the
/// device. `DeadlineWidgetRules` still owns the home-screen rows, where names
/// only appear after unlock.
public struct DeadlineAccessoryPresentation: Equatable, Sendable {
    public enum State: Equatable, Sendable {
        /// No snapshot has ever been written.
        case notConfigured
        /// A snapshot file exists but this process cannot read it.
        case unreadable
        /// Nothing inside the snapshot's 90-day window.
        case empty
        /// Deadlines exist, but none inside the next 30 days. The copy names the
        /// window instead of printing "0" three times.
        case quiet
        /// At least one bucket has a device.
        case counts
    }

    public let state: State
    /// `"Sắp hết hạn"` — the rectangular header, and the circular/inline
    /// accessibility title.
    public let title: String
    /// Explanation for every state except `.counts`; `nil` when there are
    /// numbers to show.
    public let message: String?
    /// The three buckets, `.counts` only, most urgent first.
    public let stats: [DeadlineAccessoryStat]
    /// The most urgent non-zero bucket, for `accessoryCircular`.
    public let circularValue: String?
    public let circularLabel: String?
    /// SF Symbol shown by `accessoryCircular` when there is no number to show.
    /// The rules own it so the extension has no branch to get wrong.
    public let circularSymbol: String
    /// The single line `accessoryInline` renders.
    public let inlineText: String
    /// `"Tính đến 09:41"` when the snapshot is stale. Rectangular only: inline
    /// has one line and circular has no room.
    public let asOfText: String?
    /// VoiceOver sentence for the circular/rectangular view.
    public let accessibilityText: String

    public init(
        state: State,
        title: String,
        message: String?,
        stats: [DeadlineAccessoryStat],
        circularValue: String?,
        circularLabel: String?,
        circularSymbol: String,
        inlineText: String,
        asOfText: String?,
        accessibilityText: String
    ) {
        self.state = state
        self.title = title
        self.message = message
        self.stats = stats
        self.circularValue = circularValue
        self.circularLabel = circularLabel
        self.circularSymbol = circularSymbol
        self.inlineText = inlineText
        self.asOfText = asOfText
        self.accessibilityText = accessibilityText
    }
}

// MARK: - DeadlineAccessoryRules

/// Every decision the Lock Screen accessory families make: the bucket
/// arithmetic, the copy, which number a circle can show, and when it must stop
/// implying the numbers are live. Kept in the kit (not in the extension) so the
/// extension target has nothing but layout, and so the privacy rule above can
/// be tested without a device.
public enum DeadlineAccessoryRules {

    /// The 30-day sentence used when the snapshot has deadlines but none inside
    /// the accessory's widest bucket. Reuses the existing plural key so the
    /// wording cannot drift from the in-app reminders screen.
    public static func within30Message(language: AppLanguage) -> String {
        L.p("Không có nhắc nhở nào trong %d ngày tới.", language: language, 30)
    }

    // MARK: Presentation

    /// Renders the whole accessory state from the store's read outcome.
    public static func presentation(
        outcome: DeadlineSnapshotReadOutcome,
        now: Date,
        language: AppLanguage,
        calendar: Calendar = .current
    ) -> DeadlineAccessoryPresentation {
        let title = DeadlineWidgetRules.widgetTitle(language: language)

        switch outcome {
        case .missing:
            let message = DeadlineWidgetRules.notConfiguredMessage(language: language)
            return DeadlineAccessoryPresentation(
                state: .notConfigured,
                title: title,
                message: message,
                stats: [],
                circularValue: nil,
                circularLabel: nil,
                circularSymbol: "arrow.clockwise",
                inlineText: message,
                asOfText: nil,
                accessibilityText: message
            )
        case .unreadable:
            let message = DeadlineWidgetRules.unreadableMessage(language: language)
            return DeadlineAccessoryPresentation(
                state: .unreadable,
                title: title,
                message: message,
                stats: [],
                circularValue: nil,
                circularLabel: nil,
                circularSymbol: "lock.fill",
                inlineText: message,
                asOfText: nil,
                accessibilityText: message
            )
        case let .snapshot(snapshot):
            return presentation(
                snapshot: snapshot,
                now: now,
                language: language,
                calendar: calendar
            )
        }
    }

    public static func presentation(
        snapshot: DeadlineSnapshot,
        now: Date,
        language: AppLanguage,
        calendar: Calendar = .current
    ) -> DeadlineAccessoryPresentation {
        let title = DeadlineWidgetRules.widgetTitle(language: language)
        let asOf = DeadlineWidgetRules.asOfText(
            capturedAt: snapshot.capturedAt,
            now: now,
            language: language,
            calendar: calendar
        )

        // A version-1 snapshot (build 23) has no stored counts. Derive them from
        // the rows it does carry rather than refusing to draw anything; the next
        // foreground replaces it with a v2 snapshot. Stored rows are capped at
        // 12, so a legacy snapshot that hit the cap can undercount — the honest
        // alternative would be no number at all, which is worse on a Lock Screen.
        let counts = snapshot.counts
            ?? DeadlineSnapshotCounts.counting(
                deadlines: snapshot.deadlines,
                now: now,
                calendar: calendar
            )

        if snapshot.deadlines.isEmpty && counts.isEmpty {
            let message = DeadlineWidgetRules.emptyMessage(
                windowDays: snapshot.windowDays,
                language: language
            )
            return DeadlineAccessoryPresentation(
                state: .empty,
                title: title,
                message: message,
                stats: [],
                circularValue: nil,
                circularLabel: nil,
                circularSymbol: "checkmark",
                inlineText: message,
                asOfText: asOf,
                accessibilityText: message
            )
        }

        guard !counts.isEmpty else {
            let message = within30Message(language: language)
            return DeadlineAccessoryPresentation(
                state: .quiet,
                title: title,
                message: message,
                stats: [],
                circularValue: nil,
                circularLabel: nil,
                circularSymbol: "checkmark",
                inlineText: message,
                asOfText: asOf,
                accessibilityText: message
            )
        }

        let stats = [
            DeadlineAccessoryStat(
                id: "today",
                title: L.t("Hôm nay", language: language),
                count: counts.dueToday
            ),
            DeadlineAccessoryStat(
                id: "within7",
                title: L.t("7 ngày", language: language),
                count: counts.within7
            ),
            DeadlineAccessoryStat(
                id: "within30",
                title: L.t("30 ngày", language: language),
                count: counts.within30
            ),
        ]

        // The circle can hold one number and one short label, so it shows the
        // nearest non-empty bucket: today, then 7 days, then 30 days. It never
        // shows a name (privacy) and never claims a freshness it does not have
        // (no room for "as of" — the rectangular family carries that instead).
        let circular: (value: String, label: String)
        if counts.dueToday > 0 {
            circular = (String(counts.dueToday), L.t("Hôm nay", language: language))
        } else if counts.within7 > 0 {
            circular = (String(counts.within7), L.t("7 ngày", language: language))
        } else {
            circular = (String(counts.within30), L.t("30 ngày", language: language))
        }

        return DeadlineAccessoryPresentation(
            state: .counts,
            title: title,
            message: nil,
            stats: stats,
            circularValue: circular.value,
            circularLabel: circular.label,
            circularSymbol: "checkmark",
            inlineText: inlineText(counts: counts, language: language),
            asOfText: asOf,
            accessibilityText: stats
                .map { "\($0.title) \($0.value)" }
                .joined(separator: ", ")
        )
    }

    // MARK: Copy helpers

    /// One line for `accessoryInline`, built from the non-zero buckets only.
    /// Buckets are cumulative, so dropping a leading zero keeps the sentence
    /// readable instead of turning it into a fake "0 today".
    public static func inlineText(
        counts: DeadlineSnapshotCounts,
        language: AppLanguage
    ) -> String {
        var parts: [String] = []
        if counts.dueToday > 0 {
            parts.append("\(L.t("Hôm nay", language: language)) \(counts.dueToday)")
        }
        if counts.within7 > 0 {
            parts.append("\(L.t("7 ngày", language: language)) \(counts.within7)")
        }
        if counts.within30 > 0 {
            parts.append("\(L.t("30 ngày", language: language)) \(counts.within30)")
        }
        return parts.joined(separator: " · ")
    }
}
