import Foundation

// MARK: - Warranty service directory (FEATURE_IDEAS #15)
//
// `GET /api/v1/devices/{id}/service-directory` answers one very concrete
// question — *"giờ tôi mang máy đi đâu"* — and its whole design is about **not
// pretending to know things**. Web and Android shipped it first; this file is the
// iOS half of the same contract (openapi `ServiceDirectory`,
// `BrandServiceInfo`, `WarrantyCentre`), and the honesty rules live here as pure
// functions so a network-free test can pin them:
//
//   1. `brand: null` is a valid answer meaning *the app has no verified entry for
//      that brand* — either no seeded row matches, or the free-text match was
//      **ambiguous** and the server refused to guess. It is rendered as a
//      sentence, never as an empty box, and this client never invents a URL.
//   2. `phoneSource ∈ {user, none}` is the mechanism that keeps a number from
//      looking app-verified. `user` means the user typed it; `none` means there is
//      nothing. Only `user` yields a `tel:` action, and a number whose source this
//      client does not recognise is shown **flagged**, never promoted.
//   3. The app stores no hotline and no centre address of its own: migration 0008
//      deliberately left `WarrantyProvider.phone`/`.address` NULL ("a wrong
//      hotline is worse than an empty one") and migration 0012 gave
//      `BrandServiceInfo` no phone/address columns at all.
//   4. `providerInput` is always shown next to the resolved `provider`, because
//      the match is fuzzy and the user's own words are what they can check.
//
// ## Casing, the way this API actually spells things
//
// `phoneSource` is **lowercase on the wire** (`user` / `none`) while the enums
// around it are SCREAMING CASE (`warrantyType: STANDARD | EXTENDED | THIRD_PARTY`,
// `status`, `category`). A client that inferred the casing instead of reading
// openapi failed to decode the whole directory response. `PhoneSource` therefore
// has lowercase raw values and is read through a **lenient** initializer that
// never fails a payload: an unrecognised or missing value becomes `nil` (rendered
// as "nguồn chưa rõ"), not a `DecodingError` that takes every other field down
// with it — and never a promoted `user`.

// MARK: - Wire shapes

/// Where a phone number came from. The API promises exactly two values, and the
/// app is never one of them.
public enum PhoneSource: String, Codable, Sendable, CaseIterable {
    /// The user typed this number.
    case user
    /// There is no number. Never rendered as a hotline and never guessed at.
    case none

    /// Tolerant read of the wire value: trimmed, then matched against the two
    /// documented lowercase spellings. Anything else — including `USER`, which is
    /// what a client that inferred the casing from the neighbouring SCREAMING
    /// CASE enums would expect — is `nil`, rendered as "nguồn chưa rõ".
    ///
    /// The alternative — a synthesized enum decode — throws on an unexpected
    /// string, which would fail the entire `ServiceDirectory` payload over one
    /// field. `nil` keeps the rest of the response usable, and it fails in the
    /// honest direction: an unrecognised source is never promoted to "the user
    /// typed this".
    public init?(wire: String?) {
        guard let raw = wire?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty else { return nil }
        self.init(rawValue: raw)
    }

    /// Vietnamese label. `user` states the *source*, not a verification — the app
    /// never checked the number and must not look like it did.
    public var label: String {
        switch self {
        case .user: return L.t("Số do bạn tự ghi")
        case .none: return L.t("Chưa có số điện thoại")
        }
    }
}

/// One brand row of the service directory (openapi `BrandServiceInfo`). **No
/// `phone`, no `address`** — the table has no such columns, on purpose.
public struct BrandServiceInfo: Decodable, Sendable, Hashable {
    public let brandId: String
    public let name: String
    /// The brand's own authorised-service-centre locator. `nil` when there is no
    /// verifiable URL.
    public let serviceLocatorUrl: String?
    /// The brand's general support page. May not list a single centre — which is
    /// why the UI labels it differently from the locator.
    public let supportUrl: String?
    /// Vietnamese note explaining what the links are for.
    public let notes: String?
}

