package com.warrantyvault.app.ui.screens.devices

import com.warrantyvault.app.network.PhoneSource
import com.warrantyvault.app.network.WarrantyProviderRef
import com.warrantyvault.app.network.WarrantyType
import com.warrantyvault.app.testing.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Warranty directory (#15).
 *
 * This feature is an honesty problem before it is a layout problem, so the tests
 * are written as the promises the API makes and the client could break:
 * `phoneSource` is rendered, `null` brand is explained rather than shown as an
 * empty box, an ambiguous provider match is never presented as exact, and no
 * phone number is ever shown that the user did not type.
 */
class ServiceDirectoryInfoTest {

    // ---- brand: null means "app không biết" ----

    @Test
    fun aNullBrandIsExplainedNotRenderedAsAnEmptyBox() {
        // Covers BOTH server-side reasons: no seeded row, or a tied match.
        assertTrue(NULL_BRAND_EXPLANATION.contains("không có thông tin"))
        assertTrue("phải nói cả trường hợp khớp hoà", NULL_BRAND_EXPLANATION.contains("ngang nhau"))
        assertTrue("phải nói app không đoán", NULL_BRAND_EXPLANATION.contains("không đoán bừa"))
        assertFalse("không được rỗng", NULL_BRAND_EXPLANATION.isBlank())
    }

    @Test
    fun withNoBrandRecordedTheExplanationSaysThatInstead() {
        // A different cause needs a different sentence: there is nothing to match
        // against, so telling the user about ties would be misleading.
        assertTrue(NO_BRAND_EXPLANATION.contains("chưa ghi hãng"))
        assertFalse(NO_BRAND_EXPLANATION.contains("ngang nhau"))
    }

    @Test
    fun brandInputIsShownVerbatimAndOnlyWhenThereIsSomethingToShow() {
        assertEquals("Apple", directoryBrandInput(Fixtures.serviceDirectory(brandInput = "Apple")))
        // Verbatim apart from surrounding whitespace: the user's own words are
        // what the app could not match against, so they are not rewritten.
        assertEquals("Trung tâm bảo hành", directoryBrandInput(Fixtures.serviceDirectory(brandInput = "  Trung tâm bảo hành  ")))
        assertNull(directoryBrandInput(Fixtures.serviceDirectory(brandInput = null)))
        assertNull("blank is absent, not an empty label", directoryBrandInput(Fixtures.serviceDirectory(brandInput = "   ")))
    }

    @Test
    fun aMatchedBrandCarriesItsLinksAndTheRightLabelForEach() {
        val brand = Fixtures.brandServiceInfo()
        val links = brandDirectoryLinks(brand)

        assertEquals(2, links.size)
        // The locator IS the authorised-centre page; the support page merely might
        // be. Labelling the second one "trung tâm bảo hành" would send someone
        // across town to a contact form.
        assertEquals(SERVICE_LOCATOR_LABEL, links[0].label)
        assertEquals(brand.serviceLocatorUrl, links[0].url)
        assertEquals(SUPPORT_URL_LABEL, links[1].label)
        assertEquals(brand.supportUrl, links[1].url)
    }

    @Test
    fun aBrandWithNoVerifiedUrlOffersNoButtonAtAll() {
        val brand = Fixtures.brandServiceInfo(serviceLocatorUrl = null, supportUrl = null)
        assertTrue(brandDirectoryLinks(brand).isEmpty())
    }

    @Test
    fun urlsThatAreNotWebUrlsAreDroppedRatherThanBecomingDeadButtons() {
        val brand = Fixtures.brandServiceInfo(
            serviceLocatorUrl = "javascript:alert(1)",
            supportUrl = "  ",
        )
        assertTrue(brandDirectoryLinks(brand).isEmpty())

        // A partially-usable row keeps the usable half.
        val half = Fixtures.brandServiceInfo(serviceLocatorUrl = null, supportUrl = "https://x.vn/")
        assertEquals(listOf(SUPPORT_URL_LABEL), brandDirectoryLinks(half).map { it.label })
    }

    @Test
    fun theBrandNoteIsShownOnlyWhenTheServerSentOne() {
        assertEquals("ghi chú", brandNote(Fixtures.brandServiceInfo(notes = "ghi chú")))
        assertNull(brandNote(Fixtures.brandServiceInfo(notes = null)))
        assertNull(brandNote(Fixtures.brandServiceInfo(notes = "  ")))
    }

    // ---- provider: the fuzzy match is never implied to be exact ----

    @Test
    fun aMatchedProviderShowsTheCatalogName() {
        val centre = Fixtures.warrantyCentre(providerInput = "samsung", provider = WarrantyProviderRef("samsung", "Samsung"))
        assertEquals("Samsung", centreProviderLine(centre))
        assertFalse(isUnmatchedProvider(centre))
    }

    @Test
    fun anAmbiguousOrUnseededMatchStillShowsWhatTheUserTyped() {
        // `provider: null` is the server declining to guess between several equal
        // candidates. Blanking the line would hide the only useful information.
        val centre = Fixtures.warrantyCentre(providerInput = "Trung tâm bảo hành", provider = null)
        assertEquals("Trung tâm bảo hành", centreProviderLine(centre))
        assertTrue("phải đánh dấu là chưa khớp", isUnmatchedProvider(centre))
    }

    @Test
    fun aWarrantyThatNeverRecordedAProviderSaysSoRatherThanShowingNothing() {
        val centre = Fixtures.warrantyCentre(providerInput = null, provider = null)
        assertEquals(NO_PROVIDER_MESSAGE, centreProviderLine(centre))
        assertTrue(isUnmatchedProvider(centre))

        val blank = Fixtures.warrantyCentre(providerInput = "   ", provider = null)
        assertEquals(NO_PROVIDER_MESSAGE, centreProviderLine(blank))
    }

    @Test
    fun theUnmatchedNoteQuotesTheUsersWordsAndIsAbsentWhenThereAreNone() {
        // A near-miss is useful information: the user can see what the app failed
        // to match and fix it.
        assertEquals(
            "\"Trung tâm bảo hành\" chưa khớp danh bạ nào — app không đoán.",
            unmatchedProviderNote(Fixtures.warrantyCentre(providerInput = " Trung tâm bảo hành ", provider = null)),
        )
        // Nothing typed means nothing to explain: quoting an empty string would
        // claim the user wrote something they did not.
        assertNull(unmatchedProviderNote(Fixtures.warrantyCentre(providerInput = null, provider = null)))
        assertNull(unmatchedProviderNote(Fixtures.warrantyCentre(providerInput = "  ", provider = null)))
        // A matched provider needs no note at all.
        assertNull(
            unmatchedProviderNote(
                Fixtures.warrantyCentre(providerInput = "samsung", provider = WarrantyProviderRef("samsung", "Samsung")),
            ),
        )
    }

    // ---- dates and status use the house conventions ----

    @Test
    fun theCoverageEndDateUsesTheAppsDdMmYyyyConvention() {
        val centre = Fixtures.warrantyCentre(endDate = "2027-01-15T00:00:00", isActive = true)
        assertEquals("Hết hạn 15/01/2027", centreEndDateLabel(centre))
        assertEquals("Còn hiệu lực", centreStatusLabel(centre))
    }

    @Test
    fun anExpiredOrUndatedWarrantyIsLabelledWithoutInventingADate() {
        assertEquals("Đã hết hạn", centreStatusLabel(Fixtures.warrantyCentre(isActive = false)))
        assertNull(centreEndDateLabel(Fixtures.warrantyCentre(endDate = null)))
        assertNull(centreEndDateLabel(Fixtures.warrantyCentre(endDate = "không rõ")))
        // An expired warranty with no recorded end still shows a status line.
        assertEquals("Đã hết hạn", centreStatusLabel(Fixtures.warrantyCentre(endDate = null, isActive = false)))
    }

    @Test
    fun theStatusComesFromTheServerAndIsNeverReDerivedFromTheDate() {
        // A warranty whose endDate is in the future but which the server reports
        // as inactive must read as expired: `isActive` is the verdict, the date is
        // only context. (Third-party coverage can be voided; the client may not
        // second-guess that.)
        val centre = Fixtures.warrantyCentre(endDate = "2099-01-01T00:00:00", isActive = false)
        assertEquals("Đã hết hạn", centreStatusLabel(centre))
        assertEquals("Hết hạn 01/01/2099", centreEndDateLabel(centre))
    }

    // ---- phoneSource: the honesty mechanism ----

    @Test
    fun aUserTypedNumberIsDialableAndSaysWhereItCameFrom() {
        val centre = Fixtures.warrantyCentre(phone = "0912 345 678", phoneSource = PhoneSource.USER)
        val phone = dialablePhone(centre)

        assertEquals("0912 345 678", phone?.number)
        assertEquals("Số do bạn tự ghi", phone?.attribution)
        // Attribution must never read as verification by the app.
        assertFalse(phone!!.attribution.contains("xác minh"))
        assertFalse(phone.attribution.contains("chính hãng"))
    }

    @Test
    fun theDialUriStripsSpacesSoTheDialerReceivesAValidNumber() {
        val phone = DialablePhone("0912 345 678")
        assertEquals("tel:0912345678", phone.dialUri)

        val intent = dialIntent(phone)
        // ACTION_DIAL prefills and lets the user press call; ACTION_CALL would
        // place the call straight from a tap and need CALL_PHONE.
        assertEquals("android.intent.action.DIAL", intent.action)
        assertEquals("tel:0912345678", intent.uri)
    }

    @Test
    fun noNumberIsEverDialableUnlessTheUserTypedIt() {
        assertNull(dialablePhone(Fixtures.warrantyCentre(phone = null, phoneSource = PhoneSource.NONE)))
        // A number whose source is "none" is a contradiction the server does not
        // produce. `phoneSource` is the authority, so it renders as NO number:
        // showing an unattributable number is the exact failure this field exists
        // to prevent.
        assertNull(dialablePhone(Fixtures.warrantyCentre(phone = "1900 1234", phoneSource = PhoneSource.NONE)))
        // The reverse contradiction — "user" with nothing recorded — is nothing,
        // because there is nothing to dial.
        assertNull(dialablePhone(Fixtures.warrantyCentre(phone = "  ", phoneSource = PhoneSource.USER)))
        assertNull(dialablePhone(Fixtures.warrantyCentre(phone = null, phoneSource = PhoneSource.USER)))
    }

    @Test
    fun theAbsentPhoneIsSaidOutLoudRatherThanLeftBlank() {
        // A blank row next to "call the hotline" expectations is how a user ends up
        // assuming a number exists. The app stores no hotline at all (migrations
        // 0008 / 0012), so there is nothing to fall back on.
        assertEquals("Chưa có số điện thoại", NO_PHONE_MESSAGE)
        assertEquals(PhoneSource.NONE.label, NO_PHONE_MESSAGE)
        assertFalse(NO_PHONE_MESSAGE.contains("hotline"))
    }

    @Test
    fun theAddressIsAlsoOnlyEverWhatTheUserWrote() {
        assertEquals("12 Lê Lợi, Q.1", centreAddress(Fixtures.warrantyCentre(address = "12 Lê Lợi, Q.1")))
        assertNull(centreAddress(Fixtures.warrantyCentre(address = null)))
        assertNull(centreAddress(Fixtures.warrantyCentre(address = "   ")))
    }

    // ---- the server's disclaimer ----

    @Test
    fun theServersDisclaimerIsRenderedVerbatim() {
        val text = "App không lưu hotline hay địa chỉ trung tâm bảo hành."
        assertEquals(text, directoryDisclaimer(Fixtures.serviceDirectory(disclaimer = text)))
        assertNull("nothing to say is not an empty card", directoryDisclaimer(Fixtures.serviceDirectory(disclaimer = "")))
        assertNull(directoryDisclaimer(Fixtures.serviceDirectory(disclaimer = "  ")))
    }

    // ---- counts ----

    @Test
    fun theCentreCountSpeaksVietnameseForZeroOneAndMany() {
        assertEquals("Thiết bị chưa có gói bảo hành nào", centreCountLabel(emptyList()))
        assertEquals("1 gói bảo hành", centreCountLabel(listOf(Fixtures.warrantyCentre())))
        assertEquals(
            "3 gói bảo hành",
            centreCountLabel(List(3) { Fixtures.warrantyCentre(warrantyId = "war-$it") }),
        )
    }

    @Test
    fun everyWarrantyOfTheDeviceGetsARowIncludingUnmatchedOnes() {
        // One row per warranty, per openapi — a warranty that matches no catalog
        // row is exactly the case the provider fallback exists for.
        val directory = Fixtures.serviceDirectory(
            centres = listOf(
                Fixtures.warrantyCentre(warrantyId = "w1", providerInput = "Apple", provider = WarrantyProviderRef("apple", "Apple")),
                Fixtures.warrantyCentre(warrantyId = "w2", providerInput = "Bảo hành Sao Việt", provider = null),
                Fixtures.warrantyCentre(warrantyId = "w3", providerInput = null, provider = null),
            ),
        )
        assertEquals("3 gói bảo hành", centreCountLabel(directory.centres))
        assertEquals(listOf("Apple", "Bảo hành Sao Việt", NO_PROVIDER_MESSAGE), directory.centres.map { centreProviderLine(it) })
        assertEquals(listOf(false, true, true), directory.centres.map { isUnmatchedProvider(it) })
    }

    @Test
    fun warrantyTypeKeepsItsExistingVietnameseLabels() {
        // Parity guard: the catalogue is unchanged, and the directory must not be
        // the screen where a "Mở rộng" quietly becomes "Extended".
        assertEquals("Tiêu chuẩn", WarrantyType.STANDARD.label)
        assertEquals("Mở rộng", WarrantyType.EXTENDED.label)
        assertEquals("Bên thứ ba", WarrantyType.THIRD_PARTY.label)
    }
}
