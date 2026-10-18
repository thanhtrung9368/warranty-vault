package com.warrly.ui.screens.reminders

import com.warrly.network.DeviceStatus
import com.warrly.testing.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The pure "Đã ẩn" rollup, mirroring `website/src/lib/__tests__/dismissed-reminders.test.ts`
 * and `ios/Tests/WarrlyKitTests/DismissedRemindersTests.swift`.
 */
class DismissedRemindersTest {

    @Test
    fun keepsOnlyHiddenRowsAndSortsNewestEndDateFirst() {
        val rows = listOf(
            Fixtures.upcomingReminder(id = "visible-1"),
            Fixtures.upcomingReminder(
                id = "hidden-old",
                endDate = "2023-05-01",
                isDismissed = true,
            ),
            Fixtures.upcomingReminder(
                id = "hidden-new",
                endDate = "2024-09-01",
                isDismissed = true,
            ),
        )

        val dismissed = dismissedReminders(rows)

        assertEquals(listOf("hidden-new", "hidden-old"), dismissed.map { it.warrantyId })
    }

    @Test
    fun aPlainUpcomingFeedProducesNoHiddenRows() {
        // The default feed omits `isDismissed` entirely; the decoder defaults it
        // to false, so handing it to this mapper must never invent an "Đã ẩn"
        // entry out of an active reminder.
        val plain = listOf(
            Fixtures.upcomingReminder(id = "war-1"),
            Fixtures.upcomingReminder(id = "war-2"),
        )

        assertTrue(dismissedReminders(plain).isEmpty())
    }

    @Test
    fun carriesTheDeviceProjectionAndItsNonActiveStatus() {
        val sold = Fixtures.upcomingReminder(
            id = "war-sold",
            deviceId = "dev-sold",
            endDate = "2024-02-02",
            isDismissed = true,
            deviceStatus = DeviceStatus.SOLD,
        )

        val row = dismissedReminders(listOf(sold)).single()

        assertEquals("war-sold", row.warrantyId)
        assertEquals("dev-sold", row.deviceId)
        assertEquals("iPhone 15 Pro", row.deviceName)
        assertEquals("PHONE", row.deviceCategory)
        // The badge in the UI reads this, so a sold device's reminder explains
        // why it is still visible.
        assertEquals(DeviceStatus.SOLD, row.deviceStatus)
        assertEquals("STANDARD", row.warrantyType)
        assertEquals(null, row.warrantyProvider)
        assertEquals("2024-02-02", row.endDate)
    }
}
