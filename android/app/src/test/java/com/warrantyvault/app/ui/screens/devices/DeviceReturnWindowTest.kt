package com.warrantyvault.app.ui.screens.devices

import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.Device
import com.warrantyvault.app.network.DeviceInput
import com.warrantyvault.app.testing.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Exchange/return window round trip (migration 0010) — the pure half.
 *
 * This is a PRESERVE-ONLY feature in this pass: no input, no picker, no setting.
 * `PATCH /api/v1/devices/{id}` replaces the whole device, so the only thing that
 * matters is that an edit made on Android sends back exactly what it loaded. A
 * device that arrives with a window recorded elsewhere must leave with the same
 * window — otherwise the first Android edit silently destroys data another client
 * wrote.
 */
class DeviceReturnWindowTest {

    private val json = ApiClient.json

    // ---- wire → form ----

    @Test
    fun returnWindowDaysInput_keepsZeroDistinctFromUnknown() {
        assertEquals("30", returnWindowDaysInput(30))
        // "cửa hàng không cho đổi trả" is a recorded answer, not an absence.
        assertEquals("0", returnWindowDaysInput(0))
        assertEquals("", returnWindowDaysInput(null))
    }

    @Test
    fun receivedAtInput_keepsOnlyTheCalendarDateNeverAnInstant() {
        // Naive UTC on the wire: "…T00:00:00" with no Z. Parsing it as an instant
        // in +07:00 would move 23:30Z to the next day.
        assertEquals("2026-03-02", receivedAtInput("2026-03-02T00:00:00"))
        assertEquals("2026-03-02", receivedAtInput("2026-03-02T23:30:00"))
        assertEquals("2026-03-02", receivedAtInput("2026-03-02"))
        assertEquals("", receivedAtInput(null))
        assertEquals("", receivedAtInput("   "))
    }

    // ---- form → request ----

    @Test
    fun returnWindowDaysRequest_blanksToNullAndKeepsZero() {
        assertNull("blank means 'chưa biết'", returnWindowDaysRequest(""))
        assertNull(returnWindowDaysRequest("   "))
        assertEquals(0, returnWindowDaysRequest("0"))
        assertEquals(30, returnWindowDaysRequest("30"))
        assertEquals(30, returnWindowDaysRequest("  30 "))
        assertNull("a non-numeric value degrades to absent", returnWindowDaysRequest("ba mươi"))
    }

    @Test
    fun receivedAtRequest_blanksToNullAndTrims() {
        assertNull(receivedAtRequest(""))
        assertNull(receivedAtRequest("  "))
        assertEquals("2026-03-02", receivedAtRequest("2026-03-02"))
        assertEquals("2026-03-02", receivedAtRequest("  2026-03-02  "))
    }

    // ---- the round trip itself ----

    /**
     * The load-then-save path the sheet actually performs: a `Device` as the API
     * returns it, pushed through the form helpers, back into the `DeviceInput` a
     * PATCH sends. Every value must come out identical.
     */
    @Test
    fun roundTrip_preservesBothFieldsThroughTheFormMapping() {
        val stored = Fixtures.returnWindowDevice(
            returnWindowDays = 30,
            receivedAt = "2026-03-02T00:00:00",
            returnDeadline = "2026-04-01T00:00:00",
        )

        val input = roundTrip(stored)

        assertEquals(30, input.returnWindowDays)
        assertEquals("2026-03-02", input.receivedAt)
    }

    @Test
    fun roundTrip_preservesTheMeaningfulZero() {
        val stored = Fixtures.returnWindowDevice(
            returnWindowDays = 0,
            receivedAt = null,
            returnDeadline = null,
        )

        val input = roundTrip(stored)

        assertEquals("0 must survive as 0, not become absent", 0, input.returnWindowDays)
        assertNull("no delivery date stays unknown", input.receivedAt)
    }

    @Test
    fun roundTrip_preservesAWindowThatHasNoDeliveryDate() {
        val stored = Fixtures.returnWindowDevice(returnWindowDays = 365, receivedAt = null)
        val input = roundTrip(stored)

        assertEquals(365, input.returnWindowDays)
        assertNull(input.receivedAt)
    }

