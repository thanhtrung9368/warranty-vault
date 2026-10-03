import Foundation

// "Việc cần xử lý" — the action queue (openapi `GET /api/v1/actions`).
//
// A queue of things the app can DERIVE from rows that already exist but cannot
// decide on its own: a warranty that expired yesterday, a device with no package
// at all, a return window about to close, a subscription that will charge again
// without a cancel link. Nothing here is new stored state — an item is a
// conclusion drawn from data the user typed, which is why the list can shrink
// without anything being deleted.
//
// Three contract details drive the UI and are easy to get wrong:
//
//  1. `snoozed=true` only ADDS rows; it never removes one. `counts` always counts
//     the ACTIONABLE subset, so a badge built from `counts` cannot change meaning
//     with the flag. Counting the rows on screen would overstate the workload the
//     moment the "Đang hoãn" view is opened.
//  2. `itemKey` (`<KIND>:<entityId>`) is the identity used to snooze — never a
//     position in the list, which shifts under re-sorting.
//  3. `title` / `detail` are display-ready Vietnamese written by the server, and
//     they are rendered **verbatim**: each sentence names the actual dates and
//     amounts that produced the item, so re-wording it on the client is how a
//     queue starts lying. The client only adds what the payload does not say:
//     which screen to open, how far away `dueDate` is, and when a snooze ends.
//
// `kind` and `severity` are kept as raw `String`s on purpose — a code this build
// has never seen must degrade, not throw away the whole queue.

// MARK: - Wire shapes

/// How many items are in the set being counted. Shared by the action queue and
/// the subscription audit: two different sets, one way of counting them.
public struct ActionCounts: Decodable, Sendable, Hashable {
    /// For the queue: items **đang cần xử lý**, never the snoozed ones.
    public let total: Int
    public let high: Int
    public let medium: Int
    public let low: Int
}

/// One derived thing that needs the user to decide something.
public struct ActionItem: Decodable, Sendable, Hashable, Identifiable {
    /// `<KIND>:<entityId>` — passed back verbatim to the snooze endpoints.
    public let itemKey: String
    /// One of the ten documented kinds, e.g. `WARRANTY_EXPIRED`.
    public let kind: String
    /// `HIGH | MEDIUM | LOW`.
    public let severity: String
    /// Server-written Vietnamese, rendered as-is.
    public let title: String
    /// Server-written Vietnamese, rendered as-is.
    public let detail: String

    public let deviceId: String?
    public let warrantyId: String?
    public let subscriptionId: String?
    public let wishlistItemId: String?

    /// The date the item is about, as the naive-UTC timestamp the server sends.
    /// Absent when the item has no single date.
    public let dueDate: String?
    /// Money involved (VND). **`Int64`**: the server sends int64, and an `Int32`
    /// would not survive a 4-billion-đồng value.
    public let amountVnd: Int64?
    /// Present **only** on `?snoozed=true` rows that are currently hidden — the
    /// exact set `ActionCounts` excludes from the badge.
    public let snoozedUntil: String?

    public var id: String { itemKey }

    /// `true` when this row is hidden by a snooze rather than waiting for work.
    public var isSnoozed: Bool {
        !(snoozedUntil ?? "").trimmingCharacters(in: .whitespaces).isEmpty
    }
}

/// `GET /api/v1/actions` response.
///
/// `counts` is decoded as required on purpose: it drives a badge, and a missing
/// count must fail loudly rather than render as a confident "0 việc". Every other
/// field degrades, so a partial payload still shows the rows it did send.
public struct ActionQueue: Decodable, Sendable {
    /// When the server built the queue; every day count in it is relative to this.
    public let generatedAt: String
    /// Already sorted by the server; the client re-sorts so its own grouping is
    /// stable across the actionable / snoozed split.
    public let items: [ActionItem]
    /// Always the actionable subset — see `ActionCounts`.
    public let counts: ActionCounts
    /// How many items a snooze is currently hiding, even when not in `items`.
    /// The entry point for the "Đang hoãn" view.
    public let snoozedCount: Int
    /// The server's own sentence about what this queue is and is **not** (not a
    /// push feed; snoozing here does not touch warranty reminders). Shown as-is.
    public let note: String

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = try c.decodeIfPresent(String.self, forKey: .generatedAt) ?? ""
        items = try c.decodeIfPresent([ActionItem].self, forKey: .items) ?? []
        counts = try c.decode(ActionCounts.self, forKey: .counts)
        snoozedCount = try c.decodeIfPresent(Int.self, forKey: .snoozedCount) ?? 0
        note = try c.decodeIfPresent(String.self, forKey: .note) ?? ""
    }

    private enum CodingKeys: String, CodingKey {
        case generatedAt, items, counts, snoozedCount, note
    }
}

/// Optional body of `POST /api/v1/actions/{itemKey}/snooze`. Bounds are the
/// server's: `1–365` days, with `0`/absent meaning the 90-day default.
public struct SnoozeInput: Encodable, Sendable {
    public var days: Int
    public init(days: Int) { self.days = days }
}

