import Foundation

// MARK: - Resale handoff (Warrly 2.0)
//
// A seller hands ONE device record to a buyer. The seller's account keeps the
// row, marked SOLD once the buyer claims it; the buyer gets a NEW device in
// their own account carrying the remaining warranty rows and the documents the
// seller selected. Price, sale price and private notes never travel.
//
// This is NOT an insurance flow, not a marketplace, and not a title document:
// it moves data between two accounts and nothing else. That sentence is copy,
// not a footnote — see `HandoffCopy.disclaimer`, rendered on every surface that
// could be mistaken for a transfer of ownership.
//
// ## Wire contract (frozen by the 2.0 sprint)
//
// All paths are under `/api/v1` and are enforced by Go; this file only binds to
// them.
//
//   POST   /devices/{id}/handoff            auth — mints a code (shown ONCE)
//          {"attachmentIds": ["att_…"]}     explicit selection; `[]` = no files
//     201  {"handoff": { id, deviceId, code, claimPath, status, createdAt,
//                        expiresAt }}
//
//   GET    /devices/{id}/handoff            auth — latest row, WITHOUT the code
//     200  {"handoff": { … } | null, nextAllowedAt?}
//
//   DELETE /devices/{id}/handoff            auth — cancel the PENDING row
//     200  {"ok": true}
//
//   GET    /public/handoff/{code}           NO auth — the buyer's preview
//     200  {"handoff": { code, status, expiresAt, sellerName?, device, … }}
//     404 unknown · 410 expired/cancelled · 409 already claimed
//
//   POST   /handoff/{code}/claim            auth — the only write the buyer makes
//     200  {"handoff": { id, status, claimedAt }, "device": <a full Device>}
//
// ## The code is a credential, and the server stores only its hash
//
// `POST /devices/{id}/handoff` is the ONLY response that ever carries `code`.
// The seller must copy or share it before the sheet closes; after that the
// remedy is cancel + mint a new one (subject to the 1-per-30-days rule). The
// one-time surface in `HandoffSheet` is therefore gated exactly like the
// share-certificate token, for the same reason.
//
// The code is 6 characters, single use, valid 14 days. A code that is never
// claimed expires and nothing moves. One handoff per device per 30 days.

// MARK: - Wire shapes

/// Lifecycle of one handoff row. Decoded leniently: a status this build does not
/// know becomes `.unknown` rather than failing the whole payload, because a
/// future server must not make the device screen unreadable.
public enum HandoffStatus: Sendable, Hashable {
    case pending
    case claimed
    case expired
    case cancelled
    case unknown

    init(wire: String?) {
        switch (wire ?? "").trimmingCharacters(in: .whitespacesAndNewlines).uppercased() {
        case "PENDING":   self = .pending
        case "CLAIMED":   self = .claimed
        case "EXPIRED":   self = .expired
        case "CANCELLED": self = .cancelled
        default:          self = .unknown
        }
    }

    /// The server's own spelling. `unknown` is never sent back; it only exists
    /// for a value this build could not read.
    public var wireValue: String? {
        switch self {
        case .pending:   return "PENDING"
        case .claimed:   return "CLAIMED"
        case .expired:   return "EXPIRED"
        case .cancelled: return "CANCELLED"
        case .unknown:   return nil
        }
    }

    public var label: String {
        switch self {
        case .pending:   return L.t("Đang chờ người nhận")
        case .claimed:   return L.t("Người mua đã nhận thiết bị")
        case .expired:   return L.t("Mã đã hết hạn")
        case .cancelled: return L.t("Mã đã bị huỷ")
        case .unknown:   return L.t("Không rõ trạng thái")
        }
    }

    /// A terminal row cannot be acted on again; only `pending` can be copied,
    /// shared or cancelled.
    public var isOpen: Bool { self == .pending }
}

extension HandoffStatus: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self.init(wire: try? container.decode(String.self))
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(wireValue)
    }
}

