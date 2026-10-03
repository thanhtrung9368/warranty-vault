package com.warrantyvault.app.share

import com.warrantyvault.app.share.ShareTarget.Delivery
import com.warrantyvault.app.share.ShareTarget.Payload
import com.warrantyvault.app.share.ShareTarget.Product
import com.warrantyvault.app.share.ShareTarget.Reason
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The share target's brain (FEATURE_IDEAS #10), tested as plain JVM code — no
 * Robolectric, no Android types anywhere in `ShareTarget`.
 *
 * Two things are pinned here:
 *
 *  1. what counts as a product link in the mess a share sheet hands over
 *     (title + URL, URL + chatter, several URLs, punctuation, or nothing at
 *     all), and
 *  2. that a *redelivered* intent — the same one Android hands to `onCreate`
 *     after a rotation or a process-death restore — is ignored, which is the
 *     classic double-fire bug of this feature.
 */
class ShareTargetTest {

    private fun share(text: String?, subject: String? = null): Payload =
        Payload(action = ShareTarget.ACTION_SEND, type = "text/plain", text = text, subject = subject)

    private fun captured(payload: Payload): Product {
        val delivery = ShareTarget.deliver(payload, fromSavedState = false)
        assertTrue("expected a capture, got $delivery", delivery is Delivery.Captured)
        return (delivery as Delivery.Captured).product
    }

    private fun reason(payload: Payload): Reason {
        val delivery = ShareTarget.deliver(payload, fromSavedState = false)
        assertTrue("expected a rejection, got $delivery", delivery is Delivery.Rejected)
        return (delivery as Delivery.Rejected).reason
    }

    // ---- the shapes a share actually arrives in -----------------------------

    @Test
    fun aBareUrlIsCapturedWithNoName() {
        // Nothing to name the product with, and inventing a host name would be
        // a lie the form then saves.
        val product = captured(share("https://shopee.vn/product/123"))
        assertEquals("https://shopee.vn/product/123", product.buyUrl)
        assertNull(product.name)
    }

    @Test
    fun aUrlSurroundedByTextKeepsTheTextAsTheName() {
        val product = captured(share("Cái này đẹp nè https://shopee.vn/product/9 mua đi"))
        assertEquals("https://shopee.vn/product/9", product.buyUrl)
        assertEquals("Cái này đẹp nè mua đi", product.name)
    }

    @Test
    fun titleThenUrlIsTheCommonShapeAndKeepsOnlyTheTitle() {
        // What Shopee/Lazada actually send: product title, newline, link.
        val product = captured(share("Tai nghe Bluetooth ABC\nhttps://shopee.vn/product/123?smtt=0.1"))
        assertEquals("https://shopee.vn/product/123?smtt=0.1", product.buyUrl)
        assertEquals("Tai nghe Bluetooth ABC", product.name)
    }

    @Test
    fun theShareSubjectIsTheFallbackName() {
        // Chrome's shape: the link in EXTRA_TEXT, the page title in
        // EXTRA_SUBJECT. Nothing is invented, the subject is simply read too.
        val product = captured(
            share("https://shopee.vn/product/777", subject = "Ốp lưng iPhone 15"),
        )
        assertEquals("https://shopee.vn/product/777", product.buyUrl)
        assertEquals("Ốp lưng iPhone 15", product.name)
    }

    @Test
    fun aUrlOnlyInTheSubjectIsStillFound() {
        val product = captured(
            share("Xem món này", subject = "https://lazada.vn/products/abc"),
        )
        assertEquals("https://lazada.vn/products/abc", product.buyUrl)
        assertEquals("Xem món này", product.name)
    }

    @Test
    fun multipleUrlsTakeTheFirstAndLeaveNoUrlInTheName() {
        val first = captured(share("https://shopee.vn/a https://lazada.vn/b"))
        assertEquals("https://shopee.vn/a", first.buyUrl)
        // Every URL is cut out of the name, not just the chosen one — a second
        // raw link in the "Tên sản phẩm" box would be noise.
        assertNull(first.name)

        val compared = captured(share("So sánh https://shopee.vn/a với https://lazada.vn/b nhé"))
        assertEquals("https://shopee.vn/a", compared.buyUrl)
        assertEquals("So sánh với nhé", compared.name)
    }

    @Test
    fun trailingPunctuationBelongsToTheSentenceNotToTheLink() {
        val product = captured(share("Xem: https://shopee.vn/product/123."))
        assertEquals("https://shopee.vn/product/123", product.buyUrl)
        assertEquals("Xem", product.name)

        val wrapped = captured(share("Link (https://shopee.vn/product/123)"))
        assertEquals("https://shopee.vn/product/123", wrapped.buyUrl)

        val quoted = captured(share("\"https://shopee.vn/product/123\","))
        assertEquals("https://shopee.vn/product/123", quoted.buyUrl)
    }

    @Test
    fun balancedBracketsInsideAUrlSurvive() {
        // The peel-off rule above must not eat a real trailing parenthesis.
        val product = captured(share("https://en.wikipedia.org/wiki/Phone_(model)"))
        assertEquals("https://en.wikipedia.org/wiki/Phone_(model)", product.buyUrl)
    }

