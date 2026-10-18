package com.warrly.ui.screens.devices

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The pure half of the serial/IMEI scanner: normalisation, IMEI validation,
 * candidate ranking and de-duplication.
 *
 * The camera itself is **not** covered here — CameraX + ML Kit need a device and
 * a frame pipeline, and this module has neither instrumentation tests nor
 * Robolectric. Everything downstream of "a value came out of the model" is in
 * [SerialScan] and is pinned below, which is also why the split exists: the part
 * that can be tested is the part that can silently corrupt a serial.
 */
class SerialScanTest {

    // ---- barcode normalisation -------------------------------------------

    @Test
    fun normalizeBarcodeValue_stripsScannerWireNoise() {
        // A plain Code128 IMEI is already clean.
        assertEquals("490154203237518", SerialScan.normalizeBarcodeValue("490154203237518"))
        // AIM symbology identifier: "]C1" is Code128 metadata, "]Q1" is QR.
        assertEquals("ABC123456", SerialScan.normalizeBarcodeValue("]C1ABC123456"))
        assertEquals("ABC123456", SerialScan.normalizeBarcodeValue("]Q1ABC123456"))
        // FNC1/GS (0x1D) and a trailing CR are separators, not part of the value.
        assertEquals("ABC 123", SerialScan.normalizeBarcodeValue("ABC\u001D123\r"))
        // NBSP from a label printed by a web tool, zero-width space from a PDF.
        assertEquals("SN 12345", SerialScan.normalizeBarcodeValue("SN\u00A012345"))
        assertEquals("SN 12345", SerialScan.normalizeBarcodeValue("SN\u200B 12345"))
        // Runs of whitespace collapse to one space.
        assertEquals("A B", SerialScan.normalizeBarcodeValue("  A   B  "))
        // Nothing left after cleaning is not a candidate.
        assertNull(SerialScan.normalizeBarcodeValue(null))
        assertNull(SerialScan.normalizeBarcodeValue("   \u001D "))
    }

    @Test
    fun normalizeBarcodeValue_compactsOnlyAChecksumValidImei() {
        // Spaces/dashes are how an IMEI is printed; the Luhn check says the digits
        // really are one, so compacting them is a correction, not a guess.
        assertEquals("490154203237518", SerialScan.normalizeBarcodeValue("490 154 203 237 518"))
        assertEquals("490154203237518", SerialScan.normalizeBarcodeValue("490-154-203-237-518"))
        // Same shape, wrong check digit: leave the value exactly as scanned.
        assertEquals("490 154 203 237 519", SerialScan.normalizeBarcodeValue("490 154 203 237 519"))
        // A serial with hyphens is not touched — only 15-digit Luhn-valid values are.
        assertEquals("SM-G991BZKAXME", SerialScan.normalizeBarcodeValue(" SM-G991BZKAXME "))
    }

    // ---- IMEI ------------------------------------------------------------

    @Test
    fun luhnValid_matchesTheImeiCheckDigitRule() {
        assertTrue(SerialScan.luhnValid("490154203237518"))
        assertFalse(SerialScan.luhnValid("490154203237519"))
        assertFalse("empty is not a valid IMEI", SerialScan.luhnValid(""))
        assertFalse("non-digits are not an IMEI", SerialScan.luhnValid("49015x203237518"))
    }

    @Test
    fun imeiOf_acceptsOnlyAStandaloneChecksumValidImei() {
        assertEquals("490154203237518", SerialScan.imeiOf(" 490 154 203 237 518 "))
        assertEquals("490154203237518", SerialScan.imeiOf("490-154-203-237-518"))
        // A labelled line is handled by textCandidates, not by pulling digits out
        // of arbitrary text.
        assertNull(SerialScan.imeiOf("IMEI 490154203237518"))
        assertNull("bad check digit", SerialScan.imeiOf("490154203237519"))
        assertNull("14 digits is not an IMEI", SerialScan.imeiOf("49015420323751"))
        assertNull(SerialScan.imeiOf(null))
    }

    @Test
    fun looksLikeImei_ignoresTheCheckDigitButNotTheShape() {
        assertTrue(SerialScan.looksLikeImei("490154203237519"))
        assertTrue(SerialScan.looksLikeImei("490 154 203 237 519"))
        assertFalse(SerialScan.looksLikeImei("4006381333931"))
        assertFalse(SerialScan.looksLikeImei("IMEI 490154203237519"))
        assertFalse(SerialScan.looksLikeImei(null))
    }

    // ---- ranking ---------------------------------------------------------

    @Test
    fun barcodeCandidates_ranksAValidImeiFirst() {
        val ranked = SerialScan.barcodeCandidates(
            listOf("4006381333931", "SM-G991B", "490154203237518"),
        )
        assertEquals(listOf("490154203237518", "SM-G991B", "4006381333931"), ranked)
    }

