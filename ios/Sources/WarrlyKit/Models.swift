import Foundation

// MARK: - Auth

public struct AuthSuccess: Decodable, Sendable {
    public let accessToken: String
    public let expiresAt: Date
    public let user: User
}

public struct User: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let email: String
    public let name: String?
    public let aiOptIn: Bool?
    /// The language the user picked in Settings (`User.locale`, migration 0014).
    ///
    /// `nil` means **"never chosen"**, which is NOT the same as `"en"`: the
    /// request still decides via `?lang=` → `Accept-Language` → `en`. The server
    /// omits the key entirely while it is null, so old clients see no change.
    ///
    /// Kept as the raw two-letter code rather than an `AppLanguage` so a value
    /// this build does not know (a future third language) cannot fail decoding
    /// and lock the user out of their own account.
    public let locale: String?

    /// The account's own address for forwarding receipts by email
    /// (`<inboxToken>@INBOX_EMAIL_DOMAIN`, migration 0020; `POST
    /// /api/v1/inbox/email` files the mail's attachment into the inbox).
    ///
    /// **Absent, not empty, when the deployment has no mail provider.** The
    /// server omits the key entirely (`omitempty`), so `nil` is the one honest
    /// answer and the UI renders *nothing* — a row holding an empty string
    /// would look like a broken address and invite the user to copy it.
    ///
    /// It is a **write-only capability**: knowing the address only lets someone
    /// send mail into the inbox. It cannot read, list, download or delete
    /// anything, and it is deliberately not part of a backup.
    public let inboxAddress: String?

    public init(id: String, email: String, name: String?, aiOptIn: Bool? = nil,
                locale: String? = nil, inboxAddress: String? = nil) {
        self.id = id; self.email = email; self.name = name
        self.aiOptIn = aiOptIn; self.locale = locale
        self.inboxAddress = inboxAddress
    }

    /// `locale` resolved against the languages this build actually ships.
    public var preferredLanguage: AppLanguage? { AppLanguage.parse(locale) }
}

// MARK: - Profile update (PATCH /auth/me)

/// Body of `PATCH /api/v1/auth/me`.
///
/// Both fields are **tri-state and independent** (see `openapi.yaml`): an absent
/// key leaves the stored value alone, `nil`/`""` CLEARS it, and a value sets it.
/// Sending `{"locale": "vi"}` on its own is a valid body, which is exactly what
/// the language switcher needs — and it means a client that only knows about
/// `displayName` cannot wipe a stored language by editing a name.
///
/// Modelled as `String?` + an explicit "was it set" flag rather than
/// `String??`, because `JSONEncoder` collapses the two `nil`s.
public struct UpdateProfileInput: Encodable, Sendable {
    /// Sentinel for "key absent". A plain `String?` cannot express three states.
    public enum Field: Sendable, Equatable {
        /// Key absent — keep whatever is stored.
        case unchanged
        /// `null` — clear the stored value.
        case clear
        /// A new value.
        case set(String)

        var isSet: Bool { if case .unchanged = self { return false }; return true }
        var value: String? { if case let .set(v) = self { return v }; return nil }
    }

    public var displayName: Field
    public var locale: Field

    public init(displayName: Field = .unchanged, locale: Field = .unchanged) {
        self.displayName = displayName
        self.locale = locale
    }

    enum CodingKeys: String, CodingKey { case displayName, locale }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        if displayName.isSet {
            try container.encode(displayName.value, forKey: .displayName)
        }
        if locale.isSet {
            try container.encode(locale.value, forKey: .locale)
        }
    }
}

/// Response of `PATCH /api/v1/auth/me`: the same shape as `GET /auth/me` plus a
/// server-translated `message`, so the caller can replace its cached user
/// directly instead of re-fetching. The `message` is NOT re-translated here —
/// it already arrives in the language `Accept-Language` asked for.
public struct UpdateProfileResult: Decodable, Sendable {
    public let user: User
    public let message: String?
}

public struct RegisterInput: Encodable, Sendable {
    public var email: String
    public var password: String
    public var name: String?
    public var deviceLabel: String?
    public var platform: String? // "ios"

    public init(email: String, password: String, name: String? = nil,
                deviceLabel: String? = nil, platform: String? = "ios") {
        self.email = email; self.password = password; self.name = name
        self.deviceLabel = deviceLabel; self.platform = platform
    }
}

public struct LoginInput: Encodable, Sendable {
    public var email: String
    public var password: String
    public var deviceLabel: String?
    public var platform: String?

    public init(email: String, password: String,
                deviceLabel: String? = nil, platform: String? = "ios") {
        self.email = email; self.password = password
        self.deviceLabel = deviceLabel; self.platform = platform
    }
}

public struct ChangePasswordInput: Encodable, Sendable {
    public var currentPassword: String
    public var newPassword: String
    public var confirmPassword: String

    public init(currentPassword: String, newPassword: String, confirmPassword: String) {
        self.currentPassword = currentPassword
        self.newPassword = newPassword
        self.confirmPassword = confirmPassword
    }
}

public struct ChangePasswordResult: Decodable, Sendable {
    public let ok: Bool
    public let message: String?
}

// MARK: - Domain enums

public enum DeviceStatus: String, Codable, CaseIterable, Sendable {
    case ACTIVE, EXPIRED, SOLD, BROKEN, LOST

    public var label: String {
        switch self {
        case .ACTIVE:  return L.t("Đang dùng")
        case .EXPIRED: return L.t("Hết bảo hành")
        case .SOLD:    return L.t("Đã bán")
        case .BROKEN:  return L.t("Hỏng")
        case .LOST:    return L.t("Mất")
        }
    }
}

public enum WarrantyType: String, Codable, CaseIterable, Sendable {
    case STANDARD, EXTENDED, THIRD_PARTY

    public var label: String {
        switch self {
        case .STANDARD:    return L.t("Tiêu chuẩn")
        case .EXTENDED:    return L.t("Mở rộng")
        case .THIRD_PARTY: return L.t("Bên thứ ba")
        }
    }
}

public enum BillingCycle: String, Codable, CaseIterable, Sendable {
    case MONTHLY, QUARTERLY, YEARLY, LIFETIME, CUSTOM

    public var label: String {
        switch self {
        case .MONTHLY:   return L.t("Hàng tháng")
        case .QUARTERLY: return L.t("Hàng quý")
        case .YEARLY:    return L.t("Hàng năm")
        case .LIFETIME:  return L.t("Lifetime / Trọn đời")
        case .CUSTOM:    return L.t("Tuỳ chỉnh")
        }
    }
}

public enum SubscriptionStatus: String, Codable, CaseIterable, Sendable {
    case ACTIVE, PAUSED, CANCELED, EXPIRED

    public var label: String {
        switch self {
        case .ACTIVE:   return L.t("Đang hoạt động")
        case .PAUSED:   return L.t("Tạm dừng")
        case .CANCELED: return L.t("Đã huỷ")
        case .EXPIRED:  return L.t("Hết hạn")
        }
    }
}

public enum WishlistPriority: String, Codable, CaseIterable, Sendable {
    case MUST, WANT, MAYBE

    public var label: String {
        switch self {
        case .MUST:  return L.t("Phải mua")
        case .WANT:  return L.t("Muốn")
        case .MAYBE: return L.t("Cân nhắc")
        }
    }
}

public enum WishlistStatus: String, Codable, CaseIterable, Sendable {
    case WATCHING, DECIDED, SKIPPED, PURCHASED

    public var label: String {
        switch self {
        case .WATCHING:  return L.t("Đang theo dõi")
        case .DECIDED:   return L.t("Quyết mua")
        case .SKIPPED:   return L.t("Bỏ qua")
        case .PURCHASED: return L.t("Đã mua")
        }
    }
}

public enum PushPlatform: String, Codable, CaseIterable, Sendable {
    case web, apns, fcm
}

// MARK: - Brand warranty lookup

/// What the brand's own system says about this device's warranty (openapi
/// `Device.brandWarrantyStatus`).
///
/// Five values, and the difference matters:
///
///   * `ACTIVE` / `EXPIRED` — the brand has a warranty and says whether it is
///     running;
///   * `NOT_REGISTERED` — the brand has **no record of this device at all**,
///     which is not the same answer as "expired";
///   * `PRE_ACTIVATED` — the device was activated before the user bought it
///     (the grey-market / shop-pre-activated case this feature exists for);
///   * `UNKNOWN` — the brand (or this build) cannot say.
///
/// ## Lenient wire decode
///
/// A sixth value shipped by a future server must not fail the whole device
/// payload. An unrecognised string decodes as `.UNKNOWN`, which is the honest
/// rendering: this build does not understand the answer. A missing value stays
/// `nil`, because "nothing was recorded" and "recorded as unknown" are
/// different states.
public enum BrandWarrantyStatus: String, CaseIterable, Sendable, Hashable {
    case ACTIVE
    case EXPIRED
    case NOT_REGISTERED
    case PRE_ACTIVATED
    case UNKNOWN

    /// Tolerant read of a wire value: trimmed, then matched against the five
    /// documented spellings. Anything else — including the lowercase spelling a
    /// client might infer instead of reading the contract — becomes `.UNKNOWN`
    /// rather than a decoding failure.
    public init(wire: String?) {
        let raw = wire?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() ?? ""
        self = Self(rawValue: raw) ?? .UNKNOWN
    }

    /// The label the section and the record sheet show, in the current language.
    /// Computed rather than a stored `let` so switching language re-renders it.
    public var label: String {
        switch self {
        case .ACTIVE:         return L.t("Hãng ghi còn bảo hành")
        case .EXPIRED:        return L.t("Hãng ghi đã hết hạn")
        case .NOT_REGISTERED: return L.t("Hãng chưa ghi nhận máy này")
        case .PRE_ACTIVATED:  return L.t("Máy đã được kích hoạt trước")
        case .UNKNOWN:        return L.t("Hãng chưa rõ tình trạng")
        }
    }
}

extension BrandWarrantyStatus: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        guard !container.decodeNil() else {
            self = .UNKNOWN
            return
        }
        // Lenient beyond the enum: a malformed value (a number, say) must not
        // fail the whole device payload. This build does not understand it, and
        // `.UNKNOWN` is the honest rendering of that.
        self.init(wire: (try? container.decode(String.self)))
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

