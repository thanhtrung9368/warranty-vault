package com.warrly.ui.screens.devices

import com.warrly.R
import com.warrly.i18n.AppStrings
import com.warrly.network.ApiErrorEnvelope
import com.warrly.network.BulkDeviceRequest
import com.warrly.network.BulkDeviceResponse
import com.warrly.network.DEFAULT_CURRENCY
import com.warrly.network.Device
import com.warrly.network.DeviceInput
import com.warrly.network.DeviceStatus
import kotlinx.serialization.json.Json
import retrofit2.HttpException

/**
 * Bulk device add — the pure half.
 *
 * This is the single place where the frozen `POST /api/v1/devices/bulk` contract
 * is turned into rows a person can fix. The screen and its ViewModel are thin on
 * top of these rules; nothing here touches Compose or Android, so the JVM tests
 * pin the behaviour in both languages without Robolectric.
 *
 * ## The three rules that matter
 *
 *  1. **A row is mapped, not guessed.** [BulkDeviceDraft.toDeviceInput] sends
 *     the same [DeviceInput] as the single-device create and fills only the
 *     fields this screen collects. Everything else stays at the contract's
 *     default (VND, ACTIVE, no serial, no warranty terms).
 *  2. **A failure is joined back by request index.** The server's `failed[].index`
 *     is an index into the array that was sent, never a device id. A row that
 *     succeeded leaves the form; a row that failed keeps its draft, its stable
 *     [BulkDeviceDraft.key] and its own `fieldErrors` so the next submit sends
 *     *only* the failed rows.
 *  3. **The quota 409 is not a failed row.** `LIMIT_REACHED` refuses the whole
 *     batch before anything is stored, so it is represented as a
 *     [BulkRequestFailure] with [BulkFailureKind.LIMIT_REACHED], never as a
 *     failure index. The code is compared case-insensitively because the Go
 *     envelope writer lowercases domain-service codes (`limit_reached` on the
 *     wire), exactly like `InboxRules` and `ClaimRules`.
 *
 * ## Shape chosen
 *
 * The screen is built for **the person who just moved into a flat and is
 * entering five appliances in one sitting**, not for a shop keying in a large
 * supplier order. That person has a handful of items, the same-ish purchase date,
 * and no serial numbers yet; the minimum row (name / category / purchase date /
 * price) is enough to save each device and be useful. The shop-order shape would
 * need a grid, per-line brand/model/serial and a shared order total, which is a
 * different product with different copy. See `BulkAddDevicesScreen.kt` for the
 * fields deliberately left out and why they can be added later on each device.
 */

/**
 * `POST /api/v1/devices/bulk` accepts at most 50 rows. Over the cap the server
 * answers **400** with `fieldErrors.devices`; the screen also stops the user at
 * 50 so the error should be unreachable from the UI, but the server stays the
 * authority and the error is still rendered if it arrives.
 */
const val MAX_BULK_DEVICES: Int = 50

/**
 * `MAX_DEVICES_PER_USER` in `api/internal/services/devices.go`: **active** rows,
 * i.e. every status other than `SOLD`. Used only to tell the user how many slots
 * a 409 left them; the server is still the only enforcer.
 */
const val MAX_ACTIVE_DEVICES_PER_USER: Int = 50

/**
 * `MAX_DEVICES_TOTAL_PER_USER`: every stored row, sold included. A bulk create
 * adds ACTIVE rows, so both ceilings can refuse the same batch; the honest
 * answer to "how many can I still add" is the smaller of the two remainders.
 */
const val MAX_STORED_DEVICES_PER_USER: Int = 500

/**
 * The machine-readable 409 code. The contract spells it `LIMIT_REACHED`; the
 * wire carries lowercase because the Go envelope writer lowercases service
 * codes. [bulkRequestFailure] accepts either spelling.
 */
const val BULK_LIMIT_REACHED: String = "limit_reached"

/**
 * The category the first row starts on, matching the single-device form's
 * default. The category catalog is still a dropdown; this is only a starting
 * value so a row is never sent with an empty code.
 */
const val DEFAULT_BULK_CATEGORY: String = "PHONE"

/**
 * The four fields the bulk row collects, named exactly as the `DeviceInput` JSON
 * keys so a server `fieldErrors` map can be rendered against the right input.
 *
 * This enum is also the boundary of the row: anything else in `fieldErrors`
 * belongs to a field the bulk screen does not show, and
 * [BulkDeviceDraft.otherFieldErrors] surfaces it as a row-level message rather
 * than dropping it.
 */
enum class BulkDeviceField(val wireName: String) {
    NAME("name"),
    CATEGORY("category"),
    PURCHASE_DATE("purchaseDate"),
    PRICE("purchasePrice"),
}