    @Test
    fun barcodeCandidates_dedupesIgnoringCase() {
        val ranked = SerialScan.barcodeCandidates(
            listOf("abc123456", "ABC123456", "490154203237518", "490154203237518"),
        )
        assertEquals(listOf("490154203237518", "abc123456"), ranked)
    }

    @Test
    fun barcodeCandidates_putsAUrlLastAndCapsTheList() {
        val ranked = SerialScan.barcodeCandidates(
            listOf("https://warrly.app/share/abc", "ABC12345"),
        )
        assertEquals(listOf("ABC12345", "https://warrly.app/share/abc"), ranked)

        val many = (1..10).map { "SN1234567$it" }
        assertEquals(SerialScan.MAX_CANDIDATES, SerialScan.barcodeCandidates(many).size)
    }

    // ---- printed text (OCR) ---------------------------------------------

    @Test
    fun textCandidates_readsALabelAndRanksTheImeiFirst() {
        val block = """
            Warranty card
            IMEI1: 490154203237518
            S/N: SM-G991BZKAXME
            Model: SM-G991B
            Made in Vietnam
        """.trimIndent()

        assertEquals(
            listOf("490154203237518", "SM-G991BZKAXME", "SM-G991B"),
            SerialScan.textCandidates(block),
        )
    }

    @Test
    fun textCandidates_keepsALabelledSerialThatHasNoDigits() {
        // Rare, but the label is the user telling us this is the serial.
        assertEquals(listOf("ABCDEFGH"), SerialScan.textCandidates("S/N ABCDEFGH"))
    }

    @Test
    fun textCandidates_dropsPricesDatesAndProse() {
        val block = "Giá: 25.990.000\nBảo hành 12 tháng\nMade in Vietnam"
        assertEquals(emptyList<String>(), SerialScan.textCandidates(block))
        assertEquals(emptyList<String>(), SerialScan.textCandidates(null))
        assertEquals(emptyList<String>(), SerialScan.textCandidates("   "))
    }

    @Test
    fun textCandidates_doesNotOfferAProductBarcodeAsAnOcrSerial() {
        // A 13-digit EAN is a product code; on a barcode it is offered (the box
        // may only carry that one), but a bare 13-digit number in printed text is
        // far more likely to be a price or a model year.
        assertEquals(emptyList<String>(), SerialScan.textCandidates("4006381333931"))
    }

    @Test
    fun textCandidates_findsAnUnlabelledImei() {
        assertEquals(
            listOf("490154203237518"),
            SerialScan.textCandidates("Thiết bị\n490154203237518\nCòn bảo hành"),
        )
    }

    @Test
    fun textCandidates_neverOffersTheLabelWordItself() {
        // "IMEI1" mixes letters and a digit, so a naive token rule would offer it.
        assertFalse(SerialScan.textCandidates("IMEI1: 490154203237518").contains("IMEI1"))
    }

    // ---- merging frames --------------------------------------------------

    @Test
    fun mergeCandidates_appendsWithoutReorderingWhatIsAlreadyOnScreen() {
        assertEquals(
            listOf("A", "B"),
            SerialScan.mergeCandidates(existing = listOf("A"), incoming = listOf("B")),
        )
        // Re-ranking on every frame would move the row under the user's finger.
        assertEquals(
            listOf("B", "A"),
            SerialScan.mergeCandidates(existing = listOf("B"), incoming = listOf("A")),
        )
    }

    @Test
    fun mergeCandidates_dedupesIgnoringCaseAndCapsTheList() {
        assertEquals(
            listOf("ABC123"),
            SerialScan.mergeCandidates(existing = listOf("ABC123"), incoming = listOf("abc123")),
        )
        assertEquals(
            listOf("1", "2"),
            SerialScan.mergeCandidates(existing = listOf("1", "2"), incoming = listOf("3"), limit = 2),
        )
        assertEquals(
            listOf("1", "2"),
            SerialScan.mergeCandidates(existing = listOf("1", "2", "3"), incoming = emptyList(), limit = 2),
        )
        assertEquals(
            emptyList<String>(),
            SerialScan.mergeCandidates(existing = listOf("1"), incoming = listOf("2"), limit = 0),
        )
    }

    // ---- permission route ------------------------------------------------

    @Test
    fun cameraPermissionProblem_separatesRetryFromTheSettingsRoute() {
        assertNull("nothing to report once granted", cameraPermissionProblem(granted = true, canAskAgain = false))
        assertEquals(
            CameraPermissionProblem.ASK_AGAIN,
            cameraPermissionProblem(granted = false, canAskAgain = true),
        )
        // "Don't ask again": the OS will never show the dialog, so a retry would
        // be a dead end and the only route is the app's settings page.
        assertEquals(
            CameraPermissionProblem.BLOCKED,
            cameraPermissionProblem(granted = false, canAskAgain = false),
        )
    }
}
