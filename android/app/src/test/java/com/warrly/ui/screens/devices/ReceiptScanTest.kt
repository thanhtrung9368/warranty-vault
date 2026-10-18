package com.warrly.ui.screens.devices

import com.warrly.i18n.ResCatalog
import com.warrly.network.ApiClient
import com.warrly.network.ExtractReceiptInput
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The receipt-scan rules that must stay right for search to work.
 *
 * The feature's whole point is that the OCR transcript is **persisted**: only the
 * `attachmentId` branch of `POST /api/v1/ai/extract-receipt` has an Attachment
 * row to write it to, so the client uploads first and then sends exactly
 * `{"attachmentId":"…"}`. A test here pins that wire shape, and the other two
 * pin the honest-UI sentences around the upload that happens before the user
 * commits to saving anything.
 *
 * Pure JVM: no Compose, no network, no Robolectric — the screen is not what is
 * being tested, the decisions it renders are.
 */
class ReceiptScanTest {

    private val vi = ResCatalog.vietnamese()
    private val en = ResCatalog.english()

    // ---- the extract-input shape ------------------------------------------

    /**
     * The id from the upload response is the body — one key, no multipart
     * leftovers. The server accepts `attachmentId` and nothing else on this
     * branch, and `encodeDefaults = true` guarantees the key is present even
     * when it equals its default.
     */
    @Test
    fun theExtractCallIsAJsonBodyWithTheUploadedAttachmentId() {
        val input = extractReceiptInput(" att-1 ")

        assertEquals(ExtractReceiptInput("att-1"), input)
        assertEquals(
            """{"attachmentId":"att-1"}""",
            ApiClient.json.encodeToString(ExtractReceiptInput.serializer(), input!!),
        )
    }

    /**
     * A missing/blank id is missing data, not a real attachment: sending it
     * would produce a 404 and no draft. The caller surfaces a localized error
     * instead of firing that request.
     */
    @Test
    fun aMissingOrBlankUploadIdNeverBecomesARequest() {
        assertNull(extractReceiptInput(null))
        assertNull(extractReceiptInput(""))
        assertNull(extractReceiptInput("   "))
    }

    // ---- the note under the draft -----------------------------------------

    /**
     * The note has to say three things: the file is already in the inbox, it
     * exists regardless of this form, and whether its text really is
     * searchable. The last one comes from `extractedTextStored`; claiming
     * "searchable" when the best-effort write failed is the one lie that would
     * burn the user later.
     */
    @Test
    fun theNoteSaysTheFileIsInTheInboxAndWhetherSearchWillFindIt() {
        assertEquals(
            "This receipt is already saved in your inbox, and its text is searchable. " +
                "Saving this device does not file it — open the Inbox to file or delete it.",
            receiptInboxNotice(en, extractedTextStored = true),
        )
        assertEquals(
            "Hoá đơn này đã được lưu trong hộp thư và văn bản của nó tìm kiếm được. " +
                "Lưu thiết bị không gắn tệp vào máy — mở Hộp thư để gắn hoặc xoá.",
            receiptInboxNotice(vi, extractedTextStored = true),
        )
    }

    @Test
    fun theNoteAdmitsWhenTheTranscriptWasNotStored() {
        assertEquals(
            "This receipt is already saved in your inbox, but its text could not be saved, " +
                "so a search will not find it. Saving this device does not file it — " +
                "open the Inbox to file or delete it.",
            receiptInboxNotice(en, extractedTextStored = false),
        )
        assertEquals(
            "Hoá đơn này đã được lưu trong hộp thư nhưng chưa lưu được văn bản nên tìm kiếm " +
                "sẽ không thấy. Lưu thiết bị không gắn tệp vào máy — mở Hộp thư để gắn hoặc xoá.",
            receiptInboxNotice(vi, extractedTextStored = false),
        )
    }

    // ---- the orphan decision, in words ------------------------------------

    /**
     * Extraction failed after the upload. The flow tried to delete the fresh
     * inbox item; these are the two possible outcomes, and both keep the
     * failure's own detail at the front so the user still learns WHY the scan
     * failed. A screen that silently dropped the file, or silently kept it,
     * would be the bug this feature was asked to avoid.
     */
    @Test
    fun aFailedScanSaysWhatHappenedToTheFileItJustUploaded() {
        assertEquals(
            "Scan failed: Máy chủ đang bận The receipt that was uploaded for this scan " +
                "has been deleted, so nothing extra is left in your inbox.",
            receiptScanFailureMessage(en, "Máy chủ đang bận", ReceiptCleanup.DELETED),
        )
        assertEquals(
            "Quét hoá đơn không thành công: Máy chủ đang bận Tệp vừa tải lên cho lần quét " +
                "này đã được xoá nên hộp thư không bị thừa.",
            receiptScanFailureMessage(vi, "Máy chủ đang bận", ReceiptCleanup.DELETED),
        )
    }

    @Test
    fun aFailedCleanupSaysTheFileMayStillBeInTheInbox() {
        assertEquals(
            "Scan failed: Máy chủ đang bận The uploaded receipt could not be deleted and " +
                "may still be in your inbox — open the Inbox to file or remove it.",
            receiptScanFailureMessage(en, "Máy chủ đang bận", ReceiptCleanup.LEFT_IN_INBOX),
        )
        assertEquals(
            "Quét hoá đơn không thành công: Máy chủ đang bận Không xoá được tệp vừa tải lên — " +
                "tệp có thể vẫn nằm trong hộp thư, mở Hộp thư để gắn hoặc xoá.",
            receiptScanFailureMessage(vi, "Máy chủ đang bận", ReceiptCleanup.LEFT_IN_INBOX),
        )
    }
}