/// One handoff row as the seller sees it.
///
/// `code` and `claimPath` are optional because the **status** endpoint never
/// returns them (only `POST` does): a decoder that required them would make the
/// seller's own sheet fail for a handoff that was created a minute earlier.
public struct DeviceHandoff: Decodable, Sendable, Identifiable, Hashable {
    public let id: String
    public let deviceId: String
    /// **Credential.** Present only in the create response. Never persisted.
    public let code: String?
    /// `/handoff/<code>` relative to the web app; present only on create.
    public let claimPath: String?
    public let status: HandoffStatus
    public let createdAt: Date
    public let expiresAt: Date
    public let claimedAt: Date?

    public var isOpen: Bool { status.isOpen }

    private enum CodingKeys: String, CodingKey {
        case id, deviceId, code, claimPath, status, createdAt, expiresAt, claimedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        deviceId = try c.decode(String.self, forKey: .deviceId)
        code = try c.decodeIfPresent(String.self, forKey: .code)
        claimPath = try c.decodeIfPresent(String.self, forKey: .claimPath)
        status = HandoffStatus(wire: try c.decodeIfPresent(String.self, forKey: .status))
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        expiresAt = try c.decode(Date.self, forKey: .expiresAt)
        claimedAt = try c.decodeIfPresent(Date.self, forKey: .claimedAt)
    }
}

/// Body of `POST /devices/{id}/handoff`.
///
/// `attachmentIds` is always sent explicitly: the contract makes the key a
/// *selection*, and an empty array is the honest way to say "no documents".
/// The server validates that every id belongs to this device.
public struct CreateHandoffInput: Encodable, Sendable {
    public var attachmentIds: [String]

    public init(attachmentIds: [String]) {
        self.attachmentIds = attachmentIds
    }
}

/// `GET /devices/{id}/handoff` — the latest row (any status) or `nil`.
///
/// `nextAllowedAt` is not in the sprint contract but is decoded when present:
/// it is the one value that explains a 30-day refusal without a round trip.
public struct HandoffStatusResponse: Decodable, Sendable {
    public let handoff: DeviceHandoff?
    public let nextAllowedAt: Date?
}

// MARK: - Buyer preview

/// The public preview (`GET /public/handoff/{code}`). Everything here is
/// already the safe projection the server built: masked serial only, no price,
/// no notes, no account identity beyond an optional display name.
public struct HandoffPreview: Decodable, Sendable, Hashable {
    public let code: String
    public let status: HandoffStatus
    public let expiresAt: Date
    public let sellerName: String?
    public let device: HandoffPreviewDevice
    public let warranties: [HandoffPreviewWarranty]?
    public let attachments: [HandoffPreviewAttachment]?
    public let claims: [HandoffPreviewClaim]?

    private enum CodingKeys: String, CodingKey {
        case code, status, expiresAt, sellerName, device, warranties, attachments, claims
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = try c.decode(String.self, forKey: .code)
        status = HandoffStatus(wire: try c.decodeIfPresent(String.self, forKey: .status))
        expiresAt = try c.decode(Date.self, forKey: .expiresAt)
        sellerName = try c.decodeIfPresent(String.self, forKey: .sellerName)
        device = try c.decode(HandoffPreviewDevice.self, forKey: .device)
        warranties = try c.decodeIfPresent([HandoffPreviewWarranty].self, forKey: .warranties)
        attachments = try c.decodeIfPresent([HandoffPreviewAttachment].self, forKey: .attachments)
        claims = try c.decodeIfPresent([HandoffPreviewClaim].self, forKey: .claims)
    }
}

public struct HandoffPreviewDevice: Decodable, Sendable, Hashable {
    public let name: String
    public let brand: String?
    public let model: String?
    public let category: String?
    /// Kept as the raw wire string: a day is not an instant, and only its
    /// leading `YYYY-MM-DD` is ever shown (`WireDay`).
    public let purchaseDate: String?
    /// Masked by the server. The full serial never appears publicly.
    public let serialMasked: String?
}

public struct HandoffPreviewWarranty: Decodable, Sendable, Hashable {
    public let type: String?
    public let startDate: String?
    public let endDate: String?
    public let provider: String?
    public let status: String?