/// Which way the brand's dates disagree with the user's (openapi
/// `Device.warrantyMismatch.kind`).
///
/// Modelled as an optionally-typed enum rather than a raw string so the copy
/// selector is exhaustive. `nil` only ever comes from a wire value this build
/// does not recognise — a future kind must still render the two dates and the
/// day count, in a generic sentence, instead of blanking the flag or failing the
/// entire device decode.
public enum WarrantyMismatchKind: String, CaseIterable, Sendable, Hashable {
    case STARTS_BEFORE
    case STARTS_AFTER
    case ENDED_EARLIER
    case ENDED_LATER

    /// Tolerant read. `nil` for a missing or unrecognised kind.
    public init?(wire: String?) {
        let raw = wire?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() ?? ""
        self.init(rawValue: raw)
    }
}

/// The server-computed disagreement between the brand's dates and the user's
/// purchase date (openapi `Device.warrantyMismatch`), or `nil` when there is no
/// disagreement **or nothing to compare**.
///
/// Both dates are kept as the raw wire strings and only their leading
/// `YYYY-MM-DD` is ever displayed (`BrandWarrantyRules`), for the same reason
/// `soldAt` / `receivedAt` are: parsing a Z-less server timestamp as an instant
/// moves the calendar day in a negative-offset zone.
public struct WarrantyMismatch: Sendable, Hashable {
    /// `nil` for a kind this build does not know; the generic copy still uses
    /// `days` and both dates.
    public let kind: WarrantyMismatchKind?
    /// The magnitude of the difference, in whole days, exactly as the server
    /// computed it. The client never re-derives the mismatch.
    public let days: Int
    /// The brand's date (start for `STARTS_*`, end for `ENDED_*`), raw wire.
    public let brandDate: String?
    /// The app's side of the comparison, raw wire.
    ///
    /// Despite the contract's field name, this is **not always the purchase
    /// date**: `STARTS_*` compare the brand start with `purchaseDate`, while
    /// `ENDED_*` compare the brand end with the device's whole-unit warranty
    /// end. `kind` says which date this is; `BrandWarrantyRules.mismatchDatesLine`
    /// labels it accordingly, so the card never tells the user to compare the
    /// brand's expiry with the invoice day.
    public let purchaseDate: String?

    public init(kind: WarrantyMismatchKind?, days: Int,
                brandDate: String?, purchaseDate: String?) {
        self.kind = kind
        self.days = days
        self.brandDate = brandDate
        self.purchaseDate = purchaseDate
    }
}

extension WarrantyMismatch: Codable {
    private enum CodingKeys: String, CodingKey {
        case kind, days, brandDate, purchaseDate
    }

    public init(from decoder: Decoder) throws {
        // A malformed computed object must not take down the entire device
        // payload: degrade to the generic mismatch copy, which still has the
        // kind-less day count and whatever dates were readable.
        guard let c = try? decoder.container(keyedBy: CodingKeys.self) else {
            kind = nil
            days = 0
            brandDate = nil
            purchaseDate = nil
            return
        }
        let rawKind = (try? c.decodeIfPresent(String.self, forKey: .kind)) ?? nil
        kind = WarrantyMismatchKind(wire: rawKind)
        days = ((try? c.decodeIfPresent(Int.self, forKey: .days)) ?? nil) ?? 0
        brandDate = (try? c.decodeIfPresent(String.self, forKey: .brandDate)) ?? nil
        purchaseDate = (try? c.decodeIfPresent(String.self, forKey: .purchaseDate)) ?? nil
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(kind?.rawValue, forKey: .kind)
        try c.encode(days, forKey: .days)
        try c.encodeIfPresent(brandDate, forKey: .brandDate)
        try c.encodeIfPresent(purchaseDate, forKey: .purchaseDate)
    }
}

// MARK: - Device

public struct Device: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let userId: String?
    public let name: String
    public let category: String
    public let brand: String?
    public let model: String?
    public let serialNumber: String?
    public let purchaseDate: Date

    /// What the device cost, **in `currency`** — not necessarily dong. `0` is
    /// a real price (a gift) and is different from "not recorded" on the write
    /// side (`DeviceInput.purchasePrice` is non-optional).
    public let purchasePrice: Int
    public let purchasePlace: String?
    public let status: DeviceStatus
    public let notes: String?
    public let createdAt: Date?
    public let updatedAt: Date?

    /// ISO 4217 code the purchase and sale prices are recorded in
    /// (openapi `Device.currency`, default `VND`).
    ///
    /// Optional on the **read** side only, like `leadDays`: an older cached
    /// payload (or a server that has not shipped the field yet) must still
    /// decode, and `nil` means the contract default `VND` — read it through
    /// `currencyCode`, never by treating `nil` as an unknown currency.
    ///
    /// `Device` has a synthesized `Codable`, so a `nil` here is dropped on
    /// encode. That is fine: this type is a read projection, and the write side
    /// is `DeviceInput` (whose encoder always writes both currency keys).
    public let currency: String?

    /// The exchange rate **locked when the amount was entered**: VND per one
    /// unit of `currency` (`25_400` for a $1 device bought at 25,400 ₫).
    ///
    /// `nil` for VND; the contract requires a positive value for every other
    /// currency (400 `fieldErrors.fxRate` otherwise). It is deliberately never
    /// refreshed from the market: re-rating a historical purchase would make
    /// every total move with today's rate.
    public let fxRate: Int?

    /// Reminder lead times for this device's warranties, in **days before
    /// expiry**, e.g. `[30, 7]`.
    ///
    /// Optional on the **read** side only: older cached payloads and a server
    /// that has not shipped the field yet must still decode, so `nil` means
    /// "not returned", not "no reminders". The contract returns it sorted
    /// descending with 1…5 entries in `0...365`; read it through
    /// `LeadDaysRules` rather than trusting the raw array.
    ///
    /// ## Encoding
    ///
    /// `Device` has a synthesized `Codable` conformance, which calls
    /// `encodeIfPresent` for this property: a **non-nil array is always
    /// encoded**, while `nil` is dropped. That omission is correct for this
    /// field — the contract defines an absent/`null` `leadDays` as "leave the
    /// stored schedule alone" on update and as the server default `[30, 7]` on
    /// create. (It is *not* the `AttachmentDescriptionInput.description` case,
    /// where an absent key is a 400 and `nil` must travel as an explicit JSON
    /// null; that is why the two are modelled differently.)
    public let leadDays: [Int]?

    /// Whether the warranty only starts once the retailer activates the device.
    ///
    /// `true` = e-warranty activation is required; `false` = the purchase date
    /// starts the warranty. Optional on the read side for the same reason
    /// `leadDays` is: an older cached payload (or a server that has not shipped
    /// the field yet) must still decode. `nil` means the documented default
    /// `false`, which is what `isActivationRequired` returns.
    public let activationRequired: Bool?

    /// When the device was activated, as the server's date-time wire string.
    ///
    /// Kept as the raw `String` — not a `Date` — for the same reason `soldAt` and
    /// `receivedAt` are: only its calendar day is ever shown or counted, and
    /// parsing an instant would move the day in a negative-offset zone. The wire
    /// may be `…Z`, Z-less time or a bare `YYYY-MM-DD`; read it through
    /// `WarrantyActivation`, never by parsing it here.
    ///
    /// This may legitimately be **earlier than `purchaseDate`** (a shop can
    /// pre-activate a device); the API does not reject it and neither does iOS.
    public let activatedAt: String?

    /// The last day extended cover (AppleCare+, Samsung Care+) can be bought, or
    /// `nil` when the user is not tracking it. Same raw-day rule as `activatedAt`;
    /// the countdown is `WarrantyActivation.buyByDaysLeft`.
    public let extendedCoverBuyBy: String?

    /// Never-nil view of `activationRequired` for the form and the detail screen.
    public var isActivationRequired: Bool { activationRequired ?? false }

    /// Exchange / return window ("1 đổi 1") length in days, recorded by the user
    /// for **this** device (migration 0010). Three states, and they are all
    /// different: `nil` = **chưa biết** (the API has no default and never infers
    /// one); `0` = the shop offers no exchange at all; `> 0` = that many days
    /// counted from `receivedAt` (or `purchaseDate`). This is a shop policy the
    /// user wrote down, **not** a legal right.
    ///
    /// ⚠️ `PATCH /api/v1/devices/{id}` replaces every field: a save that does not
    /// send this back **clears** a recorded window. `DeviceInput` carries it too
    /// for exactly that reason — see `DeviceReturnWindow`.
    public let returnWindowDays: Int?

    /// The day the user **actually received** the device, as the server's UTC
    /// timestamp (`"2026-03-02T00:00:00Z"`) — the same wire shape as
    /// `purchaseDate`. Kept as the raw string so only its date half is ever read:
    /// parsing it as an instant would move the calendar day by the device's UTC
    /// offset.
    ///
    /// `nil` means "chưa ghi", which is deliberately different from "arrived on
    /// the purchase date": the deadline then falls back to `purchaseDate`, but the
    /// app must not claim the device was received then.
    public let receivedAt: String?

    /// The derived exchange-window deadline,
    /// `COALESCE(receivedAt, purchaseDate) + returnWindowDays ngày`.
    ///
    /// Computed **server-side** on the list read only — it is not a stored column,
    /// so a write response (POST/PATCH) omits it and this stays `nil` there. `nil`
    /// also means "no window": unknown days, `0` days, or no date to count from.
    /// Never recompute it locally: three clients dividing days three ways is
    /// exactly what this field exists to prevent.
    public let returnDeadline: String?

    /// The day the user sold the device (resale pair, migration `0006`). The
    /// server sends a calendar day as `YYYY-MM-DD` (`"2026-03-02"`, `format:
    /// date`); it used to send a naive `"2026-03-02T00:00:00"`, which is why only
    /// the leading ten characters are ever read.
    ///
    /// Kept as the raw `String` so only the leading `YYYY-MM-DD` is ever read —
    /// parsing it as an instant would move the calendar day in a negative-offset
    /// zone. `nil` = no sale recorded.
    ///
    /// ⚠️ `PATCH /api/v1/devices/{id}` replaces every field: a save that does not
    /// send this back **erases** a sale recorded on the web or on Android.
    /// `DeviceInput` carries it too for exactly that reason — see `DeviceResale`.
    public let soldAt: String?

    /// What the device was sold for, in `currency` (not necessarily VND). `0` is
    /// a real answer — a give-away — and is deliberately different from `nil`
    /// ("chưa bán"). The server enforces the pair rule: `soldAt` and
    /// `soldPrice` travel together or not at all.
    public let soldPrice: Int?

    /// `soldPrice` converted to VND **by the server** at the locked rate.
    ///
    /// Present only when the device was sold **and** its rate is usable; the
    /// key is omitted otherwise (openapi `soldPriceVnd`, "and soldPriceVnd when
    /// sold"). Use this — never `soldPrice` — in any total.
    public let soldPriceVnd: Int?

    /// `purchasePrice` converted to VND **by the server** at the locked rate.
    ///
    /// Present on **every** device read — list, detail, search, create and
    /// update (the Go `DeviceVND` shape embeds it in all of them). It is `null`
    /// only when a non-VND row has no usable rate, which only legacy or
    /// hand-edited data can hold; it is never faked at par. This is the only
    /// number that may enter a VND total — a foreign `purchasePrice` summed raw
    /// would treat $999 as 999 ₫.
    ///
    /// Optional only so a payload from before the field existed still decodes.
    /// `purchasePriceInVnd` applies the totals rule: server value first, the
    /// native amount only when the device is VND.
    public let purchasePriceVnd: Int?

    // MARK: Brand warranty lookup (openapi `Device.brandWarranty*`)

    /// What the brand's own system says, or `nil` when the user has never
    /// recorded a check. Never inferred from the local dates.
    public let brandWarrantyStatus: BrandWarrantyStatus?

    /// The start date **the brand showed**, as the server's raw wire string.
    ///
    /// Kept raw for the same reason `soldAt` is: only its calendar day is ever
    /// displayed (`BrandWarrantyRules.dayLabel`), and parsing a Z-less timestamp
    /// as an instant would move the day in a negative-offset zone.
    public let brandWarrantyStart: String?

    /// The end date the brand showed, raw wire. May be earlier than the start
    /// only in bad data; the write rule (`BrandWarrantyRules`) rejects that
    /// before it is sent.
    public let brandWarrantyEnd: String?

    /// When the user last recorded a check with the brand, raw wire timestamp.
    public let brandCheckedAt: String?

    /// The URL the user opened while checking, recorded verbatim.
    ///
    /// This is the **user's record**, not a URL the app invented. A brand whose
    /// service info carries no `warrantyLookupUrl` must leave this empty; the
    /// app never guesses a page.
    public let brandLookupUrl: String?

    /// The server-computed disagreement between the brand's dates and the
    /// dates the app is using (purchase date for a start, whole-unit warranty
    /// end for an end), or `nil`.
    ///
    /// Read this field; never re-derive it. `nil` is deliberately ambiguous —
    /// it means "no disagreement **or** nothing to compare", which is why
    /// `BrandWarrantyRules.mismatchState` looks at the recorded fields too before
    /// claiming the two sides agree.
    public let warrantyMismatch: WarrantyMismatch?

    // MARK: Multi-currency derived views

    /// Never-nil ISO code: a decoded `nil` means the contract default `VND`.
    public var currencyCode: String { CurrencyRules.normalized(currency) }

    /// Whether the prices are in something other than dong.
    public var usesForeignCurrency: Bool { CurrencyRules.requiresRate(currency) }

    /// What this purchase contributes to a VND total, or `nil` when it cannot
    /// be known (a foreign amount with no server-computed VND value). See
    /// `CurrencyRules.totalVnd`.
    public var purchasePriceInVnd: Int? {
        CurrencyRules.totalVnd(native: purchasePrice,
                               serverVnd: purchasePriceVnd,
                               currency: currency)
    }

    /// What the sale contributes to a VND total, or `nil` when there is no sale
    /// or the foreign amount has no server-computed VND value.
    public var soldPriceInVnd: Int? {
        CurrencyRules.totalVnd(native: soldPrice,
                               serverVnd: soldPriceVnd,
                               currency: currency)
    }

    // List-row projection only (`GET /api/v1/devices`). The Go service returns
    // `DeviceListItem` = `store.Device` + these two counts — see
    // `api/internal/services/devices.go` and `website/src/lib/api/devices.ts`.
    // Both are absent on create/update/detail responses, hence optional.
    //
    // NOTE: these two fields are missing from the `Device` schema in
    // `openapi.yaml` even though the server emits them; the web client already
    // relies on them.
    public let attachmentCount: Int?
    public let effectiveWarrantyEnd: Date?
}

