import Foundation

// MARK: - Multi-currency devices
//
// A device records the currency it was bought in (`Device.currency`, ISO 4217,
// default `VND`) and the exchange rate that was true when the user entered it
// (`Device.fxRate`, **VND per one unit**, locked at entry). `purchasePrice`,
// `soldPrice` and every `Warranty.cost` on that device are amounts in that
// currency — they are NOT dong.
//
// The rule that makes totals trustworthy is:
//
//   * the server computes `purchasePriceVnd` / `soldPriceVnd` on every device
//     read and those are the only numbers that may be summed;
//   * a VND device's native amount is already VND, so it is a safe fallback
//     only when the server value is absent (an older cached payload);
//   * a foreign amount with no server VND value is **not convertible here**.
//     It contributes nothing to a total rather than contributing its native
//     number as if it were dong.
//
// `fxRate` is used for exactly one amount the frozen contract does not
// pre-compute: each `Warranty.cost` on the device. That is a multiplication by
// the *locked* rate the device stored, never a market lookup, so it cannot
// drift either.
//
// Everything here is pure and synchronous so the rules can be unit tested
// without a backend or a simulator.

public enum CurrencyRules {

    // MARK: - Codes

    /// The app's base currency. `Device.currency` defaults to this and
    /// `fxRate` must be `nil` for it.
    public static let vnd = "VND"

    /// The currency a device with no `currency` key is in. The contract's own
    /// default, so an old payload keeps meaning what it always meant.
    public static let defaultCurrency = vnd

    /// Currencies offered by the picker. This mirrors the API's closed
    /// `supportedCurrencies` list (it is what `services.ValidateDeviceInput`
    /// accepts), VND first. The list is a UI convenience, not a client-side
    /// whitelist: a device loaded with any other code still renders and saves
    /// that code, and the server is the one that validates it.
    public static let pickerCodes: [String] = [
        "VND", "USD", "EUR", "GBP", "CHF", "JPY", "KRW", "CNY", "TWD", "HKD",
        "SGD", "THB", "MYR", "IDR", "PHP", "INR", "AUD", "NZD", "CAD",
        "SEK", "NOK", "DKK", "PLN", "CZK", "RUB", "TRY", "AED", "BRL",
        "MXN", "ZAR",
    ]

    /// Trims and upper-cases an ISO code. `nil`, `""` and whitespace all mean
    /// the contract default `VND` — never an empty currency.
    public static func normalized(_ code: String?) -> String {
        let trimmed = (code ?? "").trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return trimmed.isEmpty ? defaultCurrency : trimmed
    }

    /// Whether this amount is already in dong.
    public static func isVnd(_ code: String?) -> Bool {
        normalized(code) == vnd
    }

    /// The contract's rate rule: VND carries no rate, every other currency
    /// requires one.
    public static func requiresRate(_ code: String?) -> Bool {
        !isVnd(code)
    }

    /// The picker's ordered codes, keeping a stored code this build does not
    /// list (a currency added server-side later) selectable instead of
    /// silently rewriting it to VND.
    public static func pickerCodes(current: String?) -> [String] {
        let code = normalized(current)
        guard !pickerCodes.contains(code) else { return pickerCodes }
        return pickerCodes + [code]
    }

    /// The currency's display name in the app's current language, for the
    /// picker. Foundation owns the translation table; an unknown code falls
    /// back to the code itself, which is still readable.
    public static func name(for code: String) -> String {
        let identifier = L.effectiveLanguage == .vi ? "vi_VN" : "en_US"
        let name = Locale(identifier: identifier).localizedString(forCurrencyCode: code)
        guard let name, !name.isEmpty, name != code else { return code }
        return name
    }

    /// `"USD · US Dollar"` for the picker row. In Vietnamese the name is the
    /// Vietnamese currency name.
    public static func label(for code: String) -> String {
        let code = normalized(code)
        let name = name(for: code)
        return name == code ? code : "\(code) · \(name)"
    }

