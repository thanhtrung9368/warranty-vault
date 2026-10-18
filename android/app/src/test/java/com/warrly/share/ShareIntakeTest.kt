package com.warrly.share

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The mailbox between the share intent and the screens that can show it. Its
 * one real job is the logged-out case: a share taken while the user is on the
 * login screen has to still be there when the signed-in shell appears, and
 * picking it up must never eat a *newer* share that arrived in the meantime.
 *
 * Since the filter also accepts photos/PDFs there are two mailboxes; the last
 * share of either kind wins, because the user's last action is the one they
 * meant and two stacked destinations would be worse than one.
 */
class ShareIntakeTest {

    private val first = ShareTarget.Product("https://shopee.vn/product/1", "Tai nghe")
    private val second = ShareTarget.Product("https://lazada.vn/products/2", "Sạc dự phòng")
    private val firstFile = SharedFile("hoa-don.jpg", "image/jpeg", byteArrayOf(1, 2, 3))
    private val secondFile = SharedFile("bao-hanh.pdf", "application/pdf", byteArrayOf(4, 5))

    @Test
    fun aHeldLinkWaitsUntilSomethingTakesIt() {
        val intake = ShareIntake()
        assertNull(intake.pending.value)

        // Shared on the login screen: parked, not lost.
        intake.hold(first)
        assertEquals(first, intake.pending.value)

        // The form shows it and acknowledges — now the mailbox is empty, so a
        // recomposition cannot open the sheet a second time.
        intake.consume(first)
        assertNull(intake.pending.value)
    }

    @Test
    fun theLastShareWins() {
        val intake = ShareIntake()
        intake.hold(first)
        intake.hold(second)

        // Two stacked forms would be worse than one; the user's last action is
        // the one they meant.
        assertEquals(second, intake.pending.value)
    }

    @Test
    fun consumingAnOlderLinkDoesNotEatANewerOne() {
        val intake = ShareIntake()
        intake.hold(second)

        // The first link was already shown (its consumer ran late, or it was
        // consumed twice). It must not clear the link that replaced it.
        intake.consume(first)
        assertEquals(second, intake.pending.value)

        intake.consume(second)
        assertNull(intake.pending.value)
    }

    @Test
    fun consumingTwiceIsHarmless() {
        val intake = ShareIntake()
        intake.hold(first)
        intake.consume(first)
        intake.consume(first)
        assertNull(intake.pending.value)
    }

    // ---- the file mailbox ---------------------------------------------------

    @Test
    fun aHeldFileWaitsUntilSomethingSavesOrDiscardsIt() {
        val intake = ShareIntake()
        assertNull(intake.pendingFile.value)

        // The Activity copied the bytes before the URI grant could expire and
        // parked them here; the user is still on the login screen.
        intake.hold(firstFile)
        assertEquals(firstFile, intake.pendingFile.value)

        // Confirmed (or explicitly discarded) on the Inbox screen: the card must
        // not come back on the next recomposition.
        intake.consume(firstFile)
        assertNull(intake.pendingFile.value)
    }

    @Test
    fun theLastFileWins() {
        val intake = ShareIntake()
        intake.hold(firstFile)
        intake.hold(secondFile)
        assertEquals(secondFile, intake.pendingFile.value)
    }

    @Test
    fun consumingAnOlderFileDoesNotEatANewerOne() {
        val intake = ShareIntake()
        intake.hold(secondFile)

        // A late discard callback from the previous card must be a no-op.
        intake.consume(firstFile)
        assertEquals(secondFile, intake.pendingFile.value)

        intake.consume(secondFile)
        assertNull(intake.pendingFile.value)
    }

    @Test
    fun aNewLinkShareClearsAWaitingFileAndViceVersa() {
        // Whatever the user shared last is the share they meant. Leaving both
        // mailboxes populated would open the wishlist form *and* the inbox
        // confirmation for two different actions.
        val intake = ShareIntake()
        intake.hold(firstFile)
        intake.hold(first)
        assertEquals(first, intake.pending.value)
        assertNull(intake.pendingFile.value)

        intake.hold(secondFile)
        assertEquals(secondFile, intake.pendingFile.value)
        assertNull(intake.pending.value)
    }
}
