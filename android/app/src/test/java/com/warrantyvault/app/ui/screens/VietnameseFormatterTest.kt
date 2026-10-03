package com.warrantyvault.app.ui.screens

import com.warrantyvault.app.network.BillingCycle
import com.warrantyvault.app.ui.screens.actions.formatVndLong as actionsFormatVndLong
import com.warrantyvault.app.ui.screens.devices.formatVnd as devicesFormatVnd
import com.warrantyvault.app.ui.screens.devices.todayUtcIso
import com.warrantyvault.app.ui.screens.subscriptions.formatPriceCycle
import com.warrantyvault.app.ui.screens.subscriptions.formatVnd as subscriptionsFormatVnd
import com.warrantyvault.app.ui.screens.subscriptions.formatVndLong as subscriptionsFormatVndLong
import com.warrantyvault.app.ui.screens.wishlist.formatVnd as wishlistFormatVnd
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * The money formatter is duplicated per screen package (devices / subscriptions
 * / wishlist) — these tests pin the Vietnamese output and prove the copies have
 * not drifted apart.
 */
class VietnameseFormatterTest {

    @Test
    fun formatVnd_usesVietnameseGroupingAndTheDongSuffix() {
        assertEquals("1.000.000đ", subscriptionsFormatVnd(1_000_000))
        assertEquals("260.000đ", subscriptionsFormatVnd(260_000))
        assertEquals("0đ", subscriptionsFormatVnd(0))
        assertEquals("-5.000đ", subscriptionsFormatVnd(-5_000))
        assertEquals("30.000.000đ", subscriptionsFormatVnd(30_000_000))
    }

    @Test
    fun formatVnd_isIdenticalAcrossTheDevicesSubscriptionsAndWishlistScreens() {
        listOf(0, 999, 1_000, 12_500_000, -1).forEach { amount ->
            val expected = subscriptionsFormatVnd(amount)
            assertEquals("devices screen drifted for $amount", expected, devicesFormatVnd(amount))
            assertEquals("wishlist screen drifted for $amount", expected, wishlistFormatVnd(amount))
        }
    }

    @Test
    fun formatPriceCycle_appendsTheVietnameseCycleSuffix() {
        assertEquals("99.000đ / tháng", formatPriceCycle(99_000, BillingCycle.MONTHLY))
        assertEquals("99.000đ / quý", formatPriceCycle(99_000, BillingCycle.QUARTERLY))
        assertEquals("99.000đ / năm", formatPriceCycle(99_000, BillingCycle.YEARLY))
    }

    @Test
    fun formatPriceCycle_leavesLifetimeAndCustomWithoutARecurringSuffix() {
        assertEquals("99.000đ (trọn đời)", formatPriceCycle(99_000, BillingCycle.LIFETIME))
        assertEquals("99.000đ", formatPriceCycle(99_000, BillingCycle.CUSTOM))
    }

    /**
     * The two `Long` copies added for the int64 money on the action queue and the
     * subscription audit: identical output to the `Int` formatter for every value
     * an `Int` can hold, and correct past it — narrowing those fields to `Int` is
     * what throws inside kotlinx.serialization and blanks a whole screen.
     */
    @Test
    fun formatVndLong_matchesTheIntFormatterAndSurvivesInt64Magnitudes() {
        listOf(0L, 999L, 1_000L, 12_500_000L, Int.MAX_VALUE.toLong()).forEach { amount ->
            val expected = subscriptionsFormatVnd(amount.toInt())
            assertEquals("audit screen drifted for $amount", expected, subscriptionsFormatVndLong(amount))
            assertEquals("actions screen drifted for $amount", expected, actionsFormatVndLong(amount))
        }

        assertEquals("3.000.000.000đ", subscriptionsFormatVndLong(3_000_000_000L))
        assertEquals("3.000.000.000đ", actionsFormatVndLong(3_000_000_000L))
    }

    @Test
    fun todayUtcIso_isATenCharacterUtcDate() {
        val today = todayUtcIso()

        assertTrue("unexpected shape: $today", today.matches(Regex("""\d{4}-\d{2}-\d{2}""")))
        assertEquals(LocalDate.now(ZoneOffset.UTC).toString(), today)
    }
}
