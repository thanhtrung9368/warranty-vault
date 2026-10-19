package com.warrly.ui.screens.devices

import androidx.annotation.StringRes
import com.warrly.R
import com.warrly.i18n.AppStrings
import com.warrly.network.BrandOption
import com.warrly.network.BrandWarrantyStatus
import com.warrly.network.DEFAULT_CURRENCY
import com.warrly.network.Device
import com.warrly.network.DeviceInput
import com.warrly.network.WarrantyMismatch
import com.warrly.network.normalizeLeadDays
import com.warrly.ui.components.PillKind
import com.warrly.ui.components.parseIsoDate
import com.warrly.ui.screens.vietnamDate
import java.time.Clock
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.abs

/**
 * Brand warranty lookup — the pure half.
 *
 * ## The problem, in one paragraph
 *
 * The warranty start the user typed is a **guess from the invoice**. The brand's
 * own system holds the date it actually activated, and the two routinely differ:
 * a grey-market import activated months earlier, a shop that pre-activated a
 * unit before selling it, a repaired device re-registered under a new serial. So
 * the app says "eight months left" while the counter says it expired last week.
 * The fix is not to guess a live number — no manufacturer exposes an API — but to
 * **guide the user to the brand's own lookup page and record what it said**.
 *
 * ## What this file owns
 *
 *  1. **The four mismatch kinds** and their copy, in the UI language. Plain
 *     words with both dates; the colour decision belongs to the composable and
 *     is deliberately not "error red".
 *  2. **The status labels**, through the `@StringRes` on the enum so the pill,
 *     the dropdown and the card can never drift.
 *  3. **The "no lookup URL for this brand" state.** There is no fallback search
 *     URL and no URL template: a missing link is a sentence, never a guess.
 *  4. **The day arithmetic** behind a mismatch, so a 47-day gap is 47 in both
 *     languages and a leap day does not become 46.
 *  5. **The record-sheet rules** the API enforces (`brandWarrantyStatus` required
 *     whenever anything else is set, end not before start, absolute `http(s)`
 *     URL) so a save is blocked locally instead of becoming a 400.
 *  6. **The full-replacement round trip.** `PATCH /devices/{id}` replaces every
 *     field, so recording one brand answer must send the whole row back
 *     ([deviceInputForBrandWarranty]) — exactly the trap `returnWindowDays`
 *     documents.
 *
 * Everything here is pure: values in, values out, no `Context`, no clock the
 * test cannot inject. The JVM tests pin both languages through `ResCatalog`,
 * the same seam `ClaimRules.kt` and `DeviceCurrency.kt` use.
 */

// ---- Labels ----

/** The status label in the UI language, from the enum's own `@StringRes`. */
internal fun brandWarrantyStatusLabel(s: AppStrings, status: BrandWarrantyStatus): String =
    s.get(status.labelRes)

/**
 * The colour bucket for the status pill.
 *
 * Deliberately calm: only [BrandWarrantyStatus.ACTIVE] is success-green, and
 * [BrandWarrantyStatus.PRE_ACTIVATED] is informational rather than a warning —
 * it describes how the unit was sold, not a failure. No state uses danger-red:
 * the brand's answer is not an error in the user's data.
 */
internal fun brandWarrantyStatusPillKind(status: BrandWarrantyStatus): PillKind = when (status) {
    BrandWarrantyStatus.ACTIVE -> PillKind.Success
    BrandWarrantyStatus.EXPIRED -> PillKind.Neutral
    BrandWarrantyStatus.NOT_REGISTERED -> PillKind.Neutral
    BrandWarrantyStatus.PRE_ACTIVATED -> PillKind.Info
    BrandWarrantyStatus.UNKNOWN -> PillKind.Neutral
}

/**
 * `true` when anything about the brand's answer was recorded — including a
 * "checked but no dates" row. An empty record is `false` and the card stays
 * hidden instead of showing five blank lines.
 */
internal fun hasBrandWarrantyRecord(
    status: BrandWarrantyStatus?,
    startDate: String?,
    endDate: String?,
    checkedAt: String?,
    lookupUrl: String?,
): Boolean =
    status != null ||
        !startDate.isNullOrBlank() ||
        !endDate.isNullOrBlank() ||
        !checkedAt.isNullOrBlank() ||
        !lookupUrl.isNullOrBlank()