/**
 * One editable row of the bulk form.
 *
 * [key] is both the Compose identity and the **row number shown to the user**.
 * It is allocated once by the ViewModel and preserved through
 * [reconcileBulkSubmit], so after "row 3 failed" the user still sees *Row 3*
 * even though the successful rows were removed from the form. New rows get
 * numbers above every number ever allocated, so a row added after a partial
 * success cannot collide with a retained failed row.
 *
 * [requestIndex] is the row's original 0-based position in the batch it was
 * first submitted with, used only to keep the display number meaningful across
 * retries. It is `null` until the row has been submitted.
 *
 * [fieldErrors] and [message] are server output attached by
 * [reconcileBulkSubmit]; they are cleared field-by-field as the user edits, so
 * a stale red error cannot survive the correction that fixed it.
 */
data class BulkDeviceDraft(
    val key: Int,
    val name: String = "",
    val category: String = DEFAULT_BULK_CATEGORY,
    /** `YYYY-MM-DD`; the form starts it at today, exactly like the single form. */
    val purchaseDate: String = "",
    /** Digits as typed; [toDeviceInput] turns it into `DeviceInput.purchasePrice`. */
    val purchasePrice: String = "",
    val fieldErrors: Map<String, List<String>> = emptyMap(),
    val message: String? = null,
    val requestIndex: Int? = null,
)

/**
 * A fresh row with the purchase date pre-filled.
 *
 * [today] is passed in instead of read from the clock so the ViewModel tests can
 * pin the value and so this file stays pure.
 */
fun newBulkDraft(key: Int, today: String): BulkDeviceDraft =
    BulkDeviceDraft(key = key, purchaseDate = today, category = DEFAULT_BULK_CATEGORY)

/**
 * A row with [field] set to [value], with that field's server error cleared.
 *
 * Clearing is deliberately scoped: editing the name must not erase the error
 * under the price. The row-level [message] is also dropped because the server's
 * sentence described the old values and would otherwise stay red after the user
 * has changed exactly the thing it complained about.
 */
fun BulkDeviceDraft.withField(field: BulkDeviceField, value: String): BulkDeviceDraft {
    val updated = when (field) {
        BulkDeviceField.NAME -> copy(name = value)
        BulkDeviceField.CATEGORY -> copy(category = value)
        BulkDeviceField.PURCHASE_DATE -> copy(purchaseDate = value)
        BulkDeviceField.PRICE -> copy(purchasePrice = value.filter { it.isDigit() })
    }
    return updated.copy(
        fieldErrors = fieldErrors - field.wireName,
        message = null,
    )
}

/** The server's messages for [field] on this row, or an empty list. */
fun BulkDeviceDraft.fieldErrorsFor(field: BulkDeviceField): List<String> =
    fieldErrors[field.wireName].orEmpty()

/**
 * Errors keyed to fields this screen does not render (for example `currency` or
 * `fxRate` if the contract ever changes). They are still shown, as a row-level
 * sentence, so a failed row never looks unexplained.
 */
fun BulkDeviceDraft.otherFieldErrors(): List<String> =
    fieldErrors
        .filterKeys { key -> BulkDeviceField.entries.none { it.wireName == key } }
        .values
        .flatten()

/**
 * A row that is completely empty apart from the pre-filled date/default
 * category is not sent: the user tapped "Add another row" and never filled it,
 * and submitting it would manufacture a failure for a device they never meant to
 * add.
 *
 * A row with a **name or a price** is sent even when it is missing a required
 * field; the server validates it per row and the response tells the user exactly
 * what to fix. A row where only the pre-filled date/category was touched is
 * still treated as untouched. That is the contract's partial-success design,
 * not a client guess.
 */
fun BulkDeviceDraft.isBlankForSubmit(): Boolean = name.isBlank() && purchasePrice.isBlank()

/** The rows that would go into the request, in form order. */
fun bulkDraftsToSubmit(rows: List<BulkDeviceDraft>): List<BulkDeviceDraft> =
    rows.filterNot(BulkDeviceDraft::isBlankForSubmit)

/** `false` once the form holds [MAX_BULK_DEVICES] rows. */
fun canAddBulkRow(rows: List<BulkDeviceDraft>): Boolean = rows.size < MAX_BULK_DEVICES

/**
 * Whether the submit button should be enabled. An empty form, or one containing
 * only untouched rows, has nothing the server could create.
 */
fun canSubmitBulk(rows: List<BulkDeviceDraft>): Boolean = bulkDraftsToSubmit(rows).isNotEmpty()