/// The catalog row a free-text provider string matched (openapi
/// `WarrantyProviderRef`). Its own `phone`/`address` are `null` for every seeded
/// row, so the UI shows `WarrantyCentre.phone`/`.address` instead.
public struct WarrantyProviderRef: Decodable, Sendable, Hashable {
    public let id: String
    public let name: String
    public let phone: String?
    public let address: String?
    public let websiteUrl: String?
    public let notes: String?
}

/// One warranty's contact row — **one per warranty of the device**, including
/// warranties that match no catalog row.
public struct WarrantyCentre: Decodable, Sendable, Identifiable, Hashable {
    public let warrantyId: String
    /// Kept as a string, like the web's normaliser: an unknown value must not fail
    /// the response, and `warrantyTypeLabel` renders it honestly.
    public let warrantyType: String
    public let endDate: Date?
    /// Server-computed "still running today", when the server sent it. `nil`
    /// (older payload) falls back to `endDate` in `ServiceDirectoryInfo.centreStatus`
    /// rather than defaulting to "expired".
    public let isActive: Bool?
    /// `Warranty.provider` exactly as the user typed it. **Always** rendered, even
    /// next to a matched `provider`.
    public let providerInput: String?
    /// The catalog row the free text matched, or `nil` — which is normal, not an
    /// error.
    public let provider: WarrantyProviderRef?
    /// `Warranty.address`, written by the user. The app never fills this in.
    public let address: String?
    /// `Warranty.phone`, written by the user. The app never fills this in.
    public let phone: String?
    /// `user` when `phone` has a value, `none` when there is none. `nil` only for a
    /// value this client does not recognise.
    public let phoneSource: PhoneSource?

    public var id: String { warrantyId }

    private enum CodingKeys: String, CodingKey {
        case warrantyId, warrantyType, endDate, isActive, providerInput, provider
        case address, phone, phoneSource
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        warrantyId = try c.decode(String.self, forKey: .warrantyId)
        warrantyType = try c.decodeIfPresent(String.self, forKey: .warrantyType) ?? ""
        endDate = try c.decodeIfPresent(Date.self, forKey: .endDate)
        isActive = try c.decodeIfPresent(Bool.self, forKey: .isActive)
        providerInput = try c.decodeIfPresent(String.self, forKey: .providerInput)
        provider = try c.decodeIfPresent(WarrantyProviderRef.self, forKey: .provider)
        address = try c.decodeIfPresent(String.self, forKey: .address)
        phone = try c.decodeIfPresent(String.self, forKey: .phone)
        // Lenient on purpose: see the file header. A missing or unknown
        // `phoneSource` must not fail the whole directory.
        phoneSource = PhoneSource(wire: try c.decodeIfPresent(String.self, forKey: .phoneSource))
    }
}

/// The whole directory bundle (openapi `ServiceDirectory`).
public struct ServiceDirectory: Decodable, Sendable {
    public let deviceId: String
    public let deviceName: String
    /// Category **code** (`PHONE`); the Vietnamese label comes from
    /// `CategoryLabels.swift`, as with every other payload.
    public let category: String
    /// `Device.brand` exactly as the user typed it. `nil` when never recorded.
    public let brandInput: String?
    /// The brand's directory row, or `nil` — meaning "no seeded row" or "ambiguous
    /// match". Both are explained in the UI; neither is filled with a guess.
    public let brand: BrandServiceInfo?
    /// One row per warranty, always an array (never `null`).
    public let centres: [WarrantyCentre]
    /// The server's own Vietnamese explanation of why so many fields are `null`.
    /// Rendered **verbatim**.
    public let disclaimer: String

    private enum CodingKeys: String, CodingKey {
        case deviceId, deviceName, category, brandInput, brand, centres, disclaimer
    }