/** [hasBrandWarrantyRecord] over a decoded device. */
internal fun Device.hasBrandWarrantyRecord(): Boolean =
    hasBrandWarrantyRecord(
        status = brandWarrantyStatus,
        startDate = brandWarrantyStart,
        endDate = brandWarrantyEnd,
        checkedAt = brandCheckedAt,
        lookupUrl = brandLookupUrl,
    )

/**
 * The calm "no mismatch" state.
 *
 * The agreement line is deliberately narrower than "a brand record exists and
 * `warrantyMismatch` is null". The contract defines `null` as "no mismatch **or
 * nothing to compare**": the end comparison needs a whole-unit warranty on the
 * device, and a device with only a component warranty has no end to compare. So
 * the line is only shown when the **start** date was recorded — the server
 * always compares that against `purchaseDate`, and the mismatch priority means a
 * null result with a start present really does mean the two starts agree.
 *
 * The copy says exactly that ("the brand's start matches your purchase date")
 * rather than the broader "the dates agree", which the client cannot prove for
 * the end on a payload without warranty rows.
 */
internal fun brandWarrantyAgrees(device: Device): Boolean =
    device.warrantyMismatch == null &&
        device.hasBrandWarrantyRecord() &&
        !device.brandWarrantyStart.isNullOrBlank()

// ---- Wire <-> form ----

/**
 * Wire → form. Both brand dates are **calendar days** (`YYYY-MM-DD`); the
 * 10-char prefix is the whole value, so `"2026-03-02"` stays `"2026-03-02"`.
 * Missing/blank → `""`. Never parsed as an instant — a day has no timezone to
 * apply.
 */
internal fun brandWarrantyDateInput(wire: String?): String = wire?.trim()?.take(10).orEmpty()

/** Form → request. Blank means "not recorded" and drops the key from the JSON. */
internal fun brandWarrantyDateRequest(raw: String): String? =
    raw.trim().take(10).ifBlank { null }

/**
 * The instant stamped into `brandCheckedAt` when the record sheet is saved.
 *
 * Injectable [Clock] so the test pins the exact RFC3339 string; production
 * passes the default. The server compares it to nothing, but it is the honest
 * "when did you see this" that makes a stale record recognisable.
 */
internal fun brandCheckedAtNow(clock: Clock = Clock.systemUTC()): String =
    clock.instant().toString()

/** `"2026-03-02T…"` → `"02/03/2026"`; malformed/absent → `null`. */
internal fun brandCheckedAtLabel(wire: String?): String? = vietnamDate(wire)

// ---- Day arithmetic ----

/**
 * Calendar days from [fromIso] to [toIso], or `null` when either is not a real
 * `YYYY-MM-DD` date.
 *
 * Deliberately `LocalDate` + [ChronoUnit.DAYS]: no timezone, no DST, no 23/25h
 * day. A leap day (2024-02-29 → 2024-03-01) is one day, and `2026-02-31` is not
 * a date at all rather than being silently rolled to 3 March.
 */
internal fun daysBetweenIsoDates(fromIso: String?, toIso: String?): Long? {
    val from = parseIsoDate(fromIso) ?: return null
    val to = parseIsoDate(toIso) ?: return null
    return ChronoUnit.DAYS.between(from, to)
}

/**
 * The absolute day count the copy prints.
 *
 * The server's `days` is authoritative and is used whenever it is non-zero. The
 * dated fallback exists only for a payload that carries a kind but forgot the
 * count: showing "0 days" beside two dates a month apart would be the kind of
 * quiet lie this feature exists to prevent.
 */
internal fun mismatchDays(mismatch: WarrantyMismatch): Int {
    val reported = abs(mismatch.days)
    if (reported > 0) return reported
    return abs(daysBetweenIsoDates(mismatch.brandDate, mismatch.purchaseDate) ?: 0L)
        .coerceAtMost(Int.MAX_VALUE.toLong())
        .toInt()
}

// ---- Mismatch copy ----

/**
 * The four kinds the frozen contract defines. Each carries the plural resource
 * for its sentence; the enum name matches the wire string exactly (the client
 * compares case-insensitively, because the Go envelope writer lowercases codes
 * elsewhere and a future server may normalise them).
 */
internal enum class BrandMismatchKind(@StringRes val daysRes: Int) {
    /** The brand's start is EARLIER than the purchase date: less cover left. */
    STARTS_BEFORE(R.plurals.brand_mismatch_starts_before),

    /** The brand's start is LATER than the purchase date: more cover than typed. */
    STARTS_AFTER(R.plurals.brand_mismatch_starts_after),

