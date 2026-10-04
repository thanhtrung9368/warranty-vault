package com.warrantyvault.app.ui.screens.devices

import androidx.annotation.StringRes
import com.warrantyvault.app.R
import com.warrantyvault.app.i18n.AppStrings
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

/**
 * Magic-byte detection for receipt scans, ported from the iOS
 * `AttachmentFileType.ocrPayload` so both clients decide the same way.
 *
 * Why sniff at all: [com.warrantyvault.app.network.ApiService.extractReceipt]
 * posts a multipart part, and the Go handler validates the part's declared
 * Content-Type against the bytes it actually received
 * (`files.DetectAndValidate` → "Nội dung file không khớp định dạng khai báo").
 * A content provider's `getType(uri)` is not trustworthy here (HEIC photos are
 * routinely labelled `image/jpeg`), so the client declares what the header says.
 *
 * The OCR endpoint is stricter than the attachment whitelist: JPEG / PNG / WEBP
 * **and PDF** only (`ai.IsSupportedReceiptType`). GIF and HEIC still 400 before
 * any paid model call, so they are re-encoded to JPEG on the device first — and
 * a PDF never goes near the image decoder: it is a `document` block on the
 * server side and must arrive byte-for-byte.
 */
enum class ReceiptKind(val mime: String, val fileExtension: String) {
    JPEG("image/jpeg", "jpg"),
    PNG("image/png", "png"),
    WEBP("image/webp", "webp"),
    PDF("application/pdf", "pdf"),
    GIF("image/gif", "gif"),
    HEIC("image/heic", "heic"),
}

/** What to do with a picked receipt file before uploading it. */
sealed interface ReceiptPlan {
    /**
     * The bytes are already in a format OCR accepts (JPEG / PNG / WEBP / PDF):
     * send them untouched and declare [mime]. PDF always lands here.
     */
    data class SendAsIs(val mime: String, val fileName: String) : ReceiptPlan

    /**
     * A still image the endpoint rejects but the platform can decode (HEIC from
     * a camera, GIF): re-encode it as JPEG first.
     */
    data object TranscodeToJpeg : ReceiptPlan

    /** Nothing the endpoint could ever read (video, DOCX, empty, unknown bytes). */
    data object Unsupported : ReceiptPlan
}

object ReceiptFiles {

    /** MIME types `POST /api/v1/ai/extract-receipt` can take (`ocrAcceptedMIMEs`). */
    val OCR_ACCEPTED_MIMES: Set<String> = setOf(
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/pdf",
    )

    /**
     * Vietnamese copy for a payload the OCR endpoint can't take — the server's
     * own wording from `services/ai_extract.go`, so the user sees one message
     * whether the client or the server was the one to refuse.
     */
    /**
     * The refusal shown when a picked file is not an accepted receipt type.
     *
     * A resource id, not a sentence: `ReceiptFiles` is called from the add-device
     * sheet, which has a `Context` and knows the UI language; a constant here
     * could only ever be Vietnamese.
     */
    @StringRes
    val UNSUPPORTED_MESSAGE = R.string.receipt_unsupported_type

    /** Longest header the sniffers inspect (ISO-BMFF `ftyp` box). */
    private const val SNIFF_LENGTH = 12

    /**
     * Detects the file kind from the leading bytes.
     *
     * @return the [ReceiptKind], or `null` when the payload is not one of the
     *   formats the attachment whitelist knows (a video, an office document, an
     *   empty read).
     */
    fun detect(bytes: ByteArray): ReceiptKind? {
        val header = bytes.copyOfRange(0, minOf(bytes.size, SNIFF_LENGTH))
        if (header.isEmpty()) return null

        if (matches(header, PNG_SIGNATURE)) return ReceiptKind.PNG
        if (matches(header, JPEG_SIGNATURE)) return ReceiptKind.JPEG
        if (matches(header, GIF87A_SIGNATURE) || matches(header, GIF89A_SIGNATURE)) return ReceiptKind.GIF
        // RIFF....WEBP
        if (header.size >= 12 && matches(header, RIFF_SIGNATURE) && matchesAt(header, 8, WEBP_TAG)) {
            return ReceiptKind.WEBP
        }
        if (matches(header, PDF_SIGNATURE)) return ReceiptKind.PDF
        if (isoBrand(header) in HEIC_BRANDS) return ReceiptKind.HEIC
        return null
    }

