package com.warrly.ui.screens.devices

import com.warrly.i18n.ResCatalog
import com.warrly.network.BrandOption
import com.warrly.network.BrandWarrantyStatus
import com.warrly.network.WarrantyMismatch
import com.warrly.testing.Fixtures
import com.warrly.ui.components.PillKind
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Brand warranty lookup — the pure half (`BrandWarrantyRules.kt`).
 *
 * What is pinned here is every rule whose failure would be a **wrong claim on
 * screen**, not a styling choice:
 *
 *  * the four mismatch sentences, in both languages, with both dates and the
 *    right singular/plural (`47 ngày` vs `1 day`);
 *  * the day arithmetic (a leap day is one day, not zero and not two);
 *  * the lookup URL gate and the "no page for this brand" state — including the
 *    cases that must **not** become a link (`javascript:`, a bare host, a
 *    relative path);
 *  * the API's write rules mirrored locally (status required, end not before
 *    start, absolute URL);
 *  * the full-replacement round trip: recording a brand answer must send every
 *    editable device field back, or the PATCH would erase it.
 *
 * The words are read from `res/values-vi/` and `res/values/` through the same
 * [ResCatalog] seam every other pure formatter test uses, so a missing or
 * mistranslated key fails here instead of silently rendering the wrong language.
 *
 * Not tested: the composable's placement, colours and tap wiring. This module
 * has no instrumentation tests and no Robolectric.
 */
class BrandWarrantyRulesTest {

    private val vi = ResCatalog.vietnamese()
    private val en = ResCatalog.english()

    // ---- status labels ---------------------------------------------------

    @Test
    fun everyBrandStatusHasAnExactLabelInBothLanguages() {
        assertEquals("Active", brandWarrantyStatusLabel(en, BrandWarrantyStatus.ACTIVE))
        assertEquals("Còn hiệu lực", brandWarrantyStatusLabel(vi, BrandWarrantyStatus.ACTIVE))

        assertEquals("Expired", brandWarrantyStatusLabel(en, BrandWarrantyStatus.EXPIRED))
        assertEquals("Đã hết hạn", brandWarrantyStatusLabel(vi, BrandWarrantyStatus.EXPIRED))

        assertEquals(
            "Not registered",
            brandWarrantyStatusLabel(en, BrandWarrantyStatus.NOT_REGISTERED),
        )
        assertEquals(
            "Chưa đăng ký",
            brandWarrantyStatusLabel(vi, BrandWarrantyStatus.NOT_REGISTERED),
        )

        assertEquals(
            "Pre-activated",
            brandWarrantyStatusLabel(en, BrandWarrantyStatus.PRE_ACTIVATED),
        )
        assertEquals(
            "Kích hoạt trước",
            brandWarrantyStatusLabel(vi, BrandWarrantyStatus.PRE_ACTIVATED),
        )

        assertEquals("Unknown", brandWarrantyStatusLabel(en, BrandWarrantyStatus.UNKNOWN))
        assertEquals("Không rõ", brandWarrantyStatusLabel(vi, BrandWarrantyStatus.UNKNOWN))
    }

    /**
     * The pill is calm by design: the brand's answer is not an error in the
     * user's data, so no state may use the danger colour.
     */
    @Test
    fun noBrandStatusUsesTheDangerPill() {
        assertEquals(PillKind.Success, brandWarrantyStatusPillKind(BrandWarrantyStatus.ACTIVE))
        assertEquals(PillKind.Info, brandWarrantyStatusPillKind(BrandWarrantyStatus.PRE_ACTIVATED))
        assertEquals(PillKind.Neutral, brandWarrantyStatusPillKind(BrandWarrantyStatus.EXPIRED))
        assertEquals(
            PillKind.Neutral,
            brandWarrantyStatusPillKind(BrandWarrantyStatus.NOT_REGISTERED),
        )
        assertEquals(PillKind.Neutral, brandWarrantyStatusPillKind(BrandWarrantyStatus.UNKNOWN))
        assertTrue(
            BrandWarrantyStatus.entries.none {
                brandWarrantyStatusPillKind(it) == PillKind.Danger
            },
        )
    }

    // ---- presence / agreement -------------------------------------------

