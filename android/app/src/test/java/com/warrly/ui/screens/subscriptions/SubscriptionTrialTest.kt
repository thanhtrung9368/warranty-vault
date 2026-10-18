package com.warrly.ui.screens.subscriptions

import com.warrly.i18n.ResCatalog
import com.warrly.network.ApiClient
import com.warrly.network.Subscription
import com.warrly.network.SubscriptionInput
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Free trial vs. renewal — the pure half.
 *
 * Pins the two things the screen must not get wrong:
 *
 *  * a trial changes what the billing date row *means*;
 *  * a post-trial price without a trial end date is never submitted, because the
 *    server answers it with `fieldErrors.convertsToPrice`.
 */
class SubscriptionTrialTest {

    private val vi = ResCatalog.vietnamese()
    private val en = ResCatalog.english()
    private val json = ApiClient.json

    // ---- Trial vs renewal ----

    @Test
    fun aUsableTrialDateIsTheOnlyThingThatMakesATrial() {
        assertEquals(
            BillingPhase.Trial,
            subscriptionBillingPhase("2026-04-01T00:00:00"),
        )
        assertEquals(
            "no trial is the ordinary case",
            BillingPhase.Renewal,
            subscriptionBillingPhase(null),
        )
        assertEquals(BillingPhase.Renewal, subscriptionBillingPhase("   "))
        assertEquals(
            "a malformed date must not claim a trial",
            BillingPhase.Renewal,
            subscriptionBillingPhase("not-a-date"),
        )
        assertEquals(
            "a shape-valid but impossible day must not claim a trial",
            BillingPhase.Renewal,
            subscriptionBillingPhase("2026-02-31"),
        )
    }

    @Test
    fun theBillingLabelSwitchesBetweenTrialAndRenewal() {
        assertEquals("Dùng thử đến", billingPhaseLabel(vi, BillingPhase.Trial))
        assertEquals("Trial until", billingPhaseLabel(en, BillingPhase.Trial))
        assertEquals("Gia hạn", billingPhaseLabel(vi, BillingPhase.Renewal))
        assertEquals("Renew", billingPhaseLabel(en, BillingPhase.Renewal))
    }

    // ---- Wire <-> form ----

    @Test
    fun dateHelpers_keepOnlyTheCalendarDate() {
        assertEquals("2026-04-01", trialEndsAtInput("2026-04-01T23:30:00"))
        assertEquals("2026-04-01", trialEndsAtInput("2026-04-01"))
        assertEquals("", trialEndsAtInput(null))
        assertEquals("", trialEndsAtInput("   "))
        assertNull(trialEndsAtRequest("  "))
        assertEquals("2026-04-01", trialEndsAtRequest("  2026-04-01  "))
    }

    @Test
    fun priceInput_isBlankForNoRecordedPrice() {
        assertEquals("50000", convertsToPriceInput(50_000))
        assertEquals("0", convertsToPriceInput(0))
        assertEquals("", convertsToPriceInput(null))
    }

    // ---- The convertsToPrice-without-trialEndsAt guard ----

    @Test
    fun aPriceWithoutATrialDateIsNeverSent() {
        // Even if the form state still holds a price after the date was
        // cleared, the request mapping drops it — the server's
        // fieldErrors.convertsToPrice can never fire.
        assertNull(convertsToPriceForRequest("", "50000"))
        assertNull(convertsToPriceForRequest("   ", "50000"))
        assertEquals(
            50_000,
            convertsToPriceForRequest("2026-04-01", "50000"),
        )
        assertEquals(
            "blank price stays absent",
            null,
            convertsToPriceForRequest("2026-04-01", "  "),
        )
    }

    @Test
    fun saveIsBlockedOnlyForTheInvalidCombination() {
        assertFalse(
            "the server rejects this combination",
            trialFormIsSubmittable("", "50000"),
        )
        assertTrue(trialFormIsSubmittable("", ""))
        assertTrue(trialFormIsSubmittable("2026-04-01", "50000"))
        assertTrue(trialFormIsSubmittable("2026-04-01", ""))
    }

    // ---- JSON contract ----

    @Test
    fun subscriptionJson_readsTheNewFieldsAndDefaultsAPreFeaturePayload() {
        val updated = json.decodeFromString(
            Subscription.serializer(),
            """
                {
                  "id": "sub-1",
                  "name": "Netflix",
                  "startedAt": "2026-01-01T00:00:00",
                  "trialEndsAt": "2026-02-01T00:00:00",
                  "convertsToPrice": 260000
                }
            """.trimIndent(),
        )

        assertEquals("2026-02-01T00:00:00", updated.trialEndsAt)
        assertEquals(260_000, updated.convertsToPrice)

        val old = json.decodeFromString(
            Subscription.serializer(),
            """
                {
                  "id": "sub-2",
                  "name": "Old plan",
                  "startedAt": "2024-01-01"
                }
            """.trimIndent(),
        )
        assertNull(old.trialEndsAt)
        assertNull(old.convertsToPrice)
    }

    @Test
    fun subscriptionInput_omitsNullTrialFieldsButKeepsARealPrice() {
        val withoutTrial = json.encodeToString(
            SubscriptionInput.serializer(),
            SubscriptionInput(
                name = "Netflix",
                startedAt = "2026-01-01",
                trialEndsAt = null,
                convertsToPrice = null,
            ),
        )
        assertFalse(withoutTrial.contains("\"trialEndsAt\""))
        assertFalse(withoutTrial.contains("\"convertsToPrice\""))

        val withTrial = json.encodeToString(
            SubscriptionInput.serializer(),
            SubscriptionInput(
                name = "Netflix",
                startedAt = "2026-01-01",
                trialEndsAt = "2026-02-01",
                convertsToPrice = 260_000,
            ),
        )
        assertTrue(withTrial.contains("\"trialEndsAt\":\"2026-02-01\""))
        assertTrue(withTrial.contains("\"convertsToPrice\":260000"))
    }

    @Test
    fun theFormRoundTripKeepsBothTrialFields() {
        val stored = Subscription(
            id = "sub-1",
            name = "Netflix",
            startedAt = "2026-01-01",
            trialEndsAt = "2026-02-01T00:00:00",
            convertsToPrice = 260_000,
        )

        val input = SubscriptionInput(
            name = stored.name,
            startedAt = stored.startedAt.take(10),
            trialEndsAt = trialEndsAtRequest(trialEndsAtInput(stored.trialEndsAt)),
            convertsToPrice = convertsToPriceForRequest(
                trialEndsAtInput(stored.trialEndsAt),
                convertsToPriceInput(stored.convertsToPrice),
            ),
        )

        assertEquals("2026-02-01", input.trialEndsAt)
        assertEquals(260_000, input.convertsToPrice)
    }
}