    @Test
    fun trackingParametersAreKeptVerbatim() {
        // The same product, shared by an app that decorates the link. The query
        // string is part of the link the user copied: truncating at "?" would
        // store a different URL than the one they saw, and the parameters must
        // not leak into the name either.
        val bare = "https://shopee.vn/product/1"
        val tracked = "$bare?sp_atk=abc&utm_source=share&utm_medium=android"

        assertEquals(bare, captured(share(bare)).buyUrl)
        assertEquals(tracked, captured(share(tracked)).buyUrl)

        val titled = captured(share("Sạc dự phòng 20000mAh\n$tracked"))
        assertEquals(tracked, titled.buyUrl)
        assertEquals("Sạc dự phòng 20000mAh", titled.name)
    }

    @Test
    fun aUrlWrappedInAngleBracketsIsUnwrappedAndNamesNothing() {
        val product = captured(share("<https://shopee.vn/product/123>"))
        assertEquals("https://shopee.vn/product/123", product.buyUrl)
        assertNull(product.name)
    }

    // ---- the cases that must not pretend to work ----------------------------

    @Test
    fun textWithNoUrlIsRejectedAsNoLink() {
        assertEquals(Reason.NO_LINK, reason(share("Mua cái này đi")))
        assertEquals(Reason.NO_LINK, reason(share("")))
        assertEquals(Reason.NO_LINK, reason(share(null)))
        // Prose that merely looks like it has a colon in it is still no link.
        assertEquals(Reason.NO_LINK, reason(share("Ghi chú: để mai tính")))
    }

    @Test
    fun aNonHttpSchemeIsRejectedAsUnsupported() {
        assertEquals(Reason.UNSUPPORTED_SCHEME, reason(share("ftp://files.example.com/receipt.pdf")))
        assertEquals(Reason.UNSUPPORTED_SCHEME, reason(share("mailto:shop@example.com")))
        assertEquals(Reason.UNSUPPORTED_SCHEME, reason(share("intent://scan/#Intent;scheme=zxing;end")))
        // A link we cannot use *with* the title the sender wrote is still a
        // link we cannot use.
        assertEquals(
            Reason.UNSUPPORTED_SCHEME,
            reason(share("Hoá đơn\nftp://files.example.com/receipt.pdf")),
        )
    }

    @Test
    fun theTwoRejectionsCarryDifferentVietnameseMessages() {
        val noLink = ShareTarget.message(Reason.NO_LINK)
        val scheme = ShareTarget.message(Reason.UNSUPPORTED_SCHEME)
        assertTrue(noLink.isNotBlank())
        assertTrue(scheme.isNotBlank())
        assertNotEquals(noLink, scheme)
    }

    // ---- the duplicate-intent rule ------------------------------------------

    @Test
    fun aNewShareIsCapturedAndARedeliveredOneIsIgnored() {
        val payload = share("Tai nghe\nhttps://shopee.vn/product/123")

        // Cold start / onNewIntent: a real share.
        assertEquals(
            Delivery.Captured(Product("https://shopee.vn/product/123", "Tai nghe")),
            ShareTarget.deliver(payload, fromSavedState = false),
        )

        // Rotation, dark-mode switch or process-death restore: `onCreate` runs
        // again with the very same intent. Acting on it would reopen the form
        // over whatever the user was doing and throw away what they had typed.
        assertEquals(
            Delivery.Ignored,
            ShareTarget.deliver(payload, fromSavedState = true),
        )
    }

    @Test
    fun aRedeliveredBadShareDoesNotEvenToastAgain() {
        // The guard is checked first on purpose: after a rotation a rejection
        // must not pop up a second time either.
        assertEquals(
            Delivery.Ignored,
            ShareTarget.deliver(share("Mua cái này đi"), fromSavedState = true),
        )
    }

    @Test
    fun onlyActionSendTextPlainIsOurShare() {
        // The launcher entry (and the notification's PendingIntent) reach the
        // same activity — they must never be read as a share.
        assertEquals(
            Delivery.Ignored,
            ShareTarget.deliver(share("https://shopee.vn/x").copy(action = "android.intent.action.MAIN"), false),
        )
        assertEquals(Delivery.Ignored, ShareTarget.deliver(null, fromSavedState = false))
        assertEquals(
            Delivery.Ignored,
            ShareTarget.deliver(share("https://shopee.vn/x").copy(type = "image/*"), false),
        )
        assertEquals(
            Delivery.Ignored,
            ShareTarget.deliver(share("https://shopee.vn/x").copy(type = null), false),
        )
    }

    @Test
    fun aCharsetParameterOnTheMimeTypeIsStillPlainText() {
        // Some senders declare `text/plain;charset=utf-8`; the intent filter
        // still routes it here, so it must not be dropped as "not a share".
        val product = captured(share("https://shopee.vn/x").copy(type = "text/plain; charset=utf-8"))
        assertEquals("https://shopee.vn/x", product.buyUrl)
    }

    @Test
    fun uppercaseSchemesAreAccepted() {
        assertEquals("HTTPS://Shopee.vn/product/1", captured(share("HTTPS://Shopee.vn/product/1")).buyUrl)
    }
}