    @Test
    fun aRecordIsRecognisedByAnyOfItsFiveFields() {
        assertFalse(
            hasBrandWarrantyRecord(
                status = null,
                startDate = null,
                endDate = null,
                checkedAt = null,
                lookupUrl = null,
            ),
        )
        assertTrue(
            hasBrandWarrantyRecord(
                status = BrandWarrantyStatus.UNKNOWN,
                startDate = null,
                endDate = null,
                checkedAt = null,
                lookupUrl = null,
            ),
        )
        // A URL alone is still a record: the user opened a page even if it gave
        // no dates.
        assertTrue(
            hasBrandWarrantyRecord(
                status = null,
                startDate = null,
                endDate = null,
                checkedAt = null,
                lookupUrl = "https://example.com/check",
            ),
        )
        assertFalse(
            hasBrandWarrantyRecord(
                status = null,
                startDate = "   ",
                endDate = "",
                checkedAt = null,
                lookupUrl = " ",
            ),
        )
    }

    @Test
    fun agreementNeedsARealRecordWithAtLeastOneDateAndNoMismatch() {
        val checked = Fixtures.device(
            brandWarrantyStatus = BrandWarrantyStatus.ACTIVE,
            brandWarrantyStart = "2024-03-01",
            brandWarrantyEnd = "2026-03-01",
            brandCheckedAt = "2026-10-19T02:24:20Z",
            warrantyMismatch = null,
        )
        assertTrue("same dates and no mismatch must read as agreement", brandWarrantyAgrees(checked))

        assertFalse(
            "never checked is not agreement",
            brandWarrantyAgrees(Fixtures.device()),
        )
        assertFalse(
            "a status with no dates has nothing to compare",
            brandWarrantyAgrees(
                Fixtures.device(brandWarrantyStatus = BrandWarrantyStatus.NOT_REGISTERED),
            ),
        )
        assertFalse(
            "an end date alone has no guaranteed comparison on a list payload, " +
                "so the app must not claim the two agree",
            brandWarrantyAgrees(
                Fixtures.device(
                    brandWarrantyStatus = BrandWarrantyStatus.ACTIVE,
                    brandWarrantyEnd = "2026-03-01",
                ),
            ),
        )
        assertFalse(
            "a mismatch always wins over agreement",
            brandWarrantyAgrees(
                checked.copy(
                    warrantyMismatch = WarrantyMismatch(
                        kind = "STARTS_BEFORE",
                        days = 47,
                        brandDate = "2024-01-14",
                        purchaseDate = "2024-03-01",
                    ),
                ),
            ),
        )
    }

    // ---- day arithmetic --------------------------------------------------

    @Test
    fun dayArithmeticIsCalendarDaysAndHandlesALeapDay() {
        assertEquals(1L, daysBetweenIsoDates("2024-02-29", "2024-03-01"))
        assertEquals(2L, daysBetweenIsoDates("2024-02-28", "2024-03-01"))
        assertEquals(0L, daysBetweenIsoDates("2026-03-01", "2026-03-01"))
        assertEquals(-1L, daysBetweenIsoDates("2026-03-02", "2026-03-01"))
        assertEquals(
            "a timestamp uses only its date half",
            47L,
            daysBetweenIsoDates("2026-03-01T00:00:00", "2026-04-17T23:59:59"),
        )
        assertNull("a missing side is not zero", daysBetweenIsoDates(null, "2026-03-01"))
        assertNull("31 February is not a date", daysBetweenIsoDates("2026-02-31", "2026-03-01"))
    }

    @Test
    fun mismatchDaysPrefersTheServerCountAndFallsBackToTheDates() {
        assertEquals(
            47,
            mismatchDays(WarrantyMismatch(kind = "STARTS_BEFORE", days = 47)),
        )
        assertEquals(
            "a negative wire count is still a distance",
            47,
            mismatchDays(WarrantyMismatch(kind = "STARTS_BEFORE", days = -47)),
        )
        assertEquals(
            "a payload that forgot the count still gets a real number",
            47,
            mismatchDays(
                WarrantyMismatch(
                    kind = "STARTS_BEFORE",
                    days = 0,
                    brandDate = "2026-03-01",
                    purchaseDate = "2026-04-17",
                ),
            ),
        )
        assertEquals(
            "unparseable dates degrade to 0 rather than a guessed count",
            0,
            mismatchDays(WarrantyMismatch(kind = "STARTS_BEFORE", days = 0, brandDate = "x", purchaseDate = "y")),
        )
    }

    // ---- mismatch copy ---------------------------------------------------

    private fun mismatch(kind: String, days: Int = 47) = WarrantyMismatch(
        kind = kind,
        days = days,
        brandDate = "2026-03-01",
        purchaseDate = "2026-04-17",
    )

