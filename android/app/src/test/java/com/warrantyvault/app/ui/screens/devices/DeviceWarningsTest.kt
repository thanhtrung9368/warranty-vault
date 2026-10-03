package com.warrantyvault.app.ui.screens.devices

import com.warrantyvault.app.network.DeviceWarning
import com.warrantyvault.app.network.DraftDevice
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The advisory copy + the draft's two review channels.
 *
 * The one thing these tests exist to protect: a warning is never an error. The
 * device was saved, the serial is kept, and the UI says so in Vietnamese even
 * when the server sent no message at all.
 */
class DeviceWarningsTest {

    private fun warning(
        code: String = "IMEI_CHECKSUM",
        field: String = "serialNumber",
        message: String = "",
    ) = DeviceWarning(code = code, field = field, message = message)

    // ---- message: prefer the API's own sentence ----

    @Test
    fun message_prefersTheServersOwnVietnameseCopy() {
        val fromServer = warning(
            message = "15 số này không đúng checksum IMEI (Luhn) — có thể sai một chữ số.",
        )

        assertEquals(
            "15 số này không đúng checksum IMEI (Luhn) — có thể sai một chữ số.",
            deviceWarningMessage(fromServer),
        )
    }

    @Test
    fun message_fallsBackPerCodeWhenTheServerSendsNone() {
        // A yellow box with nothing in it is worse than no box: every known code
        // has its own sentence.
        assertTrue(deviceWarningMessage(warning("IMEI_CHECKSUM")).contains("checksum"))
        assertTrue(deviceWarningMessage(warning("IMEI_LENGTH")).contains("IMEI 15 số"))
        assertTrue(deviceWarningMessage(warning("SERIAL_DUPLICATE")).contains("thiết bị khác"))
        assertTrue(deviceWarningMessage(warning("")).isNotBlank())
    }

    @Test
    fun message_neverReadsAsAFailure() {
        listOf("IMEI_CHECKSUM", "IMEI_LENGTH", "SERIAL_DUPLICATE", "SOMETHING_NEW").forEach { code ->
            val text = deviceWarningMessage(warning(code))
            assertTrue("must not claim failure for $code: $text", !text.contains("thất bại"))
            assertTrue("must not claim failure for $code: $text", !text.contains("Không lưu"))
        }
    }

    @Test
    fun title_isAboutASaveThatAlreadyHappened() {
        assertEquals("Đã lưu, nhưng nên xem lại", deviceWarningsTitle(isEdit = false))
        assertEquals("Đã cập nhật, nhưng nên xem lại", deviceWarningsTitle(isEdit = true))
    }

    // ---- field filter ----

    @Test
    fun warningsForField_keepsOnlyTheSerialAdvisories() {
        val warnings = listOf(
            warning(code = "IMEI_LENGTH"),
            warning(code = "OTHER", field = "name"),
        )

        assertEquals(listOf("IMEI_LENGTH"), deviceWarningsForField(warnings).map { it.code })
        assertEquals(1, deviceWarningsForField(warnings, "name").size)
        assertTrue(deviceWarningsForField(emptyList()).isEmpty())
    }

    // ---- the AI draft: unmatched vs warnings stay apart ----

    @Test
    fun draftReview_keepsTheTwoChannelsDistinct() {
        val review = draftReview(
            DraftDevice(
                confidence = "medium",
                unmatched = listOf("brand", "purchasePlace"),
                warnings = listOf(
                    warning("IMEI_CHECKSUM", message = "IMEI sai checksum."),
                    warning("SERIAL_DUPLICATE", message = "Serial đã có ở máy khác."),
                ),
            ),
        )

        // unmatched = "we could not use it" (dropped, must be retyped).
        assertEquals("Cần xem lại: Hãng, Nơi mua.", review.unmatched)
        // warnings = "we used it, but it looks wrong" (kept, still saved).
        assertTrue(review.warnings!!.startsWith("Đã điền nhưng có thể sai:"))
        assertTrue(review.warnings!!.contains("IMEI sai checksum."))
        assertTrue(review.warnings!!.contains("Serial đã có ở máy khác."))
    }

    @Test
    fun draftReview_isSilentWhenThereIsNothingToReview() {
        val review = draftReview(DraftDevice(confidence = "high"))

        assertNull(review.unmatched)
        assertNull(review.warnings)
        assertFalse(review.unmatched != null || review.warnings != null)
    }

    @Test
    fun draftReview_mapsOnlyKnownUnmatchedFieldsAndKeepsWarningsTextual() {
        val review = draftReview(
            DraftDevice(
                unmatched = listOf("brand", "somethingInternal"),
                warnings = listOf(warning("IMEI_LENGTH")),
            ),
        )

        // An unknown internal key is not user-facing copy.
        assertEquals("Cần xem lại: Hãng.", review.unmatched)
        // No server message → the code-specific Vietnamese fallback is used.
        assertTrue(review.warnings!!.contains("IMEI 15 số"))
    }

    @Test
    fun unmatchedLabel_coversTheFieldsTheApiCanReport() {
        assertEquals("Hãng", unmatchedLabel("brand"))
        assertEquals("Nơi mua", unmatchedLabel("purchasePlace"))
        assertEquals("Loại thiết bị", unmatchedLabel("category"))
        assertEquals("Số serial", unmatchedLabel("serialNumber"))
        assertEquals("Số tháng bảo hành", unmatchedLabel("warrantyMonths"))
        assertNull(unmatchedLabel("internalThing"))
    }
}
