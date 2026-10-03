import SwiftUI

// ============================================================
// WarrantyVault iOS — shared formatting + category helpers
//
// One home for currency / date formatting and the category →
// icon/color mapping (ported from project/ios/js/data.js) so
// every screen renders these consistently.
// ============================================================

enum WVFormat {
    /// VND amount with `.` thousands grouping and a trailing `₫` — matches the
    /// prototype's `toLocaleString('vi-VN')` output.
    static func vnd(_ amount: Int) -> String {
        (groupingFormatter.string(from: NSNumber(value: amount)) ?? "\(amount)") + " ₫"
    }

    /// Abbreviated money for tight widgets: `1,2 tr` / `980 ng`.
    static func compactVnd(_ amount: Int) -> String {
        let a = abs(amount)
        let sign = amount < 0 ? "-" : ""
        if a >= 1_000_000 {
            return "\(sign)\(decimal(Double(a) / 1_000_000)) tr ₫"
        }
        if a >= 1_000 {
            return "\(sign)\(decimal(Double(a) / 1_000)) ng ₫"
        }
        return vnd(amount)
    }

    /// `dd/MM/yyyy`.
    static func date(_ date: Date) -> String { dayFormatter.string(from: date) }

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
    static func daysUntil(_ date: Date, from now: Date = Date()) -> Int {
        let cal = Calendar.current
        let d = cal.dateComponents([.day], from: cal.startOfDay(for: now),
                                   to: cal.startOfDay(for: date))
        return d.day ?? 0
    }

    private static func decimal(_ value: Double) -> String {
        let s = String(format: "%.1f", value)
        return s.hasSuffix(".0") ? String(s.dropLast(2)) : s.replacingOccurrences(of: ".", with: ",")
    }

    private static let groupingFormatter: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.groupingSeparator = "."
        return f
    }()
    private static let dayFormatter = makeFormatter("dd/MM/yyyy")
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

/// Category → icon + accent color. Codes mirror `CATEGORIES` / `SUB_CATEGORIES`
/// in the prototype's data.js; unknown codes fall back to a neutral box.
enum WVCategory {
    private struct Style { let icon: String; let accent: WVAccent }

    // Keys are lowercased — the lookup lowercases too, so this covers both the
    // prototype's data.js ids (`laptop`) and the Go catalog codes (`LAPTOP`,
    // `GAMING_CONSOLE`, `WASHING`, …).
    private static let table: [String: Style] = [
        // devices
        "laptop":         Style(icon: "laptop", accent: .blue),
        "phone":          Style(icon: "smartphone", accent: .brand),
        "tablet":         Style(icon: "smartphone", accent: .purple),
        "watch":          Style(icon: "watch", accent: .red),
        "smartwatch":     Style(icon: "watch", accent: .red),
        "tv":             Style(icon: "tv", accent: .purple),
        "audio":          Style(icon: "headphones", accent: .orange),
        "headphone":      Style(icon: "headphones", accent: .orange),
        "speaker":        Style(icon: "headphones", accent: .orange),
        "camera":         Style(icon: "camera", accent: .blue),
        "appliance":      Style(icon: "database", accent: .green),
        "ac":             Style(icon: "cloud", accent: .teal),
        "fridge":         Style(icon: "database", accent: .teal),
        "washing":        Style(icon: "database", accent: .green),
        "kitchen":        Style(icon: "coffee", accent: .orange),
        "console":        Style(icon: "gamepad", accent: .red),
        "gaming_console": Style(icon: "gamepad", accent: .red),
        "monitor":        Style(icon: "monitor", accent: .blue),
        "keyboard":       Style(icon: "hash", accent: .gray),
        "mouse":          Style(icon: "hash", accent: .gray),
        "printer":        Style(icon: "printer", accent: .gray),
        "electronics":    Style(icon: "zap", accent: .indigo),
        "furniture":      Style(icon: "package", accent: .orange),
        "vehicle":        Style(icon: "bike", accent: .green),
        // subscriptions
        "streaming":      Style(icon: "film", accent: .red),
        "ai":             Style(icon: "sparkles", accent: .purple),
        "cloud":          Style(icon: "cloud", accent: .blue),
        "music":          Style(icon: "music", accent: .orange),
        "work":           Style(icon: "briefcase", accent: .green),
        "domain":         Style(icon: "globe", accent: .blue),
    ]

    static func icon(for code: String?) -> String {
        guard let code else { return "package" }
        return table[code.lowercased()]?.icon ?? "package"
    }

    static func accent(for code: String?) -> Color {
        guard let code, let style = table[code.lowercased()] else { return WVColor.gray }
        return style.accent.color
    }
}
