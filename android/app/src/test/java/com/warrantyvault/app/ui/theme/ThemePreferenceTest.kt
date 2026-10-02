package com.warrantyvault.app.ui.theme

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * `ThemePreference` is the 3-way "Theo hệ thống / Sáng / Tối" toggle persisted
 * to SharedPreferences — the stored values are a contract with existing installs.
 */
class ThemePreferenceTest {

    @Test
    fun from_mapsEveryStoredValue() {
        assertEquals(ThemePreference.System, ThemePreference.from("system"))
        assertEquals(ThemePreference.Light, ThemePreference.from("light"))
        assertEquals(ThemePreference.Dark, ThemePreference.from("dark"))
    }

    @Test
    fun from_fallsBackToSystemForNullAndUnknownValues() {
        assertEquals(ThemePreference.System, ThemePreference.from(null))
        assertEquals(ThemePreference.System, ThemePreference.from(""))
        assertEquals(ThemePreference.System, ThemePreference.from("DARK"))
        assertEquals(ThemePreference.System, ThemePreference.from("holographic"))
    }

    @Test
    fun storedValuesAndVietnameseLabels_areStable() {
        assertEquals("system", ThemePreference.System.storedValue)
        assertEquals("Theo hệ thống", ThemePreference.System.label)
        assertEquals("light", ThemePreference.Light.storedValue)
        assertEquals("Sáng", ThemePreference.Light.label)
        assertEquals("dark", ThemePreference.Dark.storedValue)
        assertEquals("Tối", ThemePreference.Dark.label)
    }
}
