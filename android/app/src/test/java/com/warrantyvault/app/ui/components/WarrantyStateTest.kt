package com.warrantyvault.app.ui.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate

/**
 * `warrantyState()` — the pure port of `warrantyState()` in
 * `website/src/lib/format.ts`. Every boundary is pinned to a fixed `today` so
 * the test never depends on the wall clock.
 */
class WarrantyStateTest {

    private val today = LocalDate.of(2025, 1, 1)

    private fun stateFor(end: String?) = warrantyState(end, today)

    @Test
    fun pastEnd_rendersHowLongItHasBeenExpired() {
        val state = stateFor("2024-12-30")!!

        assertEquals(-2L, state.daysLeft)
        assertEquals("Đã hết 2 ngày", state.label)
        assertEquals(WarrantyTone.Expired, state.tone)
    }

    @Test
    fun endsToday_isDangerNotExpired() {
        val state = stateFor("2025-01-01")!!

        assertEquals(0L, state.daysLeft)
        assertEquals("Hết hôm nay", state.label)
        assertEquals(WarrantyTone.Danger, state.tone)
    }

    @Test
    fun toneBoundaries_matchTheWebThresholds() {
        assertEquals(WarrantyTone.Danger, stateFor("2025-01-15")!!.tone) // 14 days
        assertEquals(WarrantyTone.Danger, stateFor("2025-01-16")!!.tone) // 15 days
        assertEquals(WarrantyTone.Warn, stateFor("2025-01-17")!!.tone)   // 16 days
        assertEquals(WarrantyTone.Warn, stateFor("2025-01-31")!!.tone)   // 30 days
        assertEquals(WarrantyTone.Safe, stateFor("2025-02-01")!!.tone)   // 31 days
    }

    @Test
    fun beyond90Days_switchesToWholeMonths() {
        assertEquals("Còn 90 ngày", stateFor("2025-04-01")!!.label) // exactly 90
        assertEquals("Còn 3 tháng", stateFor("2025-04-02")!!.label) // 91 → floor(91/30)
        assertEquals(91L, stateFor("2025-04-02")!!.daysLeft)
        assertEquals(WarrantyTone.Safe, stateFor("2025-04-02")!!.tone)
    }

    @Test
    fun acceptsRfc3339TimestampsAsWellAsPlainDates() {
        assertEquals(
            stateFor("2025-02-01")!!.daysLeft,
            stateFor("2025-02-01T00:00:00Z")!!.daysLeft,
        )
    }

    @Test
    fun missingOrUnparseableDates_returnNullInsteadOfGuessing() {
        assertNull("no warranty at all", stateFor(null))
        assertNull("blank", stateFor("   "))
        assertNull("garbage", stateFor("not-a-date"))
        assertNull("truncated", stateFor("2025-1"))
    }
}
