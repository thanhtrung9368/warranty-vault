import Foundation

// ============================================================
// DeadlineBoard — the dashboard's "next date I could miss"
//
// The home screen used to be a 2×2 grid of counts ("Còn BH 4 / Sắp hết 1 /
// Đã hết 0"). A count is not a date: it tells the user how many things exist
// but never *which one* is about to become a problem, so nothing on that
// screen could be acted on. The warranty product's home has to name the
// nearest deadline and say when it is.
//
// This file is the pure half of that: merge the three dated feeds the app
// already reads — warranty reminders, active subscriptions, wishlist target
// dates — into one ordered board. Return windows are deliberately absent:
// they exist only on the device detail read, so a home-screen board that
// included them would need one extra request per device.
//
// The date is carried as an absolute `Date` *and* as a day count. The day
// count is what the pill already said ("Còn 9d"); the absolute date is the
// fact a user needs to put in a calendar, and it is the one a relative label
// can never give back once it drifts from "9d" to "~3th" to "2 năm".
// ============================================================

/// What kind of dated thing a deadline belongs to. The order of the cases is
/// the deterministic tie-break when two deadlines land on the same day.
public enum DeadlineKind: String, Codable, Sendable, CaseIterable {
    case warranty
    case subscription
    case wishlist

    /// Warranty first: it is the thing the product exists to protect. A
    /// subscription renewal and a wishlist target are both easier to reschedule
    /// than a lapsed warranty.
    var sortRank: Int {
        switch self {
        case .warranty:     return 0
        case .subscription: return 1
        case .wishlist:     return 2
        }
    }
}

/// One dated thing on the board. Built by the dashboard from the three feeds;
/// deliberately not tied to any of their wire types so the ordering rule can be
/// tested without decoding a reminder, a subscription and a wishlist row.
public struct DeadlineCandidate: Identifiable, Equatable, Sendable {
    public let kind: DeadlineKind
    /// The id of the device / subscription / wishlist row this deadline is
    /// about. Two warranty packages on the same device share it.
    public let entityId: String
    /// What the card names: the device or subscription name.
    public let title: String
    /// Category code for the icon, when the source carries one.
    public let category: String?
    public let date: Date
    /// Whole days from "today" to `date`; negative means already past.
    public let days: Int

    public var id: String { "\(kind.rawValue):\(entityId)" }

    public init(
        kind: DeadlineKind,
        entityId: String,
        title: String,
        category: String? = nil,
        date: Date,
        days: Int
    ) {
        self.kind = kind
        self.entityId = entityId
        self.title = title
        self.category = category
        self.date = date
        self.days = days
    }
}

// MARK: - Ordering

public enum DeadlineBoard {

    /// How many deadlines the home screen shows below the card.
    public static let rowCount = 3

    /// The board's one ordering rule: **earliest date first**.
    ///
    /// An overdue deadline sorts before every future one — it is the one the
    /// user has already missed and it needs attention now. Ties break by kind
    /// (warranty → subscription → wishlist) and then by title/id so the order
    /// is stable across reloads instead of following dictionary or fetch
    /// order.
    public static func ordered(_ candidates: [DeadlineCandidate]) -> [DeadlineCandidate] {
        candidates.sorted { a, b in
            if a.date != b.date { return a.date < b.date }
            if a.kind.sortRank != b.kind.sortRank { return a.kind.sortRank < b.kind.sortRank }
            if a.title != b.title { return a.title < b.title }
            return a.entityId < b.entityId
        }
    }

    /// One device with several warranty packages would otherwise occupy
    /// several rows of a three-row board. Keeps the earliest package per
    /// entity — the nearest date is the one that matters.
    public static func deduplicated(_ candidates: [DeadlineCandidate]) -> [DeadlineCandidate] {
        var best: [String: DeadlineCandidate] = [:]
        var order: [String] = []
        for candidate in ordered(candidates) {
            if best[candidate.id] == nil {
                best[candidate.id] = candidate
                order.append(candidate.id)
            }
        }
        return order.compactMap { best[$0] }
    }

    /// The nearest deadline plus the next three rows. `nearest` is `nil` only
    /// when there is nothing dated at all — an empty board is a fact, not a
    /// loading state; callers must not render it before the reads answer.
    public static func board(
        _ candidates: [DeadlineCandidate]
    ) -> (nearest: DeadlineCandidate?, rows: [DeadlineCandidate]) {
        let ordered = deduplicated(candidates)
        return (ordered.first, Array(ordered.dropFirst().prefix(rowCount)))
    }
}

// MARK: - Copy

/// The absolute-date line every deadline prints: `Hết hạn 12/03/2027 · còn 9
/// ngày`.
///
/// Two rules that matter:
///
///  * the **absolute date is always present**. `WarrantyPillCopy.label` grows
///    vaguer as the date recedes ("Còn 12d" → "Còn ~3th" → "2 năm"), so a list
///    row built from it alone can never answer "when exactly?";
///  * past and future are never the same sentence. `quá hạn` is its own
///    phrase, not a negative "còn", for the same reason the pill's expired
///    branch is its own key.
///
/// The French-style `dd/MM/yyyy` text is passed in already formatted
/// (`WVFormat.date`), so this rule stays pure and testable without a locale.
public enum DeadlineCopy {

    /// The noun the card prints for a kind. Uses the app's existing labels so
    /// the board speaks the same language as the tabs.
    public static func kindLabel(_ kind: DeadlineKind) -> String {
        switch kind {
        case .warranty:     return L.t("Bảo hành")
        case .subscription: return L.t("Gói đăng ký")
        case .wishlist:     return L.t("Đang thèm")
        }
    }

    /// "Hết hạn 12/03/2027 · còn 9 ngày", "Gia hạn 12/03/2027 · hôm nay",
    /// "Dự kiến mua 12/03/2027 · quá hạn 4 ngày".
    public static func label(kind: DeadlineKind, dateText: String, days: Int) -> String {
        "\(dateLabel(kind: kind, dateText: dateText)) · \(dayPhrase(days))"
    }

    /// Just the day fragment, for a row that prints the date itself.
    public static func dayPhrase(_ days: Int) -> String {
        if days == 0 { return L.t("hôm nay") }
        if days > 0 { return L.p("còn %d ngày", days) }
        return L.p("quá hạn %d ngày", -days)
    }

    /// "Hết hạn 12/03/2027" / "Gia hạn …" / "Dự kiến mua …".
    public static func dateLabel(kind: DeadlineKind, dateText: String) -> String {
        switch kind {
        case .warranty:     return L.t("Hết hạn %@", dateText)
        case .subscription: return L.t("Gia hạn %@", dateText)
        case .wishlist:     return L.t("Dự kiến mua %@", dateText)
        }
    }
}