    /** The brand's end is EARLIER than the date on the user's side. */
    ENDED_EARLIER(R.plurals.brand_mismatch_ended_earlier),

    /** The brand's end is LATER than the date on the user's side. */
    ENDED_LATER(R.plurals.brand_mismatch_ended_later),
}

/**
 * Wire `kind` → [BrandMismatchKind], or `null` for one this build does not
 * know. An unknown kind is **not** an error: the card still shows both dates
 * and the record, it just does not print a sentence it cannot justify.
 */
internal fun brandMismatchKind(raw: String?): BrandMismatchKind? {
    val wanted = raw?.trim() ?: return null
    return BrandMismatchKind.entries.firstOrNull { it.name.equals(wanted, ignoreCase = true) }
}

/**
 * The plain-language sentence for a mismatch, or `null` when this build cannot
 * say it honestly (unknown kind, or a date the app refuses to format).
 *
 * Both dates are always in the sentence — that is the requirement: "Hãng ghi
 * bảo hành bắt đầu trước ngày mua 47 ngày" is only actionable because it names
 * the two dates. The tone is descriptive, never alarmist; the composable paints
 * it in a neutral container, not `colorScheme.error`.
 */
internal fun brandMismatchMessage(s: AppStrings, mismatch: WarrantyMismatch): String? {
    val kind = brandMismatchKind(mismatch.kind) ?: return null
    val brandDate = vietnamDate(mismatch.brandDate) ?: return null
    val purchaseDate = vietnamDate(mismatch.purchaseDate) ?: return null
    val days = mismatchDays(mismatch)
    return s.quantity(kind.daysRes, days, days, brandDate, purchaseDate)
}

// ---- Lookup URL / state ----

/**
 * A URL this client is willing to hand to the browser: **absolute
 * `http://` or `https://` with a host**, otherwise `null`.
 *
 * This is the one gate every lookup button goes through. `null` is the honest
 * answer for a missing URL and for a value that is not an absolute web URL
 * (`javascript:`, `intent://`, a bare host, whitespace). No branch here builds
 * a URL from a brand name or a search engine — a guessed page is worse than a
 * missing one, because it can show a warranty for the wrong device.
 */
internal fun brandLookupUrl(raw: String?): String? {
    val url = raw?.trim().orEmpty()
    if (url.isEmpty()) return null
    val parsed = runCatching { java.net.URI(url) }.getOrNull() ?: return null
    val scheme = parsed.scheme?.lowercase(Locale.ROOT) ?: return null
    if (scheme != "http" && scheme != "https") return null
    if (parsed.host.isNullOrBlank()) return null
    return url
}

/** What the "Đối chiếu với hãng" action can say, before it makes a request. */
internal sealed interface BrandLookupState {
    /** A real, absolute http(s) page to open. */
    data class Available(val url: String) : BrandLookupState

    /** A brand was named but the API has no page for it. Never guessed. */
    data object NoUrl : BrandLookupState

    /** The device has no brand recorded, so there is nothing to look up. */
    data object NoBrand : BrandLookupState
}

/**
 * The state the UI renders for a brand name and the API's (nullable) URL.
 *
 * The order matters: "no brand" is a different sentence from "we know the brand
 * but not its page", and both are different from "a page exists". Keeping the
 * decision here is what stops a composable from accidentally inventing a URL
 * when [BrandLookupState.NoUrl] was the answer.
 */
internal fun brandLookupState(brandName: String?, lookupUrl: String?): BrandLookupState {
    if (brandName.isNullOrBlank()) return BrandLookupState.NoBrand
    return brandLookupUrl(lookupUrl)
        ?.let { BrandLookupState.Available(it) }
        ?: BrandLookupState.NoUrl
}

/** The plain sentence for [BrandLookupState.NoUrl] / [BrandLookupState.NoBrand]. */
internal fun brandLookupMissingMessage(s: AppStrings, brandName: String?): String =
    if (brandName.isNullOrBlank()) {
        s.get(R.string.brand_lookup_no_brand)
    } else {
        s.get(R.string.brand_lookup_no_url, brandName)
    }

/**
 * What the lookup action says when it does not get as far as opening a page.
 *
 * [Unavailable] is not a failure: the app simply has no sourced page for the
 * brand. [Failed] is "the request or the browser failed" and is the only one
 * rendered in an error colour.
 */
internal sealed interface BrandLookupNotice {
    val text: String

