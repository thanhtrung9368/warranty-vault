package com.warrly.ui.screens.reminders

import com.warrly.network.DeviceStatus
import com.warrly.network.UpcomingReminder

/**
 * One warranty the user has hidden with "Đã xem, ẩn đi" and can restore.
 *
 * Mirrors `website/src/lib/dismissed-reminders.ts` and
 * `ios/Sources/WarrlyKit/DismissedReminders.swift`: the rows come from
 * `GET /api/v1/reminders?includeDismissed=true`, the light reminders feed with
 * the hidden rows opted back in.
 *
 * The server returns hidden rows **regardless of the `withinDays` window and
 * the owning device's status** — that is the whole point of the opt-in read.
 * [deviceStatus] therefore comes from the row instead of being assumed ACTIVE,
 * so the card can explain why a reminder on a device that was later sold is
 * still visible.
 *
 * Pure and synchronous so the mapping can be tested on the JVM without a
 * backend, exactly like the action-queue formatters.
 */
data class DismissedReminder(
    /** Warranty id — also the id `DELETE /api/v1/warranties/{id}/reminder` takes. */
    val warrantyId: String,
    val deviceId: String,
    val deviceName: String,
    val deviceCategory: String,
    val deviceStatus: DeviceStatus,
    /** Raw `STANDARD | EXTENDED | THIRD_PARTY`, resolved to a label by the card. */
    val warrantyType: String,
    val warrantyProvider: String?,
    val endDate: String,
)

/**
 * Filters a widened reminders payload down to the hidden rows, newest warranty
 * end date first.
 *
 * `isDismissed` is optional on the wire — only the opt-in read sends it — so a
 * row that omits it counts as *visible* and is skipped. That keeps this correct
 * even if it is accidentally handed the plain upcoming feed: it degrades to an
 * empty "Đã ẩn" list rather than duplicating the visible rows.
 *
 * Sorting is lexicographic on the ISO-8601 `endDate` string. The server always
 * sends the same `YYYY-MM-DD…` shape, so string order is chronological order;
 * [RemindersScreen] parses only the date half when it needs a day count.
 */
internal fun dismissedReminders(rows: List<UpcomingReminder>): List<DismissedReminder> =
    rows.asSequence()
        .filter { it.isDismissed }
        .map { row ->
            DismissedReminder(
                warrantyId = row.id,
                deviceId = row.deviceId,
                deviceName = row.device.name,
                deviceCategory = row.device.category,
                deviceStatus = row.device.status,
                warrantyType = row.type,
                warrantyProvider = row.provider,
                endDate = row.endDate,
            )
        }
        .sortedByDescending { it.endDate }
        .toList()