/**
 * The row-to-input mapping.
 *
 * Only the four collected fields are set. Every other [DeviceInput] property
 * keeps the default the single-device create uses, and because
 * `ApiClient.json` has `explicitNulls = false` the nullable ones are omitted
 * from the JSON rather than sent as `null`:
 *
 *  * `currency = VND`, `status = ACTIVE`;
 *  * `purchasePrice` defaults to `0` when the field is empty (the contract's
 *    default, and a legitimate "price not known" on this screen);
 *  * `leadDays`, `warrantyMonths`, brand, model, serial, sale record, return
 *    window and the brand-lookup group are all left to the single-device
 *    defaults.
 *
 * The trim is the client's only normalisation: the server owns validation, and
 * a name made solely of spaces must be refused by the server's rule (which is
 * also what the web and iOS send).
 */
fun BulkDeviceDraft.toDeviceInput(): DeviceInput = DeviceInput(
    name = name.trim(),
    category = category.trim().ifBlank { DEFAULT_BULK_CATEGORY },
    purchaseDate = purchaseDate.trim(),
    purchasePrice = purchasePrice.trim().toIntOrNull() ?: 0,
    currency = DEFAULT_CURRENCY,
    status = DeviceStatus.ACTIVE,
)

/**
 * The exact body the screen posts. Kept as a function (rather than assembling
 * the request at the call site) so the order of the array — which is what the
 * response's `index` refers to — has one definition.
 */
fun bulkDeviceRequest(rows: List<BulkDeviceDraft>): BulkDeviceRequest =
    BulkDeviceRequest(rows.map(BulkDeviceDraft::toDeviceInput))

/**
 * A row the server refused, joined back to the draft it came from.
 *
 * [draft] is a **copy** carrying the server's `fieldErrors` and row `message`;
 * the original draft stays untouched. [index] is the request-array index from
 * the response, and [serverMessage] is the same message in its own field for
 * callers that want to show it separately.
 */
data class BulkFailedRow(
    val draft: BulkDeviceDraft,
    val index: Int,
    val code: String,
    val serverMessage: String,
)

/**
 * The result of one bulk submit, reconciled against the rows that were sent.
 *
 * [unaccountedCount] is the contract-violation guard: a row that is in neither
 * `created` nor `failed` must not be silently reported as success. The normal
 * contract leaves it at zero (every row is one or the other).
 */
data class BulkReconciliation(
    val created: List<Device>,
    /** Failed rows, in request order, each with its own field errors attached. */
    val failed: List<BulkFailedRow>,
    val unaccountedCount: Int,
) {
    /** Only the rows the user must fix and resubmit. */
    val failedDrafts: List<BulkDeviceDraft> get() = failed.map(BulkFailedRow::draft)

    val allCreated: Boolean get() = failed.isEmpty() && unaccountedCount == 0
}

/**
 * Reconcile a 200 response with [submitted] (the exact list that was posted).
 *
 * The response gives us no identity for a **created** row (only a bare
 * `Device[]`), so success is inferred from the counts: with `created + failed ==
 * submitted`, every row not named in `failed` was created. A shorter `created`
 * array is surfaced as [BulkReconciliation.unaccountedCount] instead of being
 * turned into a fake success or a fake failure.
 *
 * Failure indexes are validated against the submitted list: an out-of-range
 * index cannot belong to this request, and a duplicate index is a server bug.
 * The first valid occurrence wins, deterministically, and the ignored entries
 * simply show up in the unaccounted count rather than crashing the screen.
 *
 * The returned failed draft preserves its original [BulkDeviceDraft.key] and
 * (if present) its original [BulkDeviceDraft.requestIndex], so a retry keeps
 * the row number the user saw.
 */
fun reconcileBulkSubmit(
    submitted: List<BulkDeviceDraft>,
    response: BulkDeviceResponse,
): BulkReconciliation {
    val failed = response.failed
        .asSequence()
        .filter { it.index in submitted.indices }
        .distinctBy { it.index }
        .sortedBy { it.index }
        .map { failure ->
            val original = submitted[failure.index]
            BulkFailedRow(
                draft = original.copy(
                    fieldErrors = failure.fieldErrors,
                    message = failure.message.ifBlank { null },
                    requestIndex = original.requestIndex ?: failure.index,
                ),
                index = failure.index,
                code = failure.code,
                serverMessage = failure.message,
            )
        }
        .toList()

    return BulkReconciliation(
        created = response.created,
        failed = failed,
        unaccountedCount =
            (submitted.size - response.created.size - failed.size).coerceAtLeast(0),
    )
}

// ---- The quota 409 ---------------------------------------------------------

/** What a batch-level failure means for the user. */
enum class BulkFailureKind {
    /**
     * 409 `limit_reached`: the whole batch was refused and **nothing** was
     * created. The screen must say that and show the remaining slots.
     */
    LIMIT_REACHED,