public struct DeviceDetail: Decodable, Sendable {
    public let device: DeviceDetailBody
}

public struct DeviceDetailBody: Decodable, Sendable {
    public let id: String
    public let name: String
    public let category: String
    public let brand: String?
    public let model: String?
    public let serialNumber: String?
    public let purchaseDate: Date

    /// In `currency`, not necessarily dong — same rule as `Device.purchasePrice`.
    public let purchasePrice: Int
    public let status: DeviceStatus
    public let notes: String?
    public let attachments: [AttachmentMeta]?
    public let warranties: [Warranty]?

    /// The server's effective warranty end for this device: the max `endDate`
    /// over its **whole-unit** rows only (`openapi.yaml`
    /// `DeviceWithEffectiveWarranty`, computed by
    /// `wholeUnitWarrantyEnd`). `nil` when no whole-unit row has an end.
    ///
    /// The detail read carries it, so the screen never has to re-derive the
    /// value from `warranties` — a local max over every row is what let a
    /// component-scoped warranty (a ten-year motor) become the device's end.
    /// Optional so a payload from a server that has not shipped the key still
    /// decodes; `nil` there means "not returned", and
    /// `StatsRollup.effectiveWarrantyEnd` is the fallback.
    public let effectiveWarrantyEnd: Date?

    // The multi-currency trio on the detail read. The detail endpoint embeds the
    // whole `store.Device`, so these have the same wire shape and rules as
    // their `Device` counterparts: `currency`/`fxRate` describe what the money
    // fields on this device mean, and the two `…Vnd` values are computed by the
    // server at the locked rate. Optional only for an older server; read them
    // through the computed views below.
    public let currency: String?
    public let fxRate: Int?
    public let purchasePriceVnd: Int?
    public let soldPriceVnd: Int?

    /// Never-nil ISO code (`nil` = the contract default `VND`).
    public var currencyCode: String { CurrencyRules.normalized(currency) }

    /// Whether this device's prices are in something other than dong.
    public var usesForeignCurrency: Bool { CurrencyRules.requiresRate(currency) }

    /// The purchase's contribution to a VND total, or `nil` when unknown.
    public var purchasePriceInVnd: Int? {
        CurrencyRules.totalVnd(native: purchasePrice,
                               serverVnd: purchasePriceVnd,
                               currency: currency)
    }

    /// The sale's contribution to a VND total, or `nil` when there is no sale
    /// or its foreign amount has no server value.
    public var soldPriceInVnd: Int? {
        CurrencyRules.totalVnd(native: soldPrice,
                               serverVnd: soldPriceVnd,
                               currency: currency)
    }

    /// Reminder lead times, on the detail read. Same field and same rules as
    /// `Device.leadDays`; optional because this screen may be talking to a
    /// server that has not shipped it yet.
    public let leadDays: [Int]?

    /// The device's repair claims ("Sửa chữa & bảo hành"), newest first.
    ///
    /// `GET /api/v1/devices/{id}` gained this array with the claims feature, so
    /// the device detail is the anchor for a claim: there is no separate read to
    /// perform before listing one device's repairs. The contract makes it `[]`
    /// for a device with no claims — never `null` — but it stays optional here
    /// so a payload from a server that has not shipped the field yet still
    /// decodes. `nil` means **"not returned"**, not "no claims"; read it through
    /// `claimsOrEmpty`.
    public let claims: [Claim]?

    /// Never-nil view of `claims` for the section that lists them.
    public var claimsOrEmpty: [Claim] { claims ?? [] }

    // Warranty activation / extended-cover deadline, on the detail read. The
    // detail endpoint embeds the whole `store.Device`, so the three fields have
    // the same wire shape and rules as their `Device` counterparts:
    // `activationRequired` is optional only for an older server, and the two
    // dates stay raw day strings so the calendar day cannot drift.
    public let activationRequired: Bool?
    public let activatedAt: String?
    public let extendedCoverBuyBy: String?

    /// Never-nil view of `activationRequired`, mirroring `Device`.
    public var isActivationRequired: Bool { activationRequired ?? false }

    // The return window, on the detail read (openapi `DeviceDetail`).
    //
    // The detail endpoint is where the **derived** deadline is available even for
    // a device that has dropped out of the list projection, and it is the read the
    // detail screen uses to draw the read-only "Hạn đổi/trả" row. Same three-state
    // rule as `Device.returnWindowDays`, and the same full-replacement warning:
    // `DeviceDetailView.saveStatus` sends all three of the fields it loaded back.
    public let returnWindowDays: Int?
    public let receivedAt: String?
    public let returnDeadline: String?

    // The resale pair, on the detail read. `DeviceDetail` embeds the whole
    // `store.Device`, so both halves are at the top level of `device` here —
    // same wire shape and same rules as `Device.soldAt` / `Device.soldPrice`.
    public let soldAt: String?
    public let soldPrice: Int?

    // The brand warranty lookup, on the detail read. Same wire shape and rules
    // as the five `Device.brandWarranty*` fields; the dates stay raw so their
    // calendar day cannot shift. `warrantyMismatch` is server-computed and is
    // what the detail screen renders — never re-derive it here.
    public let brandWarrantyStatus: BrandWarrantyStatus?
    public let brandWarrantyStart: String?
    public let brandWarrantyEnd: String?
    public let brandCheckedAt: String?
    public let brandLookupUrl: String?
    public let warrantyMismatch: WarrantyMismatch?
}

public struct DeviceInput: Encodable, Sendable {
    public var name: String
    public var category: String
    public var brand: String?
    public var model: String?
    public var serialNumber: String?
    public var purchaseDate: String  // YYYY-MM-DD
    public var purchasePrice: Int = 0
    public var purchasePlace: String?
    public var status: DeviceStatus = .ACTIVE
    public var notes: String?
    public var warrantyMonths: Int = 0
    public var warrantyProvider: String?
    public var warrantyAddress: String?
    public var warrantyPhone: String?
    public var warrantyNotes: String?
    public var fromWishlistId: String?

