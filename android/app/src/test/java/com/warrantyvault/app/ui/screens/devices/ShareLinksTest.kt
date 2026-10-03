package com.warrantyvault.app.ui.screens.devices

import com.warrantyvault.app.testing.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Handover certificate / share links (#2).
 *
 * The rules pinned here are the ones a wrong implementation would silently get
 * away with: a URL the buyer cannot open, a link reported as live after it died,
 * and — the one this feature lives or dies on — a warning that does not actually
 * say the token is shown once.
 */
class ShareLinksTest {

    /** 2026-01-01T00:00:00Z, so the expiry comparisons never touch the wall clock. */
    private val now = 1_767_225_600_000L

    // ---- The one-time warning ----

    @Test
    fun theOneTimeWarningSaysAllThreeThingsAUserNeedsBeforeDismissing() {
        val warning = ONE_TIME_WARNING

        // 1. that it is a single showing, and 2. that the app keeps no copy —
        //    without which "shown once" reads as a UI quirk rather than data loss.
        assertTrue(
            "phải nói rõ chỉ hiện một lần: $warning",
            warning.contains("MỘT LẦN"),
        )
        assertTrue(
            "phải nói app không lưu lại: $warning",
            warning.contains("không lưu lại"),
        )
        // 3. the consequence and the remedy, named before the user can dismiss.
        assertTrue(
            "phải nói hệ quả khi đóng mà chưa sao chép: $warning",
            warning.contains("chưa sao chép"),
        )
        assertTrue(
            "phải nói cách khắc phục: $warning",
            warning.contains("tạo link mới"),
        )
    }

    @Test
    fun theDialogTitleStatesTheStakesAndTheCopyConfirmationRepeatsThem() {
        assertTrue(ONE_TIME_TITLE.contains("một lần"))
        // The rule survives the dialog closing: a bare "Đã sao chép" would leave
        // the user with no reason to believe the link is not retrievable later.
        assertTrue(COPIED_MESSAGE.contains("một lần"))
    }

    @Test
    fun theProjectionExplanationNamesWhatIsExposedAndWhatIsNeverExposed() {
        val copy = CERTIFICATE_PROJECTION_EXPLANATION
        // The three things openapi's `SharedCertificate` promises are absent —
        // asserted by name so a future edit cannot quietly soften the promise.
        assertTrue("giá mua: $copy", copy.contains("giá mua"))
        assertTrue("ghi chú: $copy", copy.contains("ghi chú"))
        assertTrue("ảnh hoá đơn: $copy", copy.contains("ảnh hoá đơn"))
        assertTrue("thiết bị khác: $copy", copy.contains("thiết bị nào khác"))
    }

    @Test
    fun serialCopySaysWhatEachStateExposesAndNeitherOversells() {
        assertTrue("mặc định phải nói rõ là tắt", SERIAL_OFF_EXPLANATION.contains("mặc định"))
        assertTrue("phải nói che giữa", SERIAL_OFF_EXPLANATION.contains("che giữa"))
        assertTrue("phải nói IMEI đầy đủ", SERIAL_ON_EXPLANATION.contains("IMEI"))
        assertTrue(
            "phải nói rủi ro khi link bị chuyển tiếp",
            SERIAL_ON_EXPLANATION.contains("chuyển tiếp"),
        )
    }

    // ---- shareUrl ----

    @Test
    fun pairsTheServerPathWithTheConfiguredBaseUrl() {
        assertEquals(
            "http://10.0.2.2:4000/api/v1/public/shares/tok",
            shareUrl("http://10.0.2.2:4000", "/api/v1/public/shares/tok"),
        )
        // A trailing slash on either side must not double up.
        assertEquals(
            "https://vault.example.com/api/v1/public/shares/tok",
            shareUrl("https://vault.example.com/", "/api/v1/public/shares/tok"),
        )
        assertEquals(
            "https://vault.example.com/api/v1/public/shares/tok",
            shareUrl("https://vault.example.com", "api/v1/public/shares/tok"),
        )
    }

    @Test
    fun refusesToHandOutAUrlItCannotStand() {
        // The share action is disabled rather than sending a broken link.
        assertNull("blank path", shareUrl("http://10.0.2.2:4000", ""))
        assertNull("absent path", shareUrl("http://10.0.2.2:4000", null))
        assertNull("blank base", shareUrl("", "/api/v1/public/shares/tok"))
        // A base URL that is not a web URL would produce a link no recipient can
        // tap. Refusing here beats a share sheet full of silent failures.
        assertNull("non-web base", shareUrl("10.0.2.2:4000", "/api/v1/public/shares/tok"))
        assertNull("scheme only", shareUrl("http://", "/api/v1/public/shares/tok"))
    }

    @Test
    fun theTokenIsNeverMangledOrReEncodedOnTheWayThrough() {
        val url = shareUrl("http://10.0.2.2:4000", "/api/v1/public/shares/Ab-C_d~e.f")
        assertEquals("http://10.0.2.2:4000/api/v1/public/shares/Ab-C_d~e.f", url)
    }

    // ---- live / revoked / expired ----

    @Test
    fun aLiveShareIsNotRevokedAndNotPastItsExpiry() {
        assertTrue(isShareLive(Fixtures.share(expiresAt = "2026-01-01T00:00:01Z"), now))
        assertEquals("Đang hiệu lực", shareStateLabel(Fixtures.share(), now))
    }

    @Test
    fun anExpiredShareIsNotLiveAndSaysSo() {
        val expired = Fixtures.share(expiresAt = "2025-12-31T23:59:59Z")
        assertFalse(isShareLive(expired, now))
        assertEquals("Đã hết hạn", shareStateLabel(expired, now))
    }

    @Test
    fun aRevokedShareIsNotLiveEvenWhenItsExpiryIsStillInTheFuture() {
        val revoked = Fixtures.share(
            expiresAt = "2099-06-01T00:00:00Z",
            revokedAt = "2026-01-02T00:00:00Z",
        )
        assertFalse("thu hồi phải thắng hạn còn xa", isShareLive(revoked, now))
        assertEquals("Đã thu hồi", shareStateLabel(revoked, now))
    }

    @Test
    fun theExpiryBoundaryItselfCountsAsExpired() {
        // Exactly at expiresAt the link is no longer openable; `>` not `>=` would
        // report a dead link as live for one more millisecond of comparisons.
        val atBoundary = Fixtures.share(expiresAt = "2026-01-01T00:00:00Z")
        assertFalse(isShareLive(atBoundary, now))
    }

    @Test
    fun anUnreadableExpiryCountsAsNotLiveAndNeverAsLive() {
        // The link is still listed and still revocable; it is simply not claimed
        // to work. Claiming "còn hiệu lực" on a value the client cannot parse is
        // the wrong side to fail on.
        listOf("", "   ", "không rõ", "2026-01-01", "01/01/2026").forEach { raw ->
            assertFalse("expiresAt=\"$raw\"", isShareLive(Fixtures.share(expiresAt = raw), now))
        }
        assertNull(expiryMillis("2026-01-01"))
        assertNull(expiryMillis(null))
    }

    @Test
    fun expiryMillisReadsRfc3339Utc() {
        assertEquals(now, expiryMillis("2026-01-01T00:00:00Z"))
        assertEquals(0L, expiryMillis("1970-01-01T00:00:00Z"))
    }

    // ---- row labels ----

    @Test
    fun theExpiryRowIsRenderedInTheHouseDateFormat() {
        assertEquals("Hết hạn 01/06/2099", shareExpiryLabel(Fixtures.share()))
        // No parsable date: the row shows its state instead of an invented date.
        assertNull(shareExpiryLabel(Fixtures.share(expiresAt = "không rõ")))
    }

    @Test
    fun viewCountIsPhrasedAsOpensNotAsWhatTheBuyerDid() {
        // The app can only observe fetches. "Người mua đã xem" would claim
        // knowledge of a person the link has no identity for.
        assertEquals("Chưa mở lần nào", shareViewLabel(Fixtures.share(viewCount = 0)))
        assertEquals("Đã mở 1 lần", shareViewLabel(Fixtures.share(viewCount = 1)))
        assertEquals("Đã mở 7 lần", shareViewLabel(Fixtures.share(viewCount = 7)))
    }

    @Test
    fun theRevokeConfirmationSaysTheLinkDiesImmediatelyAndCarriesTheOldExpiry() {
        val copy = revokeConfirmMessage(Fixtures.share(expiresAt = "2099-06-01T00:00:00Z"))
        assertTrue(copy.contains("ngừng mở được ngay"))
        assertTrue("phải nói cả link chưa hết hạn cũng chết", copy.contains("chưa hết hạn"))
        assertTrue("hạn cũ theo dd/MM/yyyy", copy.contains("01/06/2099"))
    }

    @Test
    fun theLimitMessagePointsAtTheOnlyWayOut() {
        assertTrue(SHARE_LIMIT_MESSAGE.contains("10 link"))
        assertTrue(SHARE_LIMIT_MESSAGE.contains("Thu hồi"))
    }

    // ---- outgoing share payload ----

    @Test
    fun theShareSheetMessageCarriesTheLinkTheDeviceNameAndTheExpiryExpectation() {
        val message = shareMessage("iPhone 15 Pro", "https://v.example/api/v1/public/shares/tok")
        assertTrue(message.contains("iPhone 15 Pro"))
        assertTrue(message.contains("https://v.example/api/v1/public/shares/tok"))
        assertTrue("người nhận phải biết link có hạn", message.contains("có hạn"))
        assertTrue("và không cần đăng nhập", message.contains("không cần đăng nhập"))
    }

    @Test
    fun theOutgoingShareIsTheSameIntentShapeTheManifestRegistersAsATarget() {
        // This equality is exactly why the collision exists, so it is asserted
        // rather than assumed: `text/plain` / `ACTION_SEND` is both what we send
        // and what we accept.
        val outgoing = outgoingShare("x")
        assertEquals("android.intent.action.SEND", outgoing.action)
        assertEquals("text/plain", outgoing.mimeType)
        assertEquals("x", outgoing.message)
    }

    // ---- the collision with the incoming share target ----

    @Test
    fun ourOwnShareTargetIsExcludedFromTheChooser() {
        val targets = listOf(
            ResolvedTarget("com.warrantyvault.app/com.warrantyvault.app.MainActivity", isSelfTarget = true),
            ResolvedTarget("com.whatsapp/com.whatsapp.ContactPicker", isSelfTarget = false),
            ResolvedTarget("com.android.mms/.ui.ComposeMessageActivity", isSelfTarget = false),
        )

        val excluded = excludedShareTargets(targets)

        // Without this, picking WarrantyVault re-enters ShareTarget.deliver(), the
        // certificate URL parses as a product link, and the buyer's certificate
        // lands in the WISHLIST form — a silent wrong outcome, not a crash.
        assertEquals(listOf("com.warrantyvault.app/com.warrantyvault.app.MainActivity"), excluded)
        assertFalse("ứng dụng khác không được đụng tới", excluded.any { it.startsWith("com.whatsapp") })
    }

    @Test
    fun everySelfTargetIsExcludedAndNothingElseIs() {
        val excluded = excludedShareTargets(
            listOf(
                ResolvedTarget("com.warrantyvault.app/.MainActivity", isSelfTarget = true),
                ResolvedTarget("com.warrantyvault.app/.AltActivity", isSelfTarget = true),
                ResolvedTarget("org.telegram.messenger/.ShareActivity", isSelfTarget = false),
            ),
        )
        assertEquals(2, excluded.size)
        assertTrue(excluded.all { it.startsWith("com.warrantyvault.app/") })
    }

    @Test
    fun whenTheAppIsTheOnlyTargetTheListIsStillExcludedRatherThanFallingBackToSelf() {
        // Falling back to self would quietly do the wrong thing; an empty chooser
        // plus NO_SHARE_TARGET_MESSAGE tells the truth, and copy still works.
        val excluded = excludedShareTargets(
            listOf(ResolvedTarget("com.warrantyvault.app/.MainActivity", isSelfTarget = true)),
        )
        assertEquals(listOf("com.warrantyvault.app/.MainActivity"), excluded)
        assertTrue(NO_SHARE_TARGET_MESSAGE.contains("sao chép"))
    }

    @Test
    fun aChooserWithNoOtherAppsStillExcludesOurselves() {
        assertTrue(excludedShareTargets(emptyList()).isEmpty())
    }

    @Test
    fun theCollisionIsRealBecauseTheIntentsMatch() {
        // Guard against someone "fixing" the exclusion by changing the outgoing
        // MIME type: the manifest filter is text/plain, and if that ever stops
        // being true this test is the reminder to revisit the filter too.
        assertEquals("text/plain", outgoingShare("m").mimeType)
        assertEquals("android.intent.action.SEND", outgoingShare("m").action)
        assertTrue("tiêu đề chooser phải nói rõ đang gửi gì", CHOOSER_TITLE.contains("phiếu bàn giao"))
    }

    // ---- the create request ----

    @Test
    fun theCreateRequestDefaultsMatchTheDocumented30DaysAndMaskedSerial() {
        // The client always sends both fields, so these defaults are what a
        // "create" tap actually asks for — not a placeholder for an omission.
        assertEquals(30, com.warrantyvault.app.network.CreateShareInput().expiresInDays)
        assertFalse(com.warrantyvault.app.network.CreateShareInput().includeSerial)
        assertEquals(1, com.warrantyvault.app.network.CreateShareInput.MIN_EXPIRES_IN_DAYS)
        assertEquals(90, com.warrantyvault.app.network.CreateShareInput.MAX_EXPIRES_IN_DAYS)
    }
}
