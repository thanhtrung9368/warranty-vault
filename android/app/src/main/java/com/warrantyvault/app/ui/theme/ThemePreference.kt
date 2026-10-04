package com.warrantyvault.app.ui.theme

import androidx.annotation.StringRes
import com.warrantyvault.app.R

/**
 * Tuỳ chọn giao diện 3-way: theo hệ thống / sáng / tối.
 *
 * Mirror của web's `next-themes` toggle. `storedValue` được persist vào
 * SharedPreferences, `labelRes` hiển thị trên UI (một id tài nguyên, không phải
 * một câu tiếng Việt — nút gạt trong màn Cài đặt phải đổi ngôn ngữ cùng màn đó).
 */
enum class ThemePreference(val storedValue: String, @StringRes val labelRes: Int) {
    System("system", R.string.settings_theme_system),
    Light("light", R.string.settings_theme_light),
    Dark("dark", R.string.settings_theme_dark);

    companion object {
        fun from(value: String?): ThemePreference =
            entries.firstOrNull { it.storedValue == value } ?: System
    }
}
