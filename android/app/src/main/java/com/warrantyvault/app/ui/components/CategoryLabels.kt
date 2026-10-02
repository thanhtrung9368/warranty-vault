package com.warrantyvault.app.ui.components

/**
 * Vietnamese display labels for the admin-curated `Category` catalog codes.
 *
 * Mirrors `CATEGORY_LABELS` in `website/src/lib/types.ts` exactly (and the iOS
 * `CategoryLabels` enum in `ios/Sources/WarrantyVaultKit/CategoryLabels.swift`).
 * The DB `Category.name` is canonical for pickers, but lists / charts /
 * reminders only carry the *code* on the wire, so every client needs this
 * static fallback. Unknown codes fall back to the raw code so a newly-seeded
 * category still renders something.
 *
 * This is the single Android copy on purpose: the map used to be a private
 * `categoryLabel()` inside `DashboardScreen` and drifted (short/legacy keys
 * such as `watch` / `tv`, and ten missing codes rendering their raw code).
 * `api/internal/services/category_seed_test.go` parses this file and fails CI
 * when it no longer matches the web map, so edit all copies together.
 */
object CategoryLabels {

    /** Category code → Vietnamese name, in the web map's declaration order. */
    val table: Map<String, String> = mapOf(
        "PHONE" to "Điện thoại",
        "LAPTOP" to "Laptop",
        "TABLET" to "Máy tính bảng",
        "SMARTWATCH" to "Đồng hồ thông minh",
        "HEADPHONE" to "Tai nghe",
        "SPEAKER" to "Loa",
        "CAMERA" to "Máy ảnh / Quay phim",
        "TV" to "Tivi",
        "MONITOR" to "Màn hình",
        "KEYBOARD" to "Bàn phím",
        "MOUSE" to "Chuột",
        "GAMING_CONSOLE" to "Máy chơi game",
        "AC" to "Điều hòa",
        "FRIDGE" to "Tủ lạnh",
        "WASHING" to "Máy giặt / Sấy",
        "KITCHEN" to "Đồ nhà bếp",
        "APPLIANCE" to "Đồ gia dụng khác",
        "ELECTRONICS" to "Điện tử khác",
        "FURNITURE" to "Nội thất",
        "OTHER" to "Khác",
    )

    /**
     * Label for a category code.
     *
     * Case-insensitive on lookup so a legacy lowercase code (`laptop`,
     * `gaming_console`) still resolves; a null / blank code reads as `Khác` and
     * an unrecognised code degrades to itself rather than crashing.
     */
    fun label(code: String?): String {
        val trimmed = code?.trim()
        if (trimmed.isNullOrEmpty()) return "Khác"
        return table[trimmed] ?: table[trimmed.uppercase()] ?: trimmed
    }
}
