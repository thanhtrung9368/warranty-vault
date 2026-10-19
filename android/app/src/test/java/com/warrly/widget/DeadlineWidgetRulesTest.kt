package com.warrly.widget

import com.warrly.R
import com.warrly.i18n.ResCatalog
import com.warrly.network.ReminderDevice
import com.warrly.network.UpcomingReminder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

/**
 * The widget's pure half, pinned in both languages without Robolectric.
 *
 * Why this file is JVM-only: the widget's Android glue (`RemoteViews`,
 * `AppWidgetManager`) needs a running launcher to mean anything — there is no
 * emulator in this environment, so any "test" of the rendered pixels would be a
 * lie. What can be proven here is everything the renderer *decides*: which rows
 * survive, how many days are left, which empty state applies, and the exact
 * "as of …" sentence in English and Vietnamese. The renderer is then a mechanical
 * copy of [WidgetContent] into view ids.
 */
class DeadlineWidgetRulesTest {

    private val zone: ZoneId = ZoneId.of("Asia/Ho_Chi_Minh")
    private val en: ResCatalog = ResCatalog.english()
    private val vi: ResCatalog = ResCatalog.vietnamese()

    // 10:00 in Vietnam.
    private val now: Long = instant("2026-10-19T03:00:00Z")

    private fun instant(iso: String): Long = java.time.Instant.parse(iso).toEpochMilli()

    private fun reminder(
        name: String,
        endDate: String,
        deviceId: String = "device-$name",
        dismissed: Boolean = false,
        category: String = "LAPTOP",
    ) = UpcomingReminder(
        id = "warranty-$deviceId",
        deviceId = deviceId,
        device = ReminderDevice(id = deviceId, name = name, category = category),
        type = "STANDARD",
        startDate = "2025-10-19",
        endDate = endDate,
        months = 12,
        isDismissed = dismissed,
    )

    // ---- Snapshot shape ----

    @Test
    fun snapshotDropsDismissedAndMalformedRowsAndSortsByExpiry() {
        val snapshot = deadlineSnapshot(
            reminders = listOf(
                reminder("Laptop", "2026-11-20"),
                reminder("Phone", "2026-10-25"),
                reminder("Hidden", "2026-10-20", dismissed = true),
                reminder("Broken", "not-a-date"),
            ),
            capturedAtMillis = now,
        )

        assertEquals(now, snapshot.capturedAtMillis)
        assertEquals(WIDGET_HORIZON_DAYS, snapshot.horizonDays)
        assertEquals(2, snapshot.totalCount)
        assertEquals(listOf("Phone", "Laptop"), snapshot.entries.map { it.deviceName })
        assertEquals(listOf("2026-10-25", "2026-11-20"), snapshot.entries.map { it.endDate })
    }

    @Test
    fun theHorizonMatchesTheEmptyStateCopy() {
        // `widget_empty_title` says "12 months"; the horizon is 365 days.
        // Changing one without the other is the kind of silent lie this file
        // exists to prevent.
        assertEquals(365, WIDGET_HORIZON_DAYS)
    }

    @Test
    fun snapshotTrimsItsCacheButKeepsTheUntrimmedTotal() {        val reminders = (1..12).map { n ->
            reminder("Device $n", "2026-12-${(n + 9).toString().padStart(2, '0')}")
        }

        val snapshot = deadlineSnapshot(reminders, capturedAtMillis = now)

        assertEquals("the cache is bounded", WIDGET_MAX_STORED_ENTRIES, snapshot.entries.size)
        assertEquals("the total is not", 12, snapshot.totalCount)
        assertEquals("2026-12-10", snapshot.entries.first().endDate)
        assertEquals("2026-12-19", snapshot.entries.last().endDate)
    }

    @Test
    fun snapshotJsonIsThePinnedShape() {
        val raw = """
            {
              "version": 1,
              "capturedAtMillis": 1760832000000,
              "horizonDays": 365,
              "totalCount": 2,
              "entries": [
                {"deviceId":"d1","deviceName":"Laptop","endDate":"2026-10-20"},
                {"deviceId":"d2","deviceName":"Phone","endDate":"2026-10-21"}
              ]
            }
        """.trimIndent()

        val decoded = SnapshotJson.decodeFromString(DeadlineSnapshot.serializer(), raw)
        assertEquals(1, decoded.version)
        assertEquals(1760832000000L, decoded.capturedAtMillis)
        assertEquals(2, decoded.totalCount)
        assertEquals("Laptop", decoded.entries.first().deviceName)

        // The writer must keep the same keys the reader above depends on.
        val encoded = SnapshotJson.encodeToString(DeadlineSnapshot.serializer(), decoded)
        listOf("capturedAtMillis", "horizonDays", "totalCount", "entries", "deviceName", "endDate")
            .forEach { key -> assertTrue("snapshot JSON lost `$key`: $encoded", key in encoded) }
    }