    @Test
    fun startsBeforeSaysBothDatesAndTheDayCountInBothLanguages() {
        assertEquals(
            "The brand says the warranty started 47 days before your purchase date: " +
                "01/03/2026 (brand) vs 17/04/2026 (your purchase date).",
            brandMismatchMessage(en, mismatch("STARTS_BEFORE")),
        )
        assertEquals(
            "Hãng ghi bảo hành bắt đầu trước ngày mua 47 ngày: " +
                "01/03/2026 (hãng) so với 17/04/2026 (ngày mua của bạn).",
            brandMismatchMessage(vi, mismatch("STARTS_BEFORE")),
        )
    }

    @Test
    fun startsAfterSaysBothDatesAndTheDayCountInBothLanguages() {
        assertEquals(
            "The brand says the warranty started 12 days after your purchase date: " +
                "01/03/2026 (brand) vs 17/04/2026 (your purchase date).",
            brandMismatchMessage(en, mismatch("STARTS_AFTER", 12)),
        )
        assertEquals(
            "Hãng ghi bảo hành bắt đầu sau ngày mua 12 ngày: " +
                "01/03/2026 (hãng) so với 17/04/2026 (ngày mua của bạn).",
            brandMismatchMessage(vi, mismatch("STARTS_AFTER", 12)),
        )
    }

    @Test
    fun endedEarlierSaysBothDatesAndTheDayCountInBothLanguages() {
        assertEquals(
            "The brand says the warranty ended 5 days earlier than the end date the app uses: " +
                "01/03/2026 (brand) vs 17/04/2026 (the app's end date).",
            brandMismatchMessage(en, mismatch("ENDED_EARLIER", 5)),
        )
        assertEquals(
            "Hãng ghi bảo hành kết thúc sớm hơn ngày hết hạn app đang dùng 5 ngày: " +
                "01/03/2026 (hãng) so với 17/04/2026 (ngày hết hạn của app).",
            brandMismatchMessage(vi, mismatch("ENDED_EARLIER", 5)),
        )
    }

    @Test
    fun endedLaterSaysBothDatesAndTheDayCountInBothLanguages() {
        assertEquals(
            "The brand says the warranty ends 5 days later than the end date the app uses: " +
                "01/03/2026 (brand) vs 17/04/2026 (the app's end date).",
            brandMismatchMessage(en, mismatch("ENDED_LATER", 5)),
        )
        assertEquals(
            "Hãng ghi bảo hành kết thúc muộn hơn ngày hết hạn app đang dùng 5 ngày: " +
                "01/03/2026 (hãng) so với 17/04/2026 (ngày hết hạn của app).",
            brandMismatchMessage(vi, mismatch("ENDED_LATER", 5)),
        )
    }

    /** One day must not render "1 days" in English (the plural resource). */
    @Test
    fun aOneDayMismatchUsesTheSingularInEnglish() {
        assertEquals(
            "The brand says the warranty started 1 day before your purchase date: " +
                "01/03/2026 (brand) vs 17/04/2026 (your purchase date).",
            brandMismatchMessage(en, mismatch("STARTS_BEFORE", 1)),
        )
    }

    @Test
    fun anUnknownOrUnformattableMismatchDoesNotInventASentence() {
        assertNull(
            "a kind this build does not know degrades instead of guessing a direction",
            brandMismatchMessage(en, mismatch("SEASONAL_DRIFT")),
        )
        assertNull(
            brandMismatchMessage(
                en,
                WarrantyMismatch(kind = "STARTS_BEFORE", days = 3, brandDate = "", purchaseDate = ""),
            ),
        )
    }

    // ---- lookup URL / state ---------------------------------------------

    @Test
    fun onlyAbsoluteHttpAndHttpsUrlsAreAllowed() {
        assertEquals(
            "https://www.apple.com/vn/warranty/check",
            brandLookupUrl("  https://www.apple.com/vn/warranty/check  "),
        )
        assertEquals(
            "http://localhost:4000/check",
            brandLookupUrl("http://localhost:4000/check"),
        )
        assertNull(brandLookupUrl(null))
        assertNull(brandLookupUrl(""))
        assertNull(brandLookupUrl("   "))
        assertNull("a scheme the browser would execute is never a lookup", brandLookupUrl("javascript:alert(1)"))
        assertNull("intent URLs are not web pages", brandLookupUrl("intent://scan/#Intent;scheme=zxing;end"))
        assertNull("a bare host is not a URL", brandLookupUrl("www.apple.com"))
        assertNull("a relative path is not a URL", brandLookupUrl("/warranty/check"))
        assertNull("http with no host is not a URL", brandLookupUrl("https:///path"))
    }

