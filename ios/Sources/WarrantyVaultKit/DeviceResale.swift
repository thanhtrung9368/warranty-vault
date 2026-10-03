import Foundation

// Device resale ("Bán lại") — openapi `Device.soldAt` / `Device.soldPrice`
// (migration 0006, roadmap #12) and the profit/loss they imply.
//
// ## Why this file exists at all
//
// `PATCH /api/v1/devices/{id}` **replaces the whole device**. A client that sends
// only the fields it draws does not "leave the sale alone" — it **erases** it.
// The web and Android clients record sales; until this pass iOS had no notion of
// the pair, so the first iOS edit (or even a status tap) silently destroyed a
// sale recorded elsewhere.
//
// Every iOS save path therefore loads whatever is stored and sends it straight
// back, and these helpers are the pure, testable form of that round trip:
//
//     Device.soldAt    ──carried(from:)──▶ DeviceInput.soldAt
//     Device.soldPrice ──carried(from:)──▶ DeviceInput.soldPrice
//
// This is the same shape as `DeviceReturnWindow` — that file solved exactly this
// problem for the exchange/return window one pass earlier, and the two are meant
// to be read side by side.
//
// ## The three states, which are not two
//
//  * `nil`       = **chưa bán** — nothing recorded;
//  * `0`         = a real price: a give-away ("cho tặng");
//  * `> 0`       = what the device actually sold for, in VND.
//
// So `soldPrice == 0` must survive as `0` and never collapse into "absent" — the
// same distinction `DeviceReturnWindow`'s `returnWindowDays == 0` relies on.
//
// ## The pair rule (the server owns it)
//
// `services.ValidateDeviceInput` requires both halves or neither: supplying
// exactly one is a 400 with `fieldErrors.soldAt = ["Thiếu ngày bán"]` or
// `fieldErrors.soldPrice = ["Thiếu giá bán"]`, and a negative price is
// `fieldErrors.soldPrice = ["Giá bán không hợp lệ"]`. Both absent clears a
// recorded sale, and that is independent of `status`: `SOLD` with no figures is
// valid and simply means "sold, details not recorded".
//
// The messages above are duplicated here **verbatim** (as the web's
// `device-resale.ts` does) for one purpose only: the form refuses to send a
// half-filled pair, and it says so in the server's own words instead of inventing
// copy. Anything the server rejects for a reason this file cannot predict is
// still surfaced from `APIError.fieldErrors`, untranslated.
//
// ## Wire format
//
// `soldAt` arrives **Z-less**: marshalling the real `store.Device` shows
// `pgtype.Timestamp` emitting `"2026-03-02T00:00:00"` — no `Z`, no offset
// (`openapi.yaml` documents the same shape; a trailing `Z` is *not* what the
// server sends). Only the date half is ever used, and the request sends that
// calendar day back (`DeviceInput.soldAt` accepts `YYYY-MM-DD`, which Go parses
// as midnight UTC).
//
// Reading the day **off the string** — rather than parsing it into a `Date` and
// formatting it again — is what keeps the stored day from sliding: a value like
// `2026-03-02T23:30:00` must not become the 3rd in +07:00.

/// The preserved pair, exactly as it must travel into `DeviceInput`.
public struct ResaleFields: Equatable, Sendable {
    /// `YYYY-MM-DD`, or `nil` when "chưa bán".
    public let soldAt: String?
    /// VND; `0` is a give-away, `nil` is "chưa bán".
    public let soldPrice: Int?

    public init(soldAt: String?, soldPrice: Int?) {
        self.soldAt = soldAt
        self.soldPrice = soldPrice
    }

    /// Both halves unrecorded — what a device that was never sold carries.
    public static let none = ResaleFields(soldAt: nil, soldPrice: nil)
}

/// Which way the sale went, used only to pick a colour on the detail screen.
public enum SaleTone: Equatable, Sendable {
    case profit, loss, even
}

/// `soldPrice − purchasePrice`, with the Vietnamese read-out the UI shows.
public struct SaleProfitLoss: Equatable, Sendable {
    /// Signed VND difference. Negative = loss.
    public let amount: Int
    public let tone: SaleTone
    /// Already money-formatted Vietnamese: `"Lãi 2.000.000 ₫"`, `"Lỗ 500.000 ₫"`,
    /// `"Hoà vốn"` — the same wording the web and Android clients render.
    public let label: String
}