    /** Anything else: 400/5xx/a dead socket. The server's message is the copy. */
    OTHER,
}

/**
 * A parsed batch-level failure. [status] is `null` for a transport failure (no
 * HTTP response); the screen turns that into its localized network sentence.
 */
data class BulkRequestFailure(
    val kind: BulkFailureKind,
    val serverMessage: String? = null,
    val fieldErrors: Map<String, List<String>> = emptyMap(),
    val status: Int? = null,
) {
    /**
     * The batch-level `fieldErrors.devices` messages (over 50 rows, or whatever
     * the server says about the array). Rendered next to [serverMessage].
     */
    val deviceFieldErrors: List<String> get() = fieldErrors["devices"].orEmpty()
}

/**
 * Map the two wire facts that identify the all-or-nothing quota refusal.
 *
 * Both the status **and** the code are required, and the code comparison is
 * case-insensitive on purpose: the contract spells it `LIMIT_REACHED` while the
 * Go envelope writer sends lowercase `limit_reached`. A 409 with another code is
 * a different conflict; a `limit_reached` code on a non-409 is not the documented
 * contract.
 */
fun bulkRequestFailure(status: Int?, errorCode: String?): BulkFailureKind =
    if (status == 409 && errorCode?.equals(BULK_LIMIT_REACHED, ignoreCase = true) == true) {
        BulkFailureKind.LIMIT_REACHED
    } else {
        BulkFailureKind.OTHER
    }

/**
 * [bulkRequestFailure] over the exception Retrofit throws, reading the code, the
 * translated message and `fieldErrors` from the same one-shot error body.
 *
 * Reading them in one pass matters: `ResponseBody.string()` is consumed, so a
 * helper that only extracted the code would leave the screen with an empty body
 * and turn a real 400 `fieldErrors.devices` into "Server error (400)".
 */
fun bulkRequestError(error: Throwable, json: Json): BulkRequestFailure {
    if (error !is HttpException) {
        return BulkRequestFailure(kind = BulkFailureKind.OTHER)
    }
    val envelope: ApiErrorEnvelope? = runCatching {
        json.decodeFromString(
            ApiErrorEnvelope.serializer(),
            error.response()?.errorBody()?.string().orEmpty(),
        )
    }.getOrNull()
    return BulkRequestFailure(
        kind = bulkRequestFailure(error.code(), envelope?.error),
        serverMessage = envelope?.message,
        fieldErrors = envelope?.fieldErrors.orEmpty(),
        status = error.code(),
    )
}

// ---- Capacity --------------------------------------------------------------

/**
 * How many **new ACTIVE rows** the account can still take, derived from the
 * device list the screen already has to load.
 *
 * Two independent ceilings apply and both can refuse a bulk batch, so the
 * actionable number is the smaller remainder:
 *
 *  * [activeRemaining] — 50 minus every row whose status is not `SOLD`;
 *  * [storageRemaining] — 500 minus every stored row, sold included.
 *
 * The status is the authority, never `soldAt`: a device with a sale date but
 * `status = ACTIVE` still occupies an active slot (the server's rule).
 *
 * The result is clamped at zero so an account already above a ceiling (which
 * the contract allows after un-selling a device) shows "0 slots left" rather
 * than a negative number.
 */
data class BulkQuota(
    val activeRemaining: Int,
    val storageRemaining: Int,
) {
    /** New ACTIVE devices this account can still accept. */
    val newDeviceRemaining: Int get() = minOf(activeRemaining, storageRemaining).coerceAtLeast(0)
}

/** Derive [BulkQuota] from `GET /api/v1/devices` (all statuses, no filter). */
fun bulkQuota(devices: List<Device>): BulkQuota {
    val active = devices.count { it.status != DeviceStatus.SOLD }
    return BulkQuota(
        activeRemaining = (MAX_ACTIVE_DEVICES_PER_USER - active).coerceAtLeast(0),
        storageRemaining = (MAX_STORED_DEVICES_PER_USER - devices.size).coerceAtLeast(0),
    )
}

/**
 * The sentence that answers the 409's real question: **how many can I still
 * add?** [slots] is [BulkQuota.newDeviceRemaining], or `null` when the device
 * list could not be loaded — then the app says the limit was hit instead of
 * inventing a number.
 *
 * Pure and language-injectable so the JVM test can pin the exact Vietnamese and
 * English wording through `ResCatalog`.
 */
fun bulkLimitRemainingMessage(s: AppStrings, slots: Int?): String = when {
    slots == null -> s.get(R.string.bulk_limit_remaining_unknown)
    slots <= 0 -> s.get(R.string.bulk_limit_remaining_zero)
    else -> s.quantity(R.plurals.bulk_limit_remaining, slots, slots)
}