/// `POST /api/v1/actions/{itemKey}/snooze` response.
public struct SnoozeResult: Decodable, Sendable {
    public let itemKey: String
    /// When the item reappears in the queue.
    public let snoozedUntil: String
    /// The duration the **server** applied — echoed instead of assuming the one
    /// we asked for, so a confirmation can never claim a different number than
    /// the queue will actually show.
    public let days: Int
}

// MARK: - Pure presentation rules

/// The three severities the server emits, plus a bucket for a code this build
/// has never seen. Unknown codes render (data, not a broken row) and sort last:
/// the alternative — failing the decode — would blank the whole queue over one
/// new code.
public enum ActionSeverity: String, Sendable, CaseIterable {
    case HIGH, MEDIUM, LOW, UNKNOWN

    /// Display order, `HIGH` first, exactly like the server.
    public var rank: Int {
        switch self {
        case .HIGH: return 0
        case .MEDIUM: return 1
        case .LOW: return 2
        case .UNKNOWN: return 3
        }
    }

    /// Section heading. These are client copy: the server ships machine codes,
    /// and openapi documents `HIGH` as "mốc thời gian hoặc tiền sắp mất".
    public var sectionLabel: String {
        switch self {
        case .HIGH: return "Cần xử lý ngay"
        case .MEDIUM: return "Nên xử lý"
        case .LOW: return "Nhắc nhẹ"
        case .UNKNOWN: return "Khác"
        }
    }

    /// Raw `severity` code → enum, unknown codes degrading to `.UNKNOWN`.
    public static func of(_ raw: String) -> ActionSeverity {
        ActionSeverity(rawValue: raw.trimmingCharacters(in: .whitespaces).uppercased()) ?? .UNKNOWN
    }
}

/// Where tapping an item goes. The payload carries at most one entity id per
/// item, and all ten kinds today name one.
///
/// `nil` is a real case, not dead code: an older or partial payload — or a kind a
/// future server adds — may arrive with no id at all, and the row must then be a
/// plain, non-tappable card instead of a link to nowhere.
public enum ActionTarget: Equatable, Sendable {
    case device(String)
    case subscription(String)
    case wishlistItem(String)
}

/// One "hoãn bao lâu" choice. Bounds are the server's: 1–365 days.
public struct SnoozeChoice: Equatable, Sendable, Identifiable {
    public let days: Int
    public let label: String
    public var id: Int { days }
}

/// A day-count note derived from `dueDate`.
public struct ActionDueNote: Equatable, Sendable {
    public enum Urgency: Sendable { case overdue, today, soon, later }
    public let label: String
    public let urgency: Urgency
}

public enum ActionQueueRules {

    // MARK: Snooze bounds + choices

    /// The server's default (`services.SnoozeDaysDefault`). The client still
    /// sends an explicit `days` on every call — this constant only labels the
    /// suggested choice, so the two can never disagree about "mặc định".
    public static let snoozeDaysDefault = 90
    public static let snoozeDaysMin = 1
    public static let snoozeDaysMax = 365

    /// A few Vietnamese durations rather than a free number field: the decision
    /// is "để đó một thời gian", and every option is inside the server's `1–365`
    /// window, so no choice can produce a 400.
    public static let snoozeChoices: [SnoozeChoice] = [
        SnoozeChoice(days: 7, label: "1 tuần"),
        SnoozeChoice(days: 30, label: "1 tháng"),
        SnoozeChoice(days: snoozeDaysDefault, label: "3 tháng (mặc định)"),
        SnoozeChoice(days: 180, label: "6 tháng"),
        SnoozeChoice(days: snoozeDaysMax, label: "1 năm"),
    ]

    /// The choices are a client-side convenience; the server still owns the range.
    public static func isValidSnoozeDays(_ days: Int) -> Bool {
        days >= snoozeDaysMin && days <= snoozeDaysMax
    }

    // MARK: Badge + split

    /// The number a badge may show: `counts.total` — the server's count of the
    /// items that are actionable **right now**.
    ///
    /// Deliberately not `items.count`, which grows when the queue is read with
    /// `?snoozed=true`, and deliberately not a local sum either. A snooze can
    /// move a row without moving the badge's meaning.
    public static func badgeCount(_ counts: ActionCounts?) -> Int {
        counts?.total ?? 0
    }

    /// The rows the user actually has to decide about: everything the server
    /// returned minus the ones a snooze is hiding.
    public static func actionable(_ items: [ActionItem]) -> [ActionItem] {
        items.filter { !$0.isSnoozed }
    }

    /// The rows hidden by a snooze — only ever non-empty on a `?snoozed=true` read.
    public static func snoozed(_ items: [ActionItem]) -> [ActionItem] {
        items.filter(\.isSnoozed)
    }

    // MARK: Ordering + grouping

