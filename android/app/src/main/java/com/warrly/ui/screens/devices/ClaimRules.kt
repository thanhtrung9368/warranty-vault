package com.warrly.ui.screens.devices

import com.warrly.R
import com.warrly.i18n.AppStrings
import com.warrly.i18n.money
import com.warrly.network.ApiErrorEnvelope
import com.warrly.network.Claim
import com.warrly.network.ClaimStatus
import com.warrly.network.Device
import com.warrly.network.DeviceStatus
import com.warrly.ui.components.PillKind
import kotlinx.serialization.json.Json
import retrofit2.HttpException

/**
 * Warranty claims — the pure half.
 *
 * A claim is what happens after `Device.status = BROKEN`: the ticket number, the
 * shop, the diagnosis, whether the warranty paid. It is scoped to **one device**
 * (`deviceId` is required by the frozen contract), so this file has no notion of
 * a cross-device claim list. The screen that owns it is
 * `DeviceClaimsSection.kt`, inside `DeviceDetailScreen`; the form is
 * `ClaimEditSheet.kt`.
 *
 * Three rules live here because they are easy to get subtly wrong and unpleasant
 * to test through Compose:
 *
 *  1. **Open vs closed.** `OPEN` and `IN_REPAIR` are the live pair; the other
 *     three are terminal. The one-open-claim-per-device cap is about the live
 *     pair only — a device may have many resolved/rejected/cancelled claims.
 *  2. **The BROKEN dead end.** A device marked `BROKEN` with no live claim is
 *     the exact gap this feature exists to close: it gets a nudge with an add
 *     action on the detail screen.
 *  3. **The 409.** A second live claim is `409 limit_reached`. The wire is
 *     lowercase (the Go envelope writer lowercases domain codes), so the check is
 *     case-insensitive — the same rule `InboxRules` applies to `LIMIT_REACHED`
 *     for the attachment cap. The failure also carries the server's translated
 *     `message` and `fieldErrors`, read from the one-shot error body in a single
 *     pass.
 *
 * Everything is pure: plain values in, plain values out. The JVM tests pin both
 * languages through `ResCatalog` without Robolectric, the same seam
 * `WarrantyTerms.kt` and `InboxRules.kt` use.
 */

/**
 * The machine-readable code the contract names for "this device already has a
 * live claim". Stored lowercase on purpose: the Go envelope writer lowercases
 * every domain-service code, so `"limit_reached"` is what actually reaches the
 * wire (see [claimFailure], which accepts either spelling).
 */
const val CLAIM_LIMIT_REACHED: String = "limit_reached"

/**
 * One live claim per device, per the frozen contract. The server enforces it;
 * this constant exists so the UI copy and the rule can never drift.
 */
const val MAX_OPEN_CLAIMS_PER_DEVICE: Int = 1

/**
 * `true` for `OPEN`/`IN_REPAIR` — the two statuses that count as "a repair is
 * still happening". Exhaustive on purpose: adding a status to the enum without
 * deciding which side it belongs to must fail to compile.
 */
fun isOpenClaim(status: ClaimStatus): Boolean = when (status) {
    ClaimStatus.OPEN, ClaimStatus.IN_REPAIR -> true
    ClaimStatus.RESOLVED, ClaimStatus.REJECTED, ClaimStatus.CANCELLED -> false
}

/** Terminal statuses: `RESOLVED`, `REJECTED`, `CANCELLED`. */
fun isClosedClaim(status: ClaimStatus): Boolean = !isOpenClaim(status)

/** Convenience for list predicates, so a caller never re-spells the pair. */
val Claim.isOpen: Boolean
    get() = isOpenClaim(status)

/**
 * The first **live** claim in [claims], or `null` when every claim is terminal.
 *
 * The server orders its own list; this predicate is what answers "is a repair
 * open?" without depending on that order. The detail screen uses it for the
 * BROKEN nudge and the 409 dialog.
 */
fun openClaimOf(claims: List<Claim>): Claim? = claims.firstOrNull { it.isOpen }

/**
 * The claim a blocked create should send the user to: the live claim on the same
 * device, **excluding the claim currently being edited** (re-opening that one is
 * a different intent and must not point at itself).
 *
 * `null` means no live claim is known — the caller may then ask the server
 * (`GET /api/v1/claims?deviceId=…`) before telling the user there is no way out.
 */
fun claimLimitTarget(claims: List<Claim>, editingClaimId: String? = null): Claim? =
    claims.firstOrNull { it.id != editingClaimId && it.isOpen }

/**
 * The one sentence the feature exists to say: this device is marked **broken**
 * and still has no open repair. Terminal claims do not silence the nudge — a
 * device whose last repair was rejected is still broken.
 *
 * Every other status (`ACTIVE`, `EXPIRED`, `SOLD`, `LOST`) is deliberately
 * exempt: `EXPIRED` is a warranty state, not a repair state, and nagging about a
 * lost or sold device would be noise.
 */
fun brokenWithoutOpenClaim(status: DeviceStatus, claims: List<Claim>): Boolean =
    status == DeviceStatus.BROKEN && openClaimOf(claims) == null

/** [brokenWithoutOpenClaim] over a decoded device (the detail payload). */
fun Device.isBrokenWithoutOpenClaim(): Boolean = brokenWithoutOpenClaim(status, claims)

/**
 * Display order: live claims first, then newest `openedAt` first.
 *
 * The open repair is the row the user came to look at, so it must not fall below
 * a year of closed ones. `openedAt` is ISO-shaped (`YYYY-MM-DD…`), so a plain
 * string comparison is the right order; a blank value sorts last.
 */
