package com.warrly.ui.screens.devices

import com.warrly.i18n.ResCatalog
import com.warrly.network.ApiClient
import com.warrly.network.Device
import com.warrly.network.DeviceInput
import com.warrly.network.DeviceResponse
import com.warrly.testing.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/**
 * Warranty activation and the extended-cover deadline — the pure half.
 *
 * The exact words are read out of `res/values-vi/` and `res/values/` through the
 * same [ResCatalog] seam every other pure formatter test uses, so a missing or
 * mistranslated key fails here instead of silently rendering the wrong language
 * on a phone.
 *
 * The clock-dependent countdown is pinned to a fixed [today]; nothing in this
 * file reads `LocalDate.now()`.
 */
class DeviceActivationTest {

    private val vi = ResCatalog.vietnamese()
    private val en = ResCatalog.english()
    private val json = ApiClient.json

    private val today = LocalDate.of(2026, 3, 1)

    // ---- Activation status ----

    @Test
    fun activationStatus_hasThreeDistinctStates() {
        assertEquals(
            "required but no date yet",
            ActivationStatus.RequiredNotActivated,
            activationStatus(activationRequired = true, activatedAt = null),
        )
        assertEquals(
            "this is the fact the counter asks about",
            ActivationStatus.Activated("02/03/2026"),
            activationStatus(activationRequired = true, activatedAt = "2026-03-02T00:00:00"),
        )
        assertEquals(
            "the ordinary case",
            ActivationStatus.NotRequired,
            activationStatus(activationRequired = false, activatedAt = null),
        )
    }

    @Test
    fun aRecordedDateWinsOverAFalseToggle() {
        // A pre-activated device (or a record written by another client) is
        // activated; the boolean is not allowed to erase that fact.
        assertEquals(
            ActivationStatus.Activated("02/03/2026"),
            activationStatus(activationRequired = false, activatedAt = "2026-03-02"),
        )
    }

    @Test
    fun anImpossibleCalendarDateIsNotAnActivationClaim() {
        // Shape-valid but not a real day: never render "Đã kích hoạt ngày
        // 31/02/2026". The boolean still decides the state.
        assertEquals(
            ActivationStatus.RequiredNotActivated,
            activationStatus(activationRequired = true, activatedAt = "2026-02-31"),
        )
        assertEquals(
            ActivationStatus.NotRequired,
            activationStatus(activationRequired = false, activatedAt = "2026-02-31"),
        )
    }

    @Test
    fun activationLabel_speaksBothLanguages() {
        assertEquals(
            "Chưa kích hoạt",
            activationLabel(vi, ActivationStatus.RequiredNotActivated),
        )
        assertEquals(
            "Not activated",
            activationLabel(en, ActivationStatus.RequiredNotActivated),
        )
        assertEquals(
            "Đã kích hoạt ngày 02/03/2026",
            activationLabel(vi, ActivationStatus.Activated("02/03/2026")),
        )
        assertEquals(
            "Activated on 02/03/2026",
            activationLabel(en, ActivationStatus.Activated("02/03/2026")),
        )
        assertEquals("Không cần kích hoạt", activationLabel(vi, ActivationStatus.NotRequired))
        assertEquals("Not required", activationLabel(en, ActivationStatus.NotRequired))
    }

    @Test
    fun activationOnOrBeforeThePurchaseDateIsNeverBlocked() {
        // A shop can pre-activate before the invoice date. There is deliberately
        // no comparison between the two dates anywhere in the helper or form.
        val preActivated = "2023-12-20"

        assertEquals(
            ActivationStatus.Activated("20/12/2023"),
            activationStatus(activationRequired = true, activatedAt = preActivated),
        )
        assertEquals(preActivated, activatedAtRequest(activatedAtInput(preActivated)))
    }

    @Test
    fun theRowAndTheDateFieldAreOnlyShownWhenMeaningful() {
        // Detail card: a default device (false + no date) must not grow a
        // "not required" row; a required or activated one must.
        assertFalse(hasActivationState(false, null))
        assertFalse(hasActivationState(false, "   "))
        assertTrue(hasActivationState(true, null))
        assertTrue(hasActivationState(false, "2026-03-02"))

        // Form: the switch reveals the date, and an existing date keeps the
        // field visible even when the switch is off.
        assertTrue(showsActivationDate(true, ""))
        assertTrue(showsActivationDate(false, "2026-03-02"))
        assertFalse(showsActivationDate(false, ""))
    }

    // ---- Wire <-> form dates ----

    @Test
    fun dateHelpers_keepOnlyTheCalendarDate() {
        // Naive UTC on the wire: parsing as an instant would move 23:30Z to the
        // next day in Vietnam.
        assertEquals("2026-03-02", activatedAtInput("2026-03-02T23:30:00"))
        assertEquals("2026-03-02", activatedAtInput("2026-03-02"))
        assertEquals("", activatedAtInput(null))
        assertEquals("", activatedAtInput("   "))
        assertNull(activatedAtRequest("  "))
        assertEquals("2026-03-02", activatedAtRequest("  2026-03-02  "))

        assertEquals("2026-12-31", extendedCoverBuyByInput("2026-12-31T00:00:00"))
        assertEquals("", extendedCoverBuyByInput(null))
        assertNull(extendedCoverBuyByRequest(""))
        assertEquals("2026-12-31", extendedCoverBuyByRequest(" 2026-12-31 "))
    }

    // ---- Extended-cover countdown ----

    @Test
    fun countdown_isTheNumberOfCalendarDaysLeft() {
        val state = extendedCoverState(vi, "2026-03-11T00:00:00", today)!!

        assertEquals("11/03/2026", state.buyByDate)
        assertEquals(10L, state.daysLeft)
        assertEquals("Còn 10 ngày", state.label)
    }

