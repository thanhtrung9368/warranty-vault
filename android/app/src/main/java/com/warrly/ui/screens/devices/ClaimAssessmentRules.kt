package com.warrly.ui.screens.devices

import com.warrly.R
import com.warrly.i18n.AppStrings
import com.warrly.network.ApiErrorEnvelope
import com.warrly.network.ClaimAssessment
import com.warrly.network.ClaimConfidence
import com.warrly.network.ClaimCoverage
import com.warrly.ui.components.PillKind
import com.warrly.ui.screens.vietnamDate
import kotlinx.serialization.json.Json
import retrofit2.HttpException

/**
 * AI claim assessment — the pure half.
 *
 * The endpoint (`POST /api/v1/ai/assess-claim`) is **advice, not a verdict**, and
 * it writes nothing. Three rules are easy to get subtly wrong and are therefore
 * kept out of Compose:
 *
 *  1. **The labels.** `LIKELY_COVERED` is not "approved" and
 *     `LIKELY_NOT_COVERED` is not "rejected" — a wrong word here is exactly the
 *     overconfident screen that costs a user a wasted trip. The pill colours are
 *     part of the same rule: deliberately no `Success`/`Danger`, because both
 *     read as a decision.
 *  2. **The gate.** The shared AI opt-in (`User.aiOptIn`, the same switch that
 *     gates receipt OCR) can be off, the server can have no API key
 *     (503 `feature_disabled`), or the feature can be ready. The UI needs to say
 *     which one, and the feature-disabled case must win: telling the user to turn
 *     AI on cannot help when the server has no key. The server exposes no
 *     preflight for the key, so the UI learns that gate from the 503.
 *  3. **The useful output.** `UNCLEAR` with questions is a **success**, not a
 *     failure. The questions are the thing to take to the counter, so the
 *     question heading and the advice sentence switch on coverage rather than
 *     treating `UNCLEAR` as an error.
 *
 * Everything is pure: plain values in, plain values out. Tests pin both languages
 * through `ResCatalog` without Robolectric, the same seam `ClaimRules.kt` and
 * `InboxRules.kt` use.
 */

/**
 * The machine-readable code for "this account has not opted in to AI features".
 * The contract names it lowercase on the wire; matching is case-insensitive for
 * the same reason `ClaimRules` does it (the Go envelope writer lowercases domain
 * codes).
 */
const val ASSESS_OPT_IN_REQUIRED: String = "ai_optin_required"

/**
 * The machine-readable code for "the server has no AI key / the feature is
 * switched off". This is **not** a failure of the claim and must be shown
 * without an error tone.
 */
const val ASSESS_FEATURE_DISABLED: String = "feature_disabled"

/**
 * Which of the three preconditions is missing.
 *
 * `OPT_IN_REQUIRED` and `FEATURE_DISABLED` are both "not now", but they have
 * different ways out: one is a setting the user can change, the other is not
 * theirs to fix. Collapsing them into one "unavailable" state would either send
 * the user to Settings for nothing or hide the switch that would actually help.
 */
enum class ClaimAssessGate {
    /** The shared AI opt-in is off. The way out is the existing Settings toggle. */
    OPT_IN_REQUIRED,

    /** No API key / feature switched off server-side. No action helps. */
    FEATURE_DISABLED,

    /** Opted in and the server is expected to be able to answer. */
    READY,
}

/**
 * The gate state machine.
 *
 * [aiOptIn] is `null` when the opt-in check itself could not be read. That is
 * **not** treated as "off": the server is the authority on both gates, and
 * optimistically asking it is better than blocking a user whose settings call
 * failed. A 403/503 response then lands in the same two states via
 * [claimAssessFailure].
 *
 * `featureDisabled` wins over the opt-in deliberately: a server with no key
 * cannot answer whatever the toggle says, and "turn it on" would be false advice.
 */
fun claimAssessGate(aiOptIn: Boolean?, featureDisabled: Boolean = false): ClaimAssessGate =
    when {
        featureDisabled -> ClaimAssessGate.FEATURE_DISABLED
        aiOptIn == false -> ClaimAssessGate.OPT_IN_REQUIRED
        else -> ClaimAssessGate.READY
    }

/** What a failed assessment call means for the user. */
enum class ClaimAssessFailure {
    /** 403 `ai_optin_required`: the shared AI opt-in is off. */
    OPT_IN_REQUIRED,

    /** 503 `feature_disabled`: the server has no AI key. Not the user's fault. */
    FEATURE_DISABLED,

    /** Anything else (400, 404, 5xx, a dead socket): show the server's message. */
    OTHER,
}

/**
 * Maps the two gated failures by **both** status and code.
 *
 * A `feature_disabled` code on a 403 is not the documented contract, and neither
 * is `ai_optin_required` on a 503. Requiring the pair keeps an unrelated 403
 * (e.g. a permission bug) from being reported as "turn AI on" and an unrelated
 * 503 from being reported as a permanent feature switch. The comparison is
 * case-insensitive because the wire lowercases domain codes.
 */
fun claimAssessFailure(status: Int?, code: String?): ClaimAssessFailure = when {
    status == 403 && code?.equals(ASSESS_OPT_IN_REQUIRED, ignoreCase = true) == true ->
        ClaimAssessFailure.OPT_IN_REQUIRED
    status == 503 && code?.equals(ASSESS_FEATURE_DISABLED, ignoreCase = true) == true ->
        ClaimAssessFailure.FEATURE_DISABLED
    else -> ClaimAssessFailure.OTHER
}