    @Test
    fun snapshotJsonToleratesUnknownKeysFromANewerBuild() {
        val raw = """
            {"version":1,"capturedAtMillis":1,"entries":[],"futureField":"ignored"}
        """.trimIndent()

        val decoded = SnapshotJson.decodeFromString(DeadlineSnapshot.serializer(), raw)

        assertEquals(1L, decoded.capturedAtMillis)
        assertTrue(decoded.entries.isEmpty())
    }

    @Test
    fun parseEndDateAcceptsTheWirePrefixAndRejectsImpossibleDates() {
        assertEquals(LocalDate.of(2026, 10, 19), parseEndDate("2026-10-19"))
        assertEquals(LocalDate.of(2026, 10, 19), parseEndDate("2026-10-19T00:00:00Z"))
        assertNull("February has no 31st", parseEndDate("2026-02-31"))
        assertNull(parseEndDate("19/10/2026"))
        assertNull(parseEndDate(""))
        assertNull(parseEndDate(null))
    }

    // ---- Days remaining ----

    @Test
    fun daysRemainingIsCalendarDaysNotElapsedTime() {
        val today = LocalDate.of(2026, 10, 19)

        assertEquals(0, daysRemaining("2026-10-19", today))
        assertEquals(1, daysRemaining("2026-10-20", today))
        assertEquals(13, daysRemaining("2026-11-01", today))
        assertNull(daysRemaining("oops", today))
    }

    @Test
    fun dayLabelsUseTodayTomorrowAndPluralsInBothLanguages() {
        assertEquals("Expires today", daysLabel(en, 0))
        assertEquals("Hết hạn hôm nay", daysLabel(vi, 0))

        assertEquals("Expires tomorrow", daysLabel(en, 1))
        assertEquals("Hết hạn ngày mai", daysLabel(vi, 1))

        assertEquals("12 days left", daysLabel(en, 12))
        assertEquals("Còn 12 ngày", daysLabel(vi, 12))
    }

    @Test
    fun moreLineIsPluralizedInBothLanguages() {
        assertEquals(
            "+3 more",
            en.quantity(R.plurals.widget_more_deadlines, 3, 3),
        )
        assertEquals(
            "+3 mốc nữa",
            vi.quantity(R.plurals.widget_more_deadlines, 3, 3),
        )
    }

    // ---- Freshness / "as of" ----

    @Test
    fun freshnessBoundariesArePinned() {
        val capture = 1_000_000_000_000L

        assertEquals(SnapshotFreshness.FRESH, snapshotFreshness(capture, capture))
        assertEquals(
            SnapshotFreshness.FRESH,
            snapshotFreshness(capture, capture + STALE_AFTER_MILLIS - 1),
        )
        assertEquals(
            SnapshotFreshness.STALE,
            snapshotFreshness(capture, capture + STALE_AFTER_MILLIS),
        )
        assertEquals(
            SnapshotFreshness.STALE,
            snapshotFreshness(capture, capture + OLD_AFTER_MILLIS - 1),
        )
        assertEquals(
            SnapshotFreshness.OLD,
            snapshotFreshness(capture, capture + OLD_AFTER_MILLIS),
        )
    }

    @Test
    fun aFutureCaptureIsNotReportedAsStale() {
        val capturedInTheFuture = now + 60_000

        assertEquals(SnapshotFreshness.FRESH, snapshotFreshness(capturedInTheFuture, now))
        assertEquals(
            "as of 19/10 10:01",
            asOfLabel(en, capturedInTheFuture, now, zone),
        )
    }

    @Test
    fun theFooterAlwaysStatesTheCaptureTime() {
        // Fresh: still "as of", because the widget cannot prove it is live.
        assertEquals(
            "as of 19/10 09:00",
            asOfLabel(en, instant("2026-10-19T02:00:00Z"), now, zone),
        )
        // Stale (aged 2 days).
        assertEquals(
            "Stale · as of 17/10 09:00",
            asOfLabel(en, instant("2026-10-17T02:00:00Z"), now, zone),
        )
        // Old (aged 18 days) — tells the user what to do about it.
        assertEquals(
            "Old data from 01/10 09:00 · open Warrly",
            asOfLabel(en, instant("2026-10-01T02:00:00Z"), now, zone),
        )
    }

    @Test
    fun theFooterFollowsTheUiLanguage() {
        val captured = instant("2026-10-17T02:00:00Z")

        assertEquals("tính đến 19/10 09:59", asOfLabel(vi, now - 60_000, now, zone))
        assertEquals("Dữ liệu cũ · tính đến 17/10 09:00", asOfLabel(vi, captured, now, zone))
        assertEquals(
            "Dữ liệu từ 01/10 09:00 · mở Warrly",
            asOfLabel(vi, instant("2026-10-01T02:00:00Z"), now, zone),
        )
    }