    /// The type code as the app's enum, when it is one this build knows.
    public var warrantyType: WarrantyType? {
        guard let type else { return nil }
        return WarrantyType(rawValue: type.uppercased())
    }

    public var typeLabel: String { warrantyType?.label ?? L.t("Bảo hành") }
}

public struct HandoffPreviewAttachment: Decodable, Sendable, Hashable {
    public let fileName: String
    public let mimeType: String?
    public let sizeBytes: Int?
}

public struct HandoffPreviewClaim: Decodable, Sendable, Hashable {
    public let status: String?
    public let openedAt: String?
    public let closedAt: String?
    public let coveredByWarranty: Bool?
}

// MARK: - Claim

/// `POST /handoff/{code}/claim` — the buyer's single write.
public struct ClaimHandoffResult: Decodable, Sendable {
    public let handoff: ClaimedHandoff
    /// The new device, in the same shape `GET /devices/{id}` returns.
    public let device: Device
}

public struct ClaimedHandoff: Decodable, Sendable, Hashable {
    public let id: String
    public let status: HandoffStatus
    public let claimedAt: Date?
}

// MARK: - Rules

/// The pure rules and bounds of the handoff flow. Kept in the Kit so the sheet,
/// the claim view and a network-free test read the same numbers and the same
/// code grammar.
public enum HandoffRules {

    // MARK: Bounds (mirror api/internal/services/handoff.go)

    /// Six characters: short enough to read over the phone, long enough that
    /// guessing one in a 14-day window is not a strategy (the server also
    /// rate-limits the public preview and the claim).
    public static let codeLength = 6
    /// A code is valid for 14 days. There is no "never expires" value.
    public static let ttlDays = 14
    /// One handoff per device per 30 days.
    public static let windowDays = 30

    // MARK: URLs

    /// The buyer-facing claim page is a WEB page. The API returns only the
    /// relative path, so the client supplies the site it is shipped against.
    public static let websiteBaseURL = URL(string: "https://warrly.com")!

    /// The documented relative prefix (`claimPath` = `/handoff/<code>`).
    public static let claimPathPrefix = "/handoff/"

    /// Absolute URL for the buyer, or `nil` when the server sent no usable
    /// path. Never invents a link: a broken capability URL is worse than no
    /// link, because the seller would send it.
    public static func claimURL(claimPath: String?) -> URL? {
        guard let raw = claimPath?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty else { return nil }

        if let absolute = URL(string: raw), absolute.scheme?.lowercased() == "https",
           let host = absolute.host, !host.isEmpty {
            return absolute
        }
        if let absolute = URL(string: raw), absolute.scheme?.lowercased() == "http",
           let host = absolute.host, !host.isEmpty {
            return absolute
        }

        var base = websiteBaseURL.absoluteString
        while base.hasSuffix("/") { base.removeLast() }
        let path = raw.hasPrefix("/") ? raw : "/" + raw
        guard let url = URL(string: base + path), let host = url.host, !host.isEmpty else {
            return nil
        }
        return url
    }

    /// Fallback link when only the code is known: the web claim page is the
    /// canonical path, so a seller who lost `claimPath` can still send this.
    public static func claimURL(code: String) -> URL? {
        guard isValidCode(code) else { return nil }
        return claimURL(claimPath: claimPathPrefix + code)
    }

    // MARK: The code

    /// Characters the server mints: A–Z minus I/O/L plus 2–9. The client is
    /// deliberately more permissive on INPUT (a code pasted from a chat app may
    /// be lower-case or carry a hyphen) and validates only length + alphabet.
    public static func normalizedCode(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        // A pasted URL: take its last non-empty path segment. This covers
        // `https://warrly.com/handoff/ABC123` and `warrly://handoff/ABC123`.
        if trimmed.contains("/") {
            if let url = URL(string: raw), let last = lastPathSegment(url) {
                return sanitized(last)
            }
            if let last = trimmed.split(separator: "/").last {
                return sanitized(String(last))
            }
        }
        return sanitized(trimmed)
    }