    @Test
    fun countdownBoundaries_todayAndOverdue() {
        val lastDay = extendedCoverState(vi, "2026-03-01", today)!!
        assertEquals(0L, lastDay.daysLeft)
        assertEquals("Hôm nay là ngày cuối", lastDay.label)
        assertEquals(ExtendedCoverTone.Today, lastDay.tone)

        val overdue = extendedCoverState(vi, "2026-02-27T00:00:00", today)!!
        assertEquals(-2L, overdue.daysLeft)
        assertEquals("Đã quá hạn 2 ngày", overdue.label)
        assertEquals(ExtendedCoverTone.Expired, overdue.tone)
    }

    @Test
    fun countdownTone_followsTheThirtyDayBoundary() {
        assertEquals(
            ExtendedCoverTone.Open,
            extendedCoverState(vi, "2026-04-01", today)!!.tone, // 31 days
        )
        assertEquals(
            ExtendedCoverTone.Soon,
            extendedCoverState(vi, "2026-03-31", today)!!.tone, // 30 days
        )
        assertEquals(
            ExtendedCoverTone.Soon,
            extendedCoverState(vi, "2026-03-02", today)!!.tone, // 1 day
        )
    }

    @Test
    fun countdownLabels_speakBothLanguages() {
        assertEquals(
            "12 days left",
            extendedCoverState(en, "2026-03-13", today)!!.label,
        )
        assertEquals(
            "Còn 1 ngày",
            extendedCoverState(vi, "2026-03-02", today)!!.label,
        )
        assertEquals(
            "1 day left",
            extendedCoverState(en, "2026-03-02", today)!!.label,
        )
        assertEquals(
            "Last day today",
            extendedCoverState(en, "2026-03-01", today)!!.label,
        )
        assertEquals(
            "2 days overdue",
            extendedCoverState(en, "2026-02-27", today)!!.label,
        )
        assertEquals(
            "1 day overdue",
            extendedCoverState(en, "2026-02-28", today)!!.label,
        )
    }

    @Test
    fun missingOrMalformedDeadline_rendersNoRowInsteadOfGuessing() {
        assertNull(extendedCoverState(vi, null, today))
        assertNull(extendedCoverState(vi, "   ", today))
        assertNull(extendedCoverState(vi, "not-a-date", today))
        assertNull(extendedCoverState(vi, "2026-3-1", today))
        assertNull(extendedCoverState(vi, "2026-02-31", today))
    }

    // ---- JSON contract ----

    @Test
    fun deviceJson_readsTheNewFieldsAndDefaultsAPreFeaturePayload() {
        val updated = json.decodeFromString(
            DeviceResponse.serializer(),
            """
                {
                  "device": {
                    "id": "dev-1",
                    "name": "Galaxy S24",
                    "category": "PHONE",
                    "purchaseDate": "2026-03-01T00:00:00",
                    "activationRequired": true,
                    "activatedAt": "2026-03-02T00:00:00",
                    "extendedCoverBuyBy": "2026-03-31T00:00:00"
                  }
                }
            """.trimIndent(),
        ).device

        assertTrue(updated.activationRequired)
        assertEquals("2026-03-02T00:00:00", updated.activatedAt)
        assertEquals("2026-03-31T00:00:00", updated.extendedCoverBuyBy)

        // A server that predates the fields must decode to "no activation step"
        // and "no deadline", never null-out the whole device.
        val old = json.decodeFromString(
            Device.serializer(),
            """
                {
                  "id": "dev-2",
                  "name": "Old phone",
                  "category": "PHONE",
                  "purchaseDate": "2024-03-01"
                }
            """.trimIndent(),
        )
        assertFalse(old.activationRequired)
        assertNull(old.activatedAt)
        assertNull(old.extendedCoverBuyBy)
    }

    @Test
    fun deviceInput_omitsNullDatesButAlwaysSendsTheBoolean() {
        val encoded = json.encodeToString(
            DeviceInput.serializer(),
            DeviceInput(
                name = "Galaxy S24",
                category = "PHONE",
                purchaseDate = "2024-03-01",
                // explicitNulls = false: a null date is dropped, which the
                // update contract reads as "unchanged".
                activationRequired = false,
                activatedAt = null,
                extendedCoverBuyBy = null,
            ),
        )

        assertTrue(
            "false must be sent so turning activation off is not silent: $encoded",
            encoded.contains("\"activationRequired\":false"),
        )
        assertFalse(encoded.contains("\"activatedAt\""))
        assertFalse(encoded.contains("\"extendedCoverBuyBy\""))
    }

    @Test
    fun deviceInput_carriesTheActivationPairThroughTheFormRoundTrip() {
        // Mirrors AddDeviceSheet: load an existing device, save it unchanged.
        val stored = Fixtures.device().copy(
            activationRequired = true,
            activatedAt = "2023-12-20T00:00:00", // earlier than purchaseDate, allowed
            extendedCoverBuyBy = "2026-03-31T00:00:00",
        )

        val input = DeviceInput(
            name = stored.name,
            category = stored.category,
            purchaseDate = stored.purchaseDate,
            activationRequired = stored.activationRequired,
            activatedAt = activatedAtRequest(activatedAtInput(stored.activatedAt)),
            extendedCoverBuyBy = extendedCoverBuyByRequest(
                extendedCoverBuyByInput(stored.extendedCoverBuyBy),
            ),
        )

        assertTrue(input.activationRequired)
        assertEquals("2023-12-20", input.activatedAt)
        assertEquals("2026-03-31", input.extendedCoverBuyBy)
    }
}
