import Foundation

// MARK: - Brand warranty lookup
//
// The warranty start date the user typed is a **guess from the invoice**. The
// brand's own system holds the real one, and the two disagree for exactly the
// cases people actually hit: a grey-market import activated months before the
// sale, a shop that pre-activated a unit on the shelf, a repaired device
// re-registered under a new serial. The user thinks eight months are left; the
// brand's counter says it expired last week.
//
// This file is the pure half of the feature — no network, no SwiftUI — so the
// rules that decide what the user reads can be tested without a simulator or a
// running server:
//
//  1. **The server computes the mismatch.** `Device.warrantyMismatch` is
//     read-only; the client never re-derives it. What lives here is the *copy
//     selector* for the four documented kinds, plus a generic sentence for a
//     fifth kind a future server might add (the dates and the day count must
//     still render — an unknown kind must not blank the flag).
//  2. **`nil` mismatch is ambiguous.** It means "no disagreement **or** nothing
//     to compare". Only a recorded brand **start** date guarantees a comparison
//     ran (against `purchaseDate`, which always exists), so only then may the UI
//     say the two sides agree. A check that recorded only a status
//     (`NOT_REGISTERED`, say) is its own answer, not agreement — and an end date
//     alone is not comparable on a device that has no whole-unit warranty.
//  3. **No URL is an answer.** `GET /api/v1/brands/{brandId}/service-info` is
//     allowed to return `warrantyLookupUrl: null` for a brand the API cannot
//     source. The app says exactly that and invents nothing: no support-page
//     substitution, no guessed path, no search URL.
//  4. **Days are calendar days.** The wire values are raw strings and only their
//     leading `YYYY-MM-DD` is ever read (`DeviceReturnWindow.dayPrefix`), so a
//     Z-less timestamp cannot slide a day across the device's UTC offset. The
//     arithmetic is anchored in UTC on purpose — it is a difference between two
//     calendar days, and a local-time anchor would make DST days 23 or 25 hours
//     long for no reason.
//
// The five writable fields and the two wire shapes live in `Models.swift`; this
// file is the round trip and the wording, mirroring `DeviceReturnWindow` and
// `DeviceResale`.

/// The five brand-warranty fields as they travel between a read, the record
/// sheet, and `DeviceInput`.
///
/// `start` / `end` are calendar days (`YYYY-MM-DD`) once carried, so a date
/// picker cannot move the day. `checkedAt` keeps its raw wire string: it is an
/// instant, not a day, and no client-side arithmetic may turn it into one.
public struct BrandWarrantyFields: Equatable, Sendable {
    public var status: BrandWarrantyStatus?
    public var start: String?
    public var end: String?
    public var checkedAt: String?
    public var lookupUrl: String?

    public init(status: BrandWarrantyStatus? = nil,
                start: String? = nil,
                end: String? = nil,
                checkedAt: String? = nil,
                lookupUrl: String? = nil) {
        self.status = status
        self.start = start
        self.end = end
        self.checkedAt = checkedAt
        self.lookupUrl = lookupUrl
    }

    /// Every field unset — both "never checked" and "the user cleared it".
    public static let empty = BrandWarrantyFields()

    /// `true` when at least one field was ever recorded. The section uses this
    /// to distinguish "not checked yet" from "checked, no dates" — which is why
    /// `warrantyMismatch == nil` alone is not enough.
    public var hasAnyRecord: Bool {
        status != nil || Self.present(start) || Self.present(end)
            || Self.present(checkedAt) || Self.present(lookupUrl)
    }

    /// `true` when the brand showed a **start** date.
    ///
    /// Only the start guarantees a comparison happened: it is compared against
    /// `purchaseDate`, which always exists. An end date alone is compared against
    /// the device's whole-unit warranty end, and a device with only component
    /// warranties has none — the server then returns a nil mismatch meaning
    /// "nothing to compare", which must not be shown as agreement. Android reads
    /// the same wire the same way.
    public var hasComparableBrandDate: Bool {
        Self.present(start)
    }