    @Test
    fun aCaptureFromAPreviousYearCarriesTheYear() {
        val captured = instant("2025-12-30T02:00:00Z")

        assertEquals(
            "Old data from 30/12/2025 09:00 · open Warrly",
            asOfLabel(en, captured, now, zone),
        )
    }

    // ---- Widget content / empty states ----

    @Test
    fun noSnapshotShowsTheOpenTheAppState() {
        val content = widgetContent(en, snapshot = null, nowMillis = now, zoneId = zone)

        assertEquals(WidgetState.NO_SNAPSHOT, content.state)
        assertEquals("No deadline data yet", content.emptyTitle)
        assertEquals("Open Warrly once to load your saved warranties.", content.emptyBody)
        assertNull("there is no capture to date", content.footer)
        assertTrue(content.rows.isEmpty())
    }

    @Test
    fun anEmptySnapshotStillShowsItsCaptureTime() {
        val snapshot = DeadlineSnapshot(capturedAtMillis = instant("2026-10-19T02:00:00Z"))

        val content = widgetContent(en, snapshot, now, zone)

        assertEquals(WidgetState.EMPTY, content.state)
        assertEquals("Nothing expires in the next 12 months", content.emptyTitle)
        assertEquals("as of 19/10 09:00", content.footer)
        assertEquals(SnapshotFreshness.FRESH, content.freshness)
    }

    @Test
    fun theNextTwoDeadlinesAreShownWithTheRestCounted() {
        val snapshot = deadlineSnapshot(
            reminders = listOf(
                reminder("Laptop", "2026-10-21"),
                reminder("Phone", "2026-10-19"),
                reminder("Tablet", "2026-10-20"),
            ),
            capturedAtMillis = instant("2026-10-19T02:00:00Z"),
        )

        val content = widgetContent(en, snapshot, now, zone)

        assertEquals(WidgetState.ROWS, content.state)
        assertEquals(
            listOf("Phone" to "Expires today", "Tablet" to "Expires tomorrow"),
            content.rows.map { it.deviceName to it.daysLabel },
        )
        assertEquals(1, content.moreCount)
        assertEquals("as of 19/10 09:00", content.footer)
    }

    @Test
    fun aRowThatExpiredSinceTheCaptureIsDroppedNotShownAsNegative() {
        val snapshot = deadlineSnapshot(
            reminders = listOf(
                reminder("Gone", "2026-10-17"),
                reminder("Soon", "2026-10-20"),
            ),
            capturedAtMillis = instant("2026-10-15T02:00:00Z"),
        )

        val content = widgetContent(en, snapshot, now, zone)

        assertEquals(WidgetState.ROWS, content.state)
        assertEquals(listOf("Soon"), content.rows.map { it.deviceName })
        assertEquals("the expired one is not counted as more", 0, content.moreCount)
        assertEquals(
            "the footer is what makes the missing row honest",
            "Stale · as of 15/10 09:00",
            content.footer,
        )
    }

    @Test
    fun moreCountUsesTheUntrimmedServerTotalAfterExpiry() {
        // 12 stored-with-total rows, two of the cached ones now expired: ten
        // upcoming remain, two are drawn, so "+8 more" — not "+10 more", which
        // would count rows that already expired.
        val snapshot = DeadlineSnapshot(
            capturedAtMillis = instant("2026-10-10T02:00:00Z"),
            totalCount = 12,
            entries = (1..10).map { n ->
                DeadlineEntry(
                    deviceId = "d$n",
                    deviceName = "Device $n",
                    endDate = if (n <= 2) "2026-10-11" else "2026-11-${n.toString().padStart(2, '0')}",
                )
            },
        )

        val content = widgetContent(en, snapshot, now, zone)

        assertEquals(2, content.rows.size)
        assertEquals(8, content.moreCount)
    }

    @Test
    fun aBlankDeviceNameFallsBackToTheGenericLabel() {
        val snapshot = DeadlineSnapshot(
            capturedAtMillis = instant("2026-10-19T02:00:00Z"),
            totalCount = 1,
            entries = listOf(DeadlineEntry("d1", "   ", "2026-10-20")),
        )

        assertEquals(
            listOf("Unnamed device"),
            widgetContent(en, snapshot, now, zone).rows.map { it.deviceName },
        )
        assertEquals(
            listOf("Thiết bị chưa đặt tên"),
            widgetContent(vi, snapshot, now, zone).rows.map { it.deviceName },
        )
    }

    @Test
    fun theEmptyStateFollowsTheUiLanguage() {
        val content = widgetContent(vi, snapshot = null, nowMillis = now, zoneId = zone)

        assertEquals("Chưa có dữ liệu hạn", content.emptyTitle)
        assertEquals("Mở Warrly một lần để tải các bảo hành đã lưu.", content.emptyBody)
        assertNotNull(content.emptyTitle)
    }
}