    // MARK: - The rate rule

    /// The contract's rate rule, in both directions:
    ///
    ///   - **VND ⇒ the rate must be null.** Sending one is 400
    ///     `fieldErrors.fxRate` ("Thiết bị dùng VND không được có tỷ giá").
    ///   - **anything else ⇒ a positive rate is required.** Omitting it is 400
    ///     `fieldErrors.fxRate`.
    ///
    /// This is the same rule the server applies, so the form never sends a pair
    /// the API is guaranteed to reject.
    public static func rateError(currency: String?, rate: Int?) -> String? {
        if isVnd(currency) {
            guard rate == nil else {
                return L.t("Thiết bị dùng VND không được có tỷ giá")
            }
            return nil
        }
        guard let rate, rate > 0 else {
            return L.t("Cần nhập tỷ giá cho %@", normalized(currency))
        }
        return nil
    }

    /// Whether the (currency, rate) pair may be submitted.
    public static func isValidRate(_ rate: Int?, currency: String?) -> Bool {
        rateError(currency: currency, rate: rate) == nil
    }

    /// `fieldErrors` for the pair, shaped exactly like the server's. The form
    /// blocks on a non-empty result; the server remains the authority.
    public static func fieldErrors(currency: String?, rate: Int?) -> [String: [String]] {
        guard let message = rateError(currency: currency, rate: rate) else { return [:] }
        return ["fxRate": [message]]
    }

    /// The invalid-rate copy, for a rate the user typed (0 is not a rate).
    public static var invalidRateMessage: String { L.t("Tỷ giá không hợp lệ") }

    // MARK: - The totals decision

    /// The amount that may enter a **VND total** for one money field.
    ///
    /// 1. the server's computed `…Vnd` value always wins — it is the contract's
    ///    answer, and using it means the client never re-derives a conversion;
    /// 2. a VND amount with no server value is already dong, so it may stand in
    ///    for it (an older payload only — the current contract always sends it);
    /// 3. a foreign amount with no server value is **not** summed. Returning
    ///    `nil` is what stops "$999" from being added as 999 ₫.
    public static func totalVnd(native: Int, serverVnd: Int?, currency: String?) -> Int? {
        if let serverVnd { return serverVnd }
        if isVnd(currency) { return native }
        return nil
    }

    /// The same decision for a value that may be absent (`soldPrice`).
    public static func totalVnd(native: Int?, serverVnd: Int?, currency: String?) -> Int? {
        guard let native else { return nil }
        return totalVnd(native: native, serverVnd: serverVnd, currency: currency)
    }

    /// A dong value for an amount the contract does **not** pre-compute —
    /// today, each `Warranty.cost` on a device.
    ///
    /// For a VND device the amount is already dong. For a foreign device it is
    /// multiplied by the device's **locked** `fxRate`; no market lookup is
    /// involved, so the historical total does not move with the market. A
    /// foreign amount with no locked rate has no computable value and returns
    /// `nil` (callers add nothing), and an overflow returns `nil` rather than a
    /// wrapped number.
    public static func lockedVnd(_ amount: Int?, currency: String?, fxRate: Int?) -> Int? {
        guard let amount else { return nil }
        if isVnd(currency) { return amount }
        guard let fxRate, fxRate > 0 else { return nil }
        let (result, overflow) = amount.multipliedReportingOverflow(by: fxRate)
        return overflow ? nil : result
    }

    /// The live preview in the form: what the server will compute for this
    /// amount at the locked rate. Same arithmetic as `lockedVnd`, named for the
    /// place that shows it.
    public static func previewVnd(_ amount: Int?, currency: String?, fxRate: Int?) -> Int? {
        lockedVnd(amount, currency: currency, fxRate: fxRate)
    }

    // MARK: - The actual charge

