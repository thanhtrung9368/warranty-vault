package com.warrantyvault.app.ui.screens.dashboard

import com.warrantyvault.app.network.DeviceStatus
import com.warrantyvault.app.testing.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

/**
 * `deviceRollup()` — the dashboard's 2×2 grid.
 *
 * Regression guard: the counts used to be derived from
 * `GET /api/v1/reminders`, which by contract only returns warranties expiring
 * in `[today, today + withinDays]`. `expired` was therefore always 0 and the
 * "Đã hết hạn" tile could never show a number.
 */
class DeviceRollupTest {

    private val today = LocalDate.of(2025, 1, 1)

    private fun device(
        id: String,
        end: String?,
        status: DeviceStatus = DeviceStatus.ACTIVE,
    ) = Fixtures.device(id = id, status = status, effectiveWarrantyEnd = end)

    @Test
    fun countsActiveSoonAndExpiredSeparately() {
        val rollup = deviceRollup(
            listOf(
                device("long", "2026-01-01"),                  // safe
                device("soon", today.plusDays(10).toString()), // soon
                device("today", today.toString()),             // expires today → not active, not expired
                device("dead", "2024-12-01"),                  // expired
                device("sold", "2026-01-01", DeviceStatus.SOLD),
            ),
            today = today,
        )

        assertEquals(5, rollup.total)
        assertEquals("only ACTIVE + future counts", 2, rollup.active)
        assertEquals(1, rollup.soon)
        assertEquals("an end date in the past is expired regardless of status", 1, rollup.expired)
        assertEquals(1, rollup.safeActive)
    }

    @Test
    fun soonBoundaryIsInclusiveOf30Days() {
        val rollup = deviceRollup(
            listOf(
                device("d30", today.plusDays(30).toString()),
                device("d31", today.plusDays(31).toString()),
            ),
            today = today,
        )

        assertEquals(1, rollup.soon)
        assertEquals(2, rollup.active)
        assertEquals(1, rollup.safeActive)
    }

    @Test
    fun devicesWithoutAWarrantyCountOnlyTowardTheTotal() {
        val rollup = deviceRollup(
            listOf(
                device("none", null),
                device("blank", ""),
                Fixtures.device(id = "no-warranty"),
            ),
            today = today,
        )

        assertEquals(3, rollup.total)
        assertEquals(0, rollup.active)
        assertEquals(0, rollup.soon)
        assertEquals("a missing end date is NOT 'expired'", 0, rollup.expired)
    }

    @Test
    fun emptyListIsAllZeroes() {
        val rollup = deviceRollup(emptyList(), today = today)

        assertEquals(0, rollup.total)
        assertEquals(0, rollup.safeActive)
    }

    @Test
    fun safeActiveNeverGoesNegative() {
        // Defensive: soon ≤ active is an invariant of the loop, but the derived
        // property must not underflow if that ever changes.
        val impossible = DeviceRollup(total = 1, active = 0, soon = 3, expired = 0)

        assertEquals(0, impossible.safeActive)
    }
}
