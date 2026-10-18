package com.warrly.ui.screens.inbox

import com.warrly.i18n.ResCatalog
import com.warrly.network.ApiClient
import com.warrly.testing.Fixtures
import com.warrly.testing.httpError
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The capture-first inbox rules — the pure half.
 *
 * What is pinned here is the part that would be a bug rather than a styling
 * choice:
 *
 *  * **unfiled means `deviceId == null`** — the inbox's whole definition;
 *  * the badge counts unfiled rows and returns `null` (draw nothing) at zero;
 *  * **409 + `LIMIT_REACHED`** is the only combination that means "device full";
 *  * the full-device sentence names the device, the five-file cap and both ways
 *    out, in both languages.
 *
 * The screen itself is not tested: this module has no instrumentation tests and
 * no Robolectric, so nothing here proves where the dialog sits or how the
 * thumbnail renders. It proves the rules the screen is built on.
 */
class InboxRulesTest {

    private val vi = ResCatalog.vietnamese()
    private val en = ResCatalog.english()

    // ---- unfiled ----------------------------------------------------------

    /**
     * The definition of the inbox, and the only field it looks at. A blank id is
     * missing data rather than a device, so it counts as unfiled; a real id is
     * filed even if some stale request includes it in an inbox response.
     */
    @Test
    fun anAttachmentIsUnfiledExactlyWhenItHasNoDevice() {
        assertTrue("no deviceId = inbox", isUnfiled(Fixtures.attachment()))
        assertTrue("blank is missing data, not a device", isUnfiled(Fixtures.attachment(deviceId = "")))
        assertTrue("whitespace only", isUnfiled(Fixtures.attachment(deviceId = "   ")))
        assertFalse(isUnfiled(Fixtures.attachment(deviceId = "dev-1")))
    }

    // ---- badge ------------------------------------------------------------

    /**
     * The nav badge: `null` rather than `0` when there is nothing to show, so
     * the shell can leave the bubble off. `0` would read as a task ("0 việc").
     */
    @Test
    fun theBadgeCountIsNullWhenThereIsNothingToFile() {
        assertNull(inboxBadgeCount(emptyList()))
        assertNull(
            "a filed attachment is not inbox work",
            inboxBadgeCount(listOf(Fixtures.attachment(deviceId = "dev-1"))),
        )
    }

    @Test
    fun theBadgeCountsOnlyUnfiledRows() {
        val rows = listOf(
            Fixtures.attachment(id = "a1"),
            Fixtures.attachment(id = "a2", deviceId = ""),
            Fixtures.attachment(id = "a3", deviceId = "dev-1"),
        )
        assertEquals(2, inboxBadgeCount(rows))
        assertEquals(1, inboxBadgeCount(rows.take(1)))
    }

    /**
     * A four-digit bubble would be wider than the icon it sits on. The cap is a
     * display rule only: the count used for the decision stays exact.
     */
    @Test
    fun theBadgeLabelCapsAtNinetyNine() {
        assertEquals("0", inboxBadgeLabel(0))
        assertEquals("1", inboxBadgeLabel(1))
        assertEquals("99", inboxBadgeLabel(99))
        assertEquals("99+", inboxBadgeLabel(100))
        assertEquals("99+", inboxBadgeLabel(12_345))
        assertEquals("0", inboxBadgeLabel(-1))
    }

    // ---- the device cap ---------------------------------------------------

    @Test
    fun aDeviceIsFullAtTheServersFiveFileCap() {
        assertFalse(inboxDeviceIsFull(Fixtures.device(attachmentCount = 0)))
        assertFalse(inboxDeviceIsFull(Fixtures.device(attachmentCount = 4)))
        assertTrue("four is fine, five is the documented cap", inboxDeviceIsFull(Fixtures.device(attachmentCount = 5)))
        assertTrue("a stale over-count still reads as full", inboxDeviceIsFull(Fixtures.device(attachmentCount = 9)))
    }

    // ---- 409 mapping ------------------------------------------------------

