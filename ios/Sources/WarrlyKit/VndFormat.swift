import Foundation

/// Money formatting for the values that travel as `int64`.
///
/// Every amount on the action-queue and subscription-audit payloads is an
/// `Int64` — a four-billion-đồng value is legal — so the formatting entry point
/// takes `Int64` and never narrows. The output matches `WVFormat.vnd` in the app
/// target, but lives here so the pure rules and their tests do not depend on
/// SwiftUI.
///
/// ## The shape follows the app language
///
/// Vietnamese đồng is not denominated in a foreign currency, so translating it
/// would be wrong — only its **position** and the **thousands separator**
/// change, exactly as `api/internal/i18n/format.go::FormatMoney` (the canonical
/// implementation) and the web/Android clients do:
///
///     vi → 1.200.000 ₫   (dot grouping, trailing symbol)
///     en → ₫1,200,000    (comma grouping, leading symbol)
///
/// This used to be hard-coded to the Vietnamese shape, which meant an English
/// reader — English is the product default — saw Vietnamese digit grouping and
/// a trailing `₫` in the middle of an English sentence. The language parameter
/// defaults to `L.effectiveLanguage`, the one accessor the whole app already
/// reads, so every existing call site follows the Settings switcher without a
/// parameter being threaded through the views. Pass `language:` explicitly from
/// code that renders outside the app's view tree (the widget, App Intents, the
/// pure rules under test) so it cannot depend on process-wide state.
///
/// Negative amounts keep the sign in front of the symbol in **both** languages
/// (`-1.500 ₫` / `-₫1,500`): a minus sign to the right of the symbol reads as
/// part of the amount rather than as its sign. That can only arise from a
/// mis-set price, but it must never render as a positive number.
///
/// ## Multi-currency
///
/// A `Device` may be in a foreign currency. `string(_:currency:)` renders that
/// amount in **its own** currency and never as dong: the ISO code replaces the
/// `₫` sign, so a $999 phone reads `999 USD`, not `999 ₫`, and a $1,299 one
/// reads `1,299 USD`. The code — not the language — is what makes that amount
/// unambiguous, which is why the foreign branch keeps comma grouping and a
/// trailing code in both languages. For VND the output is the language-aware
/// shape above, and the old call sites keep their intent: `string(_:)` is "an
/// amount of dong", `string(_:currency:)` is "an amount in this currency".
public enum VndFormat {
    /// `4294967296` → `"4.294.967.296 ₫"` in Vietnamese, `"₫4,294,967,296"` in
    /// English. Manual grouping, so the result cannot drift with the device
    /// locale.
    public static func string(_ amount: Int64,
                              language: AppLanguage = L.effectiveLanguage) -> String {
        switch language {
        case .vi:
            return grouped(amount, separator: ".") + " ₫"
        case .en:
            // `amount.magnitude` is the UInt64 magnitude, so `Int64.min` groups
            // without overflowing and the sign is placed by hand in front of the
            // symbol (`-₫1,500`), the shape Go's FormatMoney emits.
            let sign = amount < 0 ? "-" : ""
            return sign + "₫" + digits(amount.magnitude, separator: ",")
        }
    }

    /// Formats `amount` in `currency`.
    ///
    /// `nil`/`"VND"`/empty all render exactly like `string(_:)` — the contract
    /// default is VND, and that branch is language-aware. A foreign code renders
    /// `"1,234 USD"`: comma grouping and the ISO code, never the `₫` sign. The
    /// code is the disambiguator there, so that branch does not change with the
    /// language; `language` exists only so the two overloads have one shape.
    public static func string(_ amount: Int64,
                              currency: String?,
                              language: AppLanguage = L.effectiveLanguage) -> String {
        let code = CurrencyRules.normalized(currency)
        guard !CurrencyRules.isVnd(code) else { return string(amount, language: language) }
        return grouped(amount, separator: CurrencyRules.groupingSeparator(for: code)) + " " + code
    }

    /// `Int` convenience for the UI-facing amounts (device prices, warranty
    /// costs), which are `Int` on the wire.
    public static func string(_ amount: Int,
                              currency: String?,
                              language: AppLanguage = L.effectiveLanguage) -> String {
        string(Int64(amount), currency: currency, language: language)
    }

    /// `"12.345"` — grouped digits with no currency marker. Used for the live
    /// rate field, which is VND per one unit and always dot-grouped.
    public static func digits(_ amount: Int64) -> String {
        grouped(amount, separator: ".")
    }

    private static func grouped(_ amount: Int64, separator: String) -> String {
        (amount < 0 ? "-" : "") + digits(amount.magnitude, separator: separator)
    }

    private static func digits(_ magnitude: UInt64, separator: String) -> String {
        var grouped = ""
        var count = 0
        for digit in String(magnitude).reversed() {
            if count > 0 && count % 3 == 0 {
                grouped.insert(contentsOf: separator, at: grouped.startIndex)
            }
            grouped.insert(digit, at: grouped.startIndex)
            count += 1
        }
        return grouped
    }
}