    /// `deviceId` is the only field this client insists on — without it the
    /// payload cannot be tied to a device at all. Everything else degrades to
    /// "absent" instead of failing the decode, because a directory that cannot be
    /// parsed renders as "no information", which is the one answer this feature
    /// must never give by accident.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        deviceId = try c.decode(String.self, forKey: .deviceId)
        deviceName = try c.decodeIfPresent(String.self, forKey: .deviceName) ?? ""
        category = try c.decodeIfPresent(String.self, forKey: .category) ?? ""
        brandInput = try c.decodeIfPresent(String.self, forKey: .brandInput)
        brand = try c.decodeIfPresent(BrandServiceInfo.self, forKey: .brand)
        centres = try c.decodeIfPresent([WarrantyCentre].self, forKey: .centres) ?? []
        disclaimer = try c.decodeIfPresent(String.self, forKey: .disclaimer) ?? ""
    }
}

// MARK: - Copy

/// Every Vietnamese sentence the directory shows. Kept in the Kit so the honesty
/// rules and the words for them cannot drift apart, and a test can assert them.
public enum DirectoryCopy {

    /// Section-level line: the app ships no hotline and no address of its own.
    public static let sectionHint =
        L.t("App không lưu sẵn hotline hay địa chỉ trung tâm bảo hành — một hotline sai còn tệ hơn không có. Link của hãng bên dưới là nguồn duy nhất app dám chỉ; số điện thoại và địa chỉ còn lại là do bạn tự ghi.")

    /// `brand: null` with no brand text either: nothing to look up yet.
    public static let noBrandInputTitle = L.t("Thiết bị chưa ghi hãng")
    public static let noBrandInputDetail =
        L.t("Thêm hãng cho thiết bị (nút “Sửa” ở đầu trang) để app tra danh bạ trung tâm bảo hành uỷ quyền của hãng đó.")

    /// `brand: null` with brand text present. **Both** honest causes are named —
    /// no seeded row, and a tie in the free-text match — and so is the limit of
    /// the claim: the app will not guess and will not invent a URL.
    public static let noEntryTitle = L.t("App không có thông tin đã kiểm chứng cho hãng này")
    public static let noEntryDetail =
        L.t("App chỉ có danh bạ cho một số hãng. Không có dòng nào khớp hãng bạn ghi, hoặc nhiều dòng khớp ngang nhau (chuỗi mơ hồ) nên app không đoán bừa. App cũng không tự tạo URL — bạn tra trang hỗ trợ chính thức của hãng để tìm trung tâm uỷ quyền gần nhất.")

    /// A brand row exists but carries no link this client can open.
    public static let noVerifiedLink = L.t("App không có link nào đã kiểm chứng cho hãng này.")

    /// Shown above the links of a brand row that *does* have one.
    public static let verifiedLinkNote =
        L.t("Link dưới đây do chính hãng duy trì — app chỉ dẫn lại, không chép hotline.")

    public static let linkServiceLocatorLabel = L.t("Tra cứu trung tâm bảo hành uỷ quyền")
    public static let linkSupportLabel = L.t("Trang hỗ trợ của hãng")

    /// The line that must accompany every phone number, present or absent.
    public static let phoneHonesty =
        L.t("App không phải nguồn của số điện thoại nào: số hiện ra là do bạn tự ghi cho gói bảo hành, còn “chưa có số” nghĩa là app không biết — không phải hotline.")

    public static let phoneUserLabel = L.t("Do bạn tự ghi")
    public static let phoneUserHint = L.t("Số này bạn tự nhập cho gói bảo hành; app không kiểm chứng.")

    public static let phoneNoneLabel = L.t("Chưa có số điện thoại")
    public static let phoneNoneHint =
        L.t("App không lưu hotline của hãng hay trung tâm nên không có số nào để hiện.")