    private static func lastPathSegment(_ url: URL) -> String? {
        // Works for both shapes this app accepts:
        //   https://warrly.com/handoff/ABC123  → path "/handoff/ABC123"
        //   warrly://handoff/ABC123            → host "handoff", path "/ABC123"
        url.path.split(separator: "/").last.map(String.init)
    }

    /// Upper-cased and stripped of separators a chat app may insert. Letters are
    /// **not** filtered: a wrong letter must fail validation as itself, not turn
    /// `AB1 23` into a different code that happens to be valid.
    private static func sanitized(_ value: String) -> String {
        value
            .uppercased()
            .filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
    }

    /// The pasted text as a code, or `nil` when it is not one. Accepts a bare
    /// code or a claim link (both `https://warrly.com/handoff/<code>` and
    /// `warrly://handoff/<code>`).
    public static func code(fromPasted text: String) -> String? {
        let code = normalizedCode(text)
        return isValidCode(code) ? code : nil
    }

    /// 6 alphanumerics. The server mints from a narrower alphabet; accepting a
    /// wider one here only means a typo reaches the server and gets its 404,
    /// instead of being blocked by a client that thinks it knows the alphabet.
    public static func isValidCode(_ code: String) -> Bool {
        // ASCII only. `Character.isLetter` is true for Vietnamese letters too;
        // accepting those would send a homoglyph-looking code to the server and
        // earn a 404 for a typo the user cannot see.
        code.count == codeLength
            && code.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) }
    }

    // MARK: Lifecycle

    /// Whether the detail screen may offer "Chuyển chủ".
    ///
    /// The server is the authority (it refuses a SOLD/LOST device and its daily
    /// rules); this only hides an action that cannot work. A device already
    /// handed off is SOLD, so the same condition covers it.
    public static func canOfferHandoff(_ device: Device) -> Bool {
        device.status != .SOLD && device.handoffSentAt == nil
    }

    public static func hasSent(_ device: Device) -> Bool { device.handoffSentAt != nil }
    public static func hasReceived(_ device: Device) -> Bool { device.handoffReceivedAt != nil }

    /// Whole days left, floor. `nil` once the code is no longer live.
    public static func remainingLabel(expiresAt: Date, now: Date = Date()) -> String? {
        let left = expiresAt.timeIntervalSince(now)
        guard left > 0 else { return nil }
        let days = Int(left / 86_400)
        if days < 1 { return L.t("Còn dưới 1 ngày") }
        return L.p("Còn %d ngày", days)
    }

    // MARK: Failures

    /// Message for a failed create. A 409 is the documented 30-day rule; the
    /// server's sentence is preferred when it sent one, because it can name the
    /// exact date the next handoff is allowed.
    public static func createFailureMessage(status: Int?, serverMessage: String?,
                                            fallback: String) -> String {
        if status == 409 {
            if let message = serverMessage?.trimmingCharacters(in: .whitespacesAndNewlines),
               !message.isEmpty { return message }
            return HandoffCopy.limitReached
        }
        return message(serverMessage, fallback: fallback)
    }

    public static func cancelFailureMessage(status: Int?, serverMessage: String?,
                                            fallback: String) -> String {
        return message(serverMessage, fallback: fallback)
    }

    /// Message for a failed preview or claim.
    ///
    /// 404/410 get the same local sentence on purpose: the public endpoint has
    /// one answer for every dead code (no oracle), and the app must not invent
    /// a finer distinction than the server exposes. 409 is **not** one thing —
    /// the same status can be "already claimed", the buyer's device quota, or
    /// the seller's device turning SOLD after minting — so a server message
    /// wins there when it has one.
    public static func claimFailureMessage(status: Int?, serverMessage: String?,
                                           fallback: String) -> String {
        switch status {
        case 404, 410:
            return HandoffCopy.deadCode
        case 403:
            return HandoffCopy.ownDevice
        case 401:
            return HandoffCopy.signInRequired
        case 409:
            if let message = serverMessage?.trimmingCharacters(in: .whitespacesAndNewlines),
               !message.isEmpty { return message }
            return HandoffCopy.alreadyClaimed
        default:
            return message(serverMessage, fallback: fallback)
        }
    }

    private static func message(_ serverMessage: String?, fallback: String) -> String {
        let trimmed = serverMessage?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let trimmed, !trimmed.isEmpty { return trimmed }
        return fallback
    }
}

