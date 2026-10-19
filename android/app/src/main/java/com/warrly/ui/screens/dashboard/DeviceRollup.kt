package com.warrly.ui.screens.dashboard

import com.warrly.network.Device
import com.warrly.network.DeviceStatus
import com.warrly.ui.components.parseIsoDate
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * The dashboard's 2×2 stat grid, computed from the device list.
 *
 * The numbers are deliberately computed here rather than read from
 * `GET /api/v1/stats`: that endpoint carries device counts by *status* and the
 * money rollups, but not the warranty boundaries the grid is about, so asking it
 * for these would mean a new field for a number every client derives anyway.
 * Keeping the rule local is also what makes it testable without a server.
 *
 * [inWarranty] and [soon] **overlap on purpose**: a device that expires within
 * [deviceRollup]'s soonDays is still under warranty, so it is counted in both.
 * The two tiles answer different questions ("how many are protected?" vs "which
 * ones should I look at now?") and must never be added together to estimate the
 * device count. [soon] is a subset of [inWarranty] by construction.
 */
data class DeviceRollup(
    /** Every tracked device, including sold/broken ones and ones with no plan. */
    val total: Int,
    /**
     * "Còn bảo hành": ACTIVE devices whose effective warranty end is **today or
     * later**. A device that expires later today is still under warranty.
     */
    val inWarranty: Int,
    /** "Sắp hết ≤30 ngày": the subset of [inWarranty] ending within soonDays. */
    val soon: Int,
    /**
     * "Đã hết hạn": every device whose effective warranty end has passed,
     * whatever its status (a sold device's warranty can lapse too).
     */
    val expired: Int,
)

/**
 * Rolls the device list up into the four dashboard numbers.
 *
 * The warranty-count tiles used to be derived from `GET /api/v1/reminders`,
 * but that feed only ever contains warranties with `endDate` in
 * `[today, today + withinDays]` for ACTIVE devices (see the endpoint
 * description in openapi.yaml) — so `expired` was structurally always 0 and
 * the "Đã hết hạn" tile could never show anything but zero. The device list
 * carries `effectiveWarrantyEnd`, which is what the web uses.
 *
 * ## Why "Còn bảo hành" is not `active - soon`
 *
 * It used to be exactly that, and it was wrong twice over:
 *
 *  * a warranty ending in 9 days is *still* a warranty, so subtracting every
 *    soon-to-expire device under-counted the protected list — with one device
 *    9 days out the tile read 0 and the dashboard contradicted the "Còn 9 ngày"
 *    row right below it;
 *  * the day of expiry itself (`days == 0`) was treated as neither in warranty
 *    nor expired, so a device whose plan ended today fell out of all three
 *    tiles and the device count stopped adding up.
 *
 * The definition is now the one the tile's label states: in warranty while
 * `effectiveWarrantyEnd >= today`. Within-30-days is an *alert*, not a
 * different warranty state, so [DeviceRollup.soon] is a subset of
 * [DeviceRollup.inWarranty] — never a second bucket to subtract.
 *
 * A device with no warranty at all (`effectiveWarrantyEnd == null`) counts
 * toward `total` only — it is neither in warranty nor expired. A non-ACTIVE
 * device is not "in warranty" (a sold or lost device is not something the
 * user still has covered), but a past end date is still expired whatever its
 * status. `today`/`soonDays` are injectable so the boundaries are testable.
 */
fun deviceRollup(
    devices: List<Device>,
    today: LocalDate = LocalDate.now(),
    soonDays: Long = 30L,
): DeviceRollup {
    var inWarranty = 0
    var soon = 0
    var expired = 0
    for (d in devices) {
        val end = parseIsoDate(d.effectiveWarrantyEnd) ?: continue
        val days = ChronoUnit.DAYS.between(today, end)
        if (days < 0L) expired++
        if (d.status == DeviceStatus.ACTIVE && days >= 0L) {
            inWarranty++
            if (days <= soonDays) soon++
        }
    }
    return DeviceRollup(
        total = devices.size,
        inWarranty = inWarranty,
        soon = soon,
        expired = expired,
    )
}
