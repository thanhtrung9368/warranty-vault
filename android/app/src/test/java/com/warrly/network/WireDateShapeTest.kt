package com.warrly.network

import com.warrly.i18n.ResCatalog
import com.warrly.ui.components.parseIsoDate
import com.warrly.ui.components.warrantyState
import com.warrly.ui.screens.actions.actionDateLabel
import com.warrly.ui.screens.actions.actionDuePill
import com.warrly.ui.screens.devices.activatedAtInput
import com.warrly.ui.screens.devices.brandWarrantyDateInput
import com.warrly.ui.screens.devices.daysBetweenIsoDates
import com.warrly.ui.screens.devices.extendedCoverBuyByInput
import com.warrly.ui.screens.devices.receivedAtInput
import com.warrly.ui.screens.devices.returnDeadlineLabel
import com.warrly.ui.screens.devices.soldDateInput
import com.warrly.ui.screens.settings.sessionDateLabel
import com.warrly.ui.screens.stats.forecastDateLabel
import com.warrly.ui.screens.subscriptions.trialEndsAtInput
import com.warrly.ui.screens.vietnamDate
import com.warrly.widget.parseEndDate
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeParseException
import java.util.TimeZone

/**
 * The two wire date shapes, pinned against the contract and against a **negative**
 * UTC offset.
 *
 * `api/sqlc.yaml` classifies fourteen timestamp columns as calendar days; every
 * one of them is decoded here from the literal `YYYY-MM-DD` the API now writes.
 * The rest are RFC3339 UTC instants with a `Z`. The point of this class is the
 * distinction: a day parsed with `Instant.parse` throws, an instant parsed with
 * `LocalDate.parse` throws, and any implementation that silently converts a day
 * through a time zone would fail the New York/Kiritimati assertions below.
 *
 * The device timezone is forced to `America/New_York` (UTC-4/-5) for every test
 * and switched to `Pacific/Kiritimati` (UTC+14) in the independence test, so a
 * parser that happens to work only in UTC+7 cannot pass.
 *
 * This is the JVM half of the live check; `DeviceReturnWindowTest`,
 * `DeviceResaleTest`, `VietnamDateTest` and the serialization tests pin the
 * individual helpers.
 */
class WireDateShapeTest {

    private val json = ApiClient.json
    private val vi = ResCatalog.vietnamese()
    private var originalZone: TimeZone = TimeZone.getDefault()

    @Before
    fun pinANegativeUtcOffset() {
        originalZone = TimeZone.getDefault()
        TimeZone.setDefault(TimeZone.getTimeZone("America/New_York"))
    }

    @After
    fun restoreTheDeviceZone() {
        TimeZone.setDefault(originalZone)
    }

    // ---- 1. Every calendar-day column decodes exactly as the API writes it ----