    /// The integer `fxRate` implied by what the card was actually charged:
    /// `round(chargedVnd / purchasePrice)`.
    ///
    /// `fxRate` is an integer (frozen contract) and the charged amount is
    /// whole đồng, so the two can differ by the rounding — the form shows the
    /// derived `purchasePriceVnd` as the stored value rather than pretending
    /// the typed amount is exact. `nil` when no rate can be derived (no price,
    /// no charge, a non-positive price, or a result that does not fit an
    /// `Int`).
    public static func rate(chargedVnd: Int?, purchasePrice: Int?) -> Int? {
        guard let chargedVnd, let purchasePrice,
              purchasePrice > 0, chargedVnd > 0 else { return nil }
        let quotient = Double(chargedVnd) / Double(purchasePrice)
        guard quotient.isFinite else { return nil }
        let rounded = quotient.rounded()
        guard rounded >= 1, rounded < Double(Int.max) else { return nil }
        return Int(rounded)
    }

    // MARK: - Grouping

    /// VND groups thousands with `.` (`25.000.000 ₫`); a foreign currency
    /// groups with `,` (`1,299 USD`). The two must never look alike, or a
    /// dollar amount reads as dong.
    public static func groupingSeparator(for currency: String?) -> String {
        isVnd(currency) ? "." : ","
    }
}

// MARK: - The reference conversion

/// Today's market view of a foreign-priced device — **reference only**.
///
/// Three numbers that must never be confused, in the order the frozen contract
/// defines them:
///
///   * `referenceVnd` = `round(purchasePrice × rates.VND)` — what the listed
///     price is worth at today's market rate. It is computed from the
///     **unrounded** quote (rounding the product, not the rate) and is never
///     stored on the device.
///   * `actualVnd` = the contract's `purchasePriceVnd` — the amount actually
///     charged, converted at the rate locked at entry. The caller passes it in
///     so the server value always wins in the app (and the form passes the
///     same live preview it shows).
///   * `delta` = `actualVnd − referenceVnd`: positive means the locked
///     conversion is above today's market.
///
/// The type exists so the form and the detail screen cannot render the three
/// numbers from two different formulas, and so no code path can mistake
/// `marketRate` for a value to write into `Device.fxRate`.
public struct FxReference: Equatable, Sendable {
    /// VND per one unit of the device's currency, as quoted today (rounded for
    /// display exactly like `Device.fxRate`).
    public let marketRate: Int

    /// `round(purchasePrice × rates.VND)` — today's market conversion.
    public let referenceVnd: Int

    /// What was actually charged, in VND, from the caller's authoritative
    /// value. `nil` when the device has no usable locked rate.
    public let actualVnd: Int?

    /// `actualVnd − referenceVnd`. `nil` when either side is unknown.
    public let delta: Int?

    /// The provider's fetch instant, raw and parsed, plus its cache state and
    /// source. Passed through so a screen can say how old the number is.
    public let fetchedAt: String?
    public let fetchedAtDate: Date?
    public let stale: Bool
    public let source: String?

    /// `nil` when the table has no VND quote or the listed price is not a
    /// positive amount — there is no honest conversion to show then, and the
    /// screen omits the reference rather than showing `0 ₫`.
    public init?(purchasePrice: Int?, actualVnd: Int?, table: FxRates?) {
        guard let table,
              let purchasePrice, purchasePrice > 0,
              let quote = table.vndQuote,
              let marketRate = table.vndRate else { return nil }
        let raw = Double(purchasePrice) * quote
        guard raw.isFinite, raw >= 0, raw.rounded() < Double(Int.max) else { return nil }
        let reference = Int(raw.rounded())
        let delta: Int?
        if let actualVnd {
            let (difference, overflow) = actualVnd.subtractingReportingOverflow(reference)
            delta = overflow ? nil : difference
        } else {
            delta = nil
        }

        self.marketRate = marketRate
        self.referenceVnd = reference
        self.actualVnd = actualVnd
        self.delta = delta
        self.fetchedAt = table.fetchedAt
        self.fetchedAtDate = table.fetchedAtDate
        self.stale = table.isStale
        self.source = table.source
    }
}