    // MARK: Multi-currency

    /// ISO 4217 code every money field in this payload is in (openapi
    /// `DeviceInput.currency`, default `VND`).
    ///
    /// Non-optional on the write side, like `activationRequired`: every save
    /// states it, so a PATCH can never fall back to the server default and
    /// silently re-denominate a $999 device as 999 ₫. The form normalises it
    /// through `CurrencyRules.normalized`, and `submit()` enforces the rate rule
    /// before building the payload.
    public var currency: String = CurrencyRules.vnd

    /// VND per one unit of `currency`, locked at entry (openapi
    /// `DeviceInput.fxRate`). `nil` for VND; required for anything else.
    ///
    /// ## Why the encoder is hand-written
    ///
    /// `currency`/`fxRate` are full-replacement fields: switching a device back
    /// to VND must send `"fxRate": null` to clear the stored rate. The
    /// synthesized conformance calls `encodeIfPresent` and would simply drop a
    /// `nil`, so the server could not tell "clear it" from "this client does not
    /// know the field" — the same failure `ClaimInput` documents. The encoder at
    /// the bottom of this type therefore always writes both keys, and keeps
    /// every other optional on the synthesized `encodeIfPresent` behaviour so
    /// existing payloads are byte-for-byte unchanged.
    public var fxRate: Int?

    /// Reminder lead times, in days before warranty expiry (openapi
    /// `DeviceInput.leadDays`). The device form always sends a value built by
    /// `LeadDaysRules.wireValue`: normalised descending, 1…5 entries, each
    /// `0...365`. The server also sorts and validates, so a bug here is a 400
    /// (`fieldErrors.leadDays`), never a silently stored odd schedule.
    ///
    /// `nil` is dropped from the JSON by the synthesized encoder. Unlike
    /// `returnWindowDays`, that is **not** destructive: the contract makes an
    /// absent/`null` `leadDays` mean "keep the stored schedule" on update and
    /// "use the server default `[30, 7]`" on create. The form still sends the
    /// loaded value back on every save, so the intent stays explicit.
    ///
    /// An empty array is **not** a way to clear the schedule — the server
    /// rejects it with a 400. A user who wants fewer reminders removes days
    /// until one is left.
    public var leadDays: [Int]?

    /// Whether the warranty only starts after the retailer activates the device
    /// (openapi `DeviceInput.activationRequired`, default `false`).
    ///
    /// Non-optional on the write side: the form always sends its current value,
    /// so a PATCH cannot accidentally fall back to the server default and turn a
    /// required-activation device into an ordinary one. It is independent of
    /// `activatedAt` — a device may require activation and not be activated yet.
    public var activationRequired: Bool = false

    /// When the device was activated (`YYYY-MM-DD` or full ISO), or `nil` when it
    /// has not been. `nil` is dropped by the synthesized encoder, which Go reads
    /// exactly like an explicit `null`: the date is cleared. Applied through
    /// `WarrantyActivation.apply` on every save path.
    ///
    /// A date **earlier than `purchaseDate` is valid** (pre-activation by the
    /// shop); no client-side validation rejects it.
    public var activatedAt: String?

    /// The last day extended cover can be bought (`YYYY-MM-DD` or full ISO), or
    /// `nil` when it is not tracked. Same null/clear rule as `activatedAt`.
    public var extendedCoverBuyBy: String?

    /// Exchange-window length in days (openapi `DeviceInput.returnWindowDays`).
    /// Independent of `receivedAt` — sending one without the other is valid.
    ///
    /// `nil` (the key is then dropped from the JSON, which Go decodes as nil
    /// exactly like an explicit null) means **chưa biết**; `0` is a real value
    /// meaning "cửa hàng không cho đổi trả" and must be sent as `0`, never
    /// collapsed into "absent". Out of `0–3650` → 400 `fieldErrors.returnWindowDays`.
    ///
    /// ⚠️ **Full-replacement warning.** `PATCH /api/v1/devices/{id}` replaces the
    /// whole row, so omitting this key **erases** a window recorded by another
    /// client. The device form therefore loads the existing value and sends it
    /// straight back on every save — see `DeviceReturnWindow`.
    public var returnWindowDays: Int?

    /// The day the device was actually received (`YYYY-MM-DD` or full ISO), or
    /// `nil` to clear it. Independent of `returnWindowDays`. Unparseable → 400
    /// `fieldErrors.receivedAt = ["Ngày nhận hàng không hợp lệ"]`.
    public var receivedAt: String?

    /// The day the device was sold, as `YYYY-MM-DD` (the contract says `format:
    /// date`; see `Device.soldAt` for why only the leading day is read), or `nil`
    /// when no sale is recorded.
    ///
    /// The server enforces a **pair rule** (`services.ValidateDeviceInput`):
    /// supplying exactly one of `soldAt`/`soldPrice` is a 400 with
    /// `fieldErrors.soldAt = ["Thiếu ngày bán"]` (date missing) or
    /// `fieldErrors.soldPrice = ["Thiếu giá bán"]` (price missing); a negative
    /// price is `fieldErrors.soldPrice = ["Giá bán không hợp lệ"]`. Both `nil`
    /// clears a previously recorded sale, which is independent of `status` — a
    /// device may be `SOLD` with no figures at all.
    ///
    /// ⚠️ **Full-replacement warning.** `PATCH /api/v1/devices/{id}` replaces the
    /// whole row, so omitting these keys **erases** a sale recorded by another
    /// client. Every save path loads the stored pair and sends it straight back —
    /// see `DeviceResale`.
    public var soldAt: String?

    /// What the device was sold for, in `currency`. `nil` is "chưa bán", while
    /// `0` is a real price (a give-away) that must be sent as `0`, never
    /// collapsed into "absent". Travels with `soldAt` or not at all — see the
    /// pair rule above.
    public var soldPrice: Int?

    // MARK: Brand warranty lookup

    /// The five fields recorded by `BrandWarrantyRecordSheet`, written through
    /// `BrandWarrantyRules.apply` on **every** save path.
    ///
    /// ⚠️ **Full-replacement warning.** `PATCH /api/v1/devices/{id}` replaces the
    /// whole row, so a save that does not carry them back erases a check
    /// recorded on the web or on Android — and even a bare status tap in
    /// `DeviceDetailView` does a full PATCH. `nil` keeps the key out of the JSON,
    /// which Go reads exactly like an explicit `null`: the field is cleared.
    ///
    /// The server's rules (openapi): `brandWarrantyStatus` is required whenever
    /// any other one of the five is set; `brandWarrantyEnd` must not precede
    /// `brandWarrantyStart`; `brandLookupUrl` must be an absolute http(s) URL.
    /// `BrandWarrantyRules.validationErrors` mirrors them for the sheet's local
    /// check, and the server's own `fieldErrors` still win.
    public var brandWarrantyStatus: BrandWarrantyStatus?
    /// `YYYY-MM-DD` (or a wire timestamp), or `nil` to clear.
    public var brandWarrantyStart: String?
    /// `YYYY-MM-DD` (or a wire timestamp), or `nil` to clear.
    public var brandWarrantyEnd: String?
    /// RFC3339 timestamp of the check, or `nil` to clear.
    public var brandCheckedAt: String?
    /// The URL the user opened, absolute http(s), or `nil` to clear.
    public var brandLookupUrl: String?

    public init(name: String, category: String, purchaseDate: String) {
        self.name = name; self.category = category; self.purchaseDate = purchaseDate
    }

    // Every key of `DeviceInput`, including the two currency fields. The only
    // difference from a synthesized conformance is that `currency` and `fxRate`
    // are written unconditionally — see `fxRate`'s documentation.
    enum CodingKeys: String, CodingKey {
        case name, category, brand, model, serialNumber, purchaseDate
        case purchasePrice, purchasePlace, status, notes
        case warrantyMonths, warrantyProvider, warrantyAddress, warrantyPhone, warrantyNotes
        case fromWishlistId
        case leadDays, activationRequired, activatedAt, extendedCoverBuyBy
        case returnWindowDays, receivedAt, soldAt, soldPrice
        case brandWarrantyStatus, brandWarrantyStart, brandWarrantyEnd
        case brandCheckedAt, brandLookupUrl
        case currency, fxRate
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        // Non-optional fields are always present.
        try container.encode(name, forKey: .name)
        try container.encode(category, forKey: .category)
        try container.encode(purchaseDate, forKey: .purchaseDate)
        try container.encode(purchasePrice, forKey: .purchasePrice)
        try container.encode(status, forKey: .status)
        try container.encode(warrantyMonths, forKey: .warrantyMonths)
        try container.encode(activationRequired, forKey: .activationRequired)
        // Optionals keep the synthesized `encodeIfPresent` behaviour: omitted,
        // not null. Go decodes both the same way for all of these.
        try container.encodeIfPresent(brand, forKey: .brand)
        try container.encodeIfPresent(model, forKey: .model)
        try container.encodeIfPresent(serialNumber, forKey: .serialNumber)
        try container.encodeIfPresent(purchasePlace, forKey: .purchasePlace)
        try container.encodeIfPresent(notes, forKey: .notes)
        try container.encodeIfPresent(warrantyProvider, forKey: .warrantyProvider)
        try container.encodeIfPresent(warrantyAddress, forKey: .warrantyAddress)
        try container.encodeIfPresent(warrantyPhone, forKey: .warrantyPhone)
        try container.encodeIfPresent(warrantyNotes, forKey: .warrantyNotes)
        try container.encodeIfPresent(fromWishlistId, forKey: .fromWishlistId)
        try container.encodeIfPresent(leadDays, forKey: .leadDays)
        try container.encodeIfPresent(activatedAt, forKey: .activatedAt)
        try container.encodeIfPresent(extendedCoverBuyBy, forKey: .extendedCoverBuyBy)
        try container.encodeIfPresent(returnWindowDays, forKey: .returnWindowDays)
        try container.encodeIfPresent(receivedAt, forKey: .receivedAt)
        try container.encodeIfPresent(soldAt, forKey: .soldAt)
        try container.encodeIfPresent(soldPrice, forKey: .soldPrice)
        // Brand warranty lookup. Omitted, not null, when unset — Go decodes both
        // the same way, and a PATCH that omits them clears a recorded check,
        // which is exactly what a form or status tap that loaded a device with
        // no check should do. Every save path still carries the loaded values
        // back so a recorded check survives.
        try container.encodeIfPresent(brandWarrantyStatus, forKey: .brandWarrantyStatus)
        try container.encodeIfPresent(brandWarrantyStart, forKey: .brandWarrantyStart)
        try container.encodeIfPresent(brandWarrantyEnd, forKey: .brandWarrantyEnd)
        try container.encodeIfPresent(brandCheckedAt, forKey: .brandCheckedAt)
        try container.encodeIfPresent(brandLookupUrl, forKey: .brandLookupUrl)
        // `warrantyMismatch` is deliberately absent: the contract makes it
        // read-only and server-computed. A DeviceInput cannot set it.
        // The two full-replacement fields, written unconditionally. `nil` for
        // a VND device is an explicit JSON null ("clear the rate"), which is the
        // only way to say that after the user switches currencies.
        try container.encode(currency, forKey: .currency)
        try container.encode(fxRate, forKey: .fxRate)
    }
}

