package com.warrly.ui.screens.devices

import com.warrly.i18n.ResCatalog
import com.warrly.testing.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The warranty contract terms — the pure half.
 *
 * What is pinned here is everything that would be a bug rather than a styling
 * choice: the collapsed-default predicate, the null-vs-zero distinctions the
 * contract turns on, the claims counter and the server's cross-field rule.
 * The exact words are read out of `res/values-vi/` and `res/values/` through the
 * same [ResCatalog] seam every other pure formatter test uses, so a missing or
 * mistranslated key fails here instead of silently rendering the wrong language.
 *
 * The screen itself is not tested: this module has no instrumentation tests and
 * no Robolectric, so nothing here proves where the block sits or how it looks.
 */
class WarrantyTermsTest {

    private val vi = ResCatalog.vietnamese()
    private val en = ResCatalog.english()

    // ---- the collapsed default -------------------------------------------

    /**
     * A plan with nothing recorded must not open the terms group and must not
     * grow a terms block on the detail card. `claimsUsed = 0` is in that set:
     * it is the contract's default, not a term the user entered.
     */
    @Test
    fun aPlanWithNoTermsHasNoTerms() {
        assertFalse(hasWarrantyTerms())
        assertFalse(
            "blank text is what an untouched form contains",
            hasWarrantyTerms(component = "", scope = "   ", exclusions = "\n", region = "\t"),
        )
        assertFalse("0 used is the default, not a recorded term", hasWarrantyTerms(claimsUsed = 0))
        assertFalse(Fixtures.warranty().hasContractTerms())
    }

    /**
     * Every one of the nine fields, on its own, is enough to open the group and
     * to make the detail card show the terms. The three falsy-looking values are
     * the interesting ones: `transferable = false`, `claimsAllowed = 0` and a
     * `0` cap/deductible are real terms, not absences.
     */
    @Test
    fun everyOneOfTheNineFieldsCountsAsATermOnItsOwn() {
        assertTrue("component", hasWarrantyTerms(component = "Pin"))
        assertTrue("scope", hasWarrantyTerms(scope = "Pin chai"))
        assertTrue("cap = 0 is a real cap", hasWarrantyTerms(cap = 0))
        assertTrue("cap", hasWarrantyTerms(cap = 5_000_000))
        assertTrue("deductible = 0 is a real deductible", hasWarrantyTerms(deductible = 0))
        assertTrue("deductible", hasWarrantyTerms(deductible = 500_000))
        assertTrue("exclusions", hasWarrantyTerms(exclusions = "Rơi vỡ, vào nước"))
        assertTrue("region", hasWarrantyTerms(region = "Việt Nam"))
        assertTrue("transferable = true", hasWarrantyTerms(transferable = true))
        assertTrue(
            "explicitly NOT transferable is a recorded term",
            hasWarrantyTerms(transferable = false),
        )
        assertTrue("claimsAllowed = 0 is a real limit", hasWarrantyTerms(claimsAllowed = 0))
        assertTrue("claimsAllowed", hasWarrantyTerms(claimsAllowed = 3))
        assertTrue("claimsUsed > 0", hasWarrantyTerms(claimsUsed = 1))
    }

    /** The [Warranty] extension mirrors the field-based predicate exactly. */
    @Test
    fun theWarrantyExtensionMatchesTheFieldPredicate() {
        assertTrue(Fixtures.warranty().copy(component = "Pin").hasContractTerms())
        assertTrue(Fixtures.warranty().copy(transferable = false).hasContractTerms())
        assertTrue(Fixtures.warranty().copy(claimsUsed = 2).hasContractTerms())
        assertTrue(Fixtures.warranty().copy(cap = 0).hasContractTerms())
        assertFalse(Fixtures.warranty().copy(notes = "ghi chú").hasContractTerms())
    }

    // ---- component vs whole unit -----------------------------------------

