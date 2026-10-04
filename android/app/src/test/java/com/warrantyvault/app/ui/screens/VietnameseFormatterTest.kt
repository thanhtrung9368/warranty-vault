package com.warrantyvault.app.ui.screens

import com.warrantyvault.app.i18n.Money
import com.warrantyvault.app.i18n.money
import com.warrantyvault.app.i18n.ResCatalog
import com.warrantyvault.app.network.BillingCycle
import com.warrantyvault.app.ui.screens.devices.todayUtcIso
import com.warrantyvault.app.ui.screens.subscriptions.formatPriceCycle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * The money formatter, pinned.
 *
 * It used to be duplicated per screen package (devices / subscriptions /
 * wishlist / stats / dashboard, plus two `Long` copies in the formatters), and
 * this file's job was to prove the seven copies had not drifted apart. They have
 * since been collapsed into `i18n/Money.kt`, so the drift test is gone by
 * construction and what is pinned here is the part that still matters:
 *
 *  1. **The Vietnamese shape is the repo's canonical one** —
 *     `1.000.000 ₫` (dot grouping, a space, `₫` U+20AB), exactly what
 *     `api/internal/i18n/format.go::FormatMoney` and `website/src/lib/format.ts`
 *     produce. It used to be `1.000.000đ` here (no space, `đ` U+0111), which made
 *     Android a *third* dialect for the same amount: a Vietnamese user saw
 *     `1.200.000 ₫` on the web and `1.200.000đ` in the app.
 *  2. **English is its own shape**, not the Vietnamese digits with English words
 *     around them — `₫1,000,000`, matching Go and the web.
 *
 * ## Why these expected values moved, and why that is not "bending the test"
 *
 * ⚠️ This is the **one** assertion change in this suite that is correct rather
 * than suspicious, and a later reader must be able to tell the difference:
 *
 *  * Normally, when a pinned string changes, the implementation is what is
 *    wrong — the pin is the contract and it should be restored.
 *  * Here the **requirement** changed. Android's `1.200.000đ` was never a
 *    deliberate product decision (it came from the first Android commit, before
 *    there was any shared format); Go's `FormatMoney` is canonical and the web
 *    mirrors it. The task was "make Android agree with the other two", so the
 *    expected strings had to move with the implementation.
 *
 * Everything else about the assertions is untouched: the same amounts
 * (1.000.000, 260.000, 0, -5.000, 30.000.000, 3.000.000.000), the same grouping
 * dots, the same minus sign placement, the same `/ tháng` suffix. Only the
 * separator and the symbol character differ from the previous pin.
 */
class VietnameseFormatterTest {

    private val vi = ResCatalog.vietnamese()
    private val en = ResCatalog.english()

    @Test
    fun formatVnd_usesVietnameseGroupingAndTheCanonicalDongSuffix() {
        assertEquals("1.000.000 ₫", Money.vietnamese(1_000_000))
        assertEquals("260.000 ₫", Money.vietnamese(260_000))
        assertEquals("0 ₫", Money.vietnamese(0))
        assertEquals("-5.000 ₫", Money.vietnamese(-5_000))
        assertEquals("30.000.000 ₫", Money.vietnamese(30_000_000))
    }

    /**
     * The whole point of the locale parameter: the same amount is a different
     * string in the two languages, and the catalog is what decides which.
     */
    @Test
    fun moneyFollowsTheCatalogLanguage() {
        assertEquals("1.000.000 ₫", vi.money(1_000_000))
        assertEquals("₫1,000,000", en.money(1_000_000))
        assertEquals("-5.000 ₫", vi.money(-5_000))
        assertEquals("-₫5,000", en.money(-5_000))
        assertEquals("0 ₫", vi.money(0))
        assertEquals("₫0", en.money(0))
        assertNotEquals(
            "a single-language money format is what this test exists to prevent",
            vi.money(12_500_000),
            en.money(12_500_000),
        )
    }

    @Test
    fun formatPriceCycle_appendsTheVietnameseCycleSuffix() {
        assertEquals("99.000 ₫ / tháng", formatPriceCycle(vi, 99_000, BillingCycle.MONTHLY))
        assertEquals("99.000 ₫ / quý", formatPriceCycle(vi, 99_000, BillingCycle.QUARTERLY))
        assertEquals("99.000 ₫ / năm", formatPriceCycle(vi, 99_000, BillingCycle.YEARLY))
    }

    @Test
    fun formatPriceCycle_leavesLifetimeAndCustomWithoutARecurringSuffix() {
        assertEquals("99.000 ₫ (trọn đời)", formatPriceCycle(vi, 99_000, BillingCycle.LIFETIME))
        assertEquals("99.000 ₫", formatPriceCycle(vi, 99_000, BillingCycle.CUSTOM))
    }

    /** The same lines in English — words *and* digits. */
    @Test
    fun formatPriceCycle_isEnglishToo() {
        assertEquals("₫99,000 / month", formatPriceCycle(en, 99_000, BillingCycle.MONTHLY))
        assertEquals("₫99,000 / quarter", formatPriceCycle(en, 99_000, BillingCycle.QUARTERLY))
        assertEquals("₫99,000 / year", formatPriceCycle(en, 99_000, BillingCycle.YEARLY))
        assertEquals("₫99,000 (lifetime)", formatPriceCycle(en, 99_000, BillingCycle.LIFETIME))
        assertEquals("₫99,000", formatPriceCycle(en, 99_000, BillingCycle.CUSTOM))
    }

    /**
     * The `Long` half added for the int64 money on the action queue and the
     * subscription audit: identical output to the `Int` path for every value an
     * `Int` can hold, and correct past it — narrowing those fields to `Int` is
     * what throws inside kotlinx.serialization and blanks a whole screen.
     */
    @Test
    fun money_matchesTheIntAndLongPathsAndSurvivesInt64Magnitudes() {
        listOf(0L, 999L, 1_000L, 12_500_000L, Int.MAX_VALUE.toLong()).forEach { amount ->
            val expected = Money.vietnamese(amount.toInt().toLong())
            assertEquals("drifted for $amount", expected, Money.vietnamese(amount))
        }

        assertEquals("3.000.000.000 ₫", Money.vietnamese(3_000_000_000L))
        assertEquals("₫3,000,000,000", Money.english(3_000_000_000L))
    }

    @Test
    fun todayUtcIso_isATenCharacterUtcDate() {
        val today = todayUtcIso()

        assertTrue("unexpected shape: $today", today.matches(Regex("""\d{4}-\d{2}-\d{2}""")))
        assertEquals(LocalDate.now(ZoneOffset.UTC).toString(), today)
    }
}