    /// Only for a value this client cannot attribute. Never upgraded to "user".
    public static let phoneUnverifiedLabel = L.t("Nguồn số chưa rõ")
    public static let phoneUnverifiedHint =
        L.t("Máy chủ không nói số này từ đâu tới, nên app không coi nó là số đã kiểm chứng.")

    public static let addressUserLabel = L.t("Địa chỉ do bạn tự ghi")
    public static let addressNone = L.t("Chưa ghi địa chỉ cho gói này.")

    public static let providerUnmatched =
        L.t("Chưa khớp danh bạ nhà bảo hành — app hiện đúng chữ bạn đã ghi và không đoán.")
    public static let providerMatchedNote = L.t("Khớp danh bạ nhà bảo hành.")
    public static let providerNone = L.t("Chưa ghi nhà bảo hành cho gói này.")
    public static let noProvider = L.t("Chưa ghi nơi bảo hành")

    public static let noCentres =
        L.t("Thiết bị chưa có gói bảo hành nào nên chưa có nơi bảo hành nào để hiện. Thêm gói bảo hành rồi ghi nơi bạn sẽ mang máy tới.")

    public static let unavailableState =
        L.t("Không tải được danh bạ bảo hành — thử tải lại nhé.")

    public static let unknownWarrantyType = L.t("Không rõ loại")
}

// MARK: - Rules

public enum ServiceDirectoryInfo {

    private static func str(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else { return nil }
        return trimmed
    }

    // MARK: Brand tier

    public enum BrandState: Sendable, Equatable {
        /// No brand text on the device — the fix is in the user's hands.
        case noInput(title: String, detail: String)
        /// Brand text present, no resolved row: no seeded match, or an ambiguous
        /// one. The user's own words are carried so they can be shown verbatim.
        case noEntry(title: String, detail: String, brandInput: String)
        case entry(BrandServiceInfo)
    }

    /// Decide what the brand half shows. `brand == nil` has its own wording in
    /// both directions (nothing recorded / nothing verified), so it is never an
    /// empty box and never a made-up URL.
    public static func brandState(_ directory: ServiceDirectory) -> BrandState {
        if let brand = directory.brand {
            return .entry(brand)
        }
        guard let input = str(directory.brandInput) else {
            return .noInput(title: DirectoryCopy.noBrandInputTitle,
                            detail: DirectoryCopy.noBrandInputDetail)
        }
        return .noEntry(title: DirectoryCopy.noEntryTitle,
                        detail: DirectoryCopy.noEntryDetail,
                        brandInput: input)
    }

    /// The links of a brand row this client is willing to open, with the label
    /// approved for each. Only well-formed `http(s)` URLs survive: an entry that
    /// cannot be opened must not become a button that fails silently on tap.
    public static func brandLinks(_ brand: BrandServiceInfo) -> [(label: String, url: URL)] {
        var links: [(label: String, url: URL)] = []
        if let url = safeExternalURL(brand.serviceLocatorUrl) {
            links.append((DirectoryCopy.linkServiceLocatorLabel, url))
        }
        if let url = safeExternalURL(brand.supportUrl) {
            links.append((DirectoryCopy.linkSupportLabel, url))
        }
        return links
    }

    /// `true` when the brand row carries at least one link worth showing.
    public static func hasVerifiedLink(_ brand: BrandServiceInfo) -> Bool {
        !brandLinks(brand).isEmpty
    }

    /// The brand's own Vietnamese note, or `nil` when there is nothing to add.
    public static func brandNote(_ brand: BrandServiceInfo) -> String? { str(brand.notes) }

    /// Only `http(s)` ever becomes an openable link. The catalog is
    /// admin-curated, but a catalog row is **data**, not code: a `javascript:` or
    /// `data:` value must not become a tappable row.
    public static func safeExternalURL(_ value: String?) -> URL? {
        guard let raw = str(value), let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty else { return nil }
        return url
    }

    // MARK: Phone disclosure

