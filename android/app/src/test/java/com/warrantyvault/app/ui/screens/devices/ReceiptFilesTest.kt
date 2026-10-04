package com.warrantyvault.app.ui.screens.devices

import com.warrantyvault.app.i18n.ResCatalog
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The receipt-scan upload decision: what the picked file is (magic bytes, not
 * the content provider's claim) and what the OCR endpoint can do with it.
 *
 * The PDF case is the one with teeth: `POST /api/v1/ai/extract-receipt` takes a
 * PDF as an Anthropic `document` block, so it must be uploaded byte-for-byte
 * and can never fall into the HEIC/GIF image-transcode branch — decoding a PDF
 * as a bitmap yields nothing, and "convert" would silently drop the receipt.
 */
class ReceiptFilesTest {

    // ---- Synthetic headers (magic bytes only; the planners never read more) ----

    private fun pdf() = "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n".toByteArray(Charsets.US_ASCII)

    private fun jpeg() = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 0x00, 0x10) +
        "JFIF".toByteArray(Charsets.US_ASCII)

    private fun png() = byteArrayOf(
        0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        0x00, 0x00, 0x00, 0x0D,                                  // IHDR length
    )

    private fun webp() = "RIFF".toByteArray(Charsets.US_ASCII) +
        byteArrayOf(0x24, 0x00, 0x00, 0x00) +
        "WEBP".toByteArray(Charsets.US_ASCII) +
        "VP8 ".toByteArray(Charsets.US_ASCII)

    private fun gif() = "GIF89a".toByteArray(Charsets.US_ASCII) + byteArrayOf(0x10, 0x00, 0x10, 0x00)

    /** ISO-BMFF box: 4-byte size, `ftyp`, then the major brand. */
    private fun isoBmff(brand: String) = byteArrayOf(0x00, 0x00, 0x00, 0x18) +
        "ftyp".toByteArray(Charsets.US_ASCII) +
        brand.toByteArray(Charsets.US_ASCII) +
        byteArrayOf(0x00, 0x00, 0x00, 0x00)

    // ---- PDF ----

    @Test
    fun pdfGoesAsIsWithItsOwnTypeAndFileName() {
        val plan = ReceiptFiles.plan(pdf())

        assertEquals(ReceiptPlan.SendAsIs("application/pdf", "receipt.pdf"), plan)
        assertEquals(ReceiptKind.PDF, ReceiptFiles.detect(pdf()))
    }

    @Test
    fun pdfNeverTakesTheImageTranscodeBranch() {
        // The invariant the scan flow leans on: whatever the bytes are named or
        // declared upstream, a `%PDF` header is uploaded untouched.
        val plan = ReceiptFiles.plan(pdf())

        assertNotEquals(ReceiptPlan.TranscodeToJpeg, plan)
        assertNotEquals(ReceiptPlan.Unsupported, plan)
        assertTrue("a PDF is accepted by the OCR endpoint", "application/pdf" in ReceiptFiles.OCR_ACCEPTED_MIMES)
    }

    // ---- Images the endpoint takes ----

    @Test
    fun jpegPngAndWebpGoAsIsWithTheSniffedType() {
        assertEquals(
            ReceiptPlan.SendAsIs("image/jpeg", "receipt.jpg"),
            ReceiptFiles.plan(jpeg()),
        )
        assertEquals(
            ReceiptPlan.SendAsIs("image/png", "receipt.png"),
            ReceiptFiles.plan(png()),
        )
        assertEquals(
            ReceiptPlan.SendAsIs("image/webp", "receipt.webp"),
            ReceiptFiles.plan(webp()),
        )
    }

    @Test
    fun theSniffedTypeIsWhatTheServerValidatesTheUploadAgainst() {
        // The Go handler rejects a multipart part whose declared Content-Type
        // disagrees with its bytes, and providers mislabel HEIC photos as
        // `image/jpeg` — hence sniffing instead of trusting `getType(uri)`.
        assertEquals(ReceiptKind.HEIC, ReceiptFiles.detect(isoBmff("heic")))
        assertEquals(ReceiptKind.JPEG, ReceiptFiles.detect(jpeg()))
        assertEquals("image/heic", ReceiptKind.HEIC.mime)
    }

    // ---- Images the endpoint refuses → transcode ----

    @Test
    fun heicIsFlaggedForTranscode() {
        assertEquals(ReceiptPlan.TranscodeToJpeg, ReceiptFiles.plan(isoBmff("heic")))
    }

    @Test
    fun everyHeicBrandAliasIsRecognised() {
        listOf("heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1")
            .forEach { brand ->
                assertEquals("brand $brand", ReceiptKind.HEIC, ReceiptFiles.detect(isoBmff(brand)))
            }
    }

    @Test
    fun gifIsFlaggedForTranscode() {
        assertEquals(ReceiptKind.GIF, ReceiptFiles.detect(gif()))
        assertEquals(ReceiptPlan.TranscodeToJpeg, ReceiptFiles.plan(gif()))
        assertEquals(
            ReceiptKind.GIF,
            ReceiptFiles.detect("GIF87a".toByteArray(Charsets.US_ASCII) + byteArrayOf(0x10, 0x00)),
        )
    }

    // ---- Everything else ----

    @Test
    fun videoAndUnknownPayloadsAreUnsupportedRatherThanTranscoded() {
        // MP4 (`ftyp isom`) is not a HEIC brand: a video must not be decoded as
        // an image and shipped to a paid model.
        assertEquals(null, ReceiptFiles.detect(isoBmff("isom")))
        assertEquals(ReceiptPlan.Unsupported, ReceiptFiles.plan(isoBmff("mp42")))

        val docx = byteArrayOf(0x50, 0x4B, 0x03, 0x04) // ZIP container
        assertEquals(ReceiptPlan.Unsupported, ReceiptFiles.plan(docx))
    }

    @Test
    fun emptyAndTinyPayloadsAreUnsupported() {
        assertEquals(null, ReceiptFiles.detect(ByteArray(0)))
        assertEquals(ReceiptPlan.Unsupported, ReceiptFiles.plan(ByteArray(0)))
        assertEquals(ReceiptPlan.Unsupported, ReceiptFiles.plan(byteArrayOf(0x00)))
        // A truncated PNG signature is not a PNG.
        assertEquals(null, ReceiptFiles.detect(byteArrayOf(0x89.toByte(), 0x50, 0x4E)))
    }

    @Test
    fun theUnsupportedMessageIsTheServerCopy() {
        // services/ai_extract.go: badInput("Chỉ hỗ trợ ảnh JPEG, PNG, WEBP hoặc PDF")
        assertEquals(
            "Chỉ hỗ trợ ảnh JPEG, PNG, WEBP hoặc PDF",
            ResCatalog.vietnamese().get(ReceiptFiles.UNSUPPORTED_MESSAGE),
        )
    }

    @Test
    fun acceptedMimesMirrorTheOcrContract() {
        assertEquals(
            setOf("image/jpeg", "image/png", "image/webp", "application/pdf"),
            ReceiptFiles.OCR_ACCEPTED_MIMES,
        )
    }

    @Test
    fun fileNamesCarryTheSniffedExtension() {
        assertEquals("receipt.pdf", (ReceiptFiles.plan(pdf()) as ReceiptPlan.SendAsIs).fileName)
        assertEquals("receipt.jpg", (ReceiptFiles.plan(jpeg()) as ReceiptPlan.SendAsIs).fileName)
        assertEquals("receipt.png", (ReceiptFiles.plan(png()) as ReceiptPlan.SendAsIs).fileName)
        assertEquals("receipt.webp", (ReceiptFiles.plan(webp()) as ReceiptPlan.SendAsIs).fileName)
        // A transcoded image is re-uploaded as `receipt.jpg`, so the HEIC path
        // never carries the original name into the multipart part.
        assertFalse(ReceiptFiles.plan(isoBmff("heic")) is ReceiptPlan.SendAsIs)
    }
}