    @Test
    fun theLookupStateDistinguishesNoBrandFromNoPage() {
        assertEquals(
            BrandLookupState.NoBrand,
            brandLookupState(null, "https://www.apple.com/vn/warranty"),
        )
        assertEquals(
            BrandLookupState.NoBrand,
            brandLookupState("   ", "https://www.apple.com/vn/warranty"),
        )
        assertEquals(
            "a brand we know but no sourced page is not a guessed link",
            BrandLookupState.NoUrl,
            brandLookupState("Acme", null),
        )
        assertEquals(
            BrandLookupState.NoUrl,
            brandLookupState("Acme", "javascript:alert(1)"),
        )
        assertEquals(
            BrandLookupState.Available("https://www.apple.com/vn/warranty"),
            brandLookupState("Apple", " https://www.apple.com/vn/warranty "),
        )
    }

    @Test
    fun theMissingPageCopyNamesTheBrandAndNeverPromisesASearch() {
        val enMissing = brandLookupMissingMessage(en, "Acme")
        assertTrue(enMissing.contains("Acme"))
        assertTrue(
            "the sentence must say the app will not guess a URL",
            enMissing.contains("will not guess"),
        )
        val viMissing = brandLookupMissingMessage(vi, "Acme")
        assertTrue(viMissing.contains("Acme"))
        assertTrue(viMissing.contains("không tự đoán URL"))

        assertTrue(brandLookupMissingMessage(en, null).contains("no brand recorded"))
        assertTrue(brandLookupMissingMessage(vi, "  ").contains("chưa ghi hãng"))
    }

    // ---- brand id resolution --------------------------------------------

    private val brands = listOf(
        BrandOption(id = "samsung", name = "Samsung"),
        BrandOption(id = "apple", name = "Apple"),
        BrandOption(id = "asus", name = "ASUS"),
    )

    @Test
    fun brandIdMatchesTheExactNameOrIdAndNothingLooser() {
        assertEquals("samsung", brandIdForName("  samsung ", brands))
        assertEquals("apple", brandIdForName("APPLE", brands))
        assertEquals("asus", brandIdForName("Asus", brands))
        assertNull("a model in the brand field is not the same brand", brandIdForName("Samsung Galaxy S24", brands))
        assertNull("unknown brand", brandIdForName("Nokia", brands))
        assertNull(brandIdForName(null, brands))
        assertNull(brandIdForName("   ", brands))
    }

    @Test
    fun anAmbiguousBrandNameResolvesToNothing() {
        val duplicated = brands + BrandOption(id = "samsung-2", name = "Samsung")
        assertNull(brandIdForName("Samsung", duplicated))
    }

    // ---- record-sheet validation ----------------------------------------

    @Test
    fun aBlankDraftIsValidBecauseItMeansClearTheRecord() {
        assertNull(brandWarrantyDraftProblem(BrandWarrantyDraft()))
    }

    @Test
    fun statusIsRequiredWheneverAnythingElseIsSet() {
        assertEquals(
            BrandWarrantyDraftProblem.StatusRequired,
            brandWarrantyDraftProblem(
                BrandWarrantyDraft(startDate = "2026-03-01", checkedAt = "2026-10-19T02:24:20Z"),
            ),
        )
        assertEquals(
            BrandWarrantyDraftProblem.StatusRequired,
            brandWarrantyDraftProblem(
                BrandWarrantyDraft(
                    lookupUrl = "https://example.com/check",
                    checkedAt = "2026-10-19T02:24:20Z",
                ),
            ),
        )
        assertNull(
            brandWarrantyDraftProblem(
                BrandWarrantyDraft(
                    status = BrandWarrantyStatus.ACTIVE,
                    startDate = "2026-03-01",
                    checkedAt = "2026-10-19T02:24:20Z",
                ),
            ),
        )
    }

    @Test
    fun theEndDateCannotPrecedeTheStartDate() {
        val reversed = BrandWarrantyDraft(
            status = BrandWarrantyStatus.ACTIVE,
            startDate = "2026-03-01",
            endDate = "2026-02-01",
            checkedAt = "2026-10-19T02:24:20Z",
        )
        assertEquals(BrandWarrantyDraftProblem.EndBeforeStart, brandWarrantyDraftProblem(reversed))

        assertEquals(
            "the same day is a valid end",
            null,
            brandWarrantyDraftProblem(reversed.copy(endDate = "2026-03-01")),
        )
    }

