package com.warrly.ui.screens.devices

import com.warrly.i18n.ResCatalog
import com.warrly.testing.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The pre-service handover checklist: content, order, the two per-device lines,
 * the progress counter, and the session-only tick store.
 *
 * The screen itself is not tested — this module has no instrumentation tests and
 * no Robolectric, so nothing here proves how the card looks. What is pinned is
 * everything that would be a bug rather than a styling choice: a missing row, a
 * dropped translation, a date that silently becomes `null`, or ticks leaking
 * between devices.
 */
class HandoverChecklistTest {

    private val en = ResCatalog.english()
    private val vi = ResCatalog.vietnamese()

    private fun deviceWithEverything() = Fixtures.device(
        serialNumber = "490154203237518",
        effectiveWarrantyEnd = "2027-03-02T00:00:00",
    )

    // ---- content and order -----------------------------------------------

    /**
     * The order is the workflow — at home, then what to bring, then the counter —
     * and the tick list reads as a sequence, so the sequence is the assertion.
     */
    @Test
    fun theOrderIsAtHomeThenWhatToBringThenTheCounter() {
        assertEquals(
            listOf(
                "ACCOUNTS",
                "ACTIVATION_LOCK",
                "SCREEN_LOCK",
                "BACKUP",
                "SIM_AND_CARD",
                "CONDITION_PHOTOS",
                "RECORD_SERIAL",
                "INVOICE_AND_BOX",
                "ACCESSORIES",
                "WARRANTY_END",
                "INTAKE_SLIP",
                "WIPE_CONSENT",
            ),
            HandoverChecklistKey.entries.map { it.name },
        )
        assertEquals(
            HandoverChecklistKey.entries.map { it.name },
            handoverChecklist(en, deviceWithEverything()).map { it.key.name },
        )
    }

    /**
     * The seven rules the product spec names, each mapped to the row that carries
     * it. Deleting one of those rows breaks this test on purpose.
     */
    @Test
    fun everyIntakeRuleFromTheSpecHasItsOwnRow() {
        val required = mapOf(
            "sign out of Google / Mi / iCloud accounts" to HandoverChecklistKey.ACCOUNTS,
            "remove the screen lock and biometric locks" to HandoverChecklistKey.SCREEN_LOCK,
            "back up photos and data" to HandoverChecklistKey.BACKUP,
            "bring the invoice and the box with the matching IMEI" to HandoverChecklistKey.INVOICE_AND_BOX,
            "photograph the current condition first" to HandoverChecklistKey.CONDITION_PHOTOS,
            "list the accessories handed over" to HandoverChecklistKey.ACCESSORIES,
            "know the warranty end date" to HandoverChecklistKey.WARRANTY_END,
        )
        for ((rule, key) in required) {
            assertTrue("no row for: $rule", key in HandoverChecklistKey.entries)
            assertTrue("a blank title would make the row useless: $rule", en.get(key.titleRes).isNotBlank())
            assertTrue("a blank reason would make the row generic: $rule", en.get(key.whyRes).isNotBlank())
        }
    }

    @Test
    fun everyRowIsTranslatedIntoBothLanguages() {
        for (key in HandoverChecklistKey.entries) {
            val titleEn = en.get(key.titleRes)
            val titleVi = vi.get(key.titleRes)
            val whyEn = en.get(key.whyRes)
            val whyVi = vi.get(key.whyRes)
            assertTrue("${key.name} title is blank in values/", titleEn.isNotBlank())
            assertTrue("${key.name} title is blank in values-vi/", titleVi.isNotBlank())
            assertTrue("${key.name} reason is blank in values/", whyEn.isNotBlank())
            assertTrue("${key.name} reason is blank in values-vi/", whyVi.isNotBlank())
            // An untranslated copy-paste is the exact bug this catches: the two
            // catalogs must not be the same sentence.
            assertFalse("${key.name} was not translated (same title in both)", titleEn == titleVi)
            assertFalse("${key.name} was not translated (same reason in both)", whyEn == whyVi)
        }
    }

    @Test
    fun everyRowSaysSomethingDifferentFromItsOwnTitle() {
        for (key in HandoverChecklistKey.entries) {
            assertFalse(
                "${key.name} repeats its title as the reason",
                en.get(key.titleRes) == en.get(key.whyRes),
            )
        }
    }

    @Test
    fun noTwoRowsReuseTheSameStringResource() {
        val titles = HandoverChecklistKey.entries.map { it.titleRes }
        assertEquals("two rows share a title resource", titles.size, titles.toSet().size)
        val reasons = HandoverChecklistKey.entries.map { it.whyRes }
        assertEquals("two rows share a reason resource", reasons.size, reasons.toSet().size)
        assertEquals(
            "a row reuses another row's title as its reason",
            0,
            (titles.toSet() intersect reasons.toSet()).size,
        )
    }

    // ---- per-device lines ------------------------------------------------

    @Test
    fun theInvoiceRowCarriesTheSavedImei() {
        val item = handoverChecklist(en, deviceWithEverything())
            .single { it.key == HandoverChecklistKey.INVOICE_AND_BOX }
        assertEquals("IMEI/serial saved in the app: 490154203237518", item.note)
    }

