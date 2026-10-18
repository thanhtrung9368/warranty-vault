import Foundation

// MARK: - Cross-entity search (GET /api/v1/search)
//
// One round trip across devices, subscriptions, wishlist and OCR transcripts
// (roadmap #7 + #13). The server rules live in
// `api/internal/services/search.go`; everything here is the client-side mirror
// of them plus the grouping the screen renders.

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

    /// A blank query is not an error: `services.Search` answers 200 with four
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
    /// A `let`, not a function: the message is static, and the caller can
    /// render it once. It goes through the catalog so it follows the selected
    /// language like every other user-visible line.
    public static var tooLongMessage: String { L.t("Từ khoá tìm kiếm quá dài (tối đa 200 ký tự).") }
}

/// Payload of `GET /api/v1/search`. Groups are always arrays — `[]`, never
/// `null` — so the screen can iterate unconditionally.
public struct SearchResults: Decodable, Sendable, Equatable {
    /// The trimmed query the server actually matched, `""` when none was sent.
    public let query: String
    public let devices: [Device]
    public let subscriptions: [Subscription]
    public let wishlist: [WishlistItem]
    /// OCR-text hits (migration 0019). The group is always an array; a hit
    /// carries its public attachment shape plus `deviceId` (nil = inbox).
    public let attachments: [AttachmentSearchHit]

    public init(query: String,
                devices: [Device] = [],
                subscriptions: [Subscription] = [],
                wishlist: [WishlistItem] = [],
                attachments: [AttachmentSearchHit] = []) {
        self.query = query
        self.devices = devices
        self.subscriptions = subscriptions
        self.wishlist = wishlist
        self.attachments = attachments
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
        self.attachments = try c.decodeIfPresent(
            [AttachmentSearchHit].self, forKey: .attachments
        ) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case query, devices, subscriptions, wishlist, attachments
    }
}

/// One hit of the search `attachments` group (openapi `AttachmentSearchHit`).
///
/// Flattened on the wire: all `AttachmentMeta` fields plus a `deviceId` that is
/// **always present** in this shape (`null` = inbox). The nested `attachment`
/// keeps the rest of the app using the same type it already decodes everywhere,
/// while `filing` owns the inbox-vs-filed decision instead of letting the view
/// interpret a raw id.
public struct AttachmentSearchHit: Decodable, Sendable, Equatable, Hashable, Identifiable {
    public let attachment: AttachmentMeta

    /// `nil` means the file is still in the inbox. The key is required by the
    /// contract; a missing key is treated as inbox because that is the safe
    /// reading of "no device attached".
    public let deviceId: String?

    public init(attachment: AttachmentMeta, deviceId: String? = nil) {
        self.attachment = attachment
        self.deviceId = deviceId
    }

    public init(from decoder: Decoder) throws {
        self.attachment = try AttachmentMeta(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.deviceId = try c.decodeIfPresent(String.self, forKey: .deviceId)
    }

    private enum CodingKeys: String, CodingKey { case deviceId }

    public var id: String { attachment.id }

    /// Filed-or-inbox, the one rule both the inbox and this group use.
    public var filing: AttachmentFiling {
        InboxRules.filing(deviceId: deviceId)
    }

    public var isInInbox: Bool { filing.isInbox }
}

/// One entity group of a search response, ready for a section header.
public struct SearchSection: Identifiable, Equatable, Sendable {

    public enum Kind: String, Sendable, CaseIterable {
        case devices, subscriptions, wishlist, attachments

        /// Matches the tab label each entity lives under, so a result reads as
        /// "that other tab's row". Receipts have no tab of their own; they live
        /// in the inbox, so their title is the thing that was scanned.
        public var title: String {
            switch self {
            case .devices:       return L.t("Thiết bị")
            case .subscriptions: return L.t("Đăng ký")
            case .wishlist:      return "Wishlist"
            case .attachments:   return L.t("Hoá đơn")
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
        if !attachments.isEmpty { out.append(.init(kind: .attachments, count: attachments.count)) }
        return out
    }

    /// True when a real query matched nothing anywhere.
    public var isEmpty: Bool {
        devices.isEmpty && subscriptions.isEmpty && wishlist.isEmpty && attachments.isEmpty
    }

    public var totalCount: Int {
        devices.count + subscriptions.count + wishlist.count + attachments.count
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