// MARK: - Bulk device create
//
// `POST /api/v1/devices/bulk` — the frozen contract this file mirrors:
//
//   request   `{"devices": [<DeviceInput>, ...]}`, at most 50 rows
//             (over 50 → 400 with `fieldErrors.devices`)
//   response  `{"created": [<Device>], "failed": [{index, code, message,
//              fieldErrors}]}`
//
// The endpoint is deliberately **partial-success**: a bad row does not roll back
// the good ones. `index` refers to the request array, which is what lets the
// caller keep a failed row editable and resubmit only that row. A batch that
// would break the account's device quota is the one all-or-nothing case: 409
// `LIMIT_REACHED`, and nothing is created.
//
// These are wire types only. The decision-making (row → input, reconciling
// `created`/`failed` back onto the request rows, the 409 branch, quota
// arithmetic) lives in `BulkDevices.swift` so it can be tested before the
// server exists.

/// Body of `POST /api/v1/devices/bulk`.
public struct BulkCreateDevicesRequest: Encodable, Sendable {
    public let devices: [DeviceInput]

    public init(devices: [DeviceInput]) {
        self.devices = devices
    }
}

/// One row the bulk endpoint refused, keyed by its position in the **request**
/// array (`index`), never by the position of the failure in `failed`.
public struct BulkDeviceFailure: Decodable, Sendable, Equatable {
    /// Index into the request array. This is the only correlation the contract
    /// gives us between a failure and the row the user has to fix.
    public let index: Int

    /// Wire code (`VALIDATION`, `CATEGORY_INVALID`, ...). Kept as a string so a
    /// code this build has never heard of still decodes; the UI shows the
    /// server's `message` and `fieldErrors` rather than switching on the code.
    public let code: String

    /// Vietnamese/localised sentence written to be shown as-is. Optional
    /// because an older/foreign payload may omit it; the caller then falls back
    /// to its own "this row was not saved" copy.
    public let message: String?

    /// Per-field validation errors for this one row, in the same shape as the
    /// single-device endpoints. Optional for the same reason as `message`.
    public let fieldErrors: [String: [String]]?

    /// Never-nil view for the UI.
    public var fieldErrorsOrEmpty: [String: [String]] { fieldErrors ?? [:] }

    /// `message` with blank/whitespace-only treated as absent. The server's
    /// sentence is surfaced verbatim when present.
    public var messageOrNil: String? {
        guard let message else { return nil }
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    enum CodingKeys: String, CodingKey {
        case index, code, message, fieldErrors
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // `index` is required: without it the failure cannot be attached to a
        // row at all. `code` is display-only, so a missing one degrades to ""
        // instead of throwing the whole row away.
        index = try c.decode(Int.self, forKey: .index)
        code = try c.decodeIfPresent(String.self, forKey: .code) ?? ""
        message = try c.decodeIfPresent(String.self, forKey: .message)
        fieldErrors = try c.decodeIfPresent([String: [String]].self, forKey: .fieldErrors)
    }
}

/// Response of `POST /api/v1/devices/bulk`.
///
/// ## Lenient decode on purpose
///
/// `created`/`failed` are required by the contract, but a strict decode here
/// has the worst possible failure mode: the HTTP request succeeded, devices
/// **were** created, and the client would report an error — inviting the user to
/// retry the same batch and create duplicates. An absent array therefore means
/// "none reported" (`[]`), and the reconciliation treats a row that is neither
/// created nor failed as unconfirmed rather than silently successful.
public struct BulkCreateDevicesResult: Decodable, Sendable, Equatable {
    /// The devices the server actually created. The contract attaches no index
    /// to these, so their order is the request order of the successful rows —
    /// see `BulkDeviceRules.reconcile`.
    public let created: [Device]

    /// Per-row failures, each carrying the request `index` it belongs to.
    public let failed: [BulkDeviceFailure]

    enum CodingKeys: String, CodingKey { case created, failed }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        created = try c.decodeIfPresent([Device].self, forKey: .created) ?? []
        failed = try c.decodeIfPresent([BulkDeviceFailure].self, forKey: .failed) ?? []
    }
}

// MARK: - FX rates
//
// `GET /api/v1/fx/rates?base=USD` → `{base, rates, fetchedAt, stale}`. The app
// asks for the device's currency as `base` and reads the VND quote out of
// `rates`; the user can always type the rate instead, because the endpoint is
// allowed to answer 503.

public struct FxRates: Decodable, Sendable, Equatable {
    /// The currency the rates are quoted from — the `?base=` that was asked for.
    public let base: String

    /// Quote currency → how many units of it one `base` unit buys. The app
    /// needs the `VND` entry; read it through `vndRate`.
    public let rates: [String: Double]

    /// When the provider fetched the table, as the server's date-time string.
    /// Kept raw (not a `Date`): it is only ever shown next to a "may be stale"
    /// note, never compared or bucketed by calendar day.
    public let fetchedAt: String?

    /// Whether the server's provider cache had expired and it served the last
    /// known table. Optional only so a payload that predates the field still
    /// decodes; `nil` is treated as fresh.
    public let stale: Bool?

    public init(base: String, rates: [String: Double],
                fetchedAt: String? = nil, stale: Bool? = nil) {
        self.base = base
        self.rates = rates
        self.fetchedAt = fetchedAt
        self.stale = stale
    }

    /// Whether the table is a cached fallback.
    public var isStale: Bool { stale ?? false }

    /// VND per one unit of `base`, rounded to the whole đồng the wire field
    /// (`Device.fxRate`) stores. `nil` when the payload has no positive VND
    /// quote, which the form reads as "type it yourself" rather than as 1:1.
    public var vndRate: Int? {
        let quoted = rates[CurrencyRules.vnd]
            ?? rates.first(where: { $0.key.uppercased() == CurrencyRules.vnd })?.value
        guard let quoted, quoted.isFinite, quoted > 0 else { return nil }
        let rounded = quoted.rounded()
        guard rounded >= 1, rounded <= Double(Int.max) else { return nil }
        return Int(rounded)
    }
}

// MARK: - AI receipt draft

/// Draft returned by `POST /api/v1/ai/extract-receipt`. Mirrors the Go
/// `DraftDevice` / openapi schema. Every field is optional — the model returns
/// null for anything it can't read. This is NEVER persisted directly; the form
/// pre-fills from it and the user confirms before saving.
public struct DraftDevice: Decodable, Sendable {
    public let name: String?
    public let category: String?
    public let brand: String?
    public let brandId: String?
    public let model: String?
    public let serialNumber: String?
    public let purchaseDate: String?
    public let purchasePrice: Int?
    public let purchasePlace: String?
    public let storeId: String?
    public let warrantyMonths: Int?
    public let warrantyProviderId: String?
    public let confidence: String
    public let unmatched: [String]
    /// Advisories about values that were **kept** in the draft (openapi:
    /// `draft.warnings`, always present, `[]` when nothing looks wrong).
    ///
    /// Not to be confused with `unmatched`, which lists fields the extractor
    /// could not use. Optional only so a server that omits the array can't fail
    /// the whole scan; read it through `warningsOrEmpty`.
    public let warnings: [DeviceWarning]?

    /// The model's transcript of the document (openapi `draft.extractedText`).
    ///
    /// This is **not** a Device field: it is never sent back when the device is
    /// saved. On the `attachmentId` branch it is also persisted on the
    /// attachment and becomes searchable; on the multipart branch it is returned
    /// but not stored.
    public let extractedText: String?

    /// Whether the server actually wrote `extractedText` onto an `Attachment`
    /// row (openapi `draft.extractedTextStored`).
    ///
    /// Optional only so a payload that predates the field still decodes. `true`
    /// means the transcript is searchable through the `attachments` group of
    /// `GET /api/v1/search`; `false` means the draft is still usable but the
    /// receipt is not searchable. The scan UI reads this flag instead of
    /// assuming persistence happened.
    public let extractedTextStored: Bool?

    /// Never-nil view for the scan result UI.
    public var warningsOrEmpty: [DeviceWarning] { warnings ?? [] }

    /// Whether there is any transcript worth indexing. An empty/whitespace
    /// transcript is not a searchable one.
    public var hasExtractedText: Bool {
        guard let text = extractedText else { return false }
        return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

// MARK: - AI claim assessment

/// What the AI thinks the stored contract says about one claim
/// (`POST /api/v1/ai/assess-claim`, `ClaimAssessment.coverage`).
///
/// The three wire classes are deliberately **hedged**, and so are the labels
/// below: `LIKELY_COVERED` is not "approved" and `LIKELY_NOT_COVERED` is not
/// "rejected". The service centre decides. `ClaimAssessmentRules.advice(for:confidence:)`
/// is the only supported way to turn these into screen copy, because it always
/// attaches the "advice, not a decision" disclaimer.
///
/// An unknown value decodes as `.UNCLEAR`: a server that adds a fourth class
/// must never make this build claim the fault is covered. `UNCLEAR` is the
/// honest answer for "this build does not understand the answer".
public enum ClaimAssessmentCoverage: String, CaseIterable, Sendable, Equatable, Hashable {
    case LIKELY_COVERED
    case UNCLEAR
    case LIKELY_NOT_COVERED

    /// Lenient wire decode (`"LIKELY_COVERED"`, surrounding spaces tolerated).
    public init(wire: String) {
        let normalized = wire.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        self = Self(rawValue: normalized) ?? .UNCLEAR
    }

    /// User-facing label in the selected language.
    ///
    /// Every branch is phrased as a probability or as an absence of
    /// information — never as a decision. Keep it that way: this is the line
    /// rendered largest on the result screen.
    public var label: String {
        switch self {
        case .LIKELY_COVERED:     return L.t("Có khả năng thuộc diện bảo hành")
        case .UNCLEAR:            return L.t("Chưa đủ thông tin để kết luận")
        case .LIKELY_NOT_COVERED: return L.t("Có khả năng không thuộc diện bảo hành")
        }
    }
}

extension ClaimAssessmentCoverage: Decodable {
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self.init(wire: raw)
    }
}

/// How sure the model is about its `coverage` class (openapi
/// `ClaimAssessment.confidence`).
///
/// Unknown values decode as `.LOW`, the safe direction: an unrecognised value
/// must never make the screen look more certain than it is.
public enum ClaimAssessmentConfidence: String, CaseIterable, Sendable, Equatable, Hashable {
    case LOW
    case MEDIUM
    case HIGH

