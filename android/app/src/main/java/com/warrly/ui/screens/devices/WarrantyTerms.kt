package com.warrly.ui.screens.devices

import com.warrly.R
import com.warrly.i18n.AppStrings
import com.warrly.network.Warranty

/**
 * Contract terms on a warranty plan — the derived presentation of the nine
 * optional fields (`component`, `scope`, `cap`, `deductible`, `exclusions`,
 * `region`, `transferable`, `claimsAllowed`, `claimsUsed`).
 *
 * A warranty row used to say only *when* cover ends. These fields say *what* it
 * covers and *what a claim costs*, which the Vietnamese plans express as
 * contract economics: a capped payout, a per-claim deductible, exclusions.
 *
 * Everything here is pure: (strings, values) in, sentence out. That is the same
 * seam `DeviceActivation.kt` and `ui/components/WarrantyState.kt` use, so the JVM
 * tests can pin both languages without Robolectric and the composables stay free
 * of string branching.
 *
 * ## Null is not zero
 *
 * Every nullable field has a meaningful `null` ("not recorded") that is
 * different from `0`:
 *
 *  * `cap = 0` is a real cap of zero; `null` is "no cap recorded";
 *  * `deductible = 0` is a real "no deductible"; `null` is "not recorded";
 *  * `claimsAllowed = 0` is "no claims at all"; `null` is **unbounded**;
 *  * `transferable = false` is an explicit "not transferable"; `null` is
 *    "not recorded".
 *
 * `claimsUsed` is the exception the contract itself defines: it is an `Int`
 * defaulting to `0`, so `0` is both "none used" and the empty state. It only
 * counts as a recorded term when it is greater than zero.
 */

/**
 * `true` when at least one of the nine contract-term fields carries information.
 *
 * This is what decides the **collapsed default** of the form's "Điều khoản hợp
 * đồng" group and whether the detail card grows a terms block at all: a plan
 * with no terms must render exactly as it did before the fields existed.
 *
 * Blank and whitespace-only strings count as empty (the form sends them as
 * `null` anyway). `transferable = false` and `claimsAllowed = 0` count as SET —
 * both are real terms, not absences — while `claimsUsed = 0` does not, because
 * that is the contract's default rather than a value the user chose.
 */
fun hasWarrantyTerms(
    component: String? = null,
    scope: String? = null,
    cap: Int? = null,
    deductible: Int? = null,
    exclusions: String? = null,
    region: String? = null,
    transferable: Boolean? = null,
    claimsAllowed: Int? = null,
    claimsUsed: Int = 0,
): Boolean =
    !component.isNullOrBlank() ||
        !scope.isNullOrBlank() ||
        cap != null ||
        deductible != null ||
        !exclusions.isNullOrBlank() ||
        !region.isNullOrBlank() ||
        transferable != null ||
        claimsAllowed != null ||
        claimsUsed > 0

/** [hasWarrantyTerms] over a decoded [Warranty], for the detail card and form. */
fun Warranty.hasContractTerms(): Boolean = hasWarrantyTerms(
    component = component,
    scope = scope,
    cap = cap,
    deductible = deductible,
    exclusions = exclusions,
    region = region,
    transferable = transferable,
    claimsAllowed = claimsAllowed,
    claimsUsed = claimsUsed,
)

/**
 * The terms title: the covered part, or "Toàn máy" / "Whole unit" when
 * [component] is `null`, blank or whitespace.
 *
 * The contract defines a missing component as the whole unit, so this is a
 * derivation and not a claim the app invented. A component is trimmed before it
 * is shown: `"  Pin  "` is still "Pin".
 */
fun warrantyComponentTitle(s: AppStrings, component: String?): String =
    component?.trim()?.takeIf { it.isNotEmpty() }
        ?: s.get(R.string.warr_terms_whole_unit)

/**
 * The claims counter.
 *
 *  * a recorded limit renders as `"2/3"` — the shape a service counter can read
 *    at a glance;
 *  * no limit with claims already used renders "Đã dùng 2 lần · không giới hạn";
 *  * no limit and nothing used renders "Không giới hạn".
 *
 * [claimsUsed] is deliberately never clamped to [claimsAllowed]: a server that
 * stored an inconsistent pair (an older write, or a plan edited elsewhere) is
 * shown as it is instead of being silently rewritten on the screen.
 */
fun warrantyClaimsLabel(s: AppStrings, claimsUsed: Int, claimsAllowed: Int?): String =
    when {
        claimsAllowed != null -> "$claimsUsed/$claimsAllowed"
        claimsUsed > 0 ->
            // A count, so it is a plural in both catalogs; the count is passed
            // twice because Android's two-argument getQuantityString does not
            // run String.format on a template that carries %1$d.
            s.quantity(R.plurals.warr_terms_claims_used_unbounded, claimsUsed, claimsUsed)
        else -> s.get(R.string.warr_terms_claims_unlimited)
    }

/**
 * Mirror of the server's one cross-field rule: `claimsUsed > claimsAllowed` is a
 * 400 on `fieldErrors.claimsUsed`.
 *
 * A `null` `claimsAllowed` means **unbounded**, so no pair with it can be
 * invalid. The form uses this to disable Save and to show the sentence inline,
 * which keeps an avoidable round trip out of the user's way.
 */
fun claimsExceedAllowed(claimsUsed: Int, claimsAllowed: Int?): Boolean =
    claimsAllowed != null && claimsUsed > claimsAllowed

/**
 * The tri-state label used by the detail card and the form's dropdown.
 *
 * `null` gets its own word ("Không rõ" / "Not specified") rather than falling
 * back to "Không": "not recorded" and "explicitly not transferable" are
 * different facts, and the contract keeps both.
 */
fun transferableLabel(s: AppStrings, transferable: Boolean?): String = when (transferable) {
    true -> s.get(R.string.warr_terms_transferable_yes)
    false -> s.get(R.string.warr_terms_transferable_no)
    null -> s.get(R.string.warr_terms_transferable_unknown)
}