    /**
     * Both wire facts are required: the status **and** the machine code. A 409
     * for another conflict is not a full device, and a `LIMIT_REACHED` code on a
     * different status is not the documented contract.
     *
     * The code is accepted in either case: the contract names it
     * `LIMIT_REACHED`, while the Go envelope lowercases service codes and the
     * handler test pins `limit_reached` as the real byte. Both must work, or the
     * full-device dialog never appears against the actual server.
     */
    @Test
    fun onlyTheDocumented409AndCodeMeanDeviceFull() {
        assertEquals(InboxFileFailure.DEVICE_FULL, inboxFileFailure(409, LIMIT_REACHED))
        assertEquals(InboxFileFailure.DEVICE_FULL, inboxFileFailure(409, "limit_reached"))
        assertEquals(InboxFileFailure.OTHER, inboxFileFailure(409, "conflict"))
        assertEquals(InboxFileFailure.OTHER, inboxFileFailure(409, null))
        assertEquals(InboxFileFailure.OTHER, inboxFileFailure(409, "limit_reach"))
        assertEquals(InboxFileFailure.OTHER, inboxFileFailure(400, LIMIT_REACHED))
        assertEquals(InboxFileFailure.OTHER, inboxFileFailure(null, LIMIT_REACHED))
    }

    /**
     * The adapter over Retrofit's exception reads the code out of the standard
     * error envelope — the exact path a real 409 takes. It also captures the
     * server's message in the same pass: the body is one-shot, so a later
     * `toUserMessage` would otherwise see nothing.
     *
     * The body here is the server's actual shape (`limit_reached`, lowercase),
     * not the contract's spelling.
     */
    @Test
    fun theThrowableAdapterReadsTheCodeAndTheMessageFromTheEnvelope() {
        val full = inboxFileError(
            httpError(409, """{"error":"limit_reached","message":"Tối đa 5 file/thiết bị"}"""),
            ApiClient.json,
        )
        assertEquals(InboxFileFailure.DEVICE_FULL, full.failure)
        assertEquals("Tối đa 5 file/thiết bị", full.serverMessage)

        // The contract's own spelling works too; only the status/code pair matters.
        assertEquals(
            InboxFileFailure.DEVICE_FULL,
            inboxFileError(
                httpError(409, """{"error":"LIMIT_REACHED"}"""),
                ApiClient.json,
            ).failure,
        )

        val other = inboxFileError(
            httpError(409, """{"error":"conflict","message":"Không gán được"}"""),
            ApiClient.json,
        )
        assertEquals(InboxFileFailure.OTHER, other.failure)
        assertEquals(
            "the message survives the same read that found the code",
            "Không gán được",
            other.serverMessage,
        )

        assertEquals(
            InboxFileError(InboxFileFailure.OTHER, null),
            inboxFileError(IOException("offline"), ApiClient.json),
        )
    }

    // ---- the 409 sentence -------------------------------------------------

    /**
     * The sentence is the point of the mapping: it must name the device, the
     * five-file cap and both ways out — "pick another device, or delete the
     * receipt". The server's own 409 explains the conflict but not the exit.
     */
    @Test
    fun theDeviceFullSentenceNamesTheDeviceTheLimitAndBothWaysOut() {
        assertEquals(
            "iPhone 15 đã có 5 tệp nên hoá đơn này chưa được gán. " +
                "Chọn thiết bị khác, hoặc xoá hoá đơn này.",
            inboxFileFailureMessage(vi, InboxFileFailure.DEVICE_FULL, "iPhone 15"),
        )
        assertEquals(
            "iPhone 15 already has 5 files, so this receipt was not assigned. " +
                "Pick another device, or delete the receipt.",
            inboxFileFailureMessage(en, InboxFileFailure.DEVICE_FULL, "iPhone 15"),
        )
    }

    /**
     * Anything else has no client sentence: the server's translated `message`
     * (or the transport fallback) is shown instead, never a second guess.
     */
    @Test
    fun theOtherFailureHasNoClientSentence() {
        assertNull(inboxFileFailureMessage(vi, InboxFileFailure.OTHER, "iPhone 15"))
        assertNull(inboxFileFailureMessage(en, InboxFileFailure.OTHER, "iPhone 15"))
    }

    // ---- upload time ------------------------------------------------------

    /**
     * `dd/MM/yyyy`, the app's one date convention, and `null` for anything the
     * server did not send — a row without a date is honest; a made-up one is not.
     */
    @Test
    fun theUploadedLineUsesTheAppDateConventionAndGivesUpOnMalformedInput() {
        assertEquals("Tải lên 02/01/2025", inboxUploadedLabel(vi, "2025-01-02T03:04:05"))
        assertEquals("Uploaded 02/01/2025", inboxUploadedLabel(en, "2025-01-02T03:04:05Z"))
        assertNull(inboxUploadedLabel(vi, null))
        assertNull(inboxUploadedLabel(en, ""))
        assertNull(inboxUploadedLabel(en, "not-a-date"))
        assertNull(inboxUploadedLabel(vi, "2025-1-2T00:00:00"))
    }
}