    @Test
    fun malformedDatesAreBlockedLocally() {
        assertEquals(
            BrandWarrantyDraftProblem.DateInvalid,
            brandWarrantyDraftProblem(
                BrandWarrantyDraft(
                    status = BrandWarrantyStatus.ACTIVE,
                    startDate = "2026-02-31",
                    checkedAt = "2026-10-19T02:24:20Z",
                ),
            ),
        )
        assertEquals(
            BrandWarrantyDraftProblem.DateInvalid,
            brandWarrantyDraftProblem(
                BrandWarrantyDraft(
                    status = BrandWarrantyStatus.ACTIVE,
                    endDate = "next week",
                    checkedAt = "2026-10-19T02:24:20Z",
                ),
            ),
        )
    }

    @Test
    fun aNonHttpLookupUrlIsBlockedLocally() {
        assertEquals(
            BrandWarrantyDraftProblem.LookupUrlInvalid,
            brandWarrantyDraftProblem(
                BrandWarrantyDraft(
                    status = BrandWarrantyStatus.UNKNOWN,
                    lookupUrl = "javascript:alert(1)",
                    checkedAt = "2026-10-19T02:24:20Z",
                ),
            ),
        )
        assertNull(
            brandWarrantyDraftProblem(
                BrandWarrantyDraft(
                    status = BrandWarrantyStatus.ACTIVE,
                    startDate = "2026-03-01",
                    endDate = "2027-03-01",
                    lookupUrl = "https://www.apple.com/vn/warranty",
                    checkedAt = "2026-10-19T02:24:20Z",
                ),
            ),
        )
    }

    @Test
    fun everyDraftProblemHasItsOwnSentenceInBothLanguages() {
        for (problem in BrandWarrantyDraftProblem.entries) {
            val english = brandWarrantyProblemMessage(en, problem)
            val vietnamese = brandWarrantyProblemMessage(vi, problem)
            assertTrue("empty English copy for $problem", english.isNotBlank())
            assertTrue("empty Vietnamese copy for $problem", vietnamese.isNotBlank())
            assertTrue(
                "the two languages must not be the same sentence for $problem",
                english != vietnamese,
            )
        }
    }

    // ---- wire <-> form ---------------------------------------------------

    @Test
    fun datesUseTheTakeTenConventionAndBlankMeansAbsent() {
        assertEquals("2026-03-01", brandWarrantyDateInput("2026-03-01T00:00:00"))
        assertEquals("", brandWarrantyDateInput(null))
        assertEquals("", brandWarrantyDateInput("  "))

        assertEquals("2026-03-01", brandWarrantyDateRequest("2026-03-01T00:00:00"))
        assertNull(brandWarrantyDateRequest(""))
        assertNull(brandWarrantyDateRequest("   "))
    }

    @Test
    fun checkedAtIsRfc3339FromTheInjectedClockAndFormatsToTheAppDate() {
        val fixed = Clock.fixed(Instant.parse("2026-10-19T02:24:20Z"), ZoneOffset.UTC)
        val stamp = brandCheckedAtNow(fixed)

        assertEquals("2026-10-19T02:24:20Z", stamp)
        assertEquals("19/10/2026", brandCheckedAtLabel(stamp))
        assertNull(brandCheckedAtLabel("not a date"))
    }

    @Test
    fun aDeviceDraftTakesOnlyTheDateHalfAndKeepsTheFullCheckTimestamp() {
        val device = Fixtures.device(
            brandWarrantyStatus = BrandWarrantyStatus.PRE_ACTIVATED,
            brandWarrantyStart = "2024-01-14T00:00:00",
            brandWarrantyEnd = "2026-01-14T00:00:00",
            brandCheckedAt = "2026-10-19T02:24:20Z",
            brandLookupUrl = "https://www.apple.com/vn/warranty",
        )

        val draft = brandWarrantyDraftOf(device)
        assertEquals(BrandWarrantyStatus.PRE_ACTIVATED, draft.status)
        assertEquals("2024-01-14", draft.startDate)
        assertEquals("2026-01-14", draft.endDate)
        assertEquals("the full instant is kept for the record", "2026-10-19T02:24:20Z", draft.checkedAt)
        assertEquals("https://www.apple.com/vn/warranty", draft.lookupUrl)
        assertTrue(draft.hasRecord())

        assertFalse(BrandWarrantyDraft().hasRecord())
    }