    public enum PhoneDisclosure: Sendable, Equatable {
        /// The user typed it: shown as theirs, and the only case that may be dialled.
        case user(phone: String, label: String, hint: String)
        /// There is nothing. Said in words that cannot be read as "call this hotline".
        case none(label: String, hint: String)
        /// A number this client cannot attribute. Shown, but flagged — never
        /// presented as app-verified, and never dialled.
        case unverified(phone: String, label: String, hint: String)

        /// The `tel:` URL, and **only** for `.user`. Nil for both other cases, so
        /// a call action cannot be offered for a number whose source is unknown or
        /// absent — gating lives here rather than in each view.
        public var dialURL: URL? {
            guard case .user(let phone, _, _) = self else { return nil }
            return ServiceDirectoryInfo.dialURL(for: phone)
        }
    }

    /// Turn `phone` + `phoneSource` into something renderable without ever letting
    /// a number look app-verified.
    ///
    /// The two contradictions are resolved in the honest direction: a non-blank
    /// number whose source is `none` is **no number** (the source is the authority
    /// on where a number came from), and a number with an unrecognised source is
    /// `.unverified` rather than promoted to `.user`.
    public static func phoneDisclosure(_ centre: WarrantyCentre) -> PhoneDisclosure {
        phoneDisclosure(phone: centre.phone, source: centre.phoneSource)
    }

    public static func phoneDisclosure(phone: String?, source: PhoneSource?) -> PhoneDisclosure {
        guard let number = str(phone) else {
            return .none(label: DirectoryCopy.phoneNoneLabel, hint: DirectoryCopy.phoneNoneHint)
        }
        switch source {
        case .some(.user):
            return .user(phone: number, label: DirectoryCopy.phoneUserLabel,
                         hint: DirectoryCopy.phoneUserHint)
        case .some(.none):
            return .none(label: DirectoryCopy.phoneNoneLabel, hint: DirectoryCopy.phoneNoneHint)
        case nil:
            // The wire value was missing or one this client does not recognise:
            // shown, flagged, and never offered as the user's own word.
            return .unverified(phone: number, label: DirectoryCopy.phoneUnverifiedLabel,
                               hint: DirectoryCopy.phoneUnverifiedHint)
        }
    }

    /// A `tel:` URL for a number the user can actually dial, or `nil`.
    ///
    /// Whitespace and the formatting people type — `.`, `(`, `)` — are dropped,
    /// and anything left outside the characters a dialler understands makes this
    /// `nil`: a row whose number cannot be dialled is rendered as text instead of
    /// a button that opens nothing. `+`, `*`, `#` and `-` are kept: they carry
    /// meaning in a phone number.
    public static func dialURL(for phone: String) -> URL? {
        let cleaned = phone.filter { !$0.isWhitespace && !"().".contains($0) }
        guard !cleaned.isEmpty,
              cleaned.allSatisfy({ $0.isNumber || "+*#-".contains($0) }) else { return nil }
        return URL(string: "tel:\(cleaned)")
    }

    // MARK: Centre tier

    /// `Warranty.address`, or `nil` when there is none — the app has never stored
    /// a centre address of its own.
    public static func centreAddress(_ centre: WarrantyCentre) -> String? { str(centre.address) }

    public enum ProviderState: Sendable, Equatable {
        case matched(name: String, input: String?, note: String)
        case unmatched(name: String?, input: String, note: String)
        case noInput(name: String?, input: String?, note: String)

        /// The line to render, always non-empty: the catalog name, or the user's
        /// own words, or a sentence saying nothing was recorded.
        public var line: String {
            switch self {
            case .matched(let name, _, _): return name
            case .unmatched(_, let input, _): return input
            case .noInput: return DirectoryCopy.noProvider
            }
        }
    }