    @Test
    fun roundTrip_leavesAnUnknownWindowUnknown() {
        val stored = Fixtures.returnWindowDevice(
            returnWindowDays = null,
            receivedAt = null,
            returnDeadline = null,
        )

        val input = roundTrip(stored)

        assertNull(input.returnWindowDays)
        assertNull(input.receivedAt)
    }

    /**
     * The proof at the wire level, which is where the trap actually bites: a
     * naive client would send neither key and Go would read `nil` for both,
     * clearing the window. Both keys must be present with the stored values.
     */
    @Test
    fun encodedPatchBody_carriesBothKeysSoTheServerCannotClearThem() {
        val stored = Fixtures.returnWindowDevice(
            returnWindowDays = 30,
            receivedAt = "2026-03-02T00:00:00",
        )

        val body = json.encodeToString(DeviceInput.serializer(), roundTrip(stored))

        assertTrue("returnWindowDays missing from $body", body.contains("\"returnWindowDays\":30"))
        assertTrue("receivedAt missing from $body", body.contains("\"receivedAt\":\"2026-03-02\""))
    }

    /** And the same body still omits them for a device that never had a window. */
    @Test
    fun encodedPatchBody_omitsTheKeysWhenNothingWasRecorded() {
        val body = json.encodeToString(
            DeviceInput.serializer(),
            roundTrip(Fixtures.device(returnWindowDays = null, receivedAt = null)),
        )

        assertFalse("nothing recorded ⇒ the keys stay out: $body", body.contains("returnWindowDays"))
        assertFalse(body.contains("receivedAt"))
    }

    /**
     * The rest of the form is untouched by the round trip: the window is carried
     * alongside the editable fields, not instead of them.
     */
    @Test
    fun roundTrip_doesNotChangeTheFullyReplacedRow() {
        val stored = Fixtures.returnWindowDevice().copy(
            name = "iPhone 15 Pro",
            category = "PHONE",
            status = com.warrantyvault.app.network.DeviceStatus.ACTIVE,
            soldAt = "2026-03-01T00:00:00",
            soldPrice = 25_000_000,
        )

        val input = roundTrip(stored)

        assertEquals("iPhone 15 Pro", input.name)
        assertEquals("PHONE", input.category)
        assertEquals("2026-03-01", input.soldAt)
        assertEquals(25_000_000, input.soldPrice)
        assertEquals(30, input.returnWindowDays)
    }

    /**
     * Mirrors AddDeviceSheet's mapping exactly: the form state is seeded from the
     * loaded device and fed back through the same two `*Request` helpers the save
     * button uses.
     */
    private fun roundTrip(stored: Device): DeviceInput {
        val returnWindowDaysField = returnWindowDaysInput(stored.returnWindowDays)
        val receivedAtField = receivedAtInput(stored.receivedAt)
        return DeviceInput(
            name = stored.name,
            category = stored.category,
            purchaseDate = stored.purchaseDate.take(10),
            purchasePrice = stored.purchasePrice,
            status = stored.status,
            soldAt = soldDateRequest(soldDateInput(stored.soldAt)),
            soldPrice = soldPriceRequest(stored.soldPrice?.toString().orEmpty()),
            returnWindowDays = returnWindowDaysRequest(returnWindowDaysField),
            receivedAt = receivedAtRequest(receivedAtField),
        )
    }

    // ---- decoding + the read-only deadline ----

    @Test
    fun device_decodesTheWindowFieldsFromAListOrDetailPayload() {
        val device = json.decodeFromString(
            Device.serializer(),
            """
                {
                  "id": "dev-1", "name": "iPhone", "category": "PHONE",
                  "purchaseDate": "2026-03-01T00:00:00", "purchasePrice": 30000000,
                  "status": "ACTIVE",
                  "returnWindowDays": 30,
                  "receivedAt": "2026-03-02T00:00:00",
                  "returnDeadline": "2026-04-01T00:00:00"
                }
            """.trimIndent(),
        )

        assertEquals(30, device.returnWindowDays)
        assertEquals("2026-03-02T00:00:00", device.receivedAt)
        assertEquals("2026-04-01T00:00:00", device.returnDeadline)
        assertEquals("01/04/2026", returnDeadlineLabel(device.returnDeadline))
    }