public enum DeviceResale {

    // MARK: - The server's own copy for the pair rule

    /// `fieldErrors.soldAt` when a price was given without a date.
    public static let soldAtRequiredMessage = "Thiếu ngày bán"
    /// `fieldErrors.soldPrice` when a date was given without a price.
    public static let soldPriceRequiredMessage = "Thiếu giá bán"
    /// `fieldErrors.soldPrice` for a negative price.
    public static let soldPriceInvalidMessage = "Giá bán không hợp lệ"

    // MARK: - The round trip

    /// Wire → request, unchanged.
    ///
    /// `0` stays `0`; `nil` stays `nil`; an unreadable sale date degrades to
    /// `nil` rather than being invented. Nothing here is a UI convenience: it is
    /// the entire preservation guarantee.
    public static func carried(soldAt: String?, soldPrice: Int?) -> ResaleFields {
        let day = dayPrefix(soldAt)
        // The pair is all-or-nothing on the wire, so a day that cannot be read
        // cannot drag a dangling price along with it: sending the price alone is
        // the 400 `Thiếu ngày bán`, which would fail an edit the user cannot see
        // the cause of.
        return ResaleFields(soldAt: day, soldPrice: day == nil ? nil : soldPrice)
    }

    /// The same mapping, straight off a loaded device.
    public static func carried(from device: Device) -> ResaleFields {
        carried(soldAt: device.soldAt, soldPrice: device.soldPrice)
    }

    /// The same mapping, off a device detail payload.
    public static func carried(from device: DeviceDetailBody) -> ResaleFields {
        carried(soldAt: device.soldAt, soldPrice: device.soldPrice)
    }

    /// Writes the preserved pair onto the payload a save is about to send.
    ///
    /// Applied on **every** save, create included: for a device that was never
    /// sold both stay `nil`, which the encoder drops from the JSON — exactly what
    /// the server already has, so no value is invented either way.
    ///
    /// The pair rule is held here as well, so no caller can put one half on the
    /// wire on its own: Go answers that with a 400, which would fail an edit the
    /// user cannot see the cause of (a status tap, for instance). The same day
    /// reduction as `carried` decides whether a date is really there.
    public static func apply(_ fields: ResaleFields, to input: inout DeviceInput) {
        let day = dayPrefix(fields.soldAt)
        input.soldAt = day
        input.soldPrice = day == nil ? nil : fields.soldPrice
    }

    // MARK: - The recorded answers

    /// `true` when the device carries a resale record at all — what seeds the
    /// form's "Ghi nhận đã bán" switch. The server enforces the pair rule, so
    /// either half is normally enough; the OR keeps a legacy half-record visible
    /// instead of hiding it.
    public static func hasSaleRecorded(_ fields: ResaleFields) -> Bool {
        !(fields.soldAt ?? "").trimmingCharacters(in: .whitespaces).isEmpty || fields.soldPrice != nil
    }

    /// `true` when the device was given away: a recorded price of exactly `0`.
    public static func isGiveAway(_ soldPrice: Int?) -> Bool { soldPrice == 0 }

    // MARK: - The pair rule, mirrored for the form

    /// Client-side mirror of the server's pair rule, in the server's own words.
    /// Returns the `fieldErrors` shape Go produces, or `[:]` when the sale is
    /// complete / absent.
    ///
    ///   * both blank  ⇒ no sale (`[:]`), which the write path sends as
    ///                   `{soldAt: nil, soldPrice: nil}` — the server's "clear it"
    ///   * only a date ⇒ `Thiếu giá bán`
    ///   * only a price ⇒ `Thiếu ngày bán`
    ///   * negative price ⇒ `Giá bán không hợp lệ`
    ///
    /// `recording` is the form's "Ghi nhận đã bán" switch: while it is on, "both
    /// blank" is no longer a valid answer, so the date becomes required. While it
    /// is off there is nothing to record and nothing is checked.
    public static func pairErrors(_ fields: ResaleFields,
                                  recording: Bool = true) -> [String: [String]] {
        guard recording else { return [:] }
        var errors: [String: [String]] = [:]
        let day = (fields.soldAt ?? "").trimmingCharacters(in: .whitespaces)
        let hasDate = !day.isEmpty
        let hasPrice = fields.soldPrice != nil

        if let price = fields.soldPrice, price < 0 {
            // Same order as Go: the negative-price message is written first, then
            // the pair rule may add a key. A complete-but-negative pair keeps this
            // message; a negative price with no date reports both fields.
            errors["soldPrice"] = [soldPriceInvalidMessage]
        }
        if hasDate != hasPrice {
            if hasDate {
                errors["soldPrice"] = [soldPriceRequiredMessage]
            } else {
                errors["soldAt"] = [soldAtRequiredMessage]
            }
        } else if !hasDate {
            // The switch is on, so a wholly blank pair is a sale with nothing
            // recorded: the date is the first thing missing.
            errors["soldAt"] = [soldAtRequiredMessage]
        }
        return errors
    }