// MARK: - Copy

/// Every sentence this feature renders, in one place. Like `ShareCopy`, the
/// words are part of the contract: the feature moves data, so the copy must
/// never imply ownership, payment or a legal title.
public enum HandoffCopy {

    // MARK: Titles

    public static let sheetTitle = L.t("Chuyển chủ thiết bị")
    public static let claimTitle = L.t("Nhận thiết bị chuyển chủ")
    public static let claimEntry = L.t("Nhận thiết bị chuyển chủ")

    /// The stakes, as the title of the surface that shows the code.
    public static let oneTimeTitle = L.t("Mã chuyển chủ chỉ hiện một lần")

    // MARK: What this is

    public static let intro =
        L.t("Chuyển hồ sơ thiết bị này sang tài khoản của người nhận. Hai tài khoản phải có kết nối mạng; thiết bị của bạn vẫn giữ nguyên, rồi được đánh dấu đã bán khi người nhận xác nhận.")

    /// The sentence that keeps this feature honest. Rendered on every surface
    /// where someone could read the handoff as a legal transfer.
    public static let disclaimer =
        L.t("Warrly chỉ chuyển dữ liệu thiết bị qua tài khoản. Đây không phải giấy tờ chuyển nhượng pháp lý, không xác nhận quyền sở hữu và không xử lý thanh toán.")

    /// The short form for a row/banner.
    public static let disclaimerShort =
        L.t("App chỉ chuyển dữ liệu, không phải giấy tờ pháp lý.")

    // MARK: What travels

    public static let travelsTitle = L.t("Dữ liệu đi theo thiết bị")
    public static let travels: [String] = [
        L.t("Tên, loại, hãng, model và serial/IMEI"),
        L.t("Ngày mua và nơi mua"),
        L.t("Các gói bảo hành còn lại: loại, nhà bảo hành, thời hạn và điều khoản"),
        L.t("Những hoá đơn bạn chọn bên dưới"),
        L.t("Lịch sử sửa chữa / bảo hành đã ghi"),
    ]

    public static let neverTitle = L.t("Không đi theo")
    public static let never: [String] = [
        L.t("Giá mua, giá bán, lãi/lỗ"),
        L.t("Chi phí từng gói bảo hành"),
        L.t("Ghi chú riêng của thiết bị và của gói bảo hành"),
        L.t("Các thiết bị khác trong tài khoản của bạn"),
        L.t("Tài khoản, email và mật khẩu của bạn"),
    ]

    // MARK: Rules

    public static let rulesTitle = L.t("Cách mã hoạt động")
    public static let rules: [String] = [
        L.t("Mã 6 ký tự, chỉ dùng một lần, hết hạn sau 14 ngày."),
        L.t("Mỗi thiết bị chỉ chuyển chủ 1 lần trong 30 ngày."),
        L.t("Người nhận phải đăng nhập, xem trước rồi tự xác nhận — không có “một chạm”."),
        L.t("Mã chưa dùng thì hết hạn và không có gì được chuyển."),
    ]

    // MARK: Receipts

    public static let receiptsTitle = L.t("Hoá đơn đi theo")
    public static let receiptsHint =
        L.t("Chọn hoá đơn cho người nhận xem. Hoá đơn có thể có giá — chỉ chọn tệp bạn muốn chuyển. Bỏ chọn tất cả nghĩa là không tệp nào đi theo.")
    public static let receiptsEmpty = L.t("Thiết bị này chưa có hoá đơn nào để chọn.")
    public static let receiptsLoading = L.t("Đang tải hoá đơn…")

    // MARK: Create

    public static let createAction = L.t("Tạo mã chuyển chủ")
    public static let creatingAction = L.t("Đang tạo mã…")
    public static let retryAction = L.t("Thử lại")