    /** No brand recorded, or no sourced page for the brand. Not an error. */
    data class Unavailable(override val text: String) : BrandLookupNotice

    /** The request failed or no browser could open the page. */
    data class Failed(override val text: String) : BrandLookupNotice
}

/**
 * Resolve the free-text `Device.brand` ("Samsung") to a `Brand.id` ("samsung")
 * for the service-info endpoint.
 *
 * Deliberately **exact** and **unique**: trim + case-insensitive match against
 * the catalog name or id, and `null` as soon as zero or two brands match. This
 * is stricter than the server's directory matcher (which allows "Samsung
 * Galaxy S24" to contain "Samsung"), and that is the right direction for a
 * lookup link — a wrong brand's portal is exactly the failure this feature must
 * not produce. The user can always record the page manually.
 */
internal fun brandIdForName(brandName: String?, brands: List<BrandOption>): String? {
    val wanted = brandName?.trim()?.lowercase(Locale.ROOT) ?: return null
    if (wanted.isEmpty()) return null
    val matches = brands.filter {
        it.id.trim().lowercase(Locale.ROOT) == wanted ||
            it.name.trim().lowercase(Locale.ROOT) == wanted
    }
    return matches.singleOrNull()?.id
}

// ---- The record sheet ----

/**
 * Everything the record sheet collects. `checkedAt` is not user-typed: the sheet
 * stamps it with [brandCheckedAtNow] on save, and the field is here so the same
 * value type can also describe an existing record.
 */
internal data class BrandWarrantyDraft(
    val status: BrandWarrantyStatus? = null,
    val startDate: String? = null,
    val endDate: String? = null,
    val lookupUrl: String? = null,
    val checkedAt: String? = null,
)

/** [hasBrandWarrantyRecord] over a draft (the form's in-progress copy). */
internal fun BrandWarrantyDraft.hasRecord(): Boolean = hasBrandWarrantyRecord(
    status = status,
    startDate = startDate,
    endDate = endDate,
    checkedAt = checkedAt,
    lookupUrl = lookupUrl,
)

/** The draft an existing device already carries (for prefilling the sheet). */
internal fun brandWarrantyDraftOf(device: Device): BrandWarrantyDraft = BrandWarrantyDraft(
    status = device.brandWarrantyStatus,
    startDate = brandWarrantyDateRequest(device.brandWarrantyStart.orEmpty()),
    endDate = brandWarrantyDateRequest(device.brandWarrantyEnd.orEmpty()),
    lookupUrl = device.brandLookupUrl,
    checkedAt = device.brandCheckedAt,
)

/** What blocks a save, in the order the form reads the fields. */
internal enum class BrandWarrantyDraftProblem {
    /** Another field is set but the status is not: the API's own required rule. */
    StatusRequired,

    /** A date is present but not a real `YYYY-MM-DD`. */
    DateInvalid,

    /** Both dates parse and the end precedes the start. */
    EndBeforeStart,

    /** A URL is present but is not an absolute http(s) URL. */
    LookupUrlInvalid,
}

/**
 * Mirror of the API's write rules, evaluated before a request:
 *
 *  * `brandWarrantyStatus` is required whenever any other `brandWarranty*`
 *    field is set (`fieldErrors.brandWarrantyStatus`);
 *  * `brandWarrantyEnd` must not precede `brandWarrantyStart`;
 *  * `brandLookupUrl` must be absolute `http(s)`.
 *
 * A blank row (nothing set) is valid: it means "clear the record", and the API
 * accepts it. `checkedAt` counts as "another field set", which is why opening
 * the sheet and saving without a status is blocked rather than silently storing
 * an unattributed date.
 */
internal fun brandWarrantyDraftProblem(draft: BrandWarrantyDraft): BrandWarrantyDraftProblem? {
    val start = draft.startDate?.trim()?.takeIf { it.isNotEmpty() }
    val end = draft.endDate?.trim()?.takeIf { it.isNotEmpty() }
    val url = draft.lookupUrl?.trim()?.takeIf { it.isNotEmpty() }
    val anythingElse = start != null || end != null || url != null || !draft.checkedAt.isNullOrBlank()
    if (anythingElse && draft.status == null) return BrandWarrantyDraftProblem.StatusRequired
    if (start != null && parseIsoDate(start) == null) return BrandWarrantyDraftProblem.DateInvalid
    if (end != null && parseIsoDate(end) == null) return BrandWarrantyDraftProblem.DateInvalid
    if (start != null && end != null) {
        val days = daysBetweenIsoDates(start, end) ?: return BrandWarrantyDraftProblem.DateInvalid
        if (days < 0) return BrandWarrantyDraftProblem.EndBeforeStart
    }
    if (url != null && brandLookupUrl(url) == null) {
        return BrandWarrantyDraftProblem.LookupUrlInvalid
    }
    return null
}

