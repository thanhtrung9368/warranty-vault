package com.warrantyvault.app.i18n

import com.warrantyvault.app.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * The loader the converted formatter tests depend on, tested first.
 *
 * If [ResCatalog] silently returned nothing, every formatter test would fail —
 * but if it silently returned the *wrong* language, they would all still pass
 * while asserting nothing. So what is pinned here is exactly what makes the
 * other tests meaningful: the `R` → XML join resolves, both languages resolve,
 * they really are different, arguments interpolate, plurals select correctly,
 * and a missing key fails loudly instead of rendering blank.
 */
class ResCatalogTest {

    private val en = ResCatalog.english()
    private val vi = ResCatalog.vietnamese()

    @Test
    fun reflectionJoinsRStringIdsToTheXmlCatalogInBothLanguages() {
        assertEquals("Sort", en.get(R.string.comp_sort))
        assertEquals("Sắp xếp", vi.get(R.string.comp_sort))
    }

    @Test
    fun theTwoCatalogsAreActuallyDifferentLanguages() {
        assertNotEquals(
            "res/values and res/values-vi must not hold the same text for a key that is " +
                "genuinely translated — otherwise a conversion could pass while changing nothing",
            en.get(R.string.comp_sort),
            vi.get(R.string.comp_sort),
        )
    }

    @Test
    fun formatArgumentsAreInterpolatedLikeResourcesGetString() {
        assertEquals("Hết hạn 02/03/2026", vi.get(R.string.sess_expires, "02/03/2026"))
        assertEquals("Expires 02/03/2026", en.get(R.string.sess_expires, "02/03/2026"))
    }

    @Test
    fun aTemplateWithNoArgumentsIsReturnedVerbatim() {
        // Android only runs String.format when arguments were passed; a `%` in a
        // static sentence must not be eaten here either.
        assertEquals("Sort", en.get(R.string.comp_sort))
    }

    @Test
    fun pluralsSelectOneForASingleCountAndOtherOtherwise() {
        assertEquals("1 day left", en.quantity(R.plurals.dash_days_left, 1, 1))
        assertEquals("4 days left", en.quantity(R.plurals.dash_days_left, 4, 4))
        // Vietnamese ships only `other`, and must render it for a count of 1 too.
        assertEquals("Còn 1 ngày", vi.quantity(R.plurals.dash_days_left, 1, 1))
        assertEquals("Còn 4 ngày", vi.quantity(R.plurals.dash_days_left, 4, 4))
    }

    @Test
    fun aKeyUsedByKotlinButAbsentFromTheCatalogFailsLoudly() {
        val short = ResCatalog.forTesting(mapOf("comp_sort" to "Sort"), "values")
        val thrown = assertThrows(AssertionError::class.java) {
            short.get(R.string.dash_expired)
        }
        assertTrue(
            "the failure must name the missing key: ${thrown.message}",
            thrown.message.orEmpty().contains("dash_expired"),
        )
    }

    @Test
    fun anIdOutsideTheResourceTableFailsLoudly() {
        val thrown = assertThrows(AssertionError::class.java) { vi.get(-4321) }
        assertTrue(
            "the failure must say the test is out of sync with the build: ${thrown.message}",
            thrown.message.orEmpty().contains("not a field of R.string"),
        )
    }
}
