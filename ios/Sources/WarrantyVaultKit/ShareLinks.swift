import Foundation

// MARK: - Handover certificate / share links (FEATURE_IDEAS #2)
//
// `POST /api/v1/devices/{id}/shares` creates a read-only link to **one** device
// that opens without signing in — the thing a seller hands a buyer, or hands a
// service centre when someone else takes the machine in. Web and Android shipped
// it first; this file is the iOS half of the same contract (openapi `shares`,
// `DeviceShare` / `CreatedDeviceShare`).
//
// ## The one-time token, and why the UI rules live here
//
// The create response is the **only** place a `token` ever appears. The server
// stores just its sha256 (`auth.NewTokenAndHash`, migration 0013), so
// `GET .../shares` can never return it and no later call can reproduce it. A
// client that shows the token in a dismissible toast has already lost it: the
// user reads "link chỉ hiện một lần" **after** the thing is gone.
//
// The consequence is a set of rules, not a sentence — and they are pure
// functions/constants here so a network-free test can pin them:
//
//   1. the stakes are in the *title* of the surface that shows the credential;
//   2. the warning sits above the link, in the same view, before any way out;
//   3. the only dismiss control comes **after** copy / share;
//   4. it refuses to dismiss until the link was copied or explicitly
//      acknowledged — see `ShareCopy.closeBlockedHint` / `ackLabel`;
//   5. the token is never persisted (no Keychain, no file, no UserDefaults) and
//      never logged.
//
// ## The URL
//
// `sharePath` is a path (`/api/v1/public/shares/<token>`) because the server
// does not know which host the caller reached it through. `certificateURL` pairs
// it with this client's own API base — with the web's `/api`-prefix rule kept, so
// a base that already ends in `/api` does not produce `/api/api/v1/...`. A
// `nil` result is not cosmetic: the UI disables copy/share rather than handing a
// buyer a broken link.

// MARK: - Wire shapes

/// One share link **from the owner's side** (openapi `DeviceShare`).
///
/// Deliberately has no `token` field: the wire type cannot carry the credential,
/// so no code path can accidentally look for one here. `revokedAt` and
/// `lastViewedAt` are the two nullable fields; `viewCount` counts certificate
/// *fetches*, which is all the server can observe (the link has no identity
/// behind it and may have been forwarded).
public struct DeviceShare: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let deviceId: String
    public let expiresAt: Date
    public let revokedAt: Date?
    public let includeSerial: Bool
    public let viewCount: Int
    public let lastViewedAt: Date?
    public let createdAt: Date
}

/// The **create** response (openapi `CreatedDeviceShare` = `DeviceShare` plus the
/// credential). Decoded from the same flat JSON object, with the `DeviceShare`
/// half kept nested so the one-time fields cannot be confused with the reusable
/// ones: `created.share` is the row, `created.token` is the credential.
public struct CreatedDeviceShare: Decodable, Sendable {
    public let share: DeviceShare
    /// **Credential. Shown exactly once, in the response that created it.** Never
    /// persisted, never logged, never re-fetchable.
    public let token: String
    /// `/api/v1/public/shares/<token>` — pair with `certificateURL(baseURL:sharePath:)`.
    public let sharePath: String

    private enum CodingKeys: String, CodingKey { case token, sharePath }

    public init(from decoder: Decoder) throws {
        share = try DeviceShare(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        token = try c.decode(String.self, forKey: .token)
        sharePath = try c.decode(String.self, forKey: .sharePath)
    }
}

/// Body of `POST /api/v1/devices/{id}/shares`. Both keys are always sent: the
/// server defaults `expiresInDays` to 30 when omitted, and `includeSerial` to
/// `false`, but sending what the user actually chose keeps the two in step.
public struct CreateShareInput: Encodable, Sendable {
    public var expiresInDays: Int
    public var includeSerial: Bool

    public init(expiresInDays: Int = ShareLinks.ttlDefaultDays, includeSerial: Bool = false) {
        self.expiresInDays = expiresInDays
        self.includeSerial = includeSerial
    }
}

// MARK: - Copy

/// Every Vietnamese sentence this feature shows. Kept in the Kit (like
/// `DeviceWarningCopy`) so the one-time warning cannot be softened by a screen:
/// a test asserts the exact text, and the UI only chooses *where* to render it.
public enum ShareCopy {

