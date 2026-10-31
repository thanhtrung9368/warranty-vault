import SwiftUI
import WarrlyKit

// ============================================================
// Warrly iOS — shared formatting + category helpers
//
// One home for currency / date formatting and the category →
// icon/color mapping (ported from project/ios/js/data.js) so
// every screen renders these consistently.
// ============================================================

enum WVFormat {
    /// VND in the **app language**: `1.200.000 ₫` in Vietnamese,
    /// `₫1,200,000` in English.
    ///
    /// Delegates to the Kit's `VndFormat`, whose default language is
    /// `L.effectiveLanguage` — the same accessor every screen's copy uses, so a
    /// language switch re-renders money with the rest of the UI. There is no
    /// second money implementation here: this used to be a hard-coded
    /// `vi-VN`-shaped `NumberFormatter` and was the surface that stayed
    /// Vietnamese in English mode.
    static func vnd(_ amount: Int) -> String {
        VndFormat.string(Int64(amount))
    }

    /// A device's amount in **its own** currency: `25.000.000 ₫` for VND,
    /// `999 USD` / `1,299 USD` for a foreign one.
    ///
    /// Delegates to the Kit's `VndFormat` so the rules (and their tests) live in
    /// one place. The important property is negative: a foreign amount never
    /// renders with the `₫` sign, because that is exactly how a $999 phone
    /// starts being counted as 999 dong.
    static func currency(_ amount: Int, _ currency: String?) -> String {
        VndFormat.string(Int64(amount), currency: currency)
    }

    /// A locked exchange rate as `25.400 ₫` (VND per one unit).
    static func rate(_ fxRate: Int) -> String {
        VndFormat.string(Int64(fxRate))
    }

    /// Abbreviated money for tight widgets: `1,2 tr` / `980 ng` in Vietnamese,
    /// `₫1.2M` / `₫980K` in English.
    ///
    /// The scale words are part of the language, not of the amount: `tr`/`ng`
    /// are Vietnamese ("triệu"/"nghìn") and mean nothing to an English reader,
    /// so English uses the international `M`/`K` with a dot decimal and the
    /// leading `₫` that `VndFormat` uses for full amounts. The two shapes never
    /// mix — the decimal separator flips with the language, as it does in
    /// `VndFormat`. Values under a thousand fall through to the full amount, so
    /// there is exactly one formatter for the small case.
    static func compactVnd(_ amount: Int) -> String {
        let a = abs(amount)
        let sign = amount < 0 ? "-" : ""
        switch L.effectiveLanguage {
        case .vi:
            if a >= 1_000_000 {
                return "\(sign)\(decimal(Double(a) / 1_000_000)) tr ₫"
            }
            if a >= 1_000 {
                return "\(sign)\(decimal(Double(a) / 1_000)) ng ₫"
            }
        case .en:
            if a >= 1_000_000 {
                return "\(sign)₫\(decimal(Double(a) / 1_000_000, separator: "."))M"
            }
            if a >= 1_000 {
                return "\(sign)₫\(decimal(Double(a) / 1_000, separator: "."))K"
            }
        }
        return vnd(amount)
    }

    /// `dd/MM/yyyy`.
    static func date(_ date: Date) -> String { dayFormatter.string(from: date) }

    /// `dd/MM/yyyy HH:mm` — the upload timestamp of an inbox item.
    ///
    /// Date-only would blur two receipts captured the same morning, which is
    /// exactly when the inbox is most crowded.
    static func dateTime(_ date: Date) -> String { dateTimeFormatter.string(from: date) }

    /// `dd 'thg' M` — short day + month, Vietnamese style.
    static func dayMonth(_ date: Date) -> String { dayMonthFormatter.string(from: date) }

    /// `'Thg' M, yyyy`.
    static func monthYear(_ date: Date) -> String { monthYearFormatter.string(from: date) }