    // ---- the full-replacement round trip ---------------------------------

    @Test
    fun recordingABrandAnswerSendsEveryEditableDeviceFieldBack() {
        val device = Fixtures.device(
            name = "Galaxy S25",
            category = "PHONE",
            brand = "Samsung",
            purchaseDate = "2024-03-01T00:00:00",
            purchasePrice = 25_000_000,
            currency = "USD",
            fxRate = 25_470,
            serialNumber = "SN-123",
            status = com.warrly.network.DeviceStatus.ACTIVE,
            soldAt = "2026-03-01T00:00:00",
            soldPrice = 900,
            returnWindowDays = 30,
            receivedAt = "2026-03-02T00:00:00",
        ).copy(
            model = "S25 Ultra",
            purchasePlace = "CellphoneS",
            notes = "Mua online",
            activationRequired = true,
            activatedAt = "2026-02-20T00:00:00",
            extendedCoverBuyBy = "2026-06-01T00:00:00",
            leadDays = listOf(7, 30),
        )

        val draft = BrandWarrantyDraft(
            status = BrandWarrantyStatus.PRE_ACTIVATED,
            startDate = "2024-01-14",
            endDate = "2026-01-14",
            lookupUrl = "https://www.apple.com/vn/warranty",
            checkedAt = "2026-10-19T02:24:20Z",
        )
        val input = deviceInputForBrandWarranty(device, draft)

        assertEquals(device.name, input.name)
        assertEquals(device.category, input.category)
        assertEquals(device.brand, input.brand)
        assertEquals(device.model, input.model)
        assertEquals(device.serialNumber, input.serialNumber)
        assertEquals("2024-03-01", input.purchaseDate)
        assertEquals(device.purchasePrice, input.purchasePrice)
        assertEquals(device.currency, input.currency)
        assertEquals(device.fxRate, input.fxRate)
        assertEquals(device.purchasePlace, input.purchasePlace)
        assertEquals(device.status, input.status)
        assertEquals(device.notes, input.notes)
        assertEquals("2026-03-01", input.soldAt)
        assertEquals(device.soldPrice, input.soldPrice)
        assertEquals(device.returnWindowDays, input.returnWindowDays)
        assertEquals("2026-03-02", input.receivedAt)
        assertEquals(device.activationRequired, input.activationRequired)
        assertEquals("2026-02-20", input.activatedAt)
        assertEquals("2026-06-01", input.extendedCoverBuyBy)
        assertEquals("the reminder schedule is normalised, not dropped", listOf(30, 7), input.leadDays)
        assertEquals(0, input.warrantyMonths)

        assertEquals(draft.status, input.brandWarrantyStatus)
        assertEquals(draft.startDate, input.brandWarrantyStart)
        assertEquals(draft.endDate, input.brandWarrantyEnd)
        assertEquals(draft.checkedAt, input.brandCheckedAt)
        assertEquals(draft.lookupUrl, input.brandLookupUrl)
    }

    // ---- mismatch carry-over --------------------------------------------

    @Test
    fun aMismatchSurvivesOnlyWhenTheBrandInputsDidNotMove() {
        val serverMismatch = WarrantyMismatch(
            kind = "STARTS_BEFORE",
            days = 47,
            brandDate = "2024-01-14",
            purchaseDate = "2024-03-01",
        )
        val previous = Fixtures.device(
            brandWarrantyStatus = BrandWarrantyStatus.PRE_ACTIVATED,
            brandWarrantyStart = "2024-01-14",
            brandWarrantyEnd = "2026-01-14",
            brandCheckedAt = "2026-10-19T02:24:20Z",
            brandLookupUrl = "https://www.apple.com/vn/warranty",
            warrantyMismatch = serverMismatch,
        )

        assertEquals(
            "an ordinary name edit must not blank the check result",
            serverMismatch,
            keptWarrantyMismatch(previous, previous.copy(name = "New name", warrantyMismatch = null)),
        )
        assertEquals(
            "a write response that carries the computed field wins",
            serverMismatch.copy(days = 3),
            keptWarrantyMismatch(previous, previous.copy(warrantyMismatch = serverMismatch.copy(days = 3))),
        )
        assertNull(
            "a changed brand start invalidates the old comparison",
            keptWarrantyMismatch(
                previous,
                previous.copy(brandWarrantyStart = "2025-01-14", warrantyMismatch = null),
            ),
        )
    }
}