    /** A server that predates 0010, or a bare write response, decodes as unknown. */
    @Test
    fun device_decodesMissingWindowFieldsAsUnknown() {
        val device = json.decodeFromString(
            Device.serializer(),
            """{"id":"dev-2","name":"Chuột","category":"ACCESSORY","purchaseDate":"2024-05-05"}""",
        )

        assertNull(device.returnWindowDays)
        assertNull(device.receivedAt)
        assertNull(device.returnDeadline)
        assertNull(returnDeadlineLabel(device.returnDeadline))
        assertFalse(hasReturnWindow(device.returnWindowDays))
    }

    @Test
    fun returnDeadlineLabel_isReadOnlyFormattingAndNeverInventsADate() {
        assertEquals("01/04/2026", returnDeadlineLabel("2026-04-01T00:00:00"))
        assertEquals("01/04/2026", returnDeadlineLabel("2026-04-01"))
        assertNull(returnDeadlineLabel(null))
        assertNull(returnDeadlineLabel(""))
        assertNull(returnDeadlineLabel("2026/04/01"))
        assertNull(returnDeadlineLabel("2026-4-1"))
    }

    @Test
    fun hasReturnWindow_treatsZeroAsRecordedAndNullAsUnknown() {
        assertTrue(hasReturnWindow(0))
        assertTrue(hasReturnWindow(30))
        assertFalse(hasReturnWindow(null))
    }

    // ---- the derived deadline after a write ----

    /**
     * A write response carries no `returnDeadline` (it is not a column), so the
     * previous one is kept **only** while its three inputs are unchanged — those
     * inputs do travel in the response, so an identical triple proves the derived
     * date cannot have moved.
     */
    @Test
    fun keptReturnDeadline_keepsTheDateWhileItsInputsAreUnchanged() {
        val previous = Fixtures.returnWindowDevice(
            returnWindowDays = 30,
            receivedAt = "2026-03-02T00:00:00",
            returnDeadline = "2026-04-01T00:00:00",
        )
        // The bare row a PATCH answers with: same window, no derived field, and
        // the editable fields the user just changed.
        val written = previous.copy(name = "Tên mới", returnDeadline = null)

        assertEquals("2026-04-01T00:00:00", keptReturnDeadline(previous, written))
    }

    @Test
    fun keptReturnDeadline_dropsTheDateAsSoonAsAnInputMoves() {
        val previous = Fixtures.returnWindowDevice(
            returnWindowDays = 30,
            receivedAt = "2026-03-02T00:00:00",
            returnDeadline = "2026-04-01T00:00:00",
        )

        // The user typed a different window length in this very edit.
        assertNull(keptReturnDeadline(previous, previous.copy(returnWindowDays = 15, returnDeadline = null)))
        // …or a different delivery date…
        assertNull(
            keptReturnDeadline(
                previous,
                previous.copy(receivedAt = "2026-03-05T00:00:00", returnDeadline = null),
            ),
        )
        // …or a different purchase date, which the window counts from when no
        // delivery date is recorded.
        assertNull(
            keptReturnDeadline(
                previous,
                previous.copy(purchaseDate = "2026-02-01T00:00:00", returnDeadline = null),
            ),
        )
    }

    @Test
    fun keptReturnDeadline_dropsTheDateWhenAWindowIsNoLongerRecorded() {
        val previous = Fixtures.returnWindowDevice(
            returnWindowDays = 30,
            receivedAt = "2026-03-02T00:00:00",
            returnDeadline = "2026-04-01T00:00:00",
        )

        // Cleared by another client: 30 days is not "unchanged", it is gone.
        assertNull(keptReturnDeadline(previous, previous.copy(returnWindowDays = null, returnDeadline = null)))
        // 0 = "cửa hàng không cho đổi trả" ⇒ the server derives no deadline.
        assertNull(keptReturnDeadline(previous, previous.copy(returnWindowDays = 0, returnDeadline = null)))
    }

    @Test
    fun keptReturnDeadline_prefersADateTheServerActuallySent() {
        val previous = Fixtures.returnWindowDevice(returnDeadline = "2026-04-01T00:00:00")
        val written = previous.copy(
            returnWindowDays = 7,
            receivedAt = "2026-03-09T00:00:00",
            returnDeadline = "2026-03-16T00:00:00",
        )

        assertEquals("a payload field beats any cached value", "2026-03-16T00:00:00", keptReturnDeadline(previous, written))
    }
}