    @Test
    fun everyCalendarDayColumnDecodesAsTheApiWritesIt() {
        // Device: the seven day columns from api/sqlc.yaml, all on one payload.
        val device = json.decodeFromString(
            Device.serializer(),
            """
            {
              "id": "dev-1",
              "name": "Máy giặt LG",
              "category": "WASHING",
              "purchaseDate": "2024-06-01",
              "soldAt": "2026-03-01",
              "receivedAt": "2024-06-02",
              "activatedAt": "2024-05-20",
              "extendedCoverBuyBy": "2026-12-31",
              "brandWarrantyStart": "2024-01-14",
              "brandWarrantyEnd": "2026-01-14"
            }
            """.trimIndent(),
        )
        assertEquals("2024-06-01", device.purchaseDate)
        assertEquals("2026-03-01", device.soldAt)
        assertEquals("2024-06-02", device.receivedAt)
        assertEquals("2024-05-20", device.activatedAt)
        assertEquals("2026-12-31", device.extendedCoverBuyBy)
        assertEquals("2024-01-14", device.brandWarrantyStart)
        assertEquals("2026-01-14", device.brandWarrantyEnd)

        val warranty = json.decodeFromString(
            Warranty.serializer(),
            """{"id":"war-1","deviceId":"dev-1","startDate":"2025-11-20","endDate":"2026-10-28"}""",
        )
        assertEquals("2025-11-20", warranty.startDate)
        assertEquals("2026-10-28", warranty.endDate)

        val subscription = json.decodeFromString(
            Subscription.serializer(),
            """{"id":"sub-1","name":"iCloud+","startedAt":"2025-01-01","renewalDate":"2026-01-01","trialEndsAt":"2025-02-01"}""",
        )
        assertEquals("2025-01-01", subscription.startedAt)
        assertEquals("2026-01-01", subscription.renewalDate)
        assertEquals("2025-02-01", subscription.trialEndsAt)

        val wish = json.decodeFromString(
            WishlistItem.serializer(),
            """{"id":"wish-1","name":"Máy ảnh","targetDate":"2026-05-01"}""",
        )
        assertEquals("2026-05-01", wish.targetDate)

        val claim = json.decodeFromString(
            Claim.serializer(),
            """{"id":"clm-1","deviceId":"dev-1","openedAt":"2026-10-16T12:40:46.631Z","expectedReturnAt":"2026-10-23","issue":"Không vắt"}""",
        )
        assertEquals("2026-10-23", claim.expectedReturnAt)
        // The same claim object carries an instant on another field — the two
        // shapes coexist and are distinguished per field, not per endpoint.
        assertEquals("2026-10-16T12:40:46.631Z", claim.openedAt)

        // The form helpers keep the same day.
        assertEquals("2026-03-01", soldDateInput(device.soldAt))
        assertEquals("2024-06-02", receivedAtInput(device.receivedAt))
        assertEquals("2024-05-20", activatedAtInput(device.activatedAt))
        assertEquals("2026-12-31", extendedCoverBuyByInput(device.extendedCoverBuyBy))
        assertEquals("2024-01-14", brandWarrantyDateInput(device.brandWarrantyStart))
        assertEquals("2026-01-14", brandWarrantyDateInput(device.brandWarrantyEnd))
        assertEquals("2025-02-01", trialEndsAtInput(subscription.trialEndsAt))
    }

    // ---- 2. Rendering a day does not depend on the device's UTC offset ----

    @Test
    fun aCalendarDayRendersIdenticallyAtNegativeAndPositiveOffsets() {
        // @Before has already pinned America/New_York (UTC-4/-5).
        assertEquals("02/03/2026", vietnamDate("2026-03-02"))
        assertEquals(LocalDate.of(2026, 3, 2), parseIsoDate("2026-03-02"))
        assertEquals("2026-03-02", soldDateInput("2026-03-02"))

        // UTC+14: a timezone conversion of a day would move it; a pure
        // LocalDate/take(10) read cannot.
        TimeZone.setDefault(TimeZone.getTimeZone("Pacific/Kiritimati"))
        assertEquals("02/03/2026", vietnamDate("2026-03-02"))
        assertEquals(LocalDate.of(2026, 3, 2), parseIsoDate("2026-03-02"))
        assertEquals("2026-03-02", soldDateInput("2026-03-02"))

        // UTC-5, the @Before zone, is restored for the remaining assertions.
        TimeZone.setDefault(TimeZone.getTimeZone("America/New_York"))
        assertEquals("02/03/2026", vietnamDate("2026-03-02"))
    }

    // ---- 3. The two scalars are not interchangeable ----

    @Test
    fun aDayIsNotAnInstantAndAnInstantIsNotADay() {
        // `Instant.parse` on a day has no time/offset and throws. This is what a
        // naive parser written against the old wire format would now do.
        assertThrows(DateTimeParseException::class.java) { Instant.parse("2026-03-02") }
        // Conversely, `LocalDate.parse` on a full instant throws. The app never
        // does that: it slices the 10-char prefix first.
        assertThrows(DateTimeParseException::class.java) {
            LocalDate.parse("2026-03-02T00:00:00Z")
        }

        // The supported reads: a day parses as a day; an instant's UTC date is
        // available through the prefix helper without being treated as a day.
        assertEquals(LocalDate.of(2026, 3, 2), parseIsoDate("2026-03-02"))
        assertEquals(LocalDate.of(2026, 3, 2), parseIsoDate("2026-03-02T00:00:00Z"))
        assertEquals("02/03/2026", vietnamDate("2026-03-02T00:00:00Z"))
        assertEquals(
            LocalDate.of(2026, 3, 2),
            Instant.parse("2026-03-02T00:00:00Z").atZone(ZoneId.of("UTC")).toLocalDate(),
        )
    }

    // ---- 4. Derived days keep their calendar day in either wire shape ----