    /// The stakes, as the title of the surface that shows the token (Android
    /// `ONE_TIME_TITLE`): stated before the body is read, impossible to scroll
    /// past.
    public static let oneTimeTitle = "Link chỉ hiện một lần"

    /// The sentence the UI states **before** the link exists and again while it is
    /// on screen. The server stores only a hash, so a lost token is
    /// unrecoverable and the only remedy is a new link.
    public static let oneTimeWarning =
        "Link chỉ hiện MỘT LẦN, ngay sau khi bạn bấm tạo. Máy chủ chỉ lưu mã băm của token nên không ai — kể cả bạn — xem lại được link này. Hãy sao chép và gửi cho người nhận trước khi đóng; nếu lỡ đóng mà chưa sao chép, bạn phải tạo link mới."

    /// Secondary heading on the one-time surface.
    public static let oneTimeHeading = "Đây là lần duy nhất link hiện ra"

    /// Why the dismiss control is refused. Rendered next to it while the link has
    /// been neither copied nor acknowledged.
    public static let closeBlockedHint =
        "Link chưa được lưu. Hãy bấm “Sao chép link”, hoặc tick xác nhận rằng bạn đã lưu, rồi mới đóng."

    /// The acknowledgement that satisfies the close gate without copying.
    public static let ackLabel =
        "Tôi đã sao chép hoặc lưu link này và hiểu rằng không xem lại được."

    /// Short version for the section itself, before any dialog is opened.
    public static let sectionHint =
        "Link chia sẻ là phiếu bàn giao cho người mua: mở được không cần đăng nhập, không có giá, ghi chú hay ảnh hoá đơn. Token chỉ hiện một lần lúc tạo."

    /// Button label for the create action. A verb, not a noun, because the button
    /// creates a credential that is shown once.
    public static let createAction = "Tạo link chia sẻ"

    /// Short label for the create button once the cap is reached (the long
    /// explanation is `limitReached`, rendered next to it).
    public static let limitReachedShort = "Đã đạt giới hạn link"

    /// The 10-live-link cap and the "no permanent link" rule, in one sentence.
    public static let limitNote =
        "Tối đa \(ShareLinks.maxActivePerDevice) link còn hiệu lực cho mỗi thiết bị. Link luôn có hạn (\(ShareLinks.ttlMinDays)–\(ShareLinks.ttlMaxDays) ngày) và thu hồi được — không có link vĩnh viễn."

    /// What the server says when the 11th live link is attempted (`409`), said
    /// locally too so the user does not need the round trip to understand.
    public static let limitReached =
        "Mỗi thiết bị chỉ giữ được \(ShareLinks.maxActivePerDevice) link còn hiệu lực. Thu hồi bớt một link rồi tạo lại."

    /// Serial off (the default) — what the buyer still gets.
    public static let serialOffNote =
        "Mặc định TẮT: phiếu chỉ hiện serial che giữa (giữ đầu và cuối, che phần giữa) — vẫn đủ để người mua đối chiếu tem trên máy."

    /// Serial on — exactly what turning it on exposes.
    public static let serialOnNote =
        "BẬT: phiếu hiện serial/IMEI đầy đủ. Cần khi trung tâm bảo hành tra cứu theo IMEI, nhưng nghĩa là bất kỳ ai có link (kể cả khi bị chuyển tiếp) đều thấy định danh đầy đủ của máy."

    public static let serialLabel = "Kèm serial/IMEI đầy đủ trong phiếu"

    /// Headline of the "what am I handing over" block.
    public static let projectionTitle = "Người nhận đọc được gì"

    /// What the buyer can read in the certificate. Only claims the server's own
    /// SQL projection enforces (openapi `SharedCertificate`).
    public static let certificateShows: [String] = [
        "Tên máy, loại, hãng, model",
        "Ngày mua, nơi mua, trạng thái thiết bị (kể cả ngày bán nếu bạn có ghi)",
        "Serial che giữa — hoặc serial đầy đủ nếu bạn bật lựa chọn bên trên",
        "Từng gói bảo hành: loại, nhà bảo hành, thời hạn, địa chỉ/số điện thoại do bạn tự ghi cho gói đó",
        "Ngày hết hạn bảo hành xa nhất và ngày hết hạn của chính link",
    ]

