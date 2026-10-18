package com.warrly.share

import com.warrly.share.ShareTarget.Delivery
import com.warrly.share.ShareTarget.FileShare
import com.warrly.share.ShareTarget.Payload
import com.warrly.share.ShareTarget.Product
import com.warrly.share.ShareTarget.Reason
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The share target's brain, tested as plain JVM code — no Robolectric, no
 * Android types anywhere in `ShareTarget`.
 *
 * Three things are pinned here:
 *
 *  1. what counts as a product link in the mess a share sheet hands over
 *     (title + URL, URL + chatter, several URLs, punctuation, or nothing at
 *     all), and that the widened filter did **not** move `text/plain` off the
 *     wishlist path;
 *  2. that a photo/PDF becomes a file capture with its URI untouched, while a
 *     missing stream, a multi-stream intent and an unsupported file type are
 *     rejected with their own reason instead of being swallowed; and
 *  3. that a *redelivered* intent — the same one Android hands to `onCreate`
 *     after a rotation or a process-death restore — is ignored, which is the
 *     classic double-fire bug of this feature (and would re-read a URI whose
 *     grant is no longer valid).
 */
class ShareTargetTest {

    private fun share(text: String?, subject: String? = null): Payload =
        Payload(action = ShareTarget.ACTION_SEND, type = "text/plain", text = text, subject = subject)

    /** A file-shaped share; the stream defaults to a realistic content URI. */
    private fun fileShare(
        mime: String,
        stream: String? = "content://media/external/images/media/42",
        count: Int = if (stream == null) 0 else 1,
    ): Payload = Payload(
        action = ShareTarget.ACTION_SEND,
        type = mime,
        text = null,
        subject = null,
        stream = stream,
        streamCount = count,
    )

    private fun captured(payload: Payload): Product {
        val delivery = ShareTarget.deliver(payload, fromSavedState = false)
        assertTrue("expected a capture, got $delivery", delivery is Delivery.Captured)
        return (delivery as Delivery.Captured).product
    }