    /// Lenient wire decode (`"HIGH"`, surrounding spaces tolerated).
    public init(wire: String) {
        let normalized = wire.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        self = Self(rawValue: normalized) ?? .LOW
    }

    /// User-facing label in the selected language.
    public var label: String {
        switch self {
        case .LOW:    return L.t("Thấp")
        case .MEDIUM: return L.t("Trung bình")
        case .HIGH:   return L.t("Cao")
        }
    }
}

extension ClaimAssessmentConfidence: Decodable {
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self.init(wire: raw)
    }
}

/// Response of `POST /api/v1/ai/assess-claim`.
///
/// The endpoint **writes nothing** — it reads the claim, its device and the
/// warranty terms, and returns advice. `reasoning` and `questions` arrive in
/// the request's language (`Accept-Language`), while `draftLetter` is **always
/// Vietnamese**: it is addressed to a Vietnamese service centre and the client
/// must not translate it. That asymmetry is the one thing the result UI has to
/// state out loud (see `ClaimAssessmentRules.letterLanguageNote`).
///
/// `generatedAt` and `model` are informational; they are optional only so a
/// proxy that drops them cannot turn a usable answer into a decoding failure.
public struct ClaimAssessment: Decodable, Sendable, Equatable {
    public let claimId: String
    public let coverage: ClaimAssessmentCoverage
    public let confidence: ClaimAssessmentConfidence
    /// Free-form explanation in the user's language.
    public let reasoning: String
    /// Questions the service centre is likely to ask, in the user's language.
    /// Optional so a server that omits the array still yields usable advice;
    /// read it through `visibleQuestions`.
    public let questions: [String]?
    /// ALWAYS Vietnamese, on purpose. See the type doc.
    public let draftLetter: String
    public let generatedAt: String?
    public let model: String?

    /// Never-nil view for the result UI.
    public var questionsOrEmpty: [String] { questions ?? [] }

    /// The questions worth rendering: trimmed, blank entries dropped and
    /// duplicates removed (first occurrence wins). The server's order is kept.
    public var visibleQuestions: [String] {
        ClaimAssessmentRules.normalizedQuestions(questionsOrEmpty)
    }

    /// Whether there is at least one question to show. For `.UNCLEAR` this is
    /// the useful output, not an empty result.
    public var hasQuestions: Bool { !visibleQuestions.isEmpty }

    /// Whether the letter has any content. A whitespace-only letter is not a
    /// letter and the copy/share actions have nothing to act on.
    public var hasDraftLetter: Bool {
        !draftLetter.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// Body of `POST /api/v1/ai/assess-claim`: exactly `{"claimId": "..."}`.
///
/// The id is trimmed in the initializer, the same rule `ReceiptExtractInput`
/// follows: a stray newline can never become part of the JSON body. A blank id
/// cannot identify a claim, so `isReadyToSend` lets the caller refuse it before
/// a wasted round trip.
public struct ClaimAssessmentInput: Encodable, Sendable, Equatable {
    public let claimId: String

    public init(claimId raw: String) {
        self.claimId = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// `false` only for a blank id — every real claim id is sendable.
    public var isReadyToSend: Bool { !claimId.isEmpty }
}

// MARK: - Warranty

public struct Warranty: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let deviceId: String
    public let type: WarrantyType
    public let provider: String?
    public let startDate: Date
    public let endDate: Date
    public let months: Int

    /// The package price, **in the device's currency** (openapi
    /// `Warranty.cost`). It is not necessarily dong: a $99 AppleCare+ bought on
    /// a USD device is `99`, not `99 ₫`. Convert it through
    /// `CurrencyRules.lockedVnd(_:currency:fxRate:)` with the owning device's
    /// locked rate when a VND total needs it — the frozen contract does not
    /// pre-compute a `costVnd`, and multiplying by the locked rate (rather than
    /// a market lookup) is what keeps history stable.
    ///
    /// `nil` = not recorded; `0` is a real number (a free package).
    public let cost: Int?
    public let address: String?
    public let phone: String?
    public let notes: String?

    // MARK: Contract terms (all optional)

    // Nine optional fields that turn a row from "cover ends on X" into the
    // contract it actually is. Every one is nullable on the wire because the
    // common plan is still just a date range; `nil` means "not recorded", never
    // "zero". Unlike `cost`, the two money terms below (`cap`, `deductible`)
    // are documented as VND on the wire; only `cost` follows the device's
    // currency.
    //
    // Read them through `WarrantyTerms` (WarrantyTerms.swift) rather than one
    // by one: it owns the nil-vs-zero rules, the claims label and the
    // whole-unit fallback title, and it is what both the form and the detail
    // rows use. `WarrantyTerms.hasAnyTerms` is also the "does this row have a
    // contract visible" switch.

    /// What part this row covers; `null` = the whole unit.
    public let component: String?
    /// What is covered, in the user's words.
    public let scope: String?
    /// Maximum payout in VND.
    public let cap: Int?
    /// VND the user pays per claim.
    public let deductible: Int?
    /// What the contract excludes.
    public let exclusions: String?
    /// Where the cover applies.
    public let region: String?
    /// Whether the cover survives a resale. `false` is a real answer and is
    /// deliberately different from `nil` ("not recorded").
    public let transferable: Bool?
    /// How many claims the contract allows; `null` = unbounded.
    public let claimsAllowed: Int?
    /// How many claims were used. The contract's server-side default is `0`
    /// and the key is only nullable here so an older/partial payload still
    /// decodes; `nil` reads as 0 (`WarrantyTerms.claimsLabel`). Because 0 is
    /// the default for every warranty, it must not be read as "terms exist".
    public let claimsUsed: Int?

    /// Present on `GET /devices/:id` (nested), absent on create/update responses.
    public let reminders: [Reminder]?

    /// True if every reminder row for this warranty is dismissed (or there is one and it's dismissed).
    /// Mirrors the web's per-warranty "đã ẩn nhắc" state.
    public var isReminderDismissed: Bool {
        guard let reminders, !reminders.isEmpty else { return false }
        return reminders.allSatisfy { $0.isDismissed }
    }

    /// The nine contract fields as the pure derived-presentation type. The
    /// device-detail rows and the form both go through this rather than
    /// re-deciding what an empty component means.
    public var terms: WarrantyTerms { WarrantyTerms(self) }
}

public struct Reminder: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let warrantyId: String
    public let isDismissed: Bool
    public let createdAt: Date?
}

public struct WarrantyInput: Encodable, Sendable {
    public var type: WarrantyType
    public var provider: String?
    public var startDate: String
    public var months: Int
    public var cost: Int?
    public var address: String?
    public var phone: String?
    public var notes: String?

    // MARK: Contract terms

    // The same nine fields as `Warranty`, on the create/update body
    // (`WarrantyInput` in the contract). They are dropped from the JSON by the
    // synthesized encoder when nil, which Go reads exactly like an explicit
    // `null`. Note that absent `claimsUsed` is **not** "clear" on update — the
    // contract keeps the stored counter — which is why the form goes through
    // `WarrantyTerms.apply(to:)` and always sends a concrete number.

    /// What part this row covers; `nil` = whole unit.
    public var component: String?
    /// What is covered.
    public var scope: String?
    /// Maximum payout in VND.
    public var cap: Int?
    /// VND the user pays per claim.
    public var deductible: Int?
    /// What is excluded.
    public var exclusions: String?
    /// Where the cover applies.
    public var region: String?
    /// Whether the cover survives a resale; `nil` = not recorded.
    public var transferable: Bool?
    /// How many claims the contract allows; `nil` = unbounded.
    public var claimsAllowed: Int?

    /// How many claims were used.
    ///
    /// Optional because the contract gives this key **different** absent
    /// semantics on the two write paths: create treats absent/`null` as the
    /// column default `0`, while update treats it as "keep the stored counter"
    /// (so an older client that does not know the field cannot wipe a counter a
    /// newer one recorded). The form never relies on that: `WarrantyTerms.apply`
    /// always writes a concrete number, which is what makes clearing the field
    /// clear the counter. A hand-built payload can leave it `nil` to keep.
    public var claimsUsed: Int?

    public init(type: WarrantyType, startDate: String, months: Int) {
        self.type = type; self.startDate = startDate; self.months = months
    }
}

// MARK: - Warranty claim ("Sửa chữa & bảo hành")

// A claim is what happens **after** a device is marked broken: the ticket, the
// shop, the diagnosis, whether the warranty paid, and when the machine comes
// back. It belongs to the **device**, not to a warranty plan: a repair can be
// paid for out of pocket, and deleting a warranty must not delete the history.
// `warrantyId` is an optional pointer at the plan invoked, enforced server-side
// to belong to the same device.
//
// One device may have at most one claim in `OPEN` or `IN_REPAIR` at a time. A
// second one is a **409 `limit_reached`** (lowercase on the wire) — see
// `ClaimRules.saveFailure`, which is the only supported way to turn that error
// into copy and a way out.

/// Where a repair is in its life.
///
/// The first two are **open** (`ClaimRules.isOpen`) and are the ones the
/// one-open-per-device rule counts; the last three are **closed**. `closedAt`
/// is set by the server when a claim reaches a closed status and is never sent
/// **up** by this client (see `ClaimInput`).
public enum ClaimStatus: String, Codable, CaseIterable, Sendable {
    /// Created, but the machine has not been handed over / accepted yet.
    case OPEN
    /// The service center has the device and is working on it.
    case IN_REPAIR
    /// Finished: repaired, replaced or refunded.
    case RESOLVED
    /// The service center refused the repair (out of scope, damage, …).
    case REJECTED
    /// The user withdrew the repair.
    case CANCELLED