    // MARK: - Reading the stored day

    /// `YYYY-MM-DD` of a wire timestamp, or `nil` when there is not one there.
    ///
    /// Delegates to the same reduction `DeviceReturnWindow` uses: the value is a
    /// UTC wall clock, so an offset-aware parse could move the calendar day by
    /// the device's offset. Shared rather than re-implemented so the two
    /// preserved pairs can never disagree about what a day is.
    public static func dayPrefix(_ wire: String?) -> String? {
        DeviceReturnWindow.dayPrefix(wire)
    }

    /// `dd/MM/yyyy` for the detail screen, or `nil` when nothing is recorded.
    /// The client only formats the day the server stored — it never derives one.
    public static func dayLabel(_ wire: String?) -> String? {
        DeviceReturnWindow.deadlineLabel(wire)
    }

    /// `YYYY-MM-DD` → the `Date` a date picker should hold for that day: midnight
    /// **in `timeZone`**. `nil` when the wire value carries no readable day.
    ///
    /// The zone is a parameter rather than a constant because a date picker draws
    /// its `Date` in the *device's* zone: parsing the stored day anywhere else
    /// shows the user a different day than the server holds — a Vietnam-pinned
    /// parse puts `"2026-03-02"` on the 1st for anyone west of UTC+7.
    /// `dayString(_:in:)` is its exact inverse in the same zone, so the day the
    /// user is looking at is the day that gets saved, and an untouched picker
    /// gives back precisely what was loaded.
    public static func dayDate(_ wire: String?, in timeZone: TimeZone = .current) -> Date? {
        guard let day = dayPrefix(wire) else { return nil }
        return dayFormatter(timeZone).date(from: day)
    }

    /// The `YYYY-MM-DD` a `Date` stands for in `timeZone` — the calendar day the
    /// user is looking at. The inverse of `dayDate(_:in:)`.
    public static func dayString(_ date: Date, in timeZone: TimeZone = .current) -> String {
        dayFormatter(timeZone).string(from: date)
    }

    /// A `yyyy-MM-dd` formatter pinned to `timeZone` and to a fixed locale, so the
    /// day can never drift with the device's locale. Built per call: these run
    /// once per form load and once per save.
    private static func dayFormatter(_ timeZone: TimeZone) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = timeZone
        return f
    }

    // MARK: - The derived profit/loss (read-only)

    /// Profit/loss of the resale versus the purchase price. The API never returns
    /// this ("Lãi/lỗ = soldPrice − purchasePrice (client tự tính)"), so it is
    /// computed here and unit-tested. `nil` when no sale price was recorded.
    ///
    /// Both operands are non-negative int32 by contract (Go rejects a negative
    /// `purchasePrice` with "Giá mua không hợp lệ" and a negative `soldPrice` with
    /// "Giá bán không hợp lệ"), so the difference cannot overflow `Int`.
    public static func profitLoss(purchasePrice: Int, soldPrice: Int?) -> SaleProfitLoss? {
        guard let soldPrice else { return nil }
        let amount = soldPrice - purchasePrice
        if amount > 0 {
            return SaleProfitLoss(amount: amount, tone: .profit,
                                  label: "Lãi \(VndFormat.string(Int64(amount)))")
        }
        if amount < 0 {
            return SaleProfitLoss(amount: amount, tone: .loss,
                                  label: "Lỗ \(VndFormat.string(Int64(-amount)))")
        }
        return SaleProfitLoss(amount: 0, tone: .even, label: "Hoà vốn")
    }
}