    /// A whitespace-only string is "not recorded", the same rule the server
    /// applies when it trims the five inputs.
    private static func present(_ value: String?) -> Bool {
        guard let value else { return false }
        return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

// MARK: - Copy

/// Every sentence the feature shows, in the current language.
///
/// Computed properties rather than stored `static let`s: a stored value would
/// freeze the language it happened to be read in, and this app can switch
/// language at runtime.
public enum BrandWarrantyCopy {

    /// Chip on the device detail and in the list row. Short on purpose — the
    /// sentence lives on the card.
    public static var mismatchBadge: String { L.t("Lệch ngày BH") }

    public static var sectionTitle: String { L.t("Đối chiếu với hãng") }

    /// The whole point of the feature, said plainly.
    public static var sectionHint: String {
        L.t("Ngày bảo hành bạn nhập là ước lượng từ hoá đơn. Mở trang tra cứu của hãng để xem ngày thật, rồi ghi lại kết quả.")
    }

    /// The lookup action itself. The requirement names this exact phrase, and
    /// the host in the row's subtitle says where the tap goes.
    public static var lookupAction: String { L.t("Đối chiếu với hãng") }

    /// `warrantyLookupUrl: null` for a brand that **is** in the directory.
    public static var lookupMissingTitle: String { L.t("App không có trang tra cứu của hãng này") }
    public static var lookupMissingDetail: String {
        L.t("App không có link đã kiểm chứng cho hãng này nên sẽ không tự đoán URL. Bạn có thể tự tra trên trang hỗ trợ của hãng.")
    }

    /// The brand text on the device matched no catalog row (or matched two).
    /// A different reason for the same "no page" answer, stated separately so
    /// the user knows what they can fix.
    public static var lookupUnknownBrandDetail: String {
        L.t("App chưa khớp được hãng bạn ghi với danh mục hãng nên không có trang tra cứu để mở.")
    }

    public static var lookupFailed: String {
        L.t("Không tải được thông tin tra cứu của hãng — thử lại nhé.")
    }
    public static var lookupLoading: String { L.t("Đang tải trang tra cứu của hãng…") }

    public static var noBrandDetail: String {
        L.t("Thêm hãng cho thiết bị để app tìm trang tra cứu bảo hành của hãng.")
    }

    public static var recordAction: String { L.t("Ghi kết quả hãng báo") }

    /// The `notChecked` card: an estimate exists, nothing has been compared.
    public static var notCheckedTitle: String { L.t("Chưa đối chiếu với hãng") }
    public static var notCheckedDetail: String {
        L.t("Mốc bảo hành bạn đang thấy là ước lượng từ hoá đơn. Đối chiếu với hãng để biết ngày thật.")
    }

    /// The `agrees` card. Not a green "verified" claim — the app only knows the
    /// dates the user recorded from the brand's page.
    public static var agreesTitle: String { L.t("Hãng và bạn đang tính khớp nhau.") }
    public static var agreesDetail: String {
        L.t("Lần đối chiếu gần nhất không thấy lệch ngày bảo hành.")
    }

    /// A check was recorded, but it carried no date to compare.
    public static var checkedNoDatesTitle: String { L.t("Đã đối chiếu với hãng") }
    public static var statusOnlyDetail: String {
        L.t("Hãng chưa cho ngày bảo hành cụ thể để so với mốc bạn đang tính.")
    }

    // Recorded-field labels.
    public static var statusLabel: String { L.t("Tình trạng hãng báo") }
    public static var startLabel: String { L.t("Hãng ghi bảo hành bắt đầu") }
    public static var endLabel: String { L.t("Hãng ghi bảo hành kết thúc") }
    public static var checkedAtLabel: String { L.t("Đối chiếu lúc") }
    public static var lookupURLRecordedLabel: String { L.t("Link đã mở") }

    public static var notChosen: String { L.t("Chưa chọn") }
    public static var notRecorded: String { L.t("Chưa ghi") }

    // Record sheet.
    public static var recordSheetTitle: String { L.t("Ghi kết quả hãng báo") }
    public static var recordSheetHint: String {
        L.t("Ghi đúng ngày hãng hiển thị. Đây là kết quả bạn đọc được từ trang của hãng, không phải kết quả app tự đoán.")
    }
    public static var recordSheetStartLabel: String { L.t("Ngày bắt đầu hãng ghi") }
    public static var recordSheetEndLabel: String { L.t("Ngày kết thúc hãng ghi") }
    public static var recordSheetStatusLabel: String { L.t("Tình trạng hãng báo") }
    public static var recordSheetLinkLabel: String { L.t("Link đã mở") }
    public static var recordSheetLinkPlaceholder: String { "https://…" }
    public static var checkedAtNote: String {
        L.t("Thời điểm đối chiếu sẽ được ghi là lúc bạn lưu.")
    }
    public static var localOnlyNote: String {
        L.t("Kết quả sẽ được lưu cùng thiết bị khi bạn bấm Lưu.")
    }

    public static var clearAction: String { L.t("Xoá kết quả đối chiếu") }
    public static var clearConfirmTitle: String { L.t("Xoá kết quả đối chiếu?") }
    public static var clearConfirmMessage: String {
        L.t("Toàn bộ tình trạng, ngày hãng báo và link đã lưu sẽ bị xoá.")
    }

    /// Local validation messages, in the server's `fieldErrors` shape. The
    /// wording is the server's own (verbatim, like `DeviceResale`'s pair rule),
    /// so a user sees the same sentence whether the client or Go rejected it.
    public static var statusRequiredMessage: String {
        L.t("Trạng thái bảo hành hãng bắt buộc khi đã ghi ngày hoặc link tra cứu")
    }
    public static var endBeforeStartMessage: String {
        L.t("Ngày hết hạn bảo hành hãng không được trước ngày bắt đầu")
    }
    public static var invalidURLMessage: String {
        L.t("Link tra cứu bảo hành hãng phải là URL http/https tuyệt đối")
    }
    public static var saveFailedMessage: String {
        L.t("Không lưu được kết quả đối chiếu — thử lại nhé.")
    }

    // Mismatch state copy.
    public static var savedMark: String { L.t("Đã ghi kết quả đối chiếu.") }

    /// "Checked today" / "Checked 3 days ago", when `checkedAt` is readable.
    public static var checkedToday: String { L.t("Đối chiếu hôm nay") }
}

// MARK: - Rules

public enum BrandWarrantyRules {

    // MARK: Lookup availability

    /// What the brand's service info allows the section to do.
    public enum LookupAvailability: Equatable, Sendable {
        /// A well-formed absolute `http(s)` URL. The only case that gets a
        /// tappable action.
        case available(URL)
        /// No URL — either the brand is not in the catalog, or the API
        /// returned `warrantyLookupUrl: null`. The UI states which.
        case missing
    }

    /// `http(s)` and nothing else, exactly the contract's rule. The URL must
    /// also have a host, so `"https://"` does not become a button that opens
    /// nowhere.
    public static func lookupAvailability(_ raw: String?) -> LookupAvailability {
        // Mirrors the server's `isAbsoluteHTTPURL`: trim, reject any internal
        // whitespace or control character, then require an absolute http(s) URL
        // with a host. The server is the authority, but the sheet must catch the
        // same values before a round trip.
        guard let value = trimmed(raw),
              !value.contains(where: { $0.isWhitespace }),
              let url = ServiceDirectoryInfo.safeExternalURL(value) else { return .missing }
        return .available(url)
    }

    // MARK: Catalog match (the only brand-id source)

    /// Resolve the device's free-text brand to a catalog brand id, or `nil`.
    ///
    /// The service-info route is keyed by `brandId`, and `Device` carries only
    /// the brand **name**. The catalog autocompletes exact names, so a simple
    /// folded equality is enough — and when it is not, the honest answer is
    /// "I cannot match this", not a substring guess that might resolve "Sam"
    /// to "Samsung" or "Apple Việt Nam" to nothing useful.
    ///
    /// Folding is diacritic- and case-insensitive (`Điện máy` == `dien may`) and
    /// collapses runs of whitespace. Two different ids matching the same name is
    /// **ambiguous** and returns `nil`, mirroring the server's free-text rule in
    /// `service-directory` ("hoà thì không khớp").
    public static func brandId(for brand: String?, in brands: [BrandOption]) -> String? {
        guard let needle = normalizedName(brand), !needle.isEmpty else { return nil }
        let matches = brands.filter { normalizedName($0.name) == needle }
        let ids = Set(matches.map(\.id))
        guard ids.count == 1 else { return nil }
        return ids.first
    }

    private static func normalizedName(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let folded = raw
            .replacingOccurrences(of: "đ", with: "d")
            .replacingOccurrences(of: "Đ", with: "D")
            .folding(options: [.diacriticInsensitive, .caseInsensitive],
                     locale: Locale(identifier: "en_US_POSIX"))
        let words = folded
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
        guard !words.isEmpty else { return nil }
        return words.joined(separator: " ")
    }

    // MARK: Round trip

    /// Wire → request. The two brand dates are reduced to their calendar day;
    /// the check timestamp and the URL are preserved verbatim (with the URL
    /// dropped when it is not openable, so a legacy bad value cannot make every
    /// later save a 400 the user has no field to fix).
    public static func carried(status: BrandWarrantyStatus?,
                               start: String?,
                               end: String?,
                               checkedAt: String?,
                               lookupUrl: String?) -> BrandWarrantyFields {
        BrandWarrantyFields(
            status: status,
            start: DeviceReturnWindow.dayPrefix(start),
            end: DeviceReturnWindow.dayPrefix(end),
            checkedAt: trimmed(checkedAt),
            lookupUrl: openableURLString(lookupUrl)
        )
    }

    public static func carried(from device: Device) -> BrandWarrantyFields {
        carried(status: device.brandWarrantyStatus,
                start: device.brandWarrantyStart,
                end: device.brandWarrantyEnd,
                checkedAt: device.brandCheckedAt,
                lookupUrl: device.brandLookupUrl)
    }

    public static func carried(from device: DeviceDetailBody) -> BrandWarrantyFields {
        carried(status: device.brandWarrantyStatus,
                start: device.brandWarrantyStart,
                end: device.brandWarrantyEnd,
                checkedAt: device.brandCheckedAt,
                lookupUrl: device.brandLookupUrl)
    }

    /// Writes the five fields onto the payload a save is about to send. Applied
    /// on **every** save path — status taps and the device form included —
    /// because `PATCH /devices/{id}` replaces the whole row and omitting them
    /// would erase a check recorded elsewhere.
    public static func apply(_ fields: BrandWarrantyFields, to input: inout DeviceInput) {
        input.brandWarrantyStatus = fields.status
        input.brandWarrantyStart = DeviceReturnWindow.dayPrefix(fields.start)
        input.brandWarrantyEnd = DeviceReturnWindow.dayPrefix(fields.end)
        input.brandCheckedAt = trimmed(fields.checkedAt)
        input.brandLookupUrl = openableURLString(fields.lookupUrl)
    }

    /// `true` when every one of the five fields is unset — the "clear" case the
    /// sheet sends as an explicit empty payload (all keys omitted, which Go
    /// reads as `null`).
    public static func isEmpty(_ fields: BrandWarrantyFields) -> Bool { !fields.hasAnyRecord }

    // MARK: Validation (mirrors the server)

    /// The contract's three write rules, in the server's `fieldErrors` shape:
    ///
    ///  * `brandWarrantyStatus` is required whenever **any** other one of the
    ///    five is set;
    ///  * `brandWarrantyEnd` must not precede `brandWarrantyStart`;
    ///  * `brandLookupUrl` must be an absolute `http(s)` URL.
    ///
    /// Whitespace-only strings count as unset, matching the server's trims. An
    /// unreadable date is not a client-side error — the server owns date
    /// parsing, and guessing "invalid" from a string this file cannot read
    /// would reject a valid future wire shape.
    public static func validationErrors(_ fields: BrandWarrantyFields) -> [String: [String]] {
        var errors: [String: [String]] = [:]

        let hasStart = trimmed(fields.start) != nil
        let hasEnd = trimmed(fields.end) != nil
        let hasChecked = trimmed(fields.checkedAt) != nil
        let hasURL = trimmed(fields.lookupUrl) != nil
        if fields.status == nil && (hasStart || hasEnd || hasChecked || hasURL) {
            errors["brandWarrantyStatus"] = [BrandWarrantyCopy.statusRequiredMessage]
        }

        if let start = fields.start, let end = fields.end,
           let days = signedDaysBetween(start, end), days < 0 {
            errors["brandWarrantyEnd"] = [BrandWarrantyCopy.endBeforeStartMessage]
        }

        if let raw = trimmed(fields.lookupUrl), case .missing = lookupAvailability(raw) {
            errors["brandLookupUrl"] = [BrandWarrantyCopy.invalidURLMessage]
        }

        return errors
    }

    // MARK: Mismatch state

    /// What the section should say. `warrantyMismatch == nil` never means
    /// "agrees" on its own — see the file header.
    public enum MismatchState: Equatable, Sendable {
        case notChecked
        case mismatch(WarrantyMismatch)
        case agrees
        case statusOnly(status: BrandWarrantyStatus?)
    }

    public static func mismatchState(_ mismatch: WarrantyMismatch?,
                                     fields: BrandWarrantyFields) -> MismatchState {
        if let mismatch { return .mismatch(mismatch) }
        guard fields.hasAnyRecord else { return .notChecked }
        // Only a recorded brand date gave the server something to compare. A
        // status-only check (NOT_REGISTERED, PRE_ACTIVATED, …) must not be
        // reported as agreement.
        if fields.hasComparableBrandDate { return .agrees }
        return .statusOnly(status: fields.status)
    }

    /// The headline of the mismatch card.
    ///
    /// Four documented kinds, plus a generic sentence for a kind this build does
    /// not recognise — the day count and both dates still render, so a future
    /// server cannot make the flag disappear.
    public static func mismatchHeadline(_ mismatch: WarrantyMismatch) -> String {
        let days = abs(mismatch.days)
        switch mismatch.kind {
        case .STARTS_BEFORE:
            return L.p("Hãng ghi bảo hành bắt đầu trước ngày mua %d ngày", days)
        case .STARTS_AFTER:
            return L.p("Hãng ghi bảo hành bắt đầu sau ngày mua %d ngày", days)
        case .ENDED_EARLIER:
            return L.p("Hãng ghi bảo hành kết thúc sớm hơn mốc bạn đang tính %d ngày", days)
        case .ENDED_LATER:
            return L.p("Hãng ghi bảo hành kết thúc muộn hơn mốc bạn đang tính %d ngày", days)
        case nil:
            return L.p("Hãng báo ngày bảo hành khác với mốc bạn đang tính %d ngày", days)
        }
    }

    /// The two dates, always shown with the mismatch so the user can check the
    /// claim rather than trust a number. Either date may be missing in a
    /// malformed payload; the line degrades to the one that exists.
    ///
    /// The second date is **not always the purchase date**: for `ENDED_*` the
    /// contract's `purchaseDate` field carries the app's whole-unit warranty
    /// end (the field name is frozen, the kind says which date it is). Labelling
    /// it "Ngày mua" there would tell the user to compare the brand's expiry with
    /// the wrong day.
    public static func mismatchDatesLine(_ mismatch: WarrantyMismatch) -> String? {
        let brand = dayLabel(mismatch.brandDate)
        let appSide = dayLabel(mismatch.purchaseDate)

        if let brand, let appSide {
            switch mismatch.kind {
            case .STARTS_BEFORE, .STARTS_AFTER:
                return L.t("Hãng ghi: %@ · Ngày mua: %@", brand, appSide)
            case .ENDED_EARLIER, .ENDED_LATER:
                return L.t("Hãng ghi: %@ · Mốc bạn đang tính: %@", brand, appSide)
            case nil:
                return L.t("Hãng ghi: %@ · Mốc so sánh: %@", brand, appSide)
            }
        }
        if let brand {
            return L.t("Hãng ghi: %@", brand)
        }
        if let appSide {
            switch mismatch.kind {
            case .STARTS_BEFORE, .STARTS_AFTER:
                return L.t("Ngày mua: %@", appSide)
            case .ENDED_EARLIER, .ENDED_LATER:
                return L.t("Mốc bạn đang tính: %@", appSide)
            case nil:
                return L.t("Mốc so sánh: %@", appSide)
            }
        }
        return nil
    }

    /// Title for the state card. `nil` for `.mismatch`, whose title is the
    /// per-kind sentence from `mismatchHeadline`.
    public static func stateTitle(_ state: MismatchState) -> String? {
        switch state {
        case .mismatch:            return nil
        case .notChecked:          return BrandWarrantyCopy.notCheckedTitle
        case .agrees:              return BrandWarrantyCopy.agreesTitle
        case .statusOnly(let status):
            return status?.label ?? BrandWarrantyCopy.checkedNoDatesTitle
        }
    }

    /// Detail for the state card. For `.mismatch` this is the dates line.
    public static func stateDetail(_ state: MismatchState) -> String? {
        switch state {
        case .mismatch(let mismatch):
            return mismatchDatesLine(mismatch)
        case .notChecked:
            return BrandWarrantyCopy.notCheckedDetail
        case .agrees:
            return BrandWarrantyCopy.agreesDetail
        case .statusOnly:
            return BrandWarrantyCopy.statusOnlyDetail
        }
    }

    // MARK: Day arithmetic

    /// Signed whole calendar days from `from` to `to` (`to - from`).
    ///
    /// Both values go through `DeviceReturnWindow.dayPrefix` first, so a full
    /// timestamp and a bare `YYYY-MM-DD` mean the same day. The subtraction is
    /// anchored in UTC: it is a difference between two calendar days, not
    /// between two instants, and a local anchor would turn DST days into 23 or
    /// 25 hours for no reason. `nil` when either day is unreadable.
    public static func signedDaysBetween(_ from: String?, _ to: String?) -> Int? {
        guard let fromDay = DeviceReturnWindow.dayPrefix(from),
              let toDay = DeviceReturnWindow.dayPrefix(to) else { return nil }
        let utc = utcCalendar()
        guard let start = WireDay.date(from: fromDay, in: utc.timeZone),
              let end = WireDay.date(from: toDay, in: utc.timeZone) else { return nil }
        return utc.dateComponents([.day], from: start, to: end).day
    }

    /// `true` when both dates are readable and the end is strictly before the
    /// start. Equal days are fine; no date is not an error.
    public static func endPrecedesStart(start: String?, end: String?) -> Bool {
        guard let days = signedDaysBetween(start, end) else { return false }
        return days < 0
    }

    /// Whole days since the recorded check, measured on the caller's calendar
    /// (the day the user is looking at). `nil` when `checkedAt` carries no
    /// readable day. `0` is "today".
    public static func daysSinceChecked(_ wire: String?,
                                        now: Date = Date(),
                                        calendar: Calendar = .current) -> Int? {
        guard let day = DeviceReturnWindow.dayPrefix(wire),
              let checked = WireDay.date(from: day, in: calendar.timeZone) else { return nil }
        let from = calendar.startOfDay(for: checked)
        let to = calendar.startOfDay(for: now)
        return calendar.dateComponents([.day], from: from, to: to).day
    }

    /// `"Đối chiếu hôm nay"` / `"Đối chiếu 3 ngày trước"`, or `nil` when there
    /// is no readable check date. A future timestamp (clock skew) reads as
    /// today rather than as a negative count.
    public static func checkedAgoLabel(_ wire: String?,
                                       now: Date = Date(),
                                       calendar: Calendar = .current) -> String? {
        guard let days = daysSinceChecked(wire, now: now, calendar: calendar) else { return nil }
        if days <= 0 { return BrandWarrantyCopy.checkedToday }
        return L.p("Đối chiếu %d ngày trước", days)
    }

    /// `dd/MM/yyyy` of a raw wire day, or `nil` when there is nothing readable.
    /// Never derives or shifts a day — it formats the string the server stored.
    public static func dayLabel(_ wire: String?) -> String? {
        DeviceReturnWindow.deadlineLabel(wire)
    }

    /// RFC3339 (UTC) for `DeviceInput.brandCheckedAt` when the user saves the
    /// record sheet. UTC with an explicit `Z` so the instant cannot be read in
    /// the device's zone by the server.
    public static func checkedAtString(_ date: Date = Date(),
                                       timeZone: TimeZone = TimeZone(identifier: "UTC") ?? .current) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = timeZone
        return formatter.string(from: date)
    }

    // MARK: Helpers

    private static func trimmed(_ raw: String?) -> String? {
        guard let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else { return nil }
        return value
    }

    /// The raw string when it is an openable absolute http(s) URL, else `nil`.
    /// The original spelling is preserved (no percent-encoding round trip), so
    /// a recorded link survives a save verbatim.
    private static func openableURLString(_ raw: String?) -> String? {
        guard let value = trimmed(raw),
              case .available = lookupAvailability(value) else { return nil }
        return value
    }

    private static func utcCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? TimeZone(secondsFromGMT: 0) ?? .current
        return calendar
    }
}