    private fun capturedFile(payload: Payload): FileShare {
        val delivery = ShareTarget.deliver(payload, fromSavedState = false)
        assertTrue("expected a file capture, got $delivery", delivery is Delivery.CapturedFile)
        return (delivery as Delivery.CapturedFile).file
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

    // ---- the text/plain contract that must not regress ----------------------

    @Test
    fun plainTextStillGoesToTheWishlistEvenWhenTheFilterNowAcceptsFiles() {
        // The regression this whole feature could cause: widening the manifest
        // must not move a working text share off the wishlist path. The sender
        // and the extraction are exactly the old ones.
        assertEquals(
            Delivery.Captured(Product("https://shopee.vn/product/123", "Tai nghe")),
            ShareTarget.deliver(
                Payload(
                    action = ShareTarget.ACTION_SEND,
                    type = "text/plain",
                    text = "Tai nghe\nhttps://shopee.vn/product/123",
                    subject = null,
                ),
                fromSavedState = false,
            ),
        )
    }

    @Test
    fun aTextShareThatAlsoCarriesAStreamIsStillAWishlistLink() {
        // Some browsers attach the page's share-target metadata as EXTRA_STREAM
        // even for a text/plain share. The MIME type decides the destination:
        // text stays text; reading the stream would silently turn a product
        // link into a receipt.
        val product = captured(
            share("Tai nghe\nhttps://shopee.vn/product/123").copy(
                stream = "content://com.example.share/preview",
                streamCount = 1,
            ),
        )
        assertEquals("https://shopee.vn/product/123", product.buyUrl)
        assertEquals("Tai nghe", product.name)
    }

    @Test
    fun textPlainWithNoLinkStillGetsTheOldNoLinkRejection() {
        assertEquals(Reason.NO_LINK, reason(share("Mua cái này đi")))
        assertEquals(Reason.NO_LINK, reason(share("")))
        assertEquals(Reason.NO_LINK, reason(share(null)))
        // Prose that merely looks like it has a colon in it is still no link.
        assertEquals(Reason.NO_LINK, reason(share("Ghi chú: để mai tính")))
    }

    @Test
    fun textPlainWithAForeignSchemeStillGetsTheOldSchemeRejection() {
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

    // ---- photos / PDFs go to the inbox -------------------------------------

    @Test
    fun aPhotoBecomesAFileCaptureWithItsUriUntouched() {
        val file = capturedFile(fileShare("image/jpeg"))
        assertEquals("content://media/external/images/media/42", file.uri)
        assertEquals("image/jpeg", file.mimeType)
    }

    @Test
    fun aWildcardImageTypeIsCapturedForTheResolverToConcretise() {
        // Some senders only know they are sharing an image. The reader asks the
        // ContentResolver for the concrete type; the decision here must not
        // throw the share away because the intent said `image/*`.
        val file = capturedFile(fileShare("image/*"))
        assertEquals("image/*", file.mimeType)
    }

    @Test
    fun aPdfBecomesAFileCapture() {
        val file = capturedFile(fileShare("application/pdf"))
        assertEquals("application/pdf", file.mimeType)
        assertEquals("content://media/external/images/media/42", file.uri)
    }

    @Test
    fun mimeParametersAndCaseAreNormalisedOnTheCapturedFile() {
        val file = capturedFile(fileShare("IMAGE/PNG; name=hoa-don.png", stream = "content://x/1"))
        assertEquals("image/png", file.mimeType)
    }

    @Test
    fun anImageOrPdfWithoutAStreamIsRejectedNotIgnored() {
        assertEquals(Reason.FILE_WITHOUT_STREAM, reason(fileShare("image/jpeg", stream = null)))
        assertEquals(Reason.FILE_WITHOUT_STREAM, reason(fileShare("application/pdf", stream = "  ")))
    }

    @Test
    fun severalFilesAreRejectedBecauseOnlyOneIsSupported() {
        assertEquals(
            Reason.MULTIPLE_FILES,
            reason(fileShare("image/jpeg", stream = "content://x/1", count = 2)),
        )
        assertEquals(
            Reason.MULTIPLE_FILES,
            reason(fileShare("application/pdf", stream = "content://x/1", count = 3)),
        )
    }

    @Test
    fun unsupportedFileTypesAreRejectedWithTheirOwnReason() {
        // The .docx case from the brief: not a silent drop.
        val docx =
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        assertEquals(Reason.UNSUPPORTED_FILE_TYPE, reason(fileShare(docx)))
        assertEquals(Reason.UNSUPPORTED_FILE_TYPE, reason(fileShare("application/octet-stream")))
        assertEquals(Reason.UNSUPPORTED_FILE_TYPE, reason(fileShare("video/mp4")))
        assertEquals(Reason.UNSUPPORTED_FILE_TYPE, reason(fileShare("text/html")))
        assertEquals(Reason.UNSUPPORTED_FILE_TYPE, reason(fileShare("*/*")))
        // No MIME at all is not a supported share either.
        assertEquals(Reason.UNSUPPORTED_FILE_TYPE, reason(share("https://shopee.vn/x").copy(type = null)))
    }

    @Test
    fun onlyTheServerWhitelistIsStorable() {
        // `image/*` lets a BMP/SVG through the OS chooser; these are the types
        // the Activity accepts after the ContentResolver reports the real one.
        for (mime in listOf(
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif",
            "image/heic",
            "image/heif",
            "image/heic-sequence",
            "image/heif-sequence",
            "application/pdf",
        )) {
            assertTrue("$mime should be storable", ShareTarget.isStorableFileMime(mime))
        }
        for (mime in listOf(
            "image/bmp",
            "image/svg+xml",
            "image/tiff",
            "image/*",
            "application/octet-stream",
            "application/zip",
            null,
        )) {
            assertFalse("$mime should not be storable", ShareTarget.isStorableFileMime(mime))
        }
    }

    // ---- rejection copy -----------------------------------------------------

    @Test
    fun everyRejectionCarriesItsOwnNonBlankVietnameseMessage() {
        val messages = Reason.values().map(ShareTarget::message)
        messages.forEach { assertTrue(it, it.isNotBlank()) }
        // The Activity maps Reason → a resource; a copy-paste that gives two
        // reasons the same sentence would make .docx look like "no link".
        assertEquals("every reason needs its own sentence", messages.size, messages.toSet().size)
        assertNotEquals(ShareTarget.MESSAGE_UNSUPPORTED_FILE_TYPE, ShareTarget.MESSAGE_NO_LINK)
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
    fun aRedeliveredFileShareDoesNotReadTheUriAgain() {
        // The grant may be gone by the time a recreated activity sees the same
        // intent; the guard must return Ignored before anything is read.
        assertEquals(
            Delivery.Ignored,
            ShareTarget.deliver(fileShare("image/jpeg"), fromSavedState = true),
        )
        assertEquals(
            Delivery.Ignored,
            ShareTarget.deliver(fileShare("application/pdf"), fromSavedState = true),
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
        assertEquals(
            Delivery.Ignored,
            ShareTarget.deliver(fileShare("application/octet-stream"), fromSavedState = true),
        )
    }

    @Test
    fun notAShareIsIgnored() {
        // The launcher entry (and the notification's PendingIntent) reach the
        // same activity — they must never be read as a share. ACTION_SEND_MULTIPLE
        // is ignored too: the manifest does not advertise it, and this code only
        // ever reads one stream.
        assertEquals(
            Delivery.Ignored,
            ShareTarget.deliver(share("https://shopee.vn/x").copy(action = "android.intent.action.MAIN"), false),
        )
        assertEquals(Delivery.Ignored, ShareTarget.deliver(null, fromSavedState = false))
        assertEquals(
            Delivery.Ignored,
            ShareTarget.deliver(
                fileShare("image/jpeg").copy(action = ShareTarget.ACTION_SEND_MULTIPLE),
                fromSavedState = false,
            ),
        )
        assertEquals(
            Delivery.Ignored,
            ShareTarget.deliver(
                fileShare("application/pdf").copy(action = ShareTarget.ACTION_SEND_MULTIPLE),
                fromSavedState = false,
            ),
        )
    }

    @Test
    fun baseMimeStripsParametersAndCase() {
        assertEquals("text/plain", ShareTarget.baseMime("text/plain; charset=utf-8"))
        assertEquals("application/pdf", ShareTarget.baseMime(" Application/PDF "))
        assertNull(ShareTarget.baseMime(null))
        assertNull(ShareTarget.baseMime("  "))
        assertNull(ShareTarget.baseMime(";charset=utf-8"))
    }
}