    /// User-facing label in the selected language. Mirrors the other domain
    /// enums in this file; the catalog carries both Vietnamese and English.
    public var label: String {
        switch self {
        case .OPEN:      return L.t("Đang mở")
        case .IN_REPAIR: return L.t("Đang sửa chữa")
        case .RESOLVED:  return L.t("Đã xử lý")
        case .REJECTED:  return L.t("Bị từ chối")
        case .CANCELLED: return L.t("Đã huỷ")
        }
    }
}

/// One repair claim, exactly as `GET /api/v1/claims` returns it.
///
/// ## Two kinds of date
///
/// `openedAt` / `closedAt` are RFC 3339 **instants** (`openapi.yaml`: "Là
/// instant: RFC 3339 UTC kèm Z"; the server writes `time.Now().UTC()`), while
/// `expectedReturnAt` is a **calendar day** (`format: date`). All three stay the
/// server's raw wire strings, not `Date`s, so nothing here can silently parse a
/// day as an instant. Read the instants through `ClaimRules.instantDay` /
/// `instantDayLabel`, and the day through `ClaimRules.dayLabel` / `dayDate`:
/// an instant's UTC day is the previous local day for a UTC+7 reader before
/// 07:00, which is how the claim row used to print "Đóng 19/10" for a repair
/// the user collected on the 20th.
///
/// `closedAt` is **server-owned**: it is written when the status becomes
/// `RESOLVED`, `REJECTED` or `CANCELLED`. It is deliberately absent from
/// `ClaimInput`, so no save from this client can set or clear it.
///
/// `coveredByWarranty` is **tri-state**: `nil` = "the service center has not
/// said / not recorded", `false` = "I paid for it", `true` = "warranty covered
/// it". `false` is a real answer and must never collapse into `nil`.
public struct Claim: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let deviceId: String
    public let warrantyId: String?
    public let status: ClaimStatus
    /// The server's **RFC 3339 instant** (`…Z`). A date-only value
    /// (`YYYY-MM-DD`) is still accepted on the write side (the form sends the
    /// day the user picked) and is read as that local calendar day.
    public let openedAt: String
    public let expectedReturnAt: String?
    /// Server-owned. See the type doc.
    public let closedAt: String?
    public let ticketNumber: String?
    public let serviceCenter: String?
    public let diagnosis: String?
    public let outcome: String?
    public let issue: String
    /// VND; `nil` = not recorded, `0` = a real number (a free repair).
    public let cost: Int?
    public let coveredByWarranty: Bool?
}

/// Body of `POST /api/v1/claims` and `PATCH /api/v1/claims/{id}`.
///
/// ## Why the encoder is hand-written
///
/// Two rules cannot be expressed by a synthesized `Codable` here:
///
/// 1. **`closedAt` must never be sent.** It is server-owned (see `Claim`), so
///    the key does not exist on this type at all. There is no way for a caller
///    to include it, even by accident.
/// 2. **A cleared nullable field must travel as an explicit JSON `null`.** The
///    synthesized conformance uses `encodeIfPresent` and simply *drops* a `nil`,
///    which the server cannot distinguish from "this client does not know the
///    field". For a PATCH — and for the form, which loads the stored claim and
///    sends it straight back — dropping the key would silently keep a value the
///    user just cleared. This is the same failure `AttachmentDescriptionInput`
///    documents; the encoder below writes every nullable key unconditionally.
///
/// ## `coveredByWarranty` is tri-state
///
/// `nil` is written as an explicit `null` ("not recorded"), `false` as `false`
/// ("I paid"), `true` as `true`. The distinction between unset and `false`
/// survives the wire, which is the entire reason this is `Bool?` rather than
/// `Bool` with a default.
public struct ClaimInput: Encodable, Sendable {
    /// Required. A claim always belongs to the device whose detail screen
    /// created it.
    public var deviceId: String
    /// The warranty plan invoked, or `nil` for "no plan / paid out of pocket".
    /// The server rejects an id belonging to a different device.
    public var warrantyId: String?
    public var status: ClaimStatus
    /// `YYYY-MM-DD` or a full ISO date-time. The form sends the calendar day the
    /// picker showed, written with `WireDay.string(from:)` so the day cannot
    /// move with the device's zone.
    public var openedAt: String
    public var expectedReturnAt: String?
    public var ticketNumber: String?
    public var serviceCenter: String?
    public var diagnosis: String?
    /// Free text; the contract does not constrain it to an enum.
    public var outcome: String?
    /// Required by the server. The form trims it before sending.
    public var issue: String
    /// VND, non-negative. `nil` = not recorded; `0` is a real number.
    public var cost: Int?
    /// Tri-state — see the type doc.
    public var coveredByWarranty: Bool?

    public init(deviceId: String, issue: String, openedAt: String,
                status: ClaimStatus = .OPEN, warrantyId: String? = nil) {
        self.deviceId = deviceId
        self.issue = issue
        self.openedAt = openedAt
        self.status = status
        self.warrantyId = warrantyId
    }

    // `closedAt` is intentionally missing: the server owns it and sending it is
    // forbidden by the contract.
    enum CodingKeys: String, CodingKey {
        case deviceId, warrantyId, status, openedAt, expectedReturnAt
        case ticketNumber, serviceCenter, diagnosis, outcome, issue, cost
        case coveredByWarranty
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        // Unconditional on purpose: every nullable key below travels as an
        // explicit JSON null when it is `nil`, which is how the client says
        // "clear this" instead of "I have never heard of this field".
        try container.encode(deviceId, forKey: .deviceId)
        try container.encode(warrantyId, forKey: .warrantyId)
        try container.encode(status, forKey: .status)
        try container.encode(openedAt, forKey: .openedAt)
        try container.encode(expectedReturnAt, forKey: .expectedReturnAt)
        try container.encode(ticketNumber, forKey: .ticketNumber)
        try container.encode(serviceCenter, forKey: .serviceCenter)
        try container.encode(diagnosis, forKey: .diagnosis)
        try container.encode(outcome, forKey: .outcome)
        try container.encode(issue, forKey: .issue)
        try container.encode(cost, forKey: .cost)
        try container.encode(coveredByWarranty, forKey: .coveredByWarranty)
    }
}

// MARK: - Attachment

public struct AttachmentMeta: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let fileName: String
    public let fileType: String
    public let fileSize: Int
    public let description: String?
    public let uploadedAt: Date

    /// The device this attachment is filed under, or `nil` for a **capture-first
    /// inbox** item.
    ///
    /// Optional for two reasons: the inbox endpoint deliberately returns rows
    /// with no device, and an older device-attachment payload that predates the
    /// field must keep decoding. A missing key decodes as `nil`.
    ///
    /// Filing is not a normal edit — `PATCH /api/v1/attachments/{id}` still
    /// accepts only `description`. Moving an item between the inbox and a device
    /// goes through `POST /api/v1/attachments/{id}/file`, which is why this is a
    /// read-only field here.
    public let deviceId: String?

    /// The OCR transcript stored on this file, when one has been extracted
    /// (openapi `AttachmentMeta.extractedText`, migration 0019).
    ///
    /// `nil` means the file has never been scanned — the key is **omitted** by
    /// the server in that case, not sent as `null` — so an account that has
    /// never used OCR decodes exactly as it did before the field existed. On a
    /// search hit this is the text that matched, and it is plaintext by design:
    /// it has to be readable to be indexed (see the privacy note in
    /// `openapi.yaml`).
    public let extractedText: String?

    public init(id: String, fileName: String, fileType: String, fileSize: Int,
                description: String? = nil, uploadedAt: Date, deviceId: String? = nil,
                extractedText: String? = nil) {
        self.id = id
        self.fileName = fileName
        self.fileType = fileType
        self.fileSize = fileSize
        self.description = description
        self.uploadedAt = uploadedAt
        self.deviceId = deviceId
        self.extractedText = extractedText
    }
}

/// Non-file multipart fields of `POST /api/v1/attachments`.
///
/// The one endpoint serves both upload paths: a `deviceId` attaches the file to
/// that device, while `nil` creates an **inbox item** that consumes none of the
/// device's five attachment slots. The web client carries the same optional
/// field for the same reason.
public struct AttachmentUploadInput: Sendable, Equatable {
    /// Omit/`nil` to upload into the inbox.
    public var deviceId: String?
    /// Trimmed by the server; blank is not sent at all.
    public var description: String?

    public init(deviceId: String? = nil, description: String? = nil) {
        self.deviceId = deviceId
        self.description = description
    }

    /// `true` when this upload will create an inbox item rather than consume a
    /// device slot. Mirrors `InboxRules.isUnfiled`.
    public var isInboxUpload: Bool {
        guard let deviceId else { return true }
        return deviceId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// Body of `POST /api/v1/attachments/{id}/file`.
///
/// `deviceId: nil` returns the attachment to the inbox, and the contract means
/// an **explicit JSON null**, not an absent key — so the encoder is hand-written
/// for the same reason `AttachmentDescriptionInput`'s is.
///
/// A 409 `limit_reached` means the target device already holds five attachments;
/// the item stays in the inbox. Map it through `InboxRules.fileFailure(_:)` so the
/// UI can offer the way out instead of a generic error.
public struct FileAttachmentInput: Encodable, Sendable {
    public var deviceId: String?

    public init(deviceId: String?) {
        self.deviceId = deviceId
    }

    enum CodingKeys: String, CodingKey { case deviceId }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        // Unconditional: `nil` travels as an explicit JSON null.
        try container.encode(deviceId, forKey: .deviceId)
    }
}

/// Body of `PATCH /api/v1/attachments/{id}` — the only mutable attachment field.
///
/// `description` is **required by the contract** and an absent key is a 400, so
/// the key is always encoded: `null` clears the stored description. The
/// synthesized `Codable` conformance would instead drop a `nil` key
/// (`encodeIfPresent`), turning "clear it" into "you forgot the field" — hence
/// the hand-written `encode(to:)`.
public struct AttachmentDescriptionInput: Encodable, Sendable {
    public var description: String?

