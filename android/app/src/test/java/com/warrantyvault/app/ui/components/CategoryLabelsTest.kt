package com.warrantyvault.app.ui.components

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * `CategoryLabels` — the one Android copy of the web's `CATEGORY_LABELS`
 * (`website/src/lib/types.ts`), which the DB `Category` seed mirrors and the iOS
 * `CategoryLabels` enum duplicates.
 *
 * Regression guard: the dashboard used to carry a private `categoryLabel()`
 * with legacy short keys (`watch`, `tv`, `camera`, `console`) and ten missing
 * codes, so those devices rendered "Đồng hồ" / "TV" / "Camera" or their raw
 * code instead of the web label.
 *
 * `api/internal/services/category_seed_test.go` parses this table out of the
 * source file and fails CI when it drifts from the website copy; this test pins
 * the exact Vietnamese strings the app renders.
 */
class CategoryLabelsTest {

    private val expected = mapOf(
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

    @Test
    fun everyCatalogCodeMapsToTheExactWebVietnameseLabel() {
        assertEquals("the catalog has 20 categories", 20, CategoryLabels.table.size)
        assertEquals(expected, CategoryLabels.table)
        // Declaration order drives the picker order, so it mirrors the web map too.
        assertEquals(expected.keys.toList(), CategoryLabels.table.keys.toList())

        // Per-code lookup, not just map equality — this is what call sites use.
        for ((code, label) in expected) {
            assertEquals("code $code", label, CategoryLabels.label(code))
        }
    }

    @Test
    fun codesFixedByTheDriftRegression_useTheCatalogSpellingAndLabel() {
        // The five that were wrong before: short/legacy key or a shortened label.
        assertEquals("Đồng hồ thông minh", CategoryLabels.label("SMARTWATCH"))
        assertEquals("Tivi", CategoryLabels.label("TV"))
        assertEquals("Máy ảnh / Quay phim", CategoryLabels.label("CAMERA"))
        assertEquals("Máy chơi game", CategoryLabels.label("GAMING_CONSOLE"))
        assertEquals("Đồ gia dụng khác", CategoryLabels.label("APPLIANCE"))
    }

    @Test
    fun lookupIsCaseInsensitiveForLegacyLowercaseCodes() {
        assertEquals("Laptop", CategoryLabels.label("laptop"))
        assertEquals("Máy chơi game", CategoryLabels.label("gaming_console"))
        assertEquals("Điều hòa", CategoryLabels.label("ac"))
        assertEquals("Laptop", CategoryLabels.label("  LAPTOP  "))
    }

    @Test
    fun unknownCodeDegradesToTheRawCodeInsteadOfCrashing() {
        assertEquals("DRONE", CategoryLabels.label("DRONE"))
        assertEquals("AIR_PURIFIER", CategoryLabels.label("AIR_PURIFIER"))
        // Former short keys are not catalog codes, so they fall through as-is
        // rather than inventing a label the web does not have.
        assertEquals("watch", CategoryLabels.label("watch"))
    }

    @Test
    fun missingOrBlankCodeFallsBackToKhac() {
        assertEquals("Khác", CategoryLabels.label(null))
        assertEquals("Khác", CategoryLabels.label(""))
        assertEquals("Khác", CategoryLabels.label("   "))
    }
}