    /// What the certificate **never** contains — the reason a seller can send it.
    public static let certificateNeverShown: [String] = [
        "Giá mua, giá bán, lãi/lỗ",
        "Chi phí từng gói bảo hành",
        "Ghi chú của thiết bị và ghi chú của gói bảo hành",
        "Ảnh hoá đơn và mọi file đính kèm",
        "Các thiết bị khác trong tài khoản của bạn",
    ]

    public static let neverShownTitle = "Không bao giờ có trong phiếu"

    public static let previewNote =
        "Phiếu do máy chủ API dựng và mở trong trình duyệt — không cần đăng nhập. Đây cũng là thứ người nhận sẽ thấy, nên hãy mở xem trước khi gửi."

    public static let expiryLabel = "Link sống trong bao lâu"
    public static let expiryNote =
        "Hết hạn là link ngừng hoạt động. Không có lựa chọn vĩnh viễn, và bạn luôn thu hồi được trước hạn."

    public static let createdTitle = "Đã tạo link chia sẻ"
    public static let createdSubtitle = "Gửi link dưới đây cho người nhận. Họ mở được ngay, không cần đăng nhập."
    public static let linkLabel = "Link gửi cho người nhận"
    public static let copyAction = "Sao chép link"
    public static let copiedAction = "Đã sao chép"
    public static let shareAction = "Chia sẻ"
    public static let closeAction = "Đóng"
    public static let cancelAction = "Huỷ"

    public static let copiedToast = "Đã sao chép link. Lưu ý: link chỉ hiện một lần."
    public static let copyFailed =
        "Không tự sao chép được. Hãy chọn link và sao chép thủ công rồi gửi ngay."
    /// Shown when the server sent no usable `sharePath` — the credential exists
    /// but this client cannot build a URL for it, which is said out loud.
    public static let missingPath =
        "Máy chủ không trả về đường dẫn cho link này. Hãy thu hồi và tạo lại."

    public static let emptyState =
        "Chưa có link chia sẻ nào. Tạo link khi bạn cần đưa phiếu bàn giao bảo hành cho người mua."
    public static let unavailableState =
        "Không tải được danh sách link chia sẻ — thử tải lại nhé."
    public static let noLiveLinks =
        "Không còn link nào đang hoạt động. Người nhận cũ mở link cũ sẽ thấy thông báo link không còn hiệu lực."

    /// `"Link đã hết hạn hoặc đã thu hồi (3)"`.
    public static func deadGroupLabel(_ count: Int) -> String {
        "Link đã hết hạn hoặc đã thu hồi (\(count))"
    }

    public static let revokeTitle = "Thu hồi link này?"
    public static let revokeAction = "Thu hồi"
    public static let revokeConfirm =
        "Người đang giữ link sẽ không mở được phiếu nữa. Không thể hoàn tác."

    public static let createFailed = "Không tạo được link chia sẻ, thử lại sau."
    public static let revokeFailed = "Không thu hồi được link chia sẻ, thử lại sau."

    /// The share-sheet subject: what the recipient is being handed.
    public static func shareSubject(deviceName: String) -> String {
        "Phiếu bàn giao bảo hành cho \"\(deviceName)\""
    }

    /// The share-sheet body. The URL travels as the shared item, so it is not
    /// repeated here; the sentence exists so a bare capability URL in a chat app
    /// does not read like spam. No price, no account name — nothing the
    /// certificate itself does not already expose, because this text travels
    /// further than the certificate does.
    public static let shareMessage =
        "Link chỉ-đọc, có hạn, không cần đăng nhập. Mở để xem phần bảo hành còn lại."
}

// MARK: - Rules

public enum ShareLinks {

    // MARK: Bounds (mirror api/internal/services/shares.go)