    /**
     * Decides the upload shape for a receipt scan.
     *
     * The PDF branch is the one that matters: it is accepted, so it can never
     * fall through to the transcode step. Everything that is not an accepted
     * image MIME is [ReceiptPlan.Unsupported] rather than "try to decode it" —
     * a `.docx` is not a receipt.
     */
    fun plan(bytes: ByteArray): ReceiptPlan {
        val detected = detect(bytes) ?: return ReceiptPlan.Unsupported
        if (detected.mime in OCR_ACCEPTED_MIMES) {
            return ReceiptPlan.SendAsIs(detected.mime, "receipt.${detected.fileExtension}")
        }
        // HEIC / GIF: images the endpoint refuses but BitmapFactory can read.
        return if (detected.mime.startsWith("image/")) {
            ReceiptPlan.TranscodeToJpeg
        } else {
            ReceiptPlan.Unsupported
        }
    }

    // ---- Private ----

    /**
     * ISO-BMFF brands that mean "HEIC/HEIF image" rather than video/MP4 —
     * the same list as the iOS client and the Go MIME whitelist aliases.
     */
    private val HEIC_BRANDS = setOf(
        "heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs",
        "mif1", "msf1",
    )

    private val PNG_SIGNATURE = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
    private val JPEG_SIGNATURE = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte())
    private val GIF87A_SIGNATURE = "GIF87a".toByteArray(Charsets.US_ASCII)
    private val GIF89A_SIGNATURE = "GIF89a".toByteArray(Charsets.US_ASCII)
    private val RIFF_SIGNATURE = "RIFF".toByteArray(Charsets.US_ASCII)
    private val WEBP_TAG = "WEBP".toByteArray(Charsets.US_ASCII)
    private val PDF_SIGNATURE = "%PDF".toByteArray(Charsets.US_ASCII)
    private val FTYP_TAG = "ftyp".toByteArray(Charsets.US_ASCII)

    private fun matches(header: ByteArray, signature: ByteArray): Boolean =
        matchesAt(header, 0, signature)

    private fun matchesAt(header: ByteArray, offset: Int, signature: ByteArray): Boolean {
        if (header.size < offset + signature.size) return false
        return signature.indices.all { header[offset + it] == signature[it] }
    }

    /**
     * Reads the major brand of an ISO-BMFF box: bytes 4..7 are `ftyp`, the
     * major brand is bytes 8..11.
     */
    private fun isoBrand(header: ByteArray): String? {
        if (header.size < 12 || !matchesAt(header, 4, FTYP_TAG)) return null
        return String(header, 8, 4, Charsets.US_ASCII).lowercase()
    }
}

/**
 * HEIC/GIF → JPEG, for [ReceiptPlan.TranscodeToJpeg] only.
 *
 * Touches `android.graphics`, so it stays out of the pure planner: the decision
 * that a PDF is *never* routed here is unit-tested via [ReceiptFiles.plan], and
 * this function is the thin Android edge that is compile-verified only.
 *
 * @throws IllegalStateException with the server's Vietnamese copy when the bytes
 *   are not a decodable image after all (a `.docx` cannot reach here — the
 *   planner calls it unsupported first).
 */
internal suspend fun transcodeReceiptToJpeg(s: AppStrings, bytes: ByteArray): ByteArray =
    withContext(Dispatchers.Default) {
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            ?: throw IllegalStateException(s.get(ReceiptFiles.UNSUPPORTED_MESSAGE))
        try {
            ByteArrayOutputStream().use { out ->
                // Quality 90 keeps receipt text (the whole point of the scan)
                // legible to the model while staying far under the 5 MB cap.
                if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)) {
                    throw IllegalStateException(s.get(ReceiptFiles.UNSUPPORTED_MESSAGE))
                }
                out.toByteArray()
            }
        } finally {
            bitmap.recycle()
        }
    }
