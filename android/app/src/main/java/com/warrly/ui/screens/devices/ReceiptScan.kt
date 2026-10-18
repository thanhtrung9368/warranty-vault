package com.warrly.ui.screens.devices

import com.warrly.R
import com.warrly.i18n.AppStrings
import com.warrly.network.ExtractReceiptInput

/**
 * The pure half of the receipt-scan pipeline.
 *
 * Since roadmap #13 the scan is **two network calls, in this order**:
 *
 *  1. `POST /api/v1/attachments` with **no `deviceId`** — the picked image/PDF
 *     becomes an inbox item, so it already has an id the OCR text can live on;
 *  2. `POST /api/v1/ai/extract-receipt` with `{"attachmentId": "<that id>"}` —
 *     the server reads the stored file, returns the draft, and persists the
 *     transcript on the very same Attachment row.
 *
 * The old one-call shape (multipart `file`) still exists in the API, but it has
 * no Attachment row to own the transcript, so it returns
 * `extractedTextStored=false` and the receipt is invisible to search. Android
 * therefore always takes the two-call path — the rule that builds the second
 * call's body is [extractReceiptInput], kept here (rather than inline in the
 * sheet) so the exact wire shape is pinned by a JVM test.
 *
 * The other two rules cover the honest-UI obligations:
 *
 *  * [receiptInboxNotice] — after a successful scan the file is in the inbox
 *    whether or not the user finishes the device form, and it is only
 *    searchable if the server actually stored the transcript;
 *  * [receiptScanFailureMessage] — an upload followed by a failed extraction
 *    must not leave an unexplained file behind. The flow deletes the fresh
 *    upload; if that cleanup itself fails, the sentence says the file is still
 *    in the inbox so the user can find it.
 *
 * Everything here takes plain values and returns plain values, so the tests can
 * pin both languages through `ResCatalog` without Robolectric — the same seam
 * `InboxRules.kt` and `LeadDays.kt` use.
 */

/** What happened to the file that was uploaded just before a failed extraction. */
enum class ReceiptCleanup {
    /** `DELETE /api/v1/attachments/{id}` succeeded — nothing extra is left. */
    DELETED,

    /**
     * The compensating delete failed (offline, 401, 5xx). The file is still a
     * real inbox item; the UI must say so rather than claim it was removed.
     */
    LEFT_IN_INBOX,
}

/**
 * Builds the JSON body of the `attachmentId` branch, or `null` when the upload
 * response carried no usable id (which would make the request invalid).
 *
 * The id is trimmed because it comes from JSON we did not type; an id is never
 * blank on the server, so a blank value is missing data rather than a real row.
 * Deliberately no other property: the endpoint accepts exactly this one key on
 * the JSON branch, and the multipart `file` part must never leak into it.
 */
fun extractReceiptInput(attachmentId: String?): ExtractReceiptInput? =
    attachmentId
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?.let(::ExtractReceiptInput)

/**
 * The line under a successful draft: "the file is in your inbox", plus whether
 * the transcript really made it into search.
 *
 * This is not decoration. Uploading before extracting means the bytes are
 * persisted **before** the user decides to save the device (or abandons the
 * form), so a screen that says only "draft filled in" would be lying by
 * omission about a file the user now owns. The `stored` half comes from
 * `draft.extractedTextStored`: the write is best-effort on the server, and an
 * optimistic "searchable" would be wrong exactly when the user later searches
 * for the receipt and finds nothing.
 */
fun receiptInboxNotice(s: AppStrings, extractedTextStored: Boolean): String =
    s.get(
        if (extractedTextStored) {
            R.string.devadd_receipt_in_inbox_searchable
        } else {
            R.string.devadd_receipt_in_inbox_not_searchable
        },
    )

/**
 * The error shown when the file uploaded but extraction failed.
 *
 * [detail] is the failure's own sentence (the API's translated `message` or the
 * transport fallback), and it stays at the front: the user still needs to know
 * *why* the scan failed. The suffix is the part this client owes them — what
 * happened to the file it just uploaded on their behalf.
 */
fun receiptScanFailureMessage(
    s: AppStrings,
    detail: String,
    cleanup: ReceiptCleanup,
): String = s.get(
    when (cleanup) {
        ReceiptCleanup.DELETED -> R.string.devadd_scan_failed_receipt_deleted
        ReceiptCleanup.LEFT_IN_INBOX -> R.string.devadd_scan_failed_receipt_kept
    },
    detail,
)
