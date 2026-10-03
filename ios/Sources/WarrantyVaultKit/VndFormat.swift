import Foundation

/// VND formatting for the money values that travel as `int64`.
///
/// Every amount on the action-queue and subscription-audit payloads is an
/// `Int64` — a four-billion-đồng value is legal — so the formatting entry point
/// takes `Int64` and never narrows. The output matches `WVFormat.vnd` in the app
/// target (`.` grouping, trailing `₫`), but lives here so the pure rules and their
/// tests do not depend on SwiftUI.
public enum VndFormat {
    /// `4294967296` → `"4.294.967.296 ₫"`. Manual grouping, so the result cannot
    /// drift with the device locale.
    public static func string(_ amount: Int64) -> String {
        let negative = amount < 0
        var grouped = ""
        var count = 0
        for digit in String(amount.magnitude).reversed() {
            if count > 0 && count % 3 == 0 { grouped.insert(".", at: grouped.startIndex) }
            grouped.insert(digit, at: grouped.startIndex)
            count += 1
        }
        return (negative ? "-" : "") + grouped + " ₫"
    }
}