/**
 * A parsed assessment failure: what it means and the server's own translated
 * sentence, read from the same one-shot body.
 *
 * The message is captured here for the same reason `ClaimWriteError` does it:
 * `ResponseBody.string()` can only be consumed once, so a helper that only read
 * the code would leave the screen with nothing to show for an `OTHER` failure.
 */
data class ClaimAssessError(
    val failure: ClaimAssessFailure,
    /** The envelope's `message` (already in the UI language), or `null`. */
    val serverMessage: String?,
)

/** [claimAssessFailure] over the `HttpException` Retrofit throws. */
fun claimAssessError(error: Throwable, json: Json): ClaimAssessError {
    if (error !is HttpException) {
        // No server sentence exists, and a socket's `localizedMessage` is the
        // platform's untranslated text. The screen's own resource fallback is the
        // language-correct message; returning null is what selects it.
        return ClaimAssessError(ClaimAssessFailure.OTHER, serverMessage = null)
    }
    val envelope: ApiErrorEnvelope? = runCatching {
        json.decodeFromString(
            ApiErrorEnvelope.serializer(),
            error.response()?.errorBody()?.string().orEmpty(),
        )
    }.getOrNull()
    return ClaimAssessError(
        failure = claimAssessFailure(error.code(), envelope?.error),
        serverMessage = envelope?.message,
    )
}

/**
 * The coverage label through the [AppStrings] seam. `LIKELY_…` stays a
 * possibility in both languages; the enum's own resource is the only source.
 */
fun coverageLabel(s: AppStrings, coverage: ClaimCoverage): String = s.get(coverage.labelRes)

/** The confidence label: "Medium confidence", never a bare "Medium". */
fun confidenceLabel(s: AppStrings, confidence: ClaimConfidence): String =
    s.get(confidence.labelRes)

/**
 * The sentence under the pills — the **"advice, not verdict"** copy selector.
 *
 * Every branch is advice and every branch names the next useful action (take the
 * questions/letter to the counter). No branch says "approved", "covered for
 * sure", "rejected" or "you must pay".
 */
fun coverageAdvice(s: AppStrings, coverage: ClaimCoverage): String = s.get(
    when (coverage) {
        ClaimCoverage.LIKELY_COVERED -> R.string.claim_assess_advice_likely_covered
        ClaimCoverage.UNCLEAR -> R.string.claim_assess_advice_unclear
        ClaimCoverage.LIKELY_NOT_COVERED -> R.string.claim_assess_advice_likely_not_covered
    },
)

/**
 * Colour bucket for the coverage pill.
 *
 * **Deliberately never `Success` or `Danger`.** Green would read as "approved"
 * and red as "rejected"; both are decisions the service centre has not made. The
 * likely-covered estimate is informational, unclear is neutral, and
 * likely-not-covered is a warning to check before paying — not a refusal.
 */
fun coveragePillKind(coverage: ClaimCoverage): PillKind = when (coverage) {
    ClaimCoverage.LIKELY_COVERED -> PillKind.Info
    ClaimCoverage.UNCLEAR -> PillKind.Neutral
    ClaimCoverage.LIKELY_NOT_COVERED -> PillKind.Warning
}

/**
 * The questions heading. An `UNCLEAR` result is a **success**: its questions are
 * the useful output, so they get their own heading instead of sitting under the
 * same "questions the counter may ask" label as a clear estimate.
 */
fun assessmentQuestionsTitle(s: AppStrings, coverage: ClaimCoverage): String = s.get(
    if (coverage == ClaimCoverage.UNCLEAR) {
        R.string.claim_assess_questions_title_unclear
    } else {
        R.string.claim_assess_questions_title
    },
)

/**
 * The questions, trimmed, with blank entries dropped.
 *
 * The server already trims, but the screen renders a numbered list and a blank
 * row would read as "question 3: nothing". Order is preserved: the questions are
 * already in the order the model thinks the counter will ask them.
 */
fun assessmentQuestions(assessment: ClaimAssessment): List<String> =
    assessment.questions.map { it.trim() }.filter { it.isNotEmpty() }

/**
 * The letter exactly as the server sent it, minus leading/trailing whitespace.
 *
 * This is the copy/share payload. It is **not** translated, not titled with an
 * English sentence, and not reflowed: `draftLetter` is Vietnamese on purpose and
 * the service centre reads those bytes. Trimming only removes the blank edges a
 * paste would otherwise carry.
 */
fun draftLetterText(assessment: ClaimAssessment): String = assessment.draftLetter.trim()

/**
 * The small provenance line: `Generated 19/10/2026 · claude-haiku…`, or `null`
 * when the server sent no usable `generatedAt`.
 *
 * A missing date is omitted rather than replaced with today's date: the point of
 * the line is that the estimate was made from the terms *at that time*.
 */
fun assessmentProvenance(s: AppStrings, assessment: ClaimAssessment): String? {
    val date = vietnamDate(assessment.generatedAt) ?: return null
    val model = assessment.model?.trim()?.takeIf { it.isNotEmpty() }
    return if (model != null) {
        s.get(R.string.claim_assess_generated_by, date, model)
    } else {
        s.get(R.string.claim_assess_generated_on, date)
    }
}