fun claimsInDisplayOrder(claims: List<Claim>): List<Claim> =
    claims.sortedWith(
        compareByDescending<Claim> { it.isOpen }.thenByDescending { it.openedAt },
    )

/**
 * The status label through the [AppStrings] seam, so a pure formatter can be
 * tested in either language. A composable can also resolve
 * `stringResource(status.labelRes)` directly.
 */
fun claimStatusLabel(s: AppStrings, status: ClaimStatus): String = s.get(status.labelRes)

/**
 * Colour bucket for the status pill. `OPEN` is the warning colour (something is
 * wrong and not yet at the shop), `IN_REPAIR` is informational, `RESOLVED` is
 * success, `REJECTED` is danger, and `CANCELLED` is deliberately neutral: a
 * cancelled claim is not a failure the app should shout about.
 */
fun claimStatusPillKind(status: ClaimStatus): PillKind = when (status) {
    ClaimStatus.OPEN -> PillKind.Warning
    ClaimStatus.IN_REPAIR -> PillKind.Info
    ClaimStatus.RESOLVED -> PillKind.Success
    ClaimStatus.REJECTED -> PillKind.Danger
    ClaimStatus.CANCELLED -> PillKind.Neutral
}

/**
 * `1.200.000 ₫` / `₫1,200,000` through [AppStrings.money], or `null` when no
 * cost was recorded.
 *
 * **`0` is formatted, not hidden.** `null` is "not recorded" and `0` is a real
 * amount (a repair the shop did for free); collapsing them would erase a fact.
 */
fun claimCostLabel(s: AppStrings, cost: Int?): String? =
    cost?.let { s.money(it.toLong()) }

/**
 * The tri-state warranty-payment answer: `true`/`false`/`null` are three
 * different facts, so `null` gets its own word instead of falling back to "No".
 */
fun coveredByWarrantyLabel(s: AppStrings, covered: Boolean?): String = when (covered) {
    true -> s.get(R.string.claim_covered_yes)
    false -> s.get(R.string.claim_covered_no)
    null -> s.get(R.string.claim_covered_unknown)
}

/**
 * Digits-only text → a non-negative VND amount. Blank → `null` ("not recorded").
 *
 * Only used after [claimCostIsValid] is true, and it re-checks anyway: a
 * negative or overflowing value returns `null` here rather than being silently
 * reinterpreted.
 */
fun claimCostValue(raw: String): Int? {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return null
    return trimmed.takeIf { claimCostIsValid(it) }?.toIntOrNull()
}

/**
 * Mirror of the form's cost rule: blank is allowed, otherwise the text must be
 * **digits only and fit in an `Int`** — i.e. a whole, non-negative VND amount.
 * The keyboard is numeric and the field filters digits, so this mainly catches
 * a pasted string and an amount above `Int.MAX_VALUE`.
 */
fun claimCostIsValid(raw: String): Boolean {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return true
    if (trimmed.any { !it.isDigit() }) return false
    return trimmed.toIntOrNull() != null
}

/** What a failed claim write means for the user. */
enum class ClaimFailure {
    /**
     * 409 `limit_reached`: this device already has an `OPEN`/`IN_REPAIR` claim.
     * The screen must name the constraint and offer the existing ticket — not a
     * generic "conflict".
     */
    LIMIT_REACHED,

    /** Anything else (400, 404, 5xx, a dead socket): show the server's message. */
    OTHER,
}

/**
 * Maps the two wire facts that identify the cap to [ClaimFailure].
 *
 * Both the status **and** the code are required, and the code comparison is
 * case-insensitive because the Go envelope writer lowercases it. A 409 with
 * another code is a different conflict; a `limit_reached` code on a non-409 is
 * not the documented contract.
 */
fun claimFailure(status: Int?, errorCode: String?): ClaimFailure =
    if (status == 409 && errorCode?.equals(CLAIM_LIMIT_REACHED, ignoreCase = true) == true) {
        ClaimFailure.LIMIT_REACHED
    } else {
        ClaimFailure.OTHER
    }

/**
 * A parsed claim-write failure: what it means, the server's own translated
 * sentence, and any per-field errors — all read from the same one-shot error
 * body.
 *
 * Reading them together is deliberate: `ResponseBody.string()` can only be
 * consumed once, so a helper that only extracted the code would leave the form
 * with an empty body view and turn a real field error into
 * "Lỗi máy chủ (400)".
 */
data class ClaimWriteError(
    val failure: ClaimFailure,
    /** The envelope's `message` (already in the UI language), or `null`. */
    val serverMessage: String?,
    /** `fieldErrors` from the same envelope (`issue`, `cost`, `warrantyId`, …). */
    val fieldErrors: Map<String, List<String>> = emptyMap(),
)

/**
 * [claimFailure] plus the envelope details over the `HttpException` Retrofit
 * throws. A non-HTTP failure (dead socket, cancellation) is [ClaimFailure.OTHER]
 * with no server copy.
 */
fun claimWriteError(error: Throwable, json: Json): ClaimWriteError {
    if (error !is HttpException) {
        return ClaimWriteError(ClaimFailure.OTHER, serverMessage = null)
    }
    val envelope: ApiErrorEnvelope? = runCatching {
        json.decodeFromString(
            ApiErrorEnvelope.serializer(),
            error.response()?.errorBody()?.string().orEmpty(),
        )
    }.getOrNull()
    return ClaimWriteError(
        failure = claimFailure(error.code(), envelope?.error),
        serverMessage = envelope?.message,
        fieldErrors = envelope?.fieldErrors ?: emptyMap(),
    )
}