/** The one sentence for a [BrandWarrantyDraftProblem]. */
internal fun brandWarrantyProblemMessage(
    s: AppStrings,
    problem: BrandWarrantyDraftProblem,
): String = when (problem) {
    BrandWarrantyDraftProblem.StatusRequired -> s.get(R.string.brand_sheet_status_required)
    BrandWarrantyDraftProblem.DateInvalid -> s.get(R.string.brand_sheet_date_invalid)
    BrandWarrantyDraftProblem.EndBeforeStart -> s.get(R.string.brand_sheet_end_before_start)
    BrandWarrantyDraftProblem.LookupUrlInvalid -> s.get(R.string.brand_sheet_url_invalid)
}

/**
 * The **full** device payload a record save must send.
 *
 * `PATCH /api/v1/devices/{id}` replaces every field, not just the ones in the
 * body. Sending only the brand block would erase the name, the price, the
 * warranty activation, the reminder schedule and the return window. Every
 * writable column is therefore copied from the loaded [device], and only the
 * brand fields come from [draft]. The columns a PATCH does not own
 * (`warranties`, `claims`, `attachmentCount`, derived dates) are absent from
 * [DeviceInput] by design and are untouched server-side.
 *
 * `warrantyMonths` stays `0`, exactly like the edit path of `AddDeviceSheet`:
 * it is the create-only shortcut, not a replacement for the separate warranty
 * endpoints.
 */
internal fun deviceInputForBrandWarranty(
    device: Device,
    draft: BrandWarrantyDraft,
): DeviceInput {
    val currency = normalizeCurrency(device.currency)
    return DeviceInput(
        name = device.name,
        category = device.category,
        brand = device.brand,
        model = device.model,
        serialNumber = device.serialNumber,
        purchaseDate = device.purchaseDate.take(10),
        purchasePrice = device.purchasePrice,
        currency = currency,
        // The contract's VND pair: a dong device never carries a rate. Any other
        // currency keeps the locked rate it was loaded with (a missing rate is
        // the server's 400, not something to paper over here).
        fxRate = if (currency == DEFAULT_CURRENCY) null else device.fxRate,
        purchasePlace = device.purchasePlace,
        status = device.status,
        notes = device.notes,
        soldAt = device.soldAt?.take(10),
        soldPrice = device.soldPrice,
        returnWindowDays = device.returnWindowDays,
        receivedAt = device.receivedAt?.take(10),
        activationRequired = device.activationRequired,
        activatedAt = device.activatedAt?.take(10),
        extendedCoverBuyBy = device.extendedCoverBuyBy?.take(10),
        leadDays = normalizeLeadDays(device.leadDays),
        brandWarrantyStatus = draft.status,
        brandWarrantyStart = draft.startDate,
        brandWarrantyEnd = draft.endDate,
        brandCheckedAt = draft.checkedAt,
        brandLookupUrl = draft.lookupUrl,
    )
}

/**
 * The mismatch to keep after a `PATCH` response that may or may not carry the
 * computed field.
 *
 * `warrantyMismatch` is a read-side projection, like `returnDeadline`, so a
 * bare write response can omit it. Keeping the old one unconditionally would
 * leave a stale sentence on screen after the brand dates changed; dropping it
 * unconditionally would make an ordinary name edit look like the check result
 * vanished. So it is kept only while the five inputs it was computed from are
 * demonstrably unchanged — the exact rule `keptReturnDeadline` applies, and the
 * value always reappears on the next detail read.
 */
internal fun keptWarrantyMismatch(previous: Device, written: Device): WarrantyMismatch? {
    written.warrantyMismatch?.let { return it }
    val inputsUnchanged =
        previous.brandWarrantyStatus == written.brandWarrantyStatus &&
            previous.brandWarrantyStart == written.brandWarrantyStart &&
            previous.brandWarrantyEnd == written.brandWarrantyEnd &&
            previous.brandCheckedAt == written.brandCheckedAt &&
            previous.brandLookupUrl == written.brandLookupUrl
    return if (inputsUnchanged) previous.warrantyMismatch else null
}