    /**
     * A missing component is the contract's own "whole unit", not "unknown", so
     * the card can print a title even on a plan that only records a cap.
     */
    @Test
    fun theComponentTitleFallsBackToTheWholeUnit() {
        assertEquals("Toàn máy", warrantyComponentTitle(vi, null))
        assertEquals("Whole unit", warrantyComponentTitle(en, null))
        assertEquals("Toàn máy", warrantyComponentTitle(vi, ""))
        assertEquals("Toàn máy", warrantyComponentTitle(vi, "   "))
        assertEquals("Pin", warrantyComponentTitle(vi, "Pin"))
        assertEquals("Battery", warrantyComponentTitle(en, "Battery"))
    }

    @Test
    fun theComponentTitleIsTrimmed() {
        assertEquals("Pin", warrantyComponentTitle(vi, "  Pin  "))
        assertEquals("Battery", warrantyComponentTitle(en, "\tBattery\n"))
    }

    // ---- claims ----------------------------------------------------------

    /**
     * The two shapes the counter has to read at a glance: a recorded limit is
     * `used/allowed`, and no limit is a sentence rather than a fake `/` total.
     */
    @Test
    fun theClaimsLabelIsACounterWhenThereIsALimit() {
        assertEquals("2/3", warrantyClaimsLabel(vi, claimsUsed = 2, claimsAllowed = 3))
        assertEquals("2/3", warrantyClaimsLabel(en, claimsUsed = 2, claimsAllowed = 3))
        assertEquals(
            "0/0 is a real limit of zero and must not become the unbounded wording",
            "0/0",
            warrantyClaimsLabel(vi, claimsUsed = 0, claimsAllowed = 0),
        )
    }

    @Test
    fun theClaimsLabelSaysUnboundedWhenThereIsNoLimit() {
        assertEquals("Không giới hạn", warrantyClaimsLabel(vi, claimsUsed = 0, claimsAllowed = null))
        assertEquals("Unlimited", warrantyClaimsLabel(en, claimsUsed = 0, claimsAllowed = null))
        assertEquals(
            "used claims are not hidden just because no limit was recorded",
            "Đã dùng 2 lần · không giới hạn",
            warrantyClaimsLabel(vi, claimsUsed = 2, claimsAllowed = null),
        )
        assertEquals(
            "2 used · unlimited",
            warrantyClaimsLabel(en, claimsUsed = 2, claimsAllowed = null),
        )
    }

    /**
     * The server's one cross-field rule. `claimsAllowed = null` means unbounded,
     * so no pair with it can be invalid; equality is inside the limit.
     */
    @Test
    fun theClaimsRuleMirrorsTheServer() {
        assertTrue(claimsExceedAllowed(claimsUsed = 4, claimsAllowed = 3))
        assertFalse("equal is allowed", claimsExceedAllowed(claimsUsed = 3, claimsAllowed = 3))
        assertFalse(claimsExceedAllowed(claimsUsed = 2, claimsAllowed = 3))
        assertFalse("no limit means unbounded", claimsExceedAllowed(claimsUsed = 99, claimsAllowed = null))
        assertFalse("zero of zero is valid", claimsExceedAllowed(claimsUsed = 0, claimsAllowed = 0))
    }

    // ---- transferable ----------------------------------------------------

    /**
     * Three distinct labels: `false` must never render as "Not specified", or
     * the card would tell the buyer the plan is silent when it explicitly says
     * cover does not survive the sale.
     */
    @Test
    fun theTransferableLabelKeepsAllThreeStatesDistinct() {
        assertEquals("Có", transferableLabel(vi, true))
        assertEquals("Không", transferableLabel(vi, false))
        assertEquals("Không rõ", transferableLabel(vi, null))

        assertEquals("Yes", transferableLabel(en, true))
        assertEquals("No", transferableLabel(en, false))
        assertEquals("Not specified", transferableLabel(en, null))
    }
}