    /// `provider` is legitimately `nil`, and the user's own `providerInput` is
    /// **always** rendered next to it, so the row can never look empty.
    public static func providerState(_ centre: WarrantyCentre) -> ProviderState {
        let input = str(centre.providerInput)
        if let provider = centre.provider, let name = str(provider.name) {
            return .matched(name: name, input: input, note: DirectoryCopy.providerMatchedNote)
        }
        guard let input else {
            return .noInput(name: nil, input: nil, note: DirectoryCopy.providerNone)
        }
        return .unmatched(name: nil, input: input, note: DirectoryCopy.providerUnmatched)
    }

    public enum CentreStatus: Sendable, Equatable {
        case active
        case expired
        case undated

        public var label: String {
            switch self {
            case .active:  return L.t("Còn hạn")
            case .expired: return L.t("Đã hết hạn")
            case .undated: return L.t("Chưa ghi hạn")
            }
        }
    }

    /// Whether this package's coverage is still running. `isActive` is
    /// server-computed and preferred; when it is absent the end date decides, and
    /// "no end date" is its own answer rather than a default of "expired".
    public static func centreStatus(_ centre: WarrantyCentre, now: Date = Date()) -> CentreStatus {
        if let isActive = centre.isActive {
            return isActive ? .active : .expired
        }
        guard let end = centre.endDate else { return .undated }
        return end > now ? .active : .expired
    }

    /// `WarrantyType` label for the payload's string, falling back to the raw
    /// value and then to a sentence — never a blank.
    public static func warrantyTypeLabel(_ type: String) -> String {
        if let known = WarrantyType(rawValue: type) { return known.label }
        return str(type) ?? DirectoryCopy.unknownWarrantyType
    }

    /// `"3 gói bảo hành"` — the row count, which is the device's warranty count.
    public static func centreCountLabel(_ centres: [WarrantyCentre]) -> String {
        switch centres.count {
        case 0:  return L.t("Thiết bị chưa có gói bảo hành nào")
        case 1:  return L.t("1 gói bảo hành")
        default: return L.p("%d gói bảo hành", centres.count)
        }
    }

    // MARK: Rollup

    public struct ContactSummary: Sendable, Equatable {
        public let centres: Int
        public let withUserPhone: Int
        public let withUserAddress: Int
        public let unmatchedProviders: Int

        /// `"1/3 gói có số điện thoại do bạn tự ghi · 2 gói chưa khớp danh bạ nhà bảo hành. App không có hotline nào trong hai con số đó."`
        public var line: String {
            guard centres > 0 else { return DirectoryCopy.noCentres }
            var parts = [L.t("%d/%d gói có số điện thoại do bạn tự ghi", withUserPhone, centres)]
            if unmatchedProviders > 0 {
                parts.append(L.p("%d gói chưa khớp danh bạ nhà bảo hành", unmatchedProviders))
            }
            return parts.joined(separator: " · ") + L.t(". App không có hotline nào trong hai con số đó.")
        }
    }

    /// Counts for the honest one-line summary above the centre list. A number only
    /// counts as "có số" when its source is `user` — the same rule the phone row
    /// renders, so the summary cannot overstate what the app has.
    public static func contactSummary(_ directory: ServiceDirectory) -> ContactSummary {
        var withUserPhone = 0
        var withUserAddress = 0
        var unmatchedProviders = 0
        for centre in directory.centres {
            if case .user = phoneDisclosure(centre) { withUserPhone += 1 }
            if centreAddress(centre) != nil { withUserAddress += 1 }
            if case .unmatched = providerState(centre) { unmatchedProviders += 1 }
        }
        return ContactSummary(centres: directory.centres.count,
                              withUserPhone: withUserPhone,
                              withUserAddress: withUserAddress,
                              unmatchedProviders: unmatchedProviders)
    }

    /// The server's own sentence about why so many fields are `null`, or `nil`
    /// when it sent nothing. Rendered verbatim when present.
    public static func disclaimer(_ directory: ServiceDirectory) -> String? { str(directory.disclaimer) }
}
