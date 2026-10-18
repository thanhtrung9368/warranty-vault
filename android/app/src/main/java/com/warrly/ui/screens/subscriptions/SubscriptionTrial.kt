package com.warrly.ui.screens.subscriptions

import com.warrly.R
import com.warrly.i18n.AppStrings
import com.warrly.ui.components.parseIsoDate

/**
 * Free trial vs. renewal — openapi `Subscription.trialEndsAt` /
 * `Subscription.convertsToPrice`.
 *
 * A trial changes what the billing date *means*: until it ends the plan costs
 * nothing, and the row that used to say "renews on …" has to say "trial ends on
 * …" with the price that starts afterwards. The server rejects a post-trial price
 * without a trial end (`fieldErrors.convertsToPrice`), so the form uses the
 * guards at the bottom of this file rather than trusting a raw pair of fields.
 *
 * Pure, like [com.warrly.ui.screens.devices.ActivationStatus], so both languages
 * are pinned by JVM tests without Robolectric.
 */

/** What the billing date row describes. */
enum class BillingPhase {
    /** A trial end date exists; the plan bills after it. */
    Trial,

    /** No trial; the row is the ordinary next-renewal date. */
    Renewal,
}

/**
 * Wire → phase.
 *
 * A malformed `trialEndsAt` does **not** claim a trial: without a usable date the
 * row stays an ordinary renewal, because "Dùng thử đến <garbage>" is worse than
 * saying nothing. `null`/blank is the ordinary no-trial case.
 */
fun subscriptionBillingPhase(trialEndsAt: String?): BillingPhase =
    if (parseIsoDate(trialEndsAt) != null) BillingPhase.Trial else BillingPhase.Renewal

/**
 * The label for the billing-date row: `"Dùng thử đến"` / `"Trial ends"` for a
 * trial, otherwise the existing `"Gia hạn"` / `"Renew"`.
 */
fun billingPhaseLabel(s: AppStrings, phase: BillingPhase): String = when (phase) {
    BillingPhase.Trial -> s.get(R.string.subs_trial_ends_on)
    BillingPhase.Renewal -> s.get(R.string.subs_renew_2)
}

// ---- Wire <-> form --------------------------------------------------------

/** `"2026-03-02T00:00:00"` → `"2026-03-02"`; missing/blank → `""`. */
internal fun trialEndsAtInput(wire: String?): String = wire?.trim()?.take(10).orEmpty()

/** Form → request. Blank means "no trial" and drops the key. */
internal fun trialEndsAtRequest(raw: String): String? = raw.trim().ifBlank { null }

/** Wire → form (`50000` → `"50000"`, `null` → `""`). */
internal fun convertsToPriceInput(wire: Int?): String = wire?.toString().orEmpty()

// ---- The convertsToPrice-without-trialEndsAt guard ------------------------

/**
 * Whether the post-trial price field is meaningful. The price is only rendered
 * while a trial date is present, and this is the same rule the request uses.
 */
fun trialPriceIsAllowed(trialEndsAtRaw: String): Boolean =
    trialEndsAtRaw.isNotBlank()

/**
 * Form → request for the post-trial price.
 *
 * Returns `null` — dropping the key — whenever the trial date is blank, **even
 * if a price is still in the form state**. That is the client half of the
 * server's `fieldErrors.convertsToPrice` rejection: the invalid combination can
 * never be submitted, whether the UI cleared the field or not.
 */
fun convertsToPriceForRequest(trialEndsAtRaw: String, priceRaw: String): Int? =
    if (!trialPriceIsAllowed(trialEndsAtRaw)) {
        null
    } else {
        priceRaw.trim().ifBlank { null }?.toIntOrNull()
    }

/**
 * Save is blocked while a price is present with no trial end date.
 *
 * The sheet also clears the price when the date is cleared, so this is a second,
 * independent guard — exactly the kind of contradiction that becomes a 400 when
 * a future refactor moves the state around.
 */
fun trialFormIsSubmittable(trialEndsAtRaw: String, priceRaw: String): Boolean =
    trialPriceIsAllowed(trialEndsAtRaw) || priceRaw.isBlank()