    public init(description: String?) {
        self.description = description
    }

    enum CodingKeys: String, CodingKey { case description }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        // Unconditional: `nil` travels as an explicit JSON null.
        try container.encode(description, forKey: .description)
    }
}

// MARK: - Subscription

public struct Subscription: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let category: String?
    public let brand: String?
    public let plan: String?
    public let billingCycle: BillingCycle
    public let intervalDays: Int?
    public let price: Int
    public let currency: String?
    public let startedAt: Date
    public let renewalDate: Date
    public let autoRenew: Bool
    public let status: SubscriptionStatus
    public let accountEmail: String?
    public let paymentMethod: String?
    public let manageUrl: String?
    public let cancelUrl: String?
    public let notes: String?

    /// Reminder lead times before the renewal date, in **days**, e.g.
    /// `[30, 7]`. Same optional-and-encode-when-set rule as
    /// `Device.leadDays`: `nil` means "the server did not return it" (an older
    /// payload), and a non-nil array is always encoded by the synthesized
    /// `Codable`. See `LeadDaysRules` for clamp/dedupe/sort/cap.
    public let leadDays: [Int]?

    /// When the free trial ends and billing starts, as the server's date-time
    /// wire string. `nil` = no timed trial (or a server that has not shipped the
    /// field). Kept raw for the same calendar-day reason as
    /// `Device.activatedAt`; read it through `SubscriptionTrial`, never by
    /// parsing it here.
    public let trialEndsAt: String?

    /// The price charged after the trial, in VND, or `nil` when not recorded.
    ///
    /// The server rejects `convertsToPrice` **without** `trialEndsAt` with
    /// `fieldErrors.convertsToPrice`, so the two are read and written as a pair
    /// through `SubscriptionTrialFields`.
    public let convertsToPrice: Int?
}

public struct SubscriptionInput: Encodable, Sendable {
    public var name: String
    public var category: String?
    public var brand: String?
    public var plan: String?
    public var billingCycle: BillingCycle
    public var intervalDays: Int?
    public var price: Int
    public var startedAt: String
    public var renewalDate: String?
    public var autoRenew: Bool = true
    public var status: SubscriptionStatus = .ACTIVE
    public var accountEmail: String?
    public var paymentMethod: String?
    public var manageUrl: String?
    public var cancelUrl: String?
    public var notes: String?

    /// Reminder lead times before renewal, in days (openapi
    /// `SubscriptionInput.leadDays`). Built with `LeadDaysRules.wireValue` by
    /// the form: normalised descending, 1…5 entries, `0...365`.
    ///
    /// `nil` is omitted by the synthesized encoder, which the contract defines
    /// as "leave the stored schedule unchanged" on update; on create the server
    /// defaults it to `[30, 7]`. An empty array is rejected with a 400 and is
    /// never built by this client.
    public var leadDays: [Int]?

    /// When the trial ends and billing starts (`YYYY-MM-DD` or full ISO), or
    /// `nil` when there is no trial. `nil` is dropped by the synthesized encoder;
    /// a subscription PATCH replaces the row, so an absent key is the documented
    /// "clear it" — the same rule `renewalDate` uses.
    ///
    /// `convertsToPrice` must never be sent without this. Build the pair with
    /// `SubscriptionTrialFields` / `SubscriptionTrial.apply`, which drop the price
    /// whenever the date is gone (the server answers that combination with 400
    /// `fieldErrors.convertsToPrice`).
    public var trialEndsAt: String?

    /// The price after conversion, VND, or `nil` when not recorded. Travels with
    /// `trialEndsAt` or not at all — see the pair rule above.
    public var convertsToPrice: Int?

    public init(name: String, billingCycle: BillingCycle, price: Int, startedAt: String) {
        self.name = name; self.billingCycle = billingCycle
        self.price = price; self.startedAt = startedAt
    }
}

public struct Payment: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let subscriptionId: String
    public let amount: Int
    public let paidAt: Date
    public let note: String?
}

public struct PaymentInput: Encodable, Sendable {
    public var amount: Int
    public var paidAt: String
    public var note: String?

    public init(amount: Int, paidAt: String, note: String? = nil) {
        self.amount = amount; self.paidAt = paidAt; self.note = note
    }
}

// MARK: - Wishlist

public struct WishlistItem: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let category: String?
    public let brand: String?
    public let initialPrice: Int?
    public let currentPrice: Int?
    public let buyUrl: String?
    public let imageUrl: String?
    public let targetDate: Date?
    public let priority: WishlistPriority
    public let status: WishlistStatus
    public let notes: String?
    public let reminderIntervalDays: Int?
    public let purchasedDeviceId: String?
}

public struct WishlistInput: Encodable, Sendable {
    public var name: String
    public var category: String?
    public var brand: String?
    public var initialPrice: Int?
    public var currentPrice: Int?
    public var buyUrl: String?
    public var imageUrl: String?
    public var targetDate: String?
    public var priority: WishlistPriority = .WANT
    public var status: WishlistStatus = .WATCHING
    public var notes: String?
    public var reminderIntervalDays: Int?

    public init(name: String) { self.name = name }
}

public struct WishlistPrice: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let itemId: String
    public let price: Int
    public let note: String?
    public let recordedAt: Date
}

public struct PriceLogInput: Encodable, Sendable {
    public var price: Int
    public var note: String?

    public init(price: Int, note: String? = nil) {
        self.price = price; self.note = note
    }
}

// MARK: - Catalog

public struct Catalog: Decodable, Sendable {
    public let categories: [CategoryOption]
    public let brands: [BrandOption]
    public let stores: [StoreOption]
    public let warrantyProviders: [WarrantyProviderOption]
}

public struct CategoryOption: Codable, Sendable, Identifiable, Hashable {
    public var id: String { code }
    public let code: String
    public let name: String

    public init(code: String, name: String) {
        self.code = code
        self.name = name
    }
}

public struct BrandOption: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let categoryCodes: [String]
}

public struct StoreOption: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let type: String
}

public struct WarrantyProviderOption: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let phone: String?
    public let address: String?
    public let websiteUrl: String?
    public let notes: String?
}

// MARK: - Stats

public struct UserStats: Decodable, Sendable {
    public let devices: DeviceStats
    public let subscriptions: SubscriptionStats
    public let wishlist: WishlistStats
}

public struct DeviceStats: Decodable, Sendable {
    public let total: Int
    public let byStatus: [String: Int]
    public let totalPurchasePrice: Int
}

public struct SubscriptionStats: Decodable, Sendable {
    public let total: Int
    public let byStatus: [String: Int]
    public let totalMonthlyVnd: Int
}

public struct WishlistStats: Decodable, Sendable {
    public let total: Int
    public let byStatus: [String: Int]
    public let totalCurrentPriceWatching: Int
}

// MARK: - Backup import result

/// Counts returned by `POST /api/v1/backup/import` (mirrors services.ImportResult).
///
/// ## `warnings`
///
/// Non-fatal caveats about data that **was** restored. The API sends an array of
/// complete sentences already rendered in the request's language, and omits the
/// key entirely when there is nothing to say. It has no warning *code*: the
/// sentence is the whole payload. That is why the app displays the server's
/// string verbatim instead of mapping it to a local catalog key — a client-side
/// copy would have to match prose to identify the warning and would drift the
/// moment the server changed a word.
///
/// Decoding is tolerant in both directions:
/// - a response with no `warnings` key (same server, ordinary import) decodes to
///   `nil` — not a decoding failure;
/// - an empty array decodes to `[]`;
/// - unknown keys are ignored by `JSONDecoder` (this type has no custom
///   `init(from:)` and no `CodingKeys` whitelist), so a newer server can add a
///   field without breaking this build. See `ImportWarningsTests`.
public struct ImportResult: Decodable, Sendable {
    public let imported: Int
    public let skipped: Int
    public let wishlistImported: Int
    public let wishlistSkipped: Int
    public let subImported: Int
    public let subSkipped: Int

    /// Caveats about the restored data, already in the request's language.
    ///
    /// `nil` means the server sent no `warnings` key (the API's contract for
    /// "nothing to report", `omitempty` on the Go side). Read it through
    /// `warningsOrEmpty`; the UI must show **nothing** for an ordinary import.
    public let warnings: [String]?

    /// The warnings that should actually be shown: blank strings are dropped so
    /// a malformed entry cannot produce an empty banner. An ordinary import and
    /// an explicitly empty array both yield `[]`.
    public var warningsOrEmpty: [String] {
        (warnings ?? []).filter {
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    /// The presence/absence rule the restore UI branches on. False for both an
    /// absent key and `[]`; true only when there is at least one non-blank
    /// warning.
    public var hasWarnings: Bool { !warningsOrEmpty.isEmpty }
}

// MARK: - Upcoming reminders

public struct UpcomingReminder: Decodable, Sendable, Identifiable {
    public let id: String
    public let deviceId: String
    public let device: ReminderDevice
    public let type: WarrantyType
    public let provider: String?
    public let startDate: Date
    public let endDate: Date
    public let months: Int
    /// True when the user hid this reminder ("Đã xem, ẩn đi").
    ///
    /// Only sent by the opt-in read (`includeDismissed=true`); the plain
    /// upcoming feed omits it, so `nil` means "not hidden". See
    /// `DismissedReminders` for the "Đã ẩn" rollup built on top of it.
    public let isDismissed: Bool?
}

public struct ReminderDevice: Decodable, Sendable {
    public let id: String
    public let name: String
    public let category: String
    /// Owning device's status, sent alongside `includeDismissed` rows so the
    /// "Đã ẩn" list can render its badge. Kept as a raw string (with an
    /// `ACTIVE` fallback) so an unknown status can't fail the whole feed.
    public let status: String?
}

// MARK: - Push

public struct PushSubscriptionMeta: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let endpoint: String
    public let platform: PushPlatform
    public let userAgent: String?
    public let createdAt: Date
}

public struct NativePushInput: Encodable, Sendable {
    public var platform: PushPlatform
    public var token: String
    public var userAgent: String?

    public init(platform: PushPlatform, token: String, userAgent: String? = nil) {
        self.platform = platform; self.token = token; self.userAgent = userAgent
    }
}
