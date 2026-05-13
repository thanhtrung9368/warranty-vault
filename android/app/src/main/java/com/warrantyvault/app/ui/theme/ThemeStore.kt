package com.warrantyvault.app.ui.theme

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Persist tuỳ chọn theme qua SharedPreferences. Dùng SharedPreferences thay
 * vì DataStore — chỉ một key, không cần coroutine flow phức tạp.
 *
 * Tạo singleton trong `App.onCreate()`, expose qua `App.instance.themeStore`.
 */
class ThemeStore(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val _preference: MutableStateFlow<ThemePreference> =
        MutableStateFlow(ThemePreference.from(prefs.getString(KEY_THEME, null)))

    val preference: StateFlow<ThemePreference> = _preference.asStateFlow()

    fun set(pref: ThemePreference) {
        if (_preference.value == pref) return
        _preference.value = pref
        prefs.edit().putString(KEY_THEME, pref.storedValue).apply()
    }

    private companion object {
        const val PREFS_NAME = "wv_theme"
        const val KEY_THEME = "theme_preference"
    }
}