    @Test
    fun derivedDaysKeepTheirCalendarDayInEitherWireShape() {
        // The API sends a derived day as `YYYY-MM-DD`; an older payload sent the
        // same day as midnight UTC. Both must render the same day, and neither
        // may be converted through the device zone.
        assertEquals("01/04/2026", returnDeadlineLabel("2026-04-01"))
        assertEquals("01/04/2026", returnDeadlineLabel("2026-04-01T00:00:00Z"))
        assertEquals("01/04/2026", forecastDateLabel("2026-04-01"))
        assertEquals("01/04/2026", forecastDateLabel("2026-04-01T00:00:00Z"))
        assertEquals("01/03/2026", actionDateLabel("2026-03-01"))
        assertEquals("01/03/2026", actionDateLabel("2026-03-01T00:00:00Z"))
        assertEquals(
            "Quá hạn 3 ngày",
            actionDuePill(vi, "2026-03-01", LocalDate.of(2026, 3, 4))?.label,
        )
        assertEquals(
            "Quá hạn 3 ngày",
            actionDuePill(vi, "2026-03-01T00:00:00Z", LocalDate.of(2026, 3, 4))?.label,
        )
        assertEquals(
            2L,
            warrantyState(vi, "2026-03-04", LocalDate.of(2026, 3, 2))?.daysLeft,
        )
        assertEquals(
            2L,
            warrantyState(vi, "2026-03-04T00:00:00Z", LocalDate.of(2026, 3, 2))?.daysLeft,
        )
        assertEquals(LocalDate.of(2026, 10, 19), parseEndDate("2026-10-19"))
        assertEquals(LocalDate.of(2026, 10, 19), parseEndDate("2026-10-19T00:00:00Z"))
    }

    // ---- 5. Real instants: UTC-day display, explicitly not local-day ----

    @Test
    fun instantLabelsUseTheUtcDayNotTheDeviceLocalDay() {
        // 02:30Z is still 1 March in New York. The app's date-only labels show
        // the instant's UTC day (the 2nd), deliberately and without conversion.
        // That is a display convention, not a local-day guarantee: for a real
        // instant in a negative-offset zone the label can be one day ahead of
        // the wall-clock date. Days themselves are unaffected (test 2).
        val instant = Instant.parse("2026-03-02T02:30:00Z")
        assertEquals(
            LocalDate.of(2026, 3, 1),
            instant.atZone(ZoneId.of("America/New_York")).toLocalDate(),
        )
        assertEquals("02/03/2026", sessionDateLabel("2026-03-02T02:30:00Z"))
        assertEquals("02/03/2026", actionDateLabel("2026-03-02T02:30:00Z"))
    }

    // ---- 6. Day arithmetic uses LocalDate, never an instant ----

    @Test
    fun dayArithmeticIgnoresTheDeviceZone() {
        assertEquals(47L, daysBetweenIsoDates("2026-03-01", "2026-04-17"))
        // A full instant is tolerated by the 10-char prefix, but no timezone is
        // applied: 23:59 of the same UTC day is still the same day.
        assertEquals(1L, daysBetweenIsoDates("2026-03-01T23:59:59Z", "2026-03-02T00:00:00Z"))
        assertEquals(
            "Còn 1 ngày",
            actionDuePill(vi, "2026-03-02", LocalDate.of(2026, 3, 1))?.label,
        )
        assertNull(parseEndDate("2026-02-31"))
    }

    // ---- 7. The live claim shape, mixed on purpose ----

    @Test
    fun aClaimCarriesOneDayAndThreeInstants() {
        val claim = json.decodeFromString(
            Claim.serializer(),
            """
            {
              "id": "clm_wash",
              "deviceId": "dev_wash",
              "status": "IN_REPAIR",
              "openedAt": "2026-10-16T12:40:46.631Z",
              "expectedReturnAt": "2026-10-23",
              "closedAt": null,
              "createdAt": "2026-10-19T12:40:46.631Z",
              "updatedAt": "2026-10-19T12:40:46.631Z",
              "ticketNumber": "LG-88421",
              "issue": "Máy giặt không vắt, báo lỗi UE"
            }
            """.trimIndent(),
        )
        assertEquals("2026-10-23", claim.expectedReturnAt)
        assertEquals("23/10/2026", vietnamDate(claim.expectedReturnAt))
        assertEquals("16/10/2026", vietnamDate(claim.openedAt))
        assertEquals("19/10/2026", vietnamDate(claim.createdAt))
        // An instant must remain parseable as one.
        assertEquals(Instant.parse("2026-10-16T12:40:46.631Z"), Instant.parse(claim.openedAt))
    }
}
