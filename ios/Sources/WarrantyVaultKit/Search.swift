import Foundation

// MARK: - Cross-entity search (GET /api/v1/search)
//
// One round trip across devices, subscriptions and wishlist (roadmap #7). The
// server rules live in `api/internal/services/search.go`; everything here is the
// client-side mirror of them plus the grouping the screen renders.

/// Client-side mirror of the query rules `services.Search` enforces, so the
/// screen can classify what the user typed before (or instead of) asking the
/// server.
public enum SearchQueryRules {

    /// `services.MaxSearchQueryRunes` — anything longer is a paste accident and
    /// the server answers 400.
    public static let maxRunes = 200

    /// `services.DefaultSearchLimit` — rows returned **per group**.
    public static let defaultLimit = 20

    /// `services.MaxSearchLimit` — the cap the server clamps `limit` to.
    public static let maxLimit = 50

    public static func trimmed(_ raw: String) -> String {
        raw.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// A blank query is not an error: `services.Search` answers 200 with three
    /// empty groups, because clearing a search box is not a mistake. The screen
    /// shows its "type something" state instead of an error.
    public static func isBlank(_ raw: String) -> Bool { trimmed(raw).isEmpty }

    /// Counts **runes** (Unicode code points), which is what Go's
    /// `utf8.RuneCountInString` counts. Swift's `String.count` counts grapheme
    /// clusters instead — a family emoji is 1 to `count` and several to Go — so
    /// counting `unicodeScalars` keeps the client's cap identical to the
    /// server's for every string Swift can represent.
    public static func runeCount(_ raw: String) -> Int {
        trimmed(raw).unicodeScalars.count
    }

    public static func exceedsMaxRunes(_ raw: String) -> Bool {
        runeCount(raw) > maxRunes
    }

    /// Per-group limit, clamped the way `services.Search` clamps it: a
    /// non-positive value falls back to the default, and the top is capped.
    public static func clampedLimit(_ limit: Int) -> Int {
        guard limit > 0 else { return defaultLimit }
        return min(limit, maxLimit)
    }

    /// Vietnamese copy for input the server would reject with 400
    /// (mirrors `services.Search`'s message).
    public static let tooLongMessage = "Từ khoá tìm kiếm quá dài (tối đa 200 ký tự)."
}

/// Payload of `GET /api/v1/search`. Groups are always arrays — `[]`, never
/// `null` — so the screen can iterate unconditionally.
public struct SearchResults: Decodable, Sendable, Equatable {
    /// The trimmed query the server actually matched, `""` when none was sent.
    public let query: String
    public let devices: [Device]
    public let subscriptions: [Subscription]
    public let wishlist: [WishlistItem]

    public init(query: String,
                devices: [Device] = [],
                subscriptions: [Subscription] = [],
                wishlist: [WishlistItem] = []) {
        self.query = query
        self.devices = devices
        self.subscriptions = subscriptions
        self.wishlist = wishlist
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.query = try c.decodeIfPresent(String.self, forKey: .query) ?? ""
        // The server guarantees arrays, but decoding a missing/null group as
        // empty keeps the screen alive (and shows "no results" rather than an
        // error) if that ever regresses.
        self.devices = try c.decodeIfPresent([Device].self, forKey: .devices) ?? []
        self.subscriptions = try c.decodeIfPresent([Subscription].self, forKey: .subscriptions) ?? []
        self.wishlist = try c.decodeIfPresent([WishlistItem].self, forKey: .wishlist) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case query, devices, subscriptions, wishlist
    }
}

/// One entity group of a search response, ready for a section header.
public struct SearchSection: Identifiable, Equatable, Sendable {

    public enum Kind: String, Sendable, CaseIterable {
        case devices, subscriptions, wishlist

        /// Matches the tab label each entity lives under, so a result reads as
        /// "that other tab's row".
        public var title: String {
            switch self {
            case .devices:       return "Thiết bị"
            case .subscriptions: return "Đăng ký"
            case .wishlist:      return "Wishlist"
            }
        }
    }

    public let kind: Kind
    public let count: Int

    public var id: String { kind.rawValue }
    public var title: String { kind.title }

    public init(kind: Kind, count: Int) {
        self.kind = kind
        self.count = count
    }
}

extension SearchResults {

    /// The groups that actually have rows, in the order the screen shows them
    /// (the same order the tabs use). Empty groups are dropped rather than
    /// rendered as an empty header.
    public var sections: [SearchSection] {
        var out: [SearchSection] = []
        if !devices.isEmpty { out.append(.init(kind: .devices, count: devices.count)) }
        if !subscriptions.isEmpty { out.append(.init(kind: .subscriptions, count: subscriptions.count)) }
        if !wishlist.isEmpty { out.append(.init(kind: .wishlist, count: wishlist.count)) }
        return out
    }

    /// True when a real query matched nothing anywhere.
    public var isEmpty: Bool {
        devices.isEmpty && subscriptions.isEmpty && wishlist.isEmpty
    }

    public var totalCount: Int {
        devices.count + subscriptions.count + wishlist.count
    }
}

/// What the search surface should be showing.
///
/// `resolve` is the whole state machine, kept pure so the awkward cases are
/// pinned by tests — above all: **clearing the box must return to `idle`, never
/// leave a stale error or a stale "no results" on screen**.
public enum SearchPhase: Equatable, Sendable {
    /// Blank input: nothing typed yet, so there is nothing to ask for.
    case idle
    /// Over `SearchQueryRules.maxRunes` — the server would answer 400, so we
    /// never send it.
    case tooLong
    /// A request is in flight (including the typing debounce).
    case loading
    /// At least one group has rows.
    case results
    /// A real query that matched nothing in any group.
    case noResults
    /// Transport / server failure, carrying Vietnamese copy.
    case failed(String)

    public static func resolve(query: String,
                               isLoading: Bool,
                               results: SearchResults?,
                               error: String?) -> SearchPhase {
        if SearchQueryRules.exceedsMaxRunes(query) { return .tooLong }
        if SearchQueryRules.isBlank(query) { return .idle }
        if let error { return .failed(error) }
        if isLoading || results == nil { return .loading }
        return (results?.isEmpty ?? true) ? .noResults : .results
    }
}
