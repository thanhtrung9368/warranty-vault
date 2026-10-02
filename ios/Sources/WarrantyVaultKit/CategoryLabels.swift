import Foundation

// MARK: - Category labels

/// Vietnamese display labels for the admin-curated `Category` catalog codes.
///
/// Mirrors `CATEGORY_LABELS` in `website/src/lib/types.ts` exactly — the DB
/// `Category.name` is canonical for pickers, but lists / charts / reminders
/// only carry the *code* on the wire, so every client needs this static
/// fallback. Unknown codes fall back to the raw code so a newly-seeded
/// category still renders something.
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

    /// Label for a category code. Case-insensitive on lookup, matching the
    /// permissive behaviour of the web's `categoryLabel()` helper when a
    /// legacy lowercase code (e.g. `laptop`) is on the wire.
    public static func label(for code: String?) -> String {
        guard let code, !code.isEmpty else { return "Khác" }
        if let hit = table[code] { return hit }
        if let hit = table[code.uppercased()] { return hit }
        return code
    }
}
