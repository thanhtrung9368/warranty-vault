package com.warrantyvault.app.ui.theme

import com.warrantyvault.app.i18n.ResCatalog
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * `ThemePreference` is the 3-way "Theo hệ thống / Sáng / Tối" toggle persisted
 * to SharedPreferences — the stored values are a contract with existing installs.
 */
class ThemePreferenceTest {

    private val vi = ResCatalog.vietnamese()
    private val en = ResCatalog.english()

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
        assertEquals("Theo hệ thống", vi.get(ThemePreference.System.labelRes))
        assertEquals("light", ThemePreference.Light.storedValue)
        assertEquals("Sáng", vi.get(ThemePreference.Light.labelRes))
        assertEquals("dark", ThemePreference.Dark.storedValue)
        assertEquals("Tối", vi.get(ThemePreference.Dark.labelRes))

        // …and the English column, which is the whole point of the change.
        assertEquals("System default", en.get(ThemePreference.System.labelRes))
        assertEquals("Light", en.get(ThemePreference.Light.labelRes))
        assertEquals("Dark", en.get(ThemePreference.Dark.labelRes))
    }
}
