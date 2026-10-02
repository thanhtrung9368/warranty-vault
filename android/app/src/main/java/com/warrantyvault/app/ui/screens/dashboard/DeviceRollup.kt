package com.warrantyvault.app.ui.screens.dashboard

import com.warrantyvault.app.network.Device
import com.warrantyvault.app.network.DeviceStatus
import com.warrantyvault.app.ui.components.parseIsoDate
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * The dashboard's 2×2 stat grid, computed from the device list the same way
 * the web does it (`computeDeviceStats()` in
 * `website/src/app/(app)/dashboard/page.tsx`).
 */
data class DeviceRollup(
    val total: Int,
    val active: Int,
    val soon: Int,
    val expired: Int,
) {
    /** "Còn bảo hành" — active devices minus the ones about to lapse. */
    val safeActive: Int get() = (active - soon).coerceAtLeast(0)
}

/**
 * Rolls the device list up into the four dashboard numbers.
 *
 * The previous implementation derived both `soon` and `expired` from
 * `GET /api/v1/reminders`, but that feed only ever contains warranties with
 * `endDate` in `[today, today + withinDays]` for ACTIVE devices (see the
 * endpoint description in openapi.yaml) — so `expired` was structurally
 * always 0 and the "Đã hết hạn" tile could never show anything but zero.
 * The device list carries `effectiveWarrantyEnd`, which is what the web uses.
 *
 * A device with no warranty at all (`effectiveWarrantyEnd == null`) counts
 * toward `total` only — it is neither active nor expired, mirroring the web.
 * `today`/`soonDays` are injectable so the boundaries are testable.
 */
fun deviceRollup(
    devices: List<Device>,
    today: LocalDate = LocalDate.now(),
    soonDays: Long = 30L,
): DeviceRollup {
    var active = 0
    var soon = 0
    var expired = 0
    for (d in devices) {
        val end = parseIsoDate(d.effectiveWarrantyEnd) ?: continue
        val days = ChronoUnit.DAYS.between(today, end)
        val isActiveStatus = d.status == DeviceStatus.ACTIVE
        if (days < 0L) expired++
        if (isActiveStatus && days > 0L) {
            active++
            if (days <= soonDays) soon++
        }
    }
    return DeviceRollup(total = devices.size, active = active, soon = soon, expired = expired)
}
