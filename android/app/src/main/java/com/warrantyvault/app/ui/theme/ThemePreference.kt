package com.warrantyvault.app.ui.theme

/**
 * Tuỳ chọn giao diện 3-way: theo hệ thống / sáng / tối.
 *
 * Mirror của web's `next-themes` toggle. `storedValue` được persist vào
 * SharedPreferences, `label` hiển thị trên UI.
 */
enum class ThemePreference(val storedValue: String, val label: String) {
    System("system", "Theo hệ thống"),
    Light("light", "Sáng"),
    Dark("dark", "Tối");

    companion object {
        fun from(value: String?): ThemePreference =
            entries.firstOrNull { it.storedValue == value } ?: System
    }
}