    /// `ShareTTLDefault` — applied when the client asks for no specific lifetime.
    public static let ttlDefaultDays = 30
    /// `ShareTTLMin` — there is no "expires never" value.
    public static let ttlMinDays = 1
    /// `ShareTTLMax`.
    public static let ttlMaxDays = 90
    /// `MaxActiveSharesPerDevice` — creating an 11th live link is a 409 from Go.
    public static let maxActivePerDevice = 10

    /// Expiry choices offered in the create form, all inside `1...90`. 30 days is
    /// the server default and is preselected, so the common case needs no
    /// decision, and a free-text field is deliberately not offered: a value out of
    /// range is a 400 and "0" cannot mean "forever".
    public static let expiryChoices: [(days: Int, label: String)] = [
        (7, "7 ngày"),
        (ttlDefaultDays, "30 ngày (mặc định)"),
        (90, "90 ngày"),
    ]

    /// Whatever a caller carries into `expiresInDays` becomes a value the server
    /// accepts, or the documented default: anything missing or out of `1...90`
    /// falls back to 30 rather than erroring, because the Go validator owns that
    /// rejection and the user's intent here is unambiguous.
    public static func normalizedExpiryDays(_ value: Int?) -> Int {
        guard let value, (ttlMinDays...ttlMaxDays).contains(value) else { return ttlDefaultDays }
        return value
    }

    // MARK: The absolute URL

    /// `/api/v1/public/shares/` — the path prefix Go serves (`services.SharePath`).
    public static let publicSharePathPrefix = "/api/v1/public/shares/"

    private static func isAbsoluteHTTP(_ value: String) -> Bool {
        let lower = value.lowercased()
        return lower.hasPrefix("http://") || lower.hasPrefix("https://")
    }

    /// Build the absolute certificate URL to hand to the buyer.
    ///
    /// `sharePath` is a path, so the caller's API base decides the host. The web's
    /// ladder is kept intact: an already-absolute path is returned untouched; a
    /// path that already carries `/api/` has the base's own `/api` suffix dropped
    /// first (plain concatenation against a `/api`-prefixed base would give
    /// `/api/api/v1/...`); anything else is appended, adding `/api` when the base
    /// lacks it. `nil` means "no URL this client is willing to send" — empty path,
    /// no usable base, or a result that is not an absolute `http(s)` URL with a
    /// host. The UI disables copy/share on `nil` instead of inventing a link.
    public static func certificateURL(baseURL: URL?, sharePath: String) -> URL? {
        let path = sharePath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else { return nil }
        if isAbsoluteHTTP(path) { return validHTTPURL(path) }

        guard let rawBase = baseURL?.absoluteString.trimmingCharacters(in: .whitespacesAndNewlines),
              !rawBase.isEmpty, isAbsoluteHTTP(rawBase) else { return nil }

        var base = rawBase
        while base.hasSuffix("/") { base.removeLast() }
        guard !base.isEmpty else { return nil }

        let baseHasAPISuffix = base.lowercased().hasSuffix("/api")
        let joined: String
        if path.hasPrefix("/api/") {
            // Drop the base's own `/api` (and only that), then append a path that
            // already carries the prefix. Anything before the suffix is a real
            // deployment prefix and survives.
            joined = (baseHasAPISuffix ? String(base.dropLast(4)) : base) + path
        } else {
            let withSlash = path.hasPrefix("/") ? path : "/" + path
            let needsPrefix = !baseHasAPISuffix && (withSlash.hasPrefix("/v1/") || withSlash == "/v1")
            joined = base + (needsPrefix ? "/api" : "") + withSlash
        }
        return validHTTPURL(joined)
    }

    private static func validHTTPURL(_ value: String) -> URL? {
        guard isAbsoluteHTTP(value), let url = URL(string: value),
              let host = url.host, !host.isEmpty else { return nil }
        return url
    }

    /// The token is the last path segment. Used by tests and by nothing that
    /// renders it: the whole URL is what the owner sees, and a partial credential
    /// on screen would be noise at best.
    public static func token(fromSharePath sharePath: String) -> String? {
        let path = sharePath.trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: "?")[0]
            .components(separatedBy: "#")[0]
        let segments = path.split(separator: "/").filter { !$0.isEmpty }
        guard let last = segments.last else { return nil }
        return String(last)
    }