    /// Sorts the queue the way the server does: severity first, then the date the
    /// item is about (soonest first, no date last), then `itemKey` so the order is
    /// total and two reads cannot shuffle rows for no reason.
    ///
    /// Re-sorting a list the server already sorted is not redundancy: the split
    /// between "đang cần xử lý" and "đang hoãn" happens on the client, and each
    /// section has to stay ordered on its own.
    public static func sorted(_ items: [ActionItem]) -> [ActionItem] {
        items.sorted { a, b in
            let ra = ActionSeverity.of(a.severity).rank
            let rb = ActionSeverity.of(b.severity).rank
            if ra != rb { return ra < rb }
            let da = DeviceReturnWindow.dayPrefix(a.dueDate)
            let db = DeviceReturnWindow.dayPrefix(b.dueDate)
            if (da == nil) != (db == nil) { return da != nil }
            if let da, let db, da != db { return da < db }
            return a.itemKey < b.itemKey
        }
    }

    /// Groups the queue into severity sections, each already sorted. Grouping
    /// (rather than one flat sorted list) is what makes a mixed queue readable:
    /// the user sees "Cần xử lý ngay" as a block instead of inferring the
    /// boundary from a colour repeating down the screen. Empty groups are dropped.
    public static func sections(_ items: [ActionItem]) -> [(severity: ActionSeverity, items: [ActionItem])] {
        let ordered = sorted(items)
        return ActionSeverity.allCases.compactMap { severity in
            let rows = ordered.filter { ActionSeverity.of($0.severity) == severity }
            return rows.isEmpty ? nil : (severity, rows)
        }
    }

    // MARK: Destination

    /// The entity to open, or `nil` when this item has none.
    public static func target(_ item: ActionItem) -> ActionTarget? {
        if let id = nonBlank(item.deviceId) { return .device(id) }
        if let id = nonBlank(item.subscriptionId) { return .subscription(id) }
        if let id = nonBlank(item.wishlistItemId) { return .wishlistItem(id) }
        return nil
    }

    private static func nonBlank(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespaces), !trimmed.isEmpty else { return nil }
        return trimmed
    }

    // MARK: Dates

    /// "Còn 3 ngày" / "Hôm nay" / "Quá hạn 5 ngày" for an item's `dueDate`, or
    /// `nil` when the item has no single date. `now` is a parameter so the rules
    /// can be tested without depending on the calendar.
    ///
    /// Only the date half of the timestamp is read: the server sends naive UTC,
    /// so an instant-based parse would shift the day.
    public static func dueNote(_ dueDate: String?,
                              now: Date = Date(),
                              calendar: Calendar = .current) -> ActionDueNote? {
        guard let days = DeviceReturnWindow.daysLeft(dueDate, now: now, calendar: calendar) else {
            return nil
        }
        if days < 0 { return ActionDueNote(label: "Quá hạn \(abs(days)) ngày", urgency: .overdue) }
        if days == 0 { return ActionDueNote(label: "Hôm nay", urgency: .today) }
        if days <= 7 { return ActionDueNote(label: "Còn \(days) ngày", urgency: .soon) }
        return ActionDueNote(label: "Còn \(days) ngày", urgency: .later)
    }

    /// `dd/MM/yyyy` for a naive-UTC timestamp, or `nil` when there is nothing
    /// sensible to print. A malformed value renders as "no date", never a crash.
    public static func dateLabel(_ iso: String?) -> String? {
        DeviceReturnWindow.deadlineLabel(iso)
    }

    /// `true` when the item carries money to show.
    public static func hasAmount(_ item: ActionItem) -> Bool { item.amountVnd != nil }

    // MARK: Copy

    /// What the snackbar says after a successful snooze. `SnoozeResult.days` is
    /// the duration the server applied, echoed rather than assumed.
    public static func snoozeConfirmation(_ result: SnoozeResult) -> String {
        if let until = DeviceReturnWindow.deadlineLabel(result.snoozedUntil) {
            return "Đã hoãn \(result.days) ngày — việc này hiện lại \(until)"
        }
        return "Đã hoãn \(result.days) ngày"
    }

    /// The subtitle under the screen title: the actionable workload, split by
    /// severity, built from `counts` — never from the visible rows.
    public static func subtitle(counts: Int, snoozed: Int) -> String {
        let head = counts == 0 ? "Không còn việc nào" : "\(counts) việc cần xử lý"
        return snoozed > 0 ? "\(head) · \(snoozed) việc đang hoãn" : head
    }

    /// The subtitle on the dashboard's door into the queue. `total == nil` means
    /// the extra read failed: the row claims nothing rather than "0 việc".
    public static func entrySubtitle(counts: ActionCounts?) -> String {
        guard let counts else { return "Mở hàng đợi việc app tự suy ra từ dữ liệu của bạn" }
        if counts.total == 0 { return "Không có việc nào đang chờ xử lý" }
        return counts.high > 0
            ? "\(counts.total) việc cần xử lý · \(counts.high) mức cao"
            : "\(counts.total) việc cần xử lý"
    }
}