    // There is deliberately **no** `isoDay` / `parseDay` here any more.
    //
    // They wrote and read `yyyy-MM-dd` with the formatter pinned to
    // `Asia/Ho_Chi_Minh`, which is not a zone the user is looking at. A device
    // east of UTC+7 that formatted a picked day through them stored the day
    // *before* the one on screen; a device west of UTC+7 that parsed a wire day
    // through them showed the day before. Both directions are the same mistake:
    // a Z-less wire value is a calendar day, not an instant, so it has to be read
    // and written in the zone it is displayed in.
    //
    // That round trip now lives in exactly one place, in the Kit, where it is
    // unit-tested across UTC−11 … UTC+14: `WireDay.string(from:in:)` and
    // `WireDay.date(from:in:)`. Use those for anything that reaches the wire —
    // in either direction.

    /// Whole days between `now` and `date` (negative → in the past).
    ///
    /// Delegates to the Kit's `CalendarDay` so every screen counts calendar
    /// days exactly like the list, the reminders feed and the widget. That is
    /// the fix for the dashboard saying "8d left" beside a list saying "9d
    /// left" for the same warranty: this helper used to anchor both sides to
    /// midnight, while the dashboard's own copy of the arithmetic did not.
    static func daysUntil(_ date: Date, from now: Date = Date()) -> Int {
        CalendarDay.days(from: now, to: date, calendar: .current)
    }

    private static func decimal(_ value: Double, separator: String = ",") -> String {
        let s = String(format: "%.1f", value)
        return s.hasSuffix(".0") ? String(s.dropLast(2))
                                   : s.replacingOccurrences(of: ".", with: separator)
    }

    private static let dayFormatter = makeFormatter("dd/MM/yyyy")
    private static let dateTimeFormatter = makeFormatter("dd/MM/yyyy HH:mm")
    private static let dayMonthFormatter = makeFormatter("dd 'thg' M")
    private static let monthYearFormatter = makeFormatter("'Thg' M, yyyy")

    /// Locale-pinned, and deliberately **not** zone-pinned: every one of these
    /// renders a `Date` the user is looking at, so it belongs in the zone the
    /// device is in. (The wire round trip is `WireDay`'s job, not this one's.)
    private static func makeFormatter(_ pattern: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "vi_VN")
        f.dateFormat = pattern
        return f
    }
}

/// Category → icon. Codes mirror `CATEGORIES` / `SUB_CATEGORIES` in the
/// prototype's data.js; unknown codes fall back to a neutral box.
///
/// There is deliberately no colour in this table any more. Colour encodes
/// state, never identity (§5.1): a row is not orange because it is a
/// headphone. `accent(for:)` survives only so the existing call sites keep
/// compiling, and always answers the neutral grey.
enum WVCategory {
    // Keys are lowercased — the lookup lowercases too, so this covers both the
    // prototype's data.js ids (`laptop`) and the Go catalog codes (`LAPTOP`,
    // `GAMING_CONSOLE`, `WASHING`, …).
    private static let table: [String: String] = [
        // devices
        "laptop":         "laptop",
        "phone":          "smartphone",
        "tablet":         "smartphone",
        "watch":          "watch",
        "smartwatch":     "watch",
        "tv":             "tv",
        "audio":          "headphones",
        "headphone":      "headphones",
        "speaker":        "headphones",
        "camera":         "camera",
        "appliance":      "database",
        "ac":             "cloud",
        "fridge":         "database",
        "washing":        "database",
        "kitchen":        "coffee",
        "console":        "gamepad",
        "gaming_console": "gamepad",
        "monitor":        "monitor",
        "keyboard":       "hash",
        "mouse":          "hash",
        "printer":        "printer",
        "electronics":    "zap",
        "furniture":      "package",
        "vehicle":        "bike",
        // subscriptions
        "streaming":      "film",
        "ai":             "sparkles",
        "cloud":          "cloud",
        "music":          "music",
        "work":           "briefcase",
        "domain":         "globe",
    ]

    static func icon(for code: String?) -> String {
        guard let code, let icon = table[code.lowercased()] else { return "package" }
        return icon
    }

    /// Identity colour is gone (§5.1). Kept so no call site breaks.
    static func accent(for code: String?) -> Color {
        WVColor.gray
    }
}