    /// Shown on the create button while a code already exists (the GET status
    /// returns the row but never the code, so it cannot be re-shown).
    public static let existingOpen =
        L.t("Bạn đã tạo một mã đang chờ người nhận, nhưng mã chỉ hiện ở lần tạo nên không xem lại được. Huỷ mã cũ rồi tạo mã mới nếu bạn cần gửi lại.")

    public static let existingClaimed =
        L.t("Người nhận đã nhận thiết bị này rồi. Thiết bị được đánh dấu đã bán trong tài khoản của bạn.")
    public static let existingCancelled = L.t("Mã trước đã bị huỷ. Bạn có thể tạo mã mới nếu còn trong giới hạn 30 ngày.")
    public static let existingExpired =
        L.t("Mã trước đã hết hạn mà chưa ai nhận, nên không có gì được chuyển. Bạn có thể tạo mã mới nếu còn trong giới hạn 30 ngày.")

    public static let loadFailed = L.t("Không tải được trạng thái chuyển chủ — thử tải lại nhé.")
    public static let createFailed = L.t("Không tạo được mã chuyển chủ, thử lại sau.")
    public static let cancelFailed = L.t("Không huỷ được mã chuyển chủ, thử lại sau.")
    public static let limitReached =
        L.t("Mỗi thiết bị chỉ chuyển chủ 1 lần trong 30 ngày. Thiết bị này đã dùng lượt chuyển trong 30 ngày qua.")

    // MARK: The one-time code surface

    public static let oneTimeWarning =
        L.t("Máy chủ chỉ lưu mã băm của mã, nên không ai — kể cả bạn — xem lại được mã này. Hãy sao chép mã và link rồi gửi cho người nhận trước khi đóng. Nếu lỡ đóng mà chưa sao chép, bạn phải huỷ mã và tạo mã mới (nếu còn trong giới hạn 1 lần/30 ngày).")
    public static let codeLabel = L.t("Mã chuyển chủ")
    public static let linkLabel = L.t("Link cho người nhận")
    public static let copyCodeAction = L.t("Sao chép mã")
    public static let copyLinkAction = L.t("Sao chép link")
    public static let copiedAction = L.t("Đã sao chép")
    public static let shareAction = L.t("Chia sẻ")
    public static let closeAction = L.t("Đóng")
    public static let cancelAction = L.t("Huỷ")
    public static let ackLabel =
        L.t("Tôi đã sao chép hoặc lưu mã và link này, và hiểu rằng không xem lại được.")
    public static let closeBlockedHint =
        L.t("Mã chưa được lưu. Hãy sao chép mã hoặc link, hoặc tick xác nhận, rồi mới đóng.")
    public static let missingLink =
        L.t("Máy chủ không trả về link cho mã này. Bạn vẫn có thể gửi mã để người nhận dán vào app.")

    public static func expiryLine(_ date: String) -> String {
        L.t("Hết hạn %@", date)
    }

    public static func shareSubject(deviceName: String) -> String {
        L.t("Chuyển chủ Warrly cho \"%@\"", deviceName)
    }

    public static func shareMessage(code: String, link: URL?) -> String {
        if let link {
            return L.t("Mã chuyển chủ: %@\nMở link để xem trước và nhận thiết bị: %@", code, link.absoluteString)
        }
        return L.t("Mã chuyển chủ: %@\nMở Warrly, vào Thiết bị → Nhận thiết bị chuyển chủ và dán mã này.", code)
    }

    // MARK: Cancel

    public static let cancelTitle = L.t("Huỷ mã chuyển chủ?")
    public static let cancelConfirm =
        L.t("Người nhận sẽ không dùng được mã này nữa. Không thể hoàn tác.")
    public static let cancelOpen = L.t("Huỷ mã chuyển chủ")

    // MARK: Claim entry

