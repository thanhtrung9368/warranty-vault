package com.warrantyvault.app.share

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The mailbox between the share intent and the wishlist form. Its one real job
 * is the logged-out case: a link shared while the user is on the login screen
 * has to still be there when the signed-in shell appears, and picking it up
 * must never eat a *newer* share that arrived in the meantime.
 */
class ShareIntakeTest {

    private val first = ShareTarget.Product("https://shopee.vn/product/1", "Tai nghe")
    private val second = ShareTarget.Product("https://lazada.vn/products/2", "Sạc dự phòng")

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
}
