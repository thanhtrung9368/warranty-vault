import Foundation

/// Money formatting for the values that travel as `int64`.
///
/// Every amount on the action-queue and subscription-audit payloads is an
/// `Int64` — a four-billion-đồng value is legal — so the formatting entry point
/// takes `Int64` and never narrows. The output matches `WVFormat.vnd` in the app
/// target (`.` grouping, trailing `₫`), but lives here so the pure rules and their
/// tests do not depend on SwiftUI.
///
/// ## Multi-currency
///
/// A `Device` may be in a foreign currency. `string(_:currency:)` renders that
/// amount in **its own** currency and never as dong: the grouping separator
/// differs (`.` for VND, `,` for everything else) and the ISO code replaces the
/// trailing `₫`. So a $999 phone reads `999 USD`, not `999 ₫`, and a $1,299 one
/// reads `1,299 USD`. For VND the output is byte-identical to the original
/// `string(_:)` so no existing screen changes.
public enum VndFormat {
    /// `4294967296` → `"4.294.967.296 ₫"`. Manual grouping, so the result cannot
    /// drift with the device locale.
    public static func string(_ amount: Int64) -> String {
        grouped(amount, separator: ".") + " ₫"
    }

    /// Formats `amount` in `currency`.
    ///
    /// `nil`/`"VND"`/empty all render exactly like `string(_:)` — the contract
    /// default is VND. A foreign code renders `"1,234 USD"`: comma grouping and
    /// the ISO code, never the `₫` sign.
    public static func string(_ amount: Int64, currency: String?) -> String {
        let code = CurrencyRules.normalized(currency)
        guard !CurrencyRules.isVnd(code) else { return string(amount) }
        return grouped(amount, separator: CurrencyRules.groupingSeparator(for: code)) + " " + code
    }

    /// `Int` convenience for the UI-facing amounts (device prices, warranty
    /// costs), which are `Int` on the wire.
    public static func string(_ amount: Int, currency: String?) -> String {
        string(Int64(amount), currency: currency)
    }

    /// `"12.345"` — grouped digits with no currency marker. Used for the live
    /// rate field, which is VND per one unit and always dot-grouped.
    public static func digits(_ amount: Int64) -> String {
        grouped(amount, separator: ".")
    }

    private static func grouped(_ amount: Int64, separator: String) -> String {
        let negative = amount < 0
        var grouped = ""
        var count = 0
        for digit in String(amount.magnitude).reversed() {
            if count > 0 && count % 3 == 0 {
                grouped.insert(contentsOf: separator, at: grouped.startIndex)
            }
            grouped.insert(digit, at: grouped.startIndex)
            count += 1
        }
        return (negative ? "-" : "") + grouped
    }
}
