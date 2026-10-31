import Foundation

// MARK: - Category labels

/// The **Vietnamese source** labels for the admin-curated `Category` catalog
/// codes.
///
/// Mirrors `CATEGORY_LABELS` in `website/src/lib/types.ts` exactly — the DB
/// `Category.name` is canonical for pickers, but lists / charts / reminders
/// only carry the *code* on the wire, so every client needs this static
/// fallback. Unknown codes fall back to the raw code so a newly-seeded
/// category still renders something.
///
/// The table holds only the Vietnamese source text. The English labels live in
/// `Localizable.xcstrings`, keyed on these exact strings (and required to have
/// both languages by `LocalizationTests`), so there is one table to keep in
/// step with the web / Android / migration copies — the Go test parses exactly
/// these lines — and no second copy of the labels here to drift from it.
/// `label(for:language:)` does the lookup, in the app's current language by
/// default.
public enum CategoryLabels {

    public static let table: [String: String] = [
        "PHONE": "Điện thoại",
        "LAPTOP": "Laptop",
        "TABLET": "Máy tính bảng",
        "SMARTWATCH": "Đồng hồ thông minh",
        "HEADPHONE": "Tai nghe",
        "SPEAKER": "Loa",
        "CAMERA": "Máy ảnh / Quay phim",
        "TV": "Tivi",
        "MONITOR": "Màn hình",
        "KEYBOARD": "Bàn phím",
        "MOUSE": "Chuột",
        "GAMING_CONSOLE": "Máy chơi game",
        "AC": "Điều hòa",
        "FRIDGE": "Tủ lạnh",
        "WASHING": "Máy giặt / Sấy",
        "KITCHEN": "Đồ nhà bếp",
        "APPLIANCE": "Đồ gia dụng khác",
        "ELECTRONICS": "Điện tử khác",
        "FURNITURE": "Nội thất",
        "OTHER": "Khác",
    ]

    /// Label for a category code, in the app's current language.
    ///
    /// This is the entry point every screen uses. It reads
    /// `L.effectiveLanguage` — the same value every other `L.t` call reads
    /// (`LocalizationStore` is the only writer) — so no call site has to pass a
    /// language and an app-language switch is picked up immediately.
    public static func label(for code: String?) -> String {
        label(for: code, language: L.effectiveLanguage)
    }

    /// Label for a category code in an explicit language.
    ///
    /// Exists so pure code and tests can pin a language without mutating the
    /// process-wide `L.language`. The one-argument overload above delegates
    /// here; both render through the same table and catalog.
    ///
    /// The Vietnamese label from `table` is rendered through the String
    /// Catalog, so the table above stays a plain `[String: String]` of
    /// Vietnamese source text — which is exactly what
    /// `api/internal/services/category_seed_test.go` parses to keep the web,
    /// iOS, Android and migration `0004` label sets in step. That test fails CI
    /// on a *structural* change to those 20 lines, so the table is deliberately
    /// NOT rewritten into `L.t(...)` calls, and no English duplicate of it is
    /// kept here.
    ///
    /// Case-insensitive on lookup, matching the permissive behaviour of the
    /// web's `categoryLabel()` helper when a legacy lowercase code (e.g.
    /// `laptop`) is on the wire.
    public static func label(for code: String?, language: AppLanguage) -> String {
        guard let code, !code.isEmpty else { return L.t("Khác", language: language) }
        if let hit = table[code] { return L.t(hit, language: language) }
        if let hit = table[code.uppercased()] { return L.t(hit, language: language) }
        return code
    }
}