    public static let pasteHint =
        L.t("Dán mã 6 ký tự hoặc link người bán gửi. Mã chỉ dùng được một lần.")
    public static let codeFieldLabel = L.t("Mã chuyển chủ (6 ký tự)")
    public static let codeFieldPlaceholder = L.t("VD: A7K2Q9")
    public static let previewAction = L.t("Xem thiết bị")
    public static let previewingAction = L.t("Đang tìm thiết bị…")
    public static let invalidCode = L.t("Mã gồm 6 ký tự chữ và số.")
    public static let previewFailed = L.t("Không xem trước được thiết bị. Kiểm tra mã và thử lại.")
    public static let claimFailed = L.t("Không nhận được thiết bị, thử lại sau.")
    public static let deadCode =
        L.t("Mã không còn hiệu lực: có thể đã hết hạn, đã bị huỷ hoặc đã được dùng. Hãy xin người bán mã mới.")
    public static let alreadyClaimed = L.t("Mã này đã được người khác nhận rồi.")
    public static let ownDevice = L.t("Bạn đang đăng nhập tài khoản người bán nên không thể tự nhận thiết bị của mình.")
    public static let signInRequired = L.t("Bạn cần đăng nhập để nhận thiết bị.")

    // MARK: Preview

    public static func sellerLine(_ name: String) -> String {
        L.t("Người bán: %@", name)
    }
    public static let remainingWarrantyTitle = L.t("Bảo hành còn lại")
    public static let noWarranty = L.t("Không có gói bảo hành nào đi theo.")
    public static func documentsTitle(_ count: Int) -> String {
        L.t("Hoá đơn đi kèm (%d)", count)
    }
    public static let noDocuments = L.t("Không có hoá đơn nào đi kèm.")
    public static func repairsTitle(_ count: Int) -> String {
        L.t("Lịch sử sửa chữa (%d)", count)
    }
    public static let noRepairs = L.t("Không có lịch sử sửa chữa.")
    public static let purchaseDateLabel = L.t("Ngày mua")
    public static let serialLabel = L.t("Serial (che giữa)")
    public static let claimAction = L.t("Nhận thiết bị này")
    public static let claimingAction = L.t("Đang nhận thiết bị…")
    public static let claimConfirmTitle = L.t("Nhận thiết bị này?")
    public static let claimConfirmBody =
        L.t("Thiết bị sẽ được thêm vào tài khoản của bạn cùng bảo hành và tệp đã chọn. Mã chỉ dùng được một lần.")

    public static func expiresLine(_ date: String) -> String {
        L.t("Mã hết hạn %@.", date)
    }

    public static func documentMeta(_ fileType: String?, _ sizeBytes: Int?) -> String {
        var parts: [String] = []
        if let fileType, !fileType.isEmpty { parts.append(fileType.uppercased()) }
        if let sizeBytes, sizeBytes > 0 { parts.append(sizeLabel(sizeBytes)) }
        return parts.joined(separator: " • ")
    }

    private static func sizeLabel(_ bytes: Int) -> String {
        if bytes >= 1_048_576 {
            return String(format: "%.1f MB", Double(bytes) / 1_048_576)
        }
        if bytes >= 1_024 {
            return String(format: "%.0f KB", Double(bytes) / 1_024)
        }
        return L.t("%d B", bytes)
    }

    // MARK: Device provenance

    public static let handoffSectionTitle = L.t("Chuyển chủ")
    public static let sellerRowTitle = L.t("Chuyển chủ thiết bị")
    public static let sellerRowSubtitle =
        L.t("Chuyển dữ liệu sang tài khoản người mua bằng mã 6 ký tự.")

    public static func receivedFromSeller(_ day: String) -> String {
        L.t("Chuyển từ người bán %@", day)
    }

    public static func sentToBuyer(_ day: String) -> String {
        L.t("Đã chuyển cho người mua %@", day)
    }

    public static let receivedFootnote =
        L.t("Dữ liệu này do người bán chuyển sang. Warrly không xác nhận quyền sở hữu và không phải giấy tờ chuyển nhượng pháp lý.")

    public static let sentFootnote =
        L.t("Thiết bị đã sang tài khoản người mua. Dòng này chỉ ghi nhận dữ liệu đã chuyển, không phải giấy tờ pháp lý.")

    /// A short marker for the seller's SOLD row in the device list.
    public static let sentBadge = L.t("Đã chuyển")

    // MARK: Claim entry points

}
