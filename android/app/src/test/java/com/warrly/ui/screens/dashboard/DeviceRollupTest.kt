package com.warrly.ui.screens.dashboard

import com.warrly.network.DeviceStatus
import com.warrly.testing.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/**
 * `deviceRollup()` — the dashboard's 2×2 grid.
 *
 * Two regressions are pinned here:
 *
 *  1. The counts used to be derived from `GET /api/v1/reminders`, which by
 *     contract only returns warranties expiring in `[today, today + withinDays]`.
 *     `expired` was therefore always 0 and the "Đã hết hạn" tile could never
 *     show a number.
 *  2. "Còn bảo hành" was `active - soon`. A device with 9 days left was counted
 *     as active and then subtracted right back out, so the tile read 0 while the
 *     row below it said "Còn 9 ngày". "Sắp hết" is a subset of "Còn bảo hành",
 *     not a separate bucket.
 */
class DeviceRollupTest {

    private val today = LocalDate.of(2026, 10, 19)

    private fun device(
        id: String,
        end: String?,
        status: DeviceStatus = DeviceStatus.ACTIVE,
        name: String = id,
    ) = Fixtures.device(id = id, name = name, status = status, effectiveWarrantyEnd = end)

    /**
     * The seeded account, exactly as the app shows it:
     *
     *  * iPhone 15 Pro — ACTIVE, effective end 2026-10-28 (9 days);
     *  * Tủ lạnh Samsung Inverter — ACTIVE, effective end 2025-03-10 (588 days ago);
     *  * Máy giặt LG — BROKEN, no warranty at all.
     *
     * The iPhone is counted in **both** "Còn bảo hành" and "Sắp hết ≤30 ngày":
     * with 9 days left it is still under warranty. The fridge is expired. The
     * washer is neither, so `total` is the only tile it moves. That is 1 + 1 + 1
     * here only because each of the three devices falls in a different bucket —
     * the two warranty tiles overlap by design.
     */
    @Test
    fun theSeededAccountCountsOneInWarrantyOneSoonAndOneExpired() {
        val rollup = deviceRollup(
            listOf(
                device("iphone", "2026-10-28", name = "iPhone 15 Pro"),
                device("fridge", "2025-03-10", name = "Tủ lạnh Samsung Inverter"),
                device("washer", null, DeviceStatus.BROKEN, name = "Máy giặt LG"),
            ),
            today = today,
        )

        assertEquals("Thiết bị", 3, rollup.total)
        assertEquals("Còn bảo hành", 1, rollup.inWarranty)
        assertEquals("Sắp hết ≤30 ngày", 1, rollup.soon)
        assertEquals("Đã hết hạn", 1, rollup.expired)
    }

    /**
     * The exact shape of the reported bug: one device, nine days left, and the
     * old `active - soon` made the protected count 0. It is 1, and the "soon"
     * tile is allowed to say 1 at the same time.
     */
    @Test
    fun aDeviceExpiringSoonIsStillUnderWarranty() {
        val rollup = deviceRollup(
            listOf(device("iphone", today.plusDays(9).toString())),
            today = today,
        )

        assertEquals(1, rollup.inWarranty)
        assertEquals(1, rollup.soon)
        assertEquals(0, rollup.expired)
    }

    @Test
    fun aWarrantyEndingTodayIsStillInWarranty() {
        val rollup = deviceRollup(
            listOf(device("today", today.toString())),
            today = today,
        )

        assertEquals("the last covered day is covered", 1, rollup.inWarranty)
        assertEquals("and it is the definition of 'sắp hết'", 1, rollup.soon)
        assertEquals(0, rollup.expired)
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

        assertEquals("both are in warranty", 2, rollup.inWarranty)
        assertEquals(1, rollup.soon)
    }

    @Test
    fun soonIsNeverSubtractedFromInWarranty() {
        // The invariant the dashboard tiles rely on: every soon device is also
        // in warranty, so `soon <= inWarranty` always holds and no tile can
        // underflow into a negative or contradict the row beneath it.
        val rollup = deviceRollup(
            listOf(
                device("d1", today.plusDays(1).toString()),
                device("d2", today.plusDays(15).toString()),
                device("d3", today.plusDays(29).toString()),
                device("d4", today.plusDays(400).toString()),
            ),
            today = today,
        )

        assertEquals(4, rollup.inWarranty)
        assertEquals(3, rollup.soon)
        assertTrue("soon must be a subset of in warranty", rollup.soon <= rollup.inWarranty)
    }

    @Test
    fun aPastEndDateIsExpiredRegardlessOfStatus() {
        val rollup = deviceRollup(
            listOf(
                device("active-dead", "2025-12-31"),
                device("sold-dead", "2024-01-01", DeviceStatus.SOLD),
                device("sold-live", "2027-01-01", DeviceStatus.SOLD),
            ),
            today = today,
        )

        assertEquals("a sold device is not something still covered", 0, rollup.inWarranty)
        assertEquals("but its lapsed plan still expired", 2, rollup.expired)
        assertEquals(3, rollup.total)
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
        assertEquals(0, rollup.inWarranty)
        assertEquals(0, rollup.soon)
        assertEquals("a missing end date is NOT 'expired'", 0, rollup.expired)
    }

    @Test
    fun emptyListIsAllZeroes() {
        val rollup = deviceRollup(emptyList(), today = today)

        assertEquals(0, rollup.total)
        assertEquals(0, rollup.inWarranty)
        assertEquals(0, rollup.soon)
        assertEquals(0, rollup.expired)
    }
}