    @Test
    fun theInvoiceRowSaysWhenNoImeiWasSaved() {
        val item = handoverChecklist(en, Fixtures.device(serialNumber = null))
            .single { it.key == HandoverChecklistKey.INVOICE_AND_BOX }
        assertEquals(
            "No IMEI/serial saved yet — add it so you can check it against the box.",
            item.note,
        )
        // A blank serial stored as "" must not render an empty label either.
        val blank = handoverChecklist(en, Fixtures.device(serialNumber = "   "))
            .single { it.key == HandoverChecklistKey.INVOICE_AND_BOX }
        assertEquals(item.note, blank.note)
    }

    @Test
    fun theWarrantyRowShowsTheServerDateWhenItIsPresent() {
        val item = handoverChecklist(en, deviceWithEverything())
            .single { it.key == HandoverChecklistKey.WARRANTY_END }
        assertEquals("Warranty ends: 02/03/2027", item.note)
    }

    @Test
    fun theWarrantyRowFallsBackToTheLatestWarrantyRow() {
        // The detail read carries every warranty but not `effectiveWarrantyEnd`,
        // so the card derives the same max(endDate) the server would.
        val device = Fixtures.device(
            warranties = listOf(
                Fixtures.warranty(id = "war-1", endDate = "2026-01-01T00:00:00"),
                Fixtures.warranty(id = "war-2", endDate = "2028-06-30T00:00:00"),
            ),
        )
        assertEquals("30/06/2028", handoverWarrantyEnd(device))
        val item = handoverChecklist(en, device)
            .single { it.key == HandoverChecklistKey.WARRANTY_END }
        assertEquals("Warranty ends: 30/06/2028", item.note)
    }

    @Test
    fun theWarrantyRowSaysWhenThereIsNoDateInsteadOfPrintingAnEmptyOne() {
        assertNull(handoverWarrantyEnd(Fixtures.device()))
        val item = handoverChecklist(en, Fixtures.device())
            .single { it.key == HandoverChecklistKey.WARRANTY_END }
        assertEquals("This device has no warranty end date in the app.", item.note)
    }

    @Test
    fun aMalformedDateDegradesToTheHonestLine() {
        val device = Fixtures.device(effectiveWarrantyEnd = "not-a-date")
        assertNull(handoverWarrantyEnd(device))
        val item = handoverChecklist(en, device)
            .single { it.key == HandoverChecklistKey.WARRANTY_END }
        assertEquals("This device has no warranty end date in the app.", item.note)
    }

    @Test
    fun theDeviceLinesSpeakTheUiLanguage() {
        val device = deviceWithEverything()
        val invoice = handoverChecklist(vi, device)
            .single { it.key == HandoverChecklistKey.INVOICE_AND_BOX }
        assertEquals("IMEI/serial đang ghi trong app: 490154203237518", invoice.note)
        val warranty = handoverChecklist(vi, device)
            .single { it.key == HandoverChecklistKey.WARRANTY_END }
        assertEquals("Hạn bảo hành: 02/03/2027", warranty.note)
    }

    @Test
    fun onlyTheTwoDeviceRowsCarryANote() {
        val items = handoverChecklist(en, deviceWithEverything())
        assertEquals(
            setOf(HandoverChecklistKey.INVOICE_AND_BOX, HandoverChecklistKey.WARRANTY_END),
            items.filter { it.note != null }.map { it.key }.toSet(),
        )
        val notes = items.mapNotNull { it.note }
        assertFalse("a note must never interpolate the word null", notes.any { "null" in it })
    }

    // ---- progress --------------------------------------------------------

    @Test
    fun progressCountsOnlyRowsThatStillExist() {
        val items = handoverChecklist(en, deviceWithEverything())
        assertEquals(0, handoverProgress(items, emptySet()))
        assertEquals(1, handoverProgress(items, setOf(HandoverChecklistKey.ACCOUNTS.name)))
        assertEquals(
            "a key from an older checklist shape must not inflate the counter",
            0,
            handoverProgress(items, setOf("SOME_REMOVED_ROW")),
        )
        assertEquals(
            items.size,
            handoverProgress(items, HandoverChecklistKey.entries.map { it.name }.toSet()),
        )
    }

    // ---- the session store ----------------------------------------------

    @Test
    fun togglingIsReversibleAndScopedToTheDevice() {
        val store = HandoverChecklistStore()
        store.toggle("dev-1", HandoverChecklistKey.ACCOUNTS)
        assertTrue(HandoverChecklistKey.ACCOUNTS.name in store.checkedFor("dev-1"))
        assertTrue("another device must start clean", store.checkedFor("dev-2").isEmpty())

        store.toggle("dev-1", HandoverChecklistKey.ACCOUNTS)
        assertTrue("toggling twice unticks", store.checkedFor("dev-1").isEmpty())
    }

    @Test
    fun resetClearsOneDeviceAndLeavesTheOthersAlone() {
        val store = HandoverChecklistStore()
        store.toggle("dev-1", HandoverChecklistKey.BACKUP)
        store.toggle("dev-1", HandoverChecklistKey.SCREEN_LOCK)
        store.toggle("dev-2", HandoverChecklistKey.BACKUP)

        store.reset("dev-1")

        assertTrue(store.checkedFor("dev-1").isEmpty())
        assertEquals(setOf(HandoverChecklistKey.BACKUP.name), store.checkedFor("dev-2"))
    }

    @Test
    fun theStoreExposesTheSameStateThroughItsFlow() {
        val store = HandoverChecklistStore()
        store.toggle("dev-1", HandoverChecklistKey.WARRANTY_END)
        assertEquals(
            mapOf("dev-1" to setOf(HandoverChecklistKey.WARRANTY_END.name)),
            store.checked.value,
        )
    }
}
