package com.warrantyvault.app.ui.screens.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pins [EmailChangeRules] — ported from
 * `ios/Sources/WarrantyVaultKit/EmailChange.swift::EmailChangeRules`, so the two
 * native clients accept exactly the same pasted text.
 *
 * The rule exists because of a real usability trap: the confirmation email shows
 * both a link and the bare code, and on a phone the LINK is the bigger tap
 * target. Posting the whole URL as the token fails server-side with
 * `invalid_email_change_token` for no good reason.
 */
class EmailChangeRulesTest {

    private val appUrlToken = "https://warrantyvault.app/confirm-email/abc123def456"

    @Test
    fun wholePastedLinkIsReducedToItsToken() {
        assertEquals("abc123def456", EmailChangeRules.tokenFromPasted(appUrlToken))
    }

    @Test
    fun queryStringFragmentAndTrailingSlashAreDropped() {
        assertEquals(
            "abc123def456",
            EmailChangeRules.tokenFromPasted("$appUrlToken?utm_source=email"),
        )
        assertEquals(
            "abc123def456",
            EmailChangeRules.tokenFromPasted("$appUrlToken#top"),
        )
        assertEquals(
            "abc123def456",
            EmailChangeRules.tokenFromPasted("$appUrlToken/"),
        )
        assertEquals(
            "abc123def456",
            EmailChangeRules.tokenFromPasted("\n $appUrlToken?x=1 \n"),
        )
    }

    /**
     * A pasted line often carries whitespace from the mail client's line
     * wrapping. What follows the token in the SAME paste is not part of it.
     */
    @Test
    fun textAfterTheTokenIsNotPartOfTheToken() {
        assertEquals(
            "abc123def456",
            EmailChangeRules.tokenFromPasted("$appUrlToken và bấm nút bên dưới"),
        )
    }

    @Test
    fun bareTokenIsReturnedUntouched() {
        assertEquals("abc123def456", EmailChangeRules.tokenFromPasted("  abc123def456  "))
        assertEquals("abc123def456", EmailChangeRules.tokenFromPasted("abc123def456"))
    }

    /**
     * A token that merely CONTAINS a slash must not be mangled. Only the literal
     * `/confirm-email/` marker starts the URL branch.
     */
    @Test
    fun slashesOutsideTheMarkerDoNotTriggerTheUrlBranch() {
        assertEquals("a/b/c", EmailChangeRules.tokenFromPasted("a/b/c"))
        assertEquals("", EmailChangeRules.tokenFromPasted(""))
        assertEquals("", EmailChangeRules.tokenFromPasted("   "))
        // The marker with nothing after it: no token, so the UI keeps its
        // "enter the code" state instead of sending an empty string.
        assertEquals("", EmailChangeRules.tokenFromPasted("https://x/confirm-email/"))
    }

    @Test
    fun emailIsTrimmedAndLowercasedLikeTheServerDoes() {
        assertEquals("an@example.com", EmailChangeRules.normalizedEmail("  An@Example.COM "))
        assertEquals("", EmailChangeRules.normalizedEmail("   "))
    }

    @Test
    fun stepOneNeedsBothFieldsAndStepTwoNeedsARealToken() {
        assertTrue(EmailChangeRules.canRequest("an@example.com", "s3cret"))
        assertTrue(EmailChangeRules.canRequest("  AN@example.com  ", "s3cret"))
        assertFalse("no address", EmailChangeRules.canRequest("   ", "s3cret"))
        assertFalse("no password", EmailChangeRules.canRequest("an@example.com", ""))

        assertTrue(EmailChangeRules.canConfirm(appUrlToken))
        assertTrue(EmailChangeRules.canConfirm("abc123"))
        assertFalse(EmailChangeRules.canConfirm("   "))
        assertFalse(EmailChangeRules.canConfirm("https://x/confirm-email/"))
    }

    @Test
    fun tokenTtlMatchesTheServerConstant() {
        // api/internal/services/ + migration 0009: single-use, 30 minutes. The UI
        // states it as a sentence, and nothing in the response carries it, so a
        // change server-side would turn this copy into a lie.
        assertEquals(30, EmailChangeRules.TOKEN_TTL_MINUTES)
    }
}