    // MARK: Lifecycle

    public enum Status: Sendable, Equatable {
        case live
        case expired
        case revoked

        public var label: String {
            switch self {
            case .live:    return "Đang hoạt động"
            case .expired: return "Đã hết hạn"
            case .revoked: return "Đã thu hồi"
            }
        }
    }

    /// `revoked` wins over `expired`: a link the owner killed stays labelled as
    /// revoked even after its expiry passes, because that is the action they took
    /// (and the API keeps the row, so the list would otherwise silently change
    /// meaning).
    public static func status(_ share: DeviceShare, now: Date = Date()) -> Status {
        if share.revokedAt != nil { return .revoked }
        return share.expiresAt > now ? .live : .expired
    }

    public static func isLive(_ share: DeviceShare, now: Date = Date()) -> Bool {
        status(share, now: now) == .live
    }

    /// Split the list (newest first, dead rows included) into the links that
    /// count against the cap and everything else, preserving order.
    public static func split(_ shares: [DeviceShare], now: Date = Date()) -> (live: [DeviceShare], dead: [DeviceShare]) {
        var live: [DeviceShare] = []
        var dead: [DeviceShare] = []
        for share in shares {
            if isLive(share, now: now) { live.append(share) } else { dead.append(share) }
        }
        return (live, dead)
    }

    /// How many more links this device may create. Go answers a 409 past the cap;
    /// the UI explains and disables instead of letting the round trip fail.
    public static func capacity(_ shares: [DeviceShare],
                                now: Date = Date()) -> (live: Int, remaining: Int, full: Bool) {
        let live = split(shares, now: now).live.count
        let remaining = max(0, maxActivePerDevice - live)
        return (live, remaining, remaining == 0)
    }

    private static let daySeconds: TimeInterval = 86_400

    /// Vietnamese countdown for a live link, or `nil` when the link is not live
    /// (the status badge already says why). Sub-day precision is avoided on
    /// purpose: "Còn dưới 1 ngày" is honest, "Còn 0 ngày" is not.
    public static func remainingLabel(_ share: DeviceShare, now: Date = Date()) -> String? {
        guard isLive(share, now: now) else { return nil }
        let left = share.expiresAt.timeIntervalSince(now)
        if left <= 0 { return nil }
        if left < daySeconds { return "Còn dưới 1 ngày" }
        return "Còn \(Int(left / daySeconds)) ngày"
    }

    /// `viewCount` counts fetches, which is the only thing the app can observe. It
    /// is never phrased as "người mua đã xem": the link has no identity and may
    /// have been forwarded.
    public static func viewLabel(_ viewCount: Int) -> String {
        let n = max(0, viewCount)
        if n == 0 { return "Chưa ai mở" }
        return "Đã mở \(n) lần"
    }

    /// What the link exposes about the serial, in the owner's own words.
    public static func serialExposureLabel(_ includeSerial: Bool) -> String {
        includeSerial ? "Kèm serial/IMEI đầy đủ" : "Chỉ serial che giữa"
    }

    /// `"3/10 link còn hiệu lực"` plus the reason when full — one line for the
    /// section header, so the count and the cap cannot disagree.
    public static func capacityLine(_ shares: [DeviceShare], now: Date = Date()) -> String {
        let cap = capacity(shares, now: now)
        if cap.full {
            return "\(cap.live)/\(maxActivePerDevice) link còn hiệu lực — đã đạt giới hạn, thu hồi bớt để tạo thêm"
        }
        return "\(cap.live)/\(maxActivePerDevice) link còn hiệu lực"
    }

    // MARK: Failures

    /// Vietnamese message for a failed create/revoke call. A `409` is the
    /// documented cap and gets the local explanation (the server's own sentence is
    /// not guaranteed to be the one the user needs to act on); everything else
    /// prefers the server's Vietnamese `message`, then `fallback`.
    public static func failureMessage(status: Int?, serverMessage: String?, fallback: String) -> String {
        if status == 409 { return ShareCopy.limitReached }
        let message = serverMessage?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let message, !message.isEmpty { return message }
        return fallback
    }
}
