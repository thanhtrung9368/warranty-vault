import Foundation

// WarrantyPillCopy — the label and tone of the days-left pill.
//
// The view (`WarrantyPill` in `App/DesignSystem/Components.swift`) only lays
// this out. It lives here so the one rule that matters can be unit-tested:
// **a negative count must read as expired, never as days left**.
//
// The sign was correct in the code (`if d < 0`), but the English catalog entry
// for the `"Hết %dd"` key was a copy of the positive one — `"%dd left"` — so an
// English reader saw a grey "588d left" pill on a fridge whose warranty ended
// 588 days *ago*. The Vietnamese copy (`"Hết 588d"`) was right, which is why
// this only showed up when the app was in English. `WarrantyPillCopyTests`
// pins both languages, so a translation can never silently flip the sign again.
public enum WarrantyPillCopy {

    /// The pill's tone. Kept free of SwiftUI colors so the mapping is testable
    /// and the design system stays the only place that knows the palette.
    public enum Status: Equatable, Sendable {
        case safe
        case warn
        case danger
        case expired
    }

    public static func status(daysLeft: Int?) -> Status {
        guard let d = daysLeft else { return .expired }
        if d < 0 { return .expired }
        if d <= 30 { return .danger }
        if d <= 90 { return .warn }
        return .safe
    }

    /// The compact chip label. "Hết 3d" / "Còn 12d" are short on purpose — this
    /// is a chip on a card, not a sentence. The English side keeps the same
    /// abbreviation ("3d left" / "Expired 3d") so the chip does not grow under
    /// one language only.
    public static func label(daysLeft: Int?) -> String {
        guard let d = daysLeft else { return "—" }
        if d < 0 { return L.t("Hết %dd", abs(d)) }
        if d == 0 { return L.t("Hết hôm nay") }
        if d <= 90 { return L.t("Còn %dd", d) }
        if d <= 365 { return L.t("Còn ~%dth", Int((Double(d) / 30).rounded())) }
        // Whole years, not a decimal. This branch only fires past a year, and
        // "%.1f" rendered the first two months of it as "Còn 1.0 năm" / "1.0 years
        // left" — a false-looking number in Vietnamese and a plural violation in
        // English ("1.0 years"). Rounding is clamped to at least 1 so a chip never
        // reads "Còn 0 năm". Precision past a year is not worth a decimal on a card.
        return L.p("%d năm", max(1, Int((Double(d) / 365).rounded())))
    }
}
