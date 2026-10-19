package com.warrly.network

import androidx.annotation.StringRes
import com.warrly.R
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.descriptors.element
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

// ---- Display labels on the domain enums ----
//
// Every enum below carries `@StringRes labelRes` instead of a hardcoded
// `val label: String`. The labels used to be 26 Vietnamese literals — so the
// device / subscription / wishlist status pills, the edit-sheet dropdowns, the
// detail rows and the CSV status column all stayed Vietnamese in English mode,
// while the labels around them switched. A resource id is what the rest of this
// app already does for a display label (`ui/theme/ThemePreference.kt`,
// `ui/screens/subscriptions/SubscriptionFilters.kt`), and it is resolvable from
// both worlds the labels are read in:
//
//   * a composable → `stringResource(status.labelRes)`
//   * a pure formatter that was handed the `i18n/AppStrings.kt` seam →
//     `s.get(status.labelRes)` (so `CsvExport`, `ForecastFormat`, … stay pure
//     and stay testable in either language without Robolectric).
//
// The Vietnamese wording in `res/values-vi/` is byte-for-byte what these
// literals were; the English in `res/values/` reuses the wording the Go catalog
// and the web dictionary already print for the same enum member. No Go, Swift or
// TypeScript test parses this file (only `ui/components/CategoryLabels.kt` is
// cross-repo-pinned — see `api/internal/services/category_seed_test.go`); the
// Android-side pin is `ModelsSerializationTest`, which reads the catalogs.

// ---- Auth ----

@Serializable
data class AuthSuccess(val accessToken: String, val expiresAt: String, val user: User)

@Serializable
data class User(
    val id: String,
    val email: String,
    val name: String? = null,
    val aiOptIn: Boolean = false,
    /**
     * `User.locale` — `"vi"`, `"en"`, or `null` for "never chosen"
     * (docs/I18N_PLAN.md §2.3). `omitempty` on the server, so an account that
     * has never opened the language switcher sends no byte at all and an older
     * client keeps decoding.
     *
     * This is what the cron push fan-out and the transactional emails read: they
     * run with no request context, so `Accept-Language` is not available to them.
     * The device keeps its own copy for the UI
     * ([com.warrly.i18n.LanguageStore]); the two are reconciled on
     * sign-in and on every change (see `AuthStore.updateLocale`).
     */
    val locale: String? = null,
) {
    /**
     * What the profile card shows: the saved display name, or the account email
     * when no name is set. The server trims and maps blank → NULL, so a stored
     * name is never blank — the `takeIf` only guards a whitespace name coming
     * from an older/cached payload.
     */
    val displayLabel: String
        get() = name?.takeIf { it.isNotBlank() } ?: email
}

@Serializable
data class RegisterInput(
    val email: String,
    val password: String,
    val name: String? = null,
    val deviceLabel: String? = null,
    val platform: String? = "android",
)

@Serializable
data class LoginInput(
    val email: String,
    val password: String,
    val deviceLabel: String? = null,
    val platform: String? = "android",
)

@Serializable
data class MeResponse(val user: User)

/**
 * Body of `PATCH /api/v1/auth/me` (openapi `UpdateProfileInput`).
 *
 * `displayName` is one of TWO accepted fields and the key is **required**: a
 * body without it is 400 `fieldErrors.displayName = ["Thiếu displayName"]`,
 * while an empty (or whitespace-only) string clears the stored name
 * (`User.name` → null).
 *
 * Deliberately non-nullable: `ApiClient.json` sets `explicitNulls = false`, so a
 * `null` would drop the key entirely and turn "clear my name" into a 400.
 * `""` is the documented clear value, so it is what the UI sends.
 *
 * ## The other accepted field
 *
 * `locale` is tri-state and independent of `displayName`: absent = leave the
 * stored language alone, `""`/`null` = clear it, `"vi"`/`"en"` = set it. It is
 * NOT a property here — a body that carries `displayName` must not be able to
 * wipe a stored language by accident, so the two live in separate request types
 * ([UpdateProfileInput] and [UpdateLocaleInput]) and the UI sends exactly one of
 * them per intent.
 *
 * There is no `email` / `newEmail` property either: `PATCH /auth/me` rejects
 * those with an explicit 400 and a Vietnamese explanation, because moving an
 * account to a new address is its own two-step flow — see
 * [ChangeEmailRequest] and [ConfirmEmailChangeRequest], which ARE in the
 * contract.
 */
@Serializable
data class UpdateProfileInput(val displayName: String)

/**
 * Body of `PATCH /api/v1/auth/me` when only the language changes — the
 * tri-state `locale` the contract describes (`openapi.yaml`, UpdateProfileInput):
 * absent = leave the stored value alone, `null` = CLEAR it ("theo thiết bị"),
 * `"vi"` / `"en"` = set it.
 *
 * `locale` is nullable, and unlike every other optional field in this file a
 * `null` must reach the wire **as an explicit null key**. `ApiClient.json` sets
 * `explicitNulls = false`, so a plain `@Serializable` property would be dropped
 * and `{}` would be answered with 400 ("a body with neither key"). That is why
 * this one type carries a hand-written serializer: it always emits the key.
 *
 * The "clear" case is the "Theo thiết bị" row in the language sheet — before
 * this existed the account was pinned forever once a language had been picked.
 */
@Serializable(with = UpdateLocaleInputSerializer::class)
data class UpdateLocaleInput(val locale: String?)

/**
 * Writes `{"locale": …}` **including an explicit `null`**.
 *
 * The tests pinning this are
 * `ModelsSerializationTest.updateLocaleInput_alwaysSendsTheKeyAndCanClearWithAnExplicitNull`
 * and `AuthI18nNetworkTest.updateLocaleCanClearTheStoredLanguageWithAnExplicitNull`;
 * without it the "Theo thiết bị" row would silently send `{}` and the server
 * would reject the request.
 */
object UpdateLocaleInputSerializer : KSerializer<UpdateLocaleInput> {
    override val descriptor: SerialDescriptor =
        buildClassSerialDescriptor("com.warrly.network.UpdateLocaleInput") {
            element<String?>("locale")
        }

    override fun serialize(encoder: Encoder, value: UpdateLocaleInput) {
        val jsonEncoder = encoder as? JsonEncoder
            ?: throw SerializationException("UpdateLocaleInput is only serialized as JSON")
        jsonEncoder.encodeJsonElement(
            buildJsonObject {
                val tag = value.locale
                put("locale", if (tag == null) JsonNull else JsonPrimitive(tag))
            },
        )
    }

    override fun deserialize(decoder: Decoder): UpdateLocaleInput {
        val jsonDecoder = decoder as? JsonDecoder
            ?: throw SerializationException("UpdateLocaleInput is only deserialized from JSON")
        val element = jsonDecoder.decodeJsonElement().jsonObject["locale"]
        return UpdateLocaleInput(
            element?.takeIf { it !is JsonNull }?.jsonPrimitive?.content,
        )
    }
}

/** Response of `PATCH /api/v1/auth/me` — the fresh user plus a translated note. */
@Serializable
data class UpdateProfileResponse(
    val user: User,
    val message: String? = null,
)

// ---- Email change: POST /api/v1/auth/change-email → /confirm-email-change ----
//
// Two steps, because moving an account to a new address has to prove control of
// that address:
//
//   1. [ChangeEmailRequest] — new address + the CURRENT PASSWORD, so a stolen
//      bearer token alone cannot move the account. The server mails a
//      single-use, 30-minute token to the *new* address. `User.email` is
//      untouched: the old address keeps working until step 2 succeeds.
//   2. [ConfirmEmailChangeRequest] — the raw token only, and **no bearer
//      token**: the token is the credential, and the mailed link is usually
//      opened on another device. On success the server updates the address and
//      revokes every session, so the client must sign in again.
//
// The mailed link points at `<APP_URL>/confirm-email/<token>`, which is a *web*
// page a native client cannot open as a session. The email therefore also
// carries the raw token as text ("Hoặc nhập mã xác nhận trong ứng dụng"), which
// is what this client consumes — see `EmailChangeRules`.

/** Body of step 1. Both fields are required by the contract. */
@Serializable
data class ChangeEmailRequest(
    val newEmail: String,
    val currentPassword: String,
)

/**
 * Response of step 1 — **neutral by construction**: the same `message` comes
 * back whether the token was mailed or the address already belongs to another
 * account, so the endpoint cannot be used to enumerate accounts. There is no
 * token field (the raw token only ever travels in the email) and nothing says
 * whether the mail provider accepted the message. The UI must not try to tell
 * those cases apart, and must not claim the mail was delivered.
 */
@Serializable
data class ChangeEmailResult(
    val ok: Boolean = true,
    val message: String? = null,
)

/** Body of step 2 — the raw token from the email, or the whole mailed link. */
@Serializable
data class ConfirmEmailChangeRequest(val token: String)

/** Response of step 2. Every session, including this one, has been revoked. */
@Serializable
data class ConfirmEmailChangeResult(
    val ok: Boolean = true,
    val message: String? = null,
)

@Serializable
data class ForgotRequest(val email: String)

@Serializable
data class ChangePasswordRequest(
    val currentPassword: String,
    val newPassword: String,
    val confirmPassword: String,
)

@Serializable
data class ChangePasswordResponse(
    val ok: Boolean = true,
    val message: String? = null,
)

// ---- Device sessions (GET/DELETE /api/v1/auth/sessions) ----
//
// The revocation surface that used to be missing: before it, the only ways to
// kill a login were "the exact token being sent" (POST /auth/logout) and
// "everything at once" (password reset). A sliding 7-day TTL means a session
// never expires while the app is opened weekly, so handing the phone to someone
// was a silent, one-way act.
//
// `id` is the Session row's surrogate key (a cuid) — NOT the bearer token and
// not its hash; `tokenHash` never leaves the server. It is only ever used as the
// path parameter of the revoke call.

@Serializable
data class SessionSummary(
    val id: String,
    /**
     * The label the client sent at login (≤80 chars). **Nullable by contract**:
     * sessions issued by an older client that sent no label carry `null`, which
     * the openapi documents as "Không rõ thiết bị" — render that fallback rather
     * than an empty row. Never authoritative (it is user-agent-ish free text).
     */
    val deviceLabel: String? = null,
    /**
     * Raw platform code. `ios | android | web` for sessions (the login/register
     * enum); `apns | fcm` are the *push* platform codes and only appear here on
     * legacy rows. Also nullable — unknown/unset is normal, not an error.
     */
    val platform: String? = null,
    /** `true` = the session that issued this request — "Thiết bị này". */
    val current: Boolean = false,
    /** RFC3339, UTC. Refreshed at most once every 5 minutes. */
    val lastSeenAt: String = "",
    val createdAt: String = "",
    /** Sliding TTL: +30 days on use after 7 days. */
    val expiresAt: String = "",
)

@Serializable
data class SessionListResponse(val sessions: List<SessionSummary> = emptyList())

/**
 * `DELETE /api/v1/auth/sessions/{id}` (openapi `SessionRevokeResult`).
 *
 * `alreadyRevoked = true` is **success**, not an error: a retry on a session that
 * was already killed changes nothing and still answers 200. The server's
 * `message` is Vietnamese and is shown as-is.
 *
 * `current = true` means the caller just revoked the session it is holding: the
 * token is dead and the next request is a 401, so the client MUST clear its
 * token store and return to login (the same route the delete-account flow
 * takes). That is the documented answer to "đăng xuất khỏi thiết bị này".
 */
@Serializable
data class SessionRevokeResult(
    val ok: Boolean = true,
    val current: Boolean = false,
    val alreadyRevoked: Boolean = false,
    val message: String = "",
)

// ---- Devices ----

/**
 * The currency every price field meant before multi-currency devices existed.
 * Kept as a named constant because the wire default, the form's initial pick and
 * the "no rate required" branch all have to agree on the exact string.
 */
const val DEFAULT_CURRENCY: String = "VND"

@Serializable
enum class DeviceStatus(@StringRes val labelRes: Int) {
    ACTIVE(R.string.enum_device_status_active),
    EXPIRED(R.string.enum_device_status_expired),
    SOLD(R.string.enum_device_status_sold),
    BROKEN(R.string.enum_device_status_broken),
    LOST(R.string.enum_device_status_lost),
}

@Serializable
enum class WarrantyType(@StringRes val labelRes: Int) {
    STANDARD(R.string.enum_warranty_type_standard),
    EXTENDED(R.string.enum_warranty_type_extended),
    THIRD_PARTY(R.string.enum_warranty_type_third_party),
}

@Serializable
data class Device(
    val id: String,
    val userId: String? = null,
    val name: String,
    val category: String,
    val brand: String? = null,
    val model: String? = null,
    val serialNumber: String? = null,
    val purchaseDate: String,
    val purchasePrice: Int = 0,
    /**
     * ISO 4217 code of the currency [purchasePrice], [soldPrice] and every
     * [Warranty.cost] on this device are denominated in. **Default `VND`**, so a
     * payload from a server that predates multi-currency still decodes as the
     * dong-only world it came from.
     *
     * The price fields are NOT VND when this is anything else. Never feed
     * [purchasePrice] / [soldPrice] into a dong formatter or a dong sum — use
     * [purchasePriceVnd] / [soldPriceVnd] for money that has to add up across
     * devices. See `ui/screens/devices/DeviceCurrency.kt` for the one rule.
     */
    val currency: String = DEFAULT_CURRENCY,
    /**
     * The exchange rate **locked at entry**: VND per one unit of [currency]
     * (e.g. `25470` for a USD device). `null` for a VND device, and for a legacy
     * row that never recorded one — the contract requires a positive integer
     * whenever the currency is not VND, enforced server-side on write.
     *
     * It is deliberately not refreshed from the FX endpoint on read: a stored
     * price must not drift with the market. The FX call only helps fill the form.
     */
    val fxRate: Int? = null,
    /**
     * Server-computed VND value of [purchasePrice] at the locked [fxRate] —
     * **use this for totals**, never a client-side multiplication.
     *
     * `null` when the VND value genuinely cannot be known: a non-VND row with no
     * usable rate (only hand-edited / legacy data), or an older server that
     * predates the field. For a VND device the value is the price itself
     * ([com.warrly.ui.screens.devices.devicePurchasePriceVnd] falls back to
     * [purchasePrice], which is not a conversion).
     */
    val purchasePriceVnd: Long? = null,
    val purchasePlace: String? = null,
    val status: DeviceStatus = DeviceStatus.ACTIVE,
    val notes: String? = null,
    /**
     * Sale record (openapi `Device.soldAt` / `soldPrice`, roadmap #12). `null`
     * means "not sold / not recorded". The server enforces the pair rule on the
     * write path — both fields together, or neither — so a response carries
     * either both or none of them.
     *
     * Wire format is identical to [purchaseDate]: a naive UTC timestamp rendered
     * as `YYYY-MM-DDTHH:MM:SS[.fff]` with **no** `Z` and no offset, e.g.
     * `"2026-03-01T00:00:00"`. Parse the date half only (`take(10)`), never as an
     * instant — see `ui/screens/devices/DeviceResale.kt`. (The JSON *backup* file
     * is the exception: there `soldAt` is RFC3339 with a `Z`.)
     */
    val soldAt: String? = null,
    /**
     * Sale price **in [currency]** (not VND unless [currency] is VND). `null` =
     * not sold; `0` is a real price (give-away).
     */
    val soldPrice: Int? = null,
    /**
     * Server-computed VND value of [soldPrice] at the locked [fxRate]. `null`
     * when there is no sale or no usable rate (or on a server that predates the
     * field). Use this — never a client-side conversion — for profit/loss
     * expressed in dong.
     */
    val soldPriceVnd: Long? = null,
    /**
     * Exchange / return window ("1 đổi 1") length in days, recorded by the user
     * for **this** device (migration 0010). Three states, and they are all
     * different:
     *
     *  * `null` — **chưa biết**. The API has no default and never infers one.
     *  * `0` — the shop offers no exchange at all.
     *  * `> 0` — that many days counted from [receivedAt] (or [purchaseDate]).
     *
     * This is a shop policy the user wrote down, **not** a legal right.
     *
     * ⚠️ `PATCH /api/v1/devices/{id}` replaces every field: a save that does not
     * send this back **clears** a recorded window (the same trap `soldAt` /
     * `soldPrice` had, and why [DeviceInput] carries it too — see
     * `ui/screens/devices/DeviceReturnWindow.kt`).
     */
    val returnWindowDays: Int? = null,
    /**
     * The day the user **actually received** the device, as a naive-UTC
     * timestamp (`"2026-03-02T00:00:00"`, no `Z`) — the very same wire shape as
     * [soldAt] / [purchaseDate], so only the date half is ever used.
     *
     * `null` means "not recorded", which is deliberately different from
     * "arrived on the purchase date": the deadline then falls back to
     * [purchaseDate], but the app must not claim the device was received then.
     */
    val receivedAt: String? = null,
    /**
     * The derived exchange-window deadline,
     * `COALESCE(receivedAt, purchaseDate) + returnWindowDays days` (openapi
     * `DeviceListItem.returnDeadline` / `DeviceDetail.returnDeadline`).
     *
     * Computed **server-side** on the list and detail reads only — it is not a
     * stored column, so a write response (POST/PATCH) omits it and this stays
     * `null` there. Null also means "no window": unknown days, `0` days, or no
     * date to count from. Never recompute it locally: three clients dividing
     * days three ways is exactly what this field exists to prevent.
     */
    val returnDeadline: String? = null,
    /**
     * Warranty activation (openapi `Device.activationRequired`): `true` when the
     * warranty only starts once a retailer activates the device.
     *
     * Defaulted to `false` rather than nullable because that is the contract's
     * default: a server that predates the field and a brand-new device both mean
     * "no activation step". The derived state lives in
     * `ui/screens/devices/DeviceActivation.kt`.
     */
    val activationRequired: Boolean = false,
    /**
     * When the warranty was activated, in the same naive-UTC wire shape as
     * [purchaseDate] / [soldAt] (`"2026-03-02T00:00:00"`, no `Z`) — only the
     * date half is ever used.
     *
     * A date **earlier** than [purchaseDate] is allowed and must never be
     * blocked: a shop can pre-activate a device before the invoice date.
     */
    val activatedAt: String? = null,
    /**
     * The last day extended cover (AppleCare+, Samsung Care+) can be bought, in
     * the same naive-UTC wire shape as [purchaseDate]. `null` = the retailer
     * gave no deadline for this device; it is not a date the client may invent.
     * The countdown is computed by `extendedCoverState` in
     * `ui/screens/devices/DeviceActivation.kt`.
     */
    val extendedCoverBuyBy: String? = null,
    /**
     * User-chosen reminder schedule (openapi `Device.leadDays`): how many days
     * before the warranty end each reminder fires. Descending, `0..365` each,
     * 1..5 entries, no duplicates — `0` means "on the day it expires" and is a
     * real choice, not "unset".
     *
     * **Defaulted, not nullable, on purpose.** A server that predates the field
     * omits it, and an empty chip row would read as "this device has no
     * reminders" — which was never true (the old cron used the fixed 30/7
     * schedule). [DEFAULT_LEAD_DAYS] is exactly that old schedule, so the UI
     * shows the effective truth against an older server. See
     * [normalizeLeadDays] for the rules and [isValidLeadDays] for the 1..5
     * lower bound.
     */
    val leadDays: List<Int> = DEFAULT_LEAD_DAYS,
    val warranties: List<Warranty> = emptyList(),
    /**
     * `GET /api/v1/devices` only (see Go `DeviceListItem`): `max(endDate)` over
     * the device's warranties. `null` when the device has no warranty at all —
     * which is NOT the same as "expired". Absent on the detail read, so it
     * defaults to null there and the list-only UI must not treat it as truth.
     */
    val effectiveWarrantyEnd: String? = null,
    /** `GET /api/v1/devices` only — the list projection's attachment count. */
    val attachmentCount: Int = 0,
    /**
     * `GET /api/v1/devices/{id}` only (`openapi.yaml` `DeviceDetail.claims`):
     * the device's repair tickets, newest state included.
     *
     * The **list** endpoint does not carry them, so this defaults to empty there
     * and the device-list screen must not read it as "this device has no
     * claims". The detail screen is the anchor: it is the one payload that says
     * whether an open repair exists — which is what the BROKEN nudge in
     * `ui/screens/devices/ClaimRules.kt` needs.
     *
     * A write response (`POST`/`PATCH /api/v1/devices/{id}`) is a bare device
     * row and omits the array; `DeviceDetailViewModel.replaceDevice` carries the
     * loaded list over for the same reason it does warranties.
     */
    val claims: List<Claim> = emptyList(),
)

@Serializable
data class DeviceListResponse(val devices: List<Device>)

/**
 * One **advisory** finding about a value that was already saved (openapi
 * `DeviceWarning`, FEATURE_IDEAS #6).
 *
 * `POST /api/v1/devices` and `PATCH /api/v1/devices/{id}` return
 * `{device, warnings}` — nothing is blocked, the device row exists, and the
 * status is still 201/200. The meaning is "đã lưu, nhưng giá trị này có vẻ sai",
 * never "thất bại". A client must not delete or rewrite the value on its own.
 *
 * `code` is a stable machine-readable string (`IMEI_CHECKSUM`, `IMEI_LENGTH`,
 * `SERIAL_DUPLICATE`); `message` is the Vietnamese sentence to show as-is, and
 * [com.warrly.ui.screens.devices.deviceWarningMessage] falls back to
 * a code-specific Vietnamese sentence when it is blank (an older server).
 */
@Serializable
data class DeviceWarning(
    val code: String,
    /** Request/draft field the warning points at; always `serialNumber` today. */
    val field: String = SERIAL_FIELD,
    val message: String = "",
) {
    companion object {
        const val SERIAL_FIELD = "serialNumber"
    }
}

/**
 * `{"device": {...}, "warnings": [...]}` — the envelope of device create, update
 * **and** the single-device read.
 *
 * `warnings` only ever has content on the write responses; `GET /devices/{id}`
 * omits the key entirely, hence the default. It was silently dropped before this
 * field existed because `ApiClient.json` sets `ignoreUnknownKeys = true` — which
 * is exactly why no one had seen a single warning.
 */
@Serializable
data class DeviceResponse(
    val device: Device,
    val warnings: List<DeviceWarning> = emptyList(),
)

// ---- FX rates (`GET /api/v1/fx/rates?base=…`) ----

/**
 * The FX endpoint's answer (openapi `FXRateResponse`):
 *
 * ```json
 * {"base":"USD","rates":{"VND":25470.5},"fetchedAt":"2026-10-19T00:00:00Z","stale":false}
 * ```
 *
 * `base` is the currency the user picked; `rates` is quoted **per one unit of
 * `base`**, which is why the rate the form needs is `rates["VND"]` (VND per one
 * USD). [com.warrly.ui.screens.devices.rateToVnd] owns that lookup and returns
 * `null` instead of guessing when the map does not carry `VND`.
 *
 * Every field is defaulted: this is an optional helper for filling one form
 * field, and a 503 (the documented failure) is handled separately by the sheet.
 * `stale = true` means "here is the last known rate, it may be old" — the sheet
 * still lets the user see and edit it, and says so.
 */
@Serializable
data class FxRates(
    val base: String = DEFAULT_CURRENCY,
    /** Quote currency → units per one unit of [base]. */
    val rates: Map<String, Double> = emptyMap(),
    val fetchedAt: String? = null,
    val stale: Boolean = false,
)

// ---- Warranties ----

@Serializable
data class Reminder(
    val id: String,
    val warrantyId: String,
    val isDismissed: Boolean = false,
    val createdAt: String? = null,
)

@Serializable
data class Warranty(
    val id: String,
    val deviceId: String,
    val type: WarrantyType = WarrantyType.STANDARD,
    val provider: String? = null,
    val startDate: String,
    val endDate: String,
    val months: Int = 0,
    /**
     * What the plan cost, **in the owning device's currency** (openapi
     * `Device.currency`). For a VND device that is dong, exactly as before; for a
     * `USD` device it is dollars. It is not converted client-side — the total
     * across devices is `devices.totalWarrantyCost`, computed server-side in VND.
     */
    val cost: Int? = null,
    val address: String? = null,
    val phone: String? = null,
    val notes: String? = null,
    // ---- Contract terms (all optional) ----
    //
    // What the plan actually covers, and what a claim costs. The derived
    // presentation lives in `ui/screens/devices/WarrantyTerms.kt`; every
    // `null` below means "not recorded", and a plan with all nine fields empty
    // must render exactly as it did before these fields existed.
    /**
     * The part this plan covers. `null` means the **whole unit** — the contract
     * defines it that way, not "unknown". A blank string is treated as `null`
     * by the UI and is dropped when saving.
     */
    val component: String? = null,
    /** What is covered, in the user's own words. `null` = not recorded. */
    val scope: String? = null,
    /**
     * Maximum payout in VND. `null` = no cap recorded; `0` is a real cap of
     * zero and must not be collapsed into "absent". Negative is a 400.
     */
    val cap: Int? = null,
    /**
     * VND the user pays per claim. `null` = no deductible recorded; `0` is a
     * real "no deductible" and is displayed as money, not hidden.
     */
    val deductible: Int? = null,
    /** What the plan excludes. `null` = not recorded. */
    val exclusions: String? = null,
    /** Where the cover applies. `null` = not recorded. */
    val region: String? = null,
    /**
     * Whether the cover survives a resale. Three states, all different:
     * `null` = not recorded, `true` = transferable, `false` = explicitly not
     * transferable.
     */
    val transferable: Boolean? = null,
    /**
     * How many claims the plan allows. `null` = unbounded (not "zero"); `0`
     * is a real "no claims at all" and counts as a recorded term.
     */
    val claimsAllowed: Int? = null,
    /**
     * How many claims have been used. The server defaults this to `0`, so a
     * plan with only `claimsUsed = 0` still has no terms recorded. The server
     * rejects `claimsUsed > claimsAllowed` with a 400 on
     * `fieldErrors.claimsUsed`; `claimsExceedAllowed` in
     * `ui/screens/devices/WarrantyTerms.kt` mirrors that rule in the form so an
     * invalid pair is never sent.
     */
    val claimsUsed: Int = 0,
    val reminders: List<Reminder> = emptyList(),
) {
    val isDismissed: Boolean
        get() = reminders.any { it.isDismissed }
}

@Serializable
data class WarrantyInput(
    val type: WarrantyType = WarrantyType.STANDARD,
    val provider: String? = null,
    val startDate: String,            // YYYY-MM-DD
    val months: Int,
    val cost: Int? = null,
    val address: String? = null,
    val phone: String? = null,
    val notes: String? = null,
    // ---- Contract terms (all optional) ----
    //
    // `ApiClient.json` sets `explicitNulls = false`, so a `null` here is DROPPED
    // from the request body instead of being sent as an explicit null — the
    // server sees an absent key, not `null`. A blank text field is therefore
    // sent as `null` and disappears from the wire.
    /** Part covered; `null` = the whole unit (the contract's own meaning). */
    val component: String? = null,
    /** What is covered. */
    val scope: String? = null,
    /** Maximum payout in VND; `0` is a real value, not "unset". */
    val cap: Int? = null,
    /** Deductible per claim in VND; `0` means "no deductible". */
    val deductible: Int? = null,
    /** What is excluded. */
    val exclusions: String? = null,
    /** Where the cover applies. */
    val region: String? = null,
    /** Tri-state resale transferability: `null` = not specified. */
    val transferable: Boolean? = null,
    /** Claims allowed; `null` = unbounded, `0` = none allowed. */
    val claimsAllowed: Int? = null,
    /**
     * Claims used so far. Non-nullable because the contract gives it the
     * default `0`, and `encodeDefaults = true` means it is always sent — a
     * create that never opens the terms group still says `"claimsUsed":0`.
     */
    val claimsUsed: Int = 0,
)

@Serializable
data class WarrantyResponse(val warranty: Warranty)

@Serializable
data class DeviceInput(
    val name: String,
    val category: String,
    val brand: String? = null,
    val model: String? = null,
    val serialNumber: String? = null,
    val purchaseDate: String, // YYYY-MM-DD
    val purchasePrice: Int = 0,
    /**
     * ISO 4217 code (openapi `DeviceInput.currency`). Always encoded
     * (`encodeDefaults = true`), defaulting to [DEFAULT_CURRENCY].
     *
     * `PATCH /api/v1/devices/{id}` replaces the whole row, so an edit MUST send
     * the loaded currency back or it silently re-labels a foreign-currency
     * device's prices as dong.
     */
    val currency: String = DEFAULT_CURRENCY,
    /**
     * VND per one unit of [currency], locked at entry. `null` for VND, where
     * `ApiClient.json`'s `explicitNulls = false` drops the key.
     *
     * The contract requires a **positive integer** whenever [currency] is not
     * `VND` (400 `fieldErrors.fxRate` if absent); the form blocks Save instead
     * of sending the null (`fxRateRequired` in `DeviceCurrency.kt`). The pair is
     * not validated in the model because the server owns that rule.
     */
    val fxRate: Int? = null,
    val purchasePlace: String? = null,
    val status: DeviceStatus = DeviceStatus.ACTIVE,
    val notes: String? = null,
    /**
     * Optional sale record (`YYYY-MM-DD`, like [purchaseDate]). The server
     * rejects half a pair: `soldAt` without `soldPrice` → 400
     * `fieldErrors.soldPrice = ["Thiếu giá bán"]`, and `soldPrice` without
     * `soldAt` → 400 `fieldErrors.soldAt = ["Thiếu ngày bán"]`. Leaving both
     * `null` (they are then omitted from the JSON) clears a recorded sale, which
     * is exactly what the server does with explicit nulls.
     */
    val soldAt: String? = null,
    /** Sale price in [currency]. Negative is a 400; `0` is a valid give-away price. */
    val soldPrice: Int? = null,
    /**
     * Exchange-window length in days (openapi `DeviceInput.returnWindowDays`).
     * Independent of [receivedAt] — sending one without the other is valid.
     *
     * `null` (the key is then dropped from the JSON, which Go decodes as nil
     * exactly like an explicit null) means **chưa biết**; `0` is a real value
     * meaning "cửa hàng không cho đổi trả" and must be sent as `0`, never
     * collapsed into "absent". Out of `0–3650` → 400
     * `fieldErrors.returnWindowDays`.
     *
     * ⚠️ **Full-replacement warning.** `PATCH /api/v1/devices/{id}` replaces the
     * whole row, so omitting this key **erases** a window recorded by another
     * client. The device form therefore loads the existing value and sends it
     * straight back; see `ui/screens/devices/DeviceReturnWindow.kt`.
     */
    val returnWindowDays: Int? = null,
    /**
     * The day the device was actually received (`YYYY-MM-DD` or full ISO).
     * `null` clears it. Independent of [returnWindowDays]. Unparseable → 400
     * `fieldErrors.receivedAt = ["Ngày nhận hàng không hợp lệ"]`.
     */
    val receivedAt: String? = null,
    /**
     * Warranty activation (openapi `DeviceInput.activationRequired`). A plain
     * boolean, always encoded (`encodeDefaults = true`), so an update that turns
     * activation off really sends `false` instead of dropping the key. Create
     * defaults to `false`, which is the contract default.
     */
    val activationRequired: Boolean = false,
    /**
     * Activation date (`YYYY-MM-DD`). `null` drops the key (explicit nulls are
     * off), which the update contract reads as "unchanged". Any date is accepted,
     * including one before [purchaseDate] — a shop may pre-activate.
     */
    val activatedAt: String? = null,
    /**
     * Last day to buy extended cover (`YYYY-MM-DD`). `null` drops the key, which
     * means "unchanged" on update and "not recorded" on create.
     */
    val extendedCoverBuyBy: String? = null,
    /**
     * Reminder schedule to store (`leadDays`, openapi `DeviceInput.leadDays`).
     *
     * `null` **omits the key** (`ApiClient.json` drops nulls), which the
     * contract reads as "leave it alone" on update and "use the server default
     * `[30, 7]`" on create. The sheet never relies on that in practice: it
     * loads the stored schedule and sends a normalised non-empty list back
     * (`ui/components/LeadDaysPicker.kt` → [leadDaysForRequest]). It exists so
     * a caller that does not touch reminders cannot accidentally overwrite
     * them with a default.
     */
    val leadDays: List<Int>? = null,
    val warrantyMonths: Int = 0,
    val warrantyProvider: String? = null,
    val warrantyAddress: String? = null,
    val warrantyPhone: String? = null,
    val warrantyNotes: String? = null,
    val fromWishlistId: String? = null,
)

// ---- Warranty claims (GET/POST/PATCH/DELETE /api/v1/claims) ----
//
// What happens AFTER a device breaks. Before this model existed, `BROKEN` was a
// dead end: the status said something was wrong, and there was nowhere to put
// the ticket number, the shop, the diagnosis or what the warranty actually paid.
//
// Three contract facts drive the UI and are easy to get wrong:
//
//  * **`deviceId` is required** — a claim belongs to exactly one device, which
//    is why the only list surface in the app is the device detail (see
//    `ui/screens/devices/DeviceClaimsSection.kt`).
//  * **`closedAt` is set by the server.** It is deliberately absent from
//    [ClaimInput]: sending it would be a contract violation, and the closing
//    date is the server's record of when the status became terminal.
//  * **One OPEN/IN_REPAIR claim per device.** A second create is
//    **409 `limit_reached`** (lowercase on the wire, compared case-insensitively
//    in `ui/screens/devices/ClaimRules.kt`, exactly like `InboxRules` does for
//    the attachment cap). The client does not pre-block the attempt: the
//    server's 409 carries the constraint, and the screen offers a way to the
//    ticket that is already open.

/**
 * `OPEN | IN_REPAIR | RESOLVED | REJECTED | CANCELLED` (openapi `Claim.status`).
 *
 * `OPEN`/`IN_REPAIR` are the **live** pair — the ones the one-per-device rule
 * applies to. The other three are terminal; `closedAt` is non-null once one of
 * them is stored (the server sets it; the client never sends it).
 */
@Serializable
enum class ClaimStatus(@StringRes val labelRes: Int) {
    OPEN(R.string.enum_claim_status_open),
    IN_REPAIR(R.string.enum_claim_status_in_repair),
    RESOLVED(R.string.enum_claim_status_resolved),
    REJECTED(R.string.enum_claim_status_rejected),
    CANCELLED(R.string.enum_claim_status_cancelled),
}

/**
 * One repair ticket (openapi `Claim`).
 *
 * Dates use the file's existing convention: a naive-UTC timestamp such as
 * `"2026-03-02T00:00:00"` with **no** `Z`; a date-only `"2026-03-02"` is also
 * accepted by the API. Only the date half is ever read (`take(10)` /
 * [com.warrly.ui.screens.vietnamDate]), never parsed as an instant.
 *
 * `cost` is VND and **`Int`**, like every other per-row money field in this
 * file. `null` means "not recorded" and is not the same as `0` (a real free
 * repair); negative values are rejected by the server and can never be typed in
 * the form (digit-only input).
 *
 * `coveredByWarranty` is **tri-state**: `true` / `false` are facts the user
 * recorded, `null` means unknown. Because `ApiClient.json` has
 * `explicitNulls = false`, a `null` in [ClaimInput] is dropped from the request
 * instead of being sent as an explicit `null` — which is exactly the "unknown"
 * state the contract describes.
 */
@Serializable
data class Claim(
    val id: String,
    val deviceId: String,
    /** Must belong to [deviceId]; `null` = the claim is not tied to a plan. */
    val warrantyId: String? = null,
    val status: ClaimStatus = ClaimStatus.OPEN,
    val openedAt: String,
    val expectedReturnAt: String? = null,
    /** Server-set. Read-only on the client; never present in [ClaimInput]. */
    val closedAt: String? = null,
    val ticketNumber: String? = null,
    /** The shop / service centre, in the user's own words. */
    val serviceCenter: String? = null,
    val diagnosis: String? = null,
    /** What happened in the end, in the user's own words. */
    val outcome: String? = null,
    /** Required by the contract: what went wrong in the first place. */
    val issue: String,
    /** VND. `null` = not recorded; `0` is a real amount (a free repair). */
    val cost: Int? = null,
    /** `null` = unknown, which is different from an explicit "No". */
    val coveredByWarranty: Boolean? = null,
    /**
     * Server bookkeeping (`createdAt` / `updatedAt` in the response; the frozen
     * field table in the brief lists only the user-facing fields). The app does
     * not display them today, but they are part of the payload the server always
     * sends, and a stable tie-breaker for "same openedAt" rows. Defaulted so a
     * partial payload and every existing test fixture keep decoding.
     */
    val createdAt: String? = null,
    val updatedAt: String? = null,
)

/** `GET /api/v1/claims` (optional `?deviceId=` / `?status=` filters). */
@Serializable
data class ClaimListResponse(val claims: List<Claim> = emptyList())

/** `{"claim": {...}}` — the POST / PATCH / GET-by-id envelope. */
@Serializable
data class ClaimResponse(val claim: Claim)

/**
 * Body of `POST /api/v1/claims` and `PATCH /api/v1/claims/{id}`.
 *
 * Mirrors exactly the writable half of [Claim]. **No `closedAt`**: the contract
 * makes it server-owned, and the form never exposes it. `status` and the
 * nullable text fields are always sent (`encodeDefaults = true` sends the
 * status; a `null` text field is dropped by `explicitNulls = false`, which the
 * contract reads as "not recorded").
 *
 * `issue` is non-nullable because the API requires it. The form keeps Save
 * disabled until it is non-blank.
 *
 * `warrantyId` must name a warranty that belongs to [deviceId] — the form only
 * offers that device's plans (see `ClaimEditSheet`).
 */
@Serializable
data class ClaimInput(
    val deviceId: String,
    val warrantyId: String? = null,
    val status: ClaimStatus = ClaimStatus.OPEN,
    /** `YYYY-MM-DD` (a full date-time is also accepted by the server). */
    val openedAt: String,
    val expectedReturnAt: String? = null,
    val ticketNumber: String? = null,
    val serviceCenter: String? = null,
    val diagnosis: String? = null,
    val outcome: String? = null,
    val issue: String,
    /** VND, non-negative. `null` = not recorded; `0` is a real amount. */
    val cost: Int? = null,
    /** Tri-state; `null` is dropped from the JSON and means "unknown". */
    val coveredByWarranty: Boolean? = null,
)

// ---- AI receipt OCR ----

// Draft from POST /api/v1/ai/extract-receipt. Mirrors Go DraftDevice / openapi.
// Every field is nullable — the model returns null for anything it can't read.
// The DRAFT is never persisted directly; the form pre-fills from it and the user
// confirms. `extractedText` is different: the server stores that transcript on
// the Attachment when the request carries an `attachmentId` (see ExtractReceiptInput).
@Serializable
data class DraftDevice(
    val name: String? = null,
    val category: String? = null,
    val brand: String? = null,
    val brandId: String? = null,
    val model: String? = null,
    val serialNumber: String? = null,
    val purchaseDate: String? = null,
    val purchasePrice: Int? = null,
    val purchasePlace: String? = null,
    val storeId: String? = null,
    val warrantyMonths: Int? = null,
    val warrantyProviderId: String? = null,
    val confidence: String = "medium",
    val unmatched: List<String> = emptyList(),
    /**
     * Advisory findings about values the draft **kept** — the sibling of
     * [unmatched], not a duplicate of it. `unmatched` = "we could not use this
     * value" (it was dropped, e.g. an OCR serial longer than 120 bytes);
     * `warnings` = "we used this value but it looks wrong" (a 15-digit IMEI with
     * a bad Luhn digit, a serial that already exists on another device). The UI
     * must show them on separate lines and must still let the user save.
     *
     * Always present in the payload (`[]` when clean); defaulted here only for a
     * pre-warnings server.
     */
    val warnings: List<DeviceWarning> = emptyList(),
    /**
     * The transcript the model read off the document, already trimmed / NUL-free
     * and capped at 8000 characters by the server. `null` when the model read no
     * text at all. Not a Device field — never send it back into the form.
     *
     * On the `attachmentId` branch this same string is written to
     * `Attachment.extractedText` and becomes searchable. A re-scan that yields no
     * text does **not** erase a previously stored transcript, by design.
     */
    val extractedText: String? = null,
    /**
     * `true` only when [extractedText] was successfully written to an Attachment
     * row. The Android scan flow now always uses that branch, but the write is
     * best-effort: `false` means "this scan will not be found in search", which
     * the sheet says out loud instead of implying the receipt is indexed.
     */
    val extractedTextStored: Boolean = false,
)

/**
 * Body of the `attachmentId` branch of `POST /api/v1/ai/extract-receipt`.
 *
 * The endpoint takes **either** this JSON object **or** multipart `file`; the
 * two differ in exactly one observable way: only this branch has an Attachment
 * row to persist the transcript on. Android therefore uploads first (an inbox
 * item, no `deviceId`) and extracts second — see
 * `ui/screens/devices/ReceiptScan.kt` for the pure input-shape rule.
 *
 * A single property on purpose: the server rejects nothing else here, and the
 * multipart field must not leak into the JSON body.
 */
@Serializable
data class ExtractReceiptInput(val attachmentId: String)

@Serializable
data class DraftDeviceResponse(val draft: DraftDevice)

@Serializable
data class AIOptInRequest(val enabled: Boolean)

@Serializable
data class AIOptInResponse(val aiOptIn: Boolean)

// ---- AI claim assessment ----
//
// `POST /api/v1/ai/assess-claim` is advice, **not** a decision, and it writes
// nothing. The server reads the claim and the device's warranty terms; the
// request carries only the claim id.
//
// Three contract facts shape the models:
//
//  * `coverage` is an estimate (`LIKELY_…` / `UNCLEAR`), never an approval.
//    The UI must not render it as one — see `ClaimAssessmentRules.kt`.
//  * `reasoning` and `questions` are in the user's language; `draftLetter` is
//    ALWAYS Vietnamese, because it is read at a Vietnamese service centre. The
//    app shows it as-is and never translates it.
//  * `questions` can be empty (and is still a successful answer); `draftLetter`
//    is defaulted so a partial payload cannot throw away an otherwise useful
//    result. `generatedAt` / `model` are provenance, not inputs.

/** `LIKELY_COVERED | UNCLEAR | LIKELY_NOT_COVERED` (openapi `ClaimAssessment.coverage`). */
@Serializable
enum class ClaimCoverage(@StringRes val labelRes: Int) {
    LIKELY_COVERED(R.string.claim_assess_coverage_likely_covered),
    UNCLEAR(R.string.claim_assess_coverage_unclear),
    LIKELY_NOT_COVERED(R.string.claim_assess_coverage_likely_not_covered),
}

/** `LOW | MEDIUM | HIGH` — how sure the model is, not how sure the shop is. */
@Serializable
enum class ClaimConfidence(@StringRes val labelRes: Int) {
    LOW(R.string.claim_assess_confidence_low),
    MEDIUM(R.string.claim_assess_confidence_medium),
    HIGH(R.string.claim_assess_confidence_high),
}

/**
 * Body of `POST /api/v1/ai/assess-claim`.
 *
 * Exactly one property on purpose: the server owns the rest (it loads the
 * claim, its device and the warranty terms), and a wider body would let the
 * client send a different set of facts than the ones it displayed.
 */
@Serializable
data class AssessClaimInput(val claimId: String)

/**
 * One AI claim assessment (openapi `ClaimAssessment`).
 *
 * The endpoint is read-only by construction: this response is a draft of advice,
 * the questions a counter may ask, and a Vietnamese letter. Nothing is saved.
 *
 * `draftLetter` defaults to `""` rather than being nullable: the UI only needs
 * "is there a letter to show" and the contract says it is always present. An
 * older/partial payload that lacks it still yields the useful coverage,
 * confidence, reasoning and questions instead of failing to decode the whole
 * response.
 */
@Serializable
data class ClaimAssessment(
    val claimId: String,
    val coverage: ClaimCoverage,
    val confidence: ClaimConfidence,
    /** The user's language. Shown as the "why" behind the estimate. */
    val reasoning: String,
    /** The user's language. Empty is valid and still useful. */
    val questions: List<String> = emptyList(),
    /** ALWAYS Vietnamese, on purpose. Never translated by the app. */
    val draftLetter: String = "",
    val generatedAt: String? = null,
    val model: String? = null,
)

// ---- Catalog ----

@Serializable
data class Catalog(
    val categories: List<CategoryOption>,
    val brands: List<BrandOption>,
    val stores: List<StoreOption>,
    val warrantyProviders: List<WarrantyProviderOption>,
    /**
     * Warranty directory per brand (openapi `Catalog.brandServiceInfo`,
     * FEATURE_IDEAS #15, migration 0012) — **additive**: the field is required by
     * the contract, but defaulted here so a response from a server that predates
     * it still decodes instead of throwing away all four existing catalogs.
     *
     * ⚠️ This is lookup data, **not** picker data. Reading the array directly
     * means re-implementing the server's free-text → row matching, whose rule is
     * "a tie does not match" — see
     * [com.warrly.network.ServiceDirectory], which is the endpoint
     * that owns that rule. Nothing on the device form may offer these as choices.
     */
    val brandServiceInfo: List<BrandServiceInfo> = emptyList(),
)

@Serializable
data class CategoryOption(val code: String, val name: String)

@Serializable
data class BrandOption(val id: String, val name: String, val categoryCodes: List<String> = emptyList())

@Serializable
data class StoreOption(val id: String, val name: String, val type: String)

@Serializable
data class WarrantyProviderOption(
    val id: String, val name: String,
    val phone: String? = null, val address: String? = null,
    val websiteUrl: String? = null, val notes: String? = null,
)

// ---- Subscriptions ----

// Server enum: ACTIVE | PAUSED | CANCELED | EXPIRED. Note single-L "CANCELED".
@Serializable
enum class SubscriptionStatus(@StringRes val labelRes: Int) {
    ACTIVE(R.string.enum_subscription_status_active),
    PAUSED(R.string.enum_subscription_status_paused),
    CANCELED(R.string.enum_subscription_status_canceled),
    EXPIRED(R.string.enum_subscription_status_expired),
}

@Serializable
enum class BillingCycle(@StringRes val labelRes: Int) {
    MONTHLY(R.string.enum_billing_cycle_monthly),
    QUARTERLY(R.string.enum_billing_cycle_quarterly),
    YEARLY(R.string.enum_billing_cycle_yearly),
    LIFETIME(R.string.enum_billing_cycle_lifetime),
    CUSTOM(R.string.enum_billing_cycle_custom),
}

@Serializable
data class Subscription(
    val id: String,
    val userId: String? = null,
    val name: String,
    val category: String? = null,
    val brand: String? = null,
    val plan: String? = null,
    val billingCycle: BillingCycle = BillingCycle.MONTHLY,
    val intervalDays: Int? = null,
    val price: Int = 0,
    val currency: String = "VND",
    val startedAt: String,
    val renewalDate: String? = null,
    /**
     * Free-trial end (openapi `Subscription.trialEndsAt`), in the same naive-UTC
     * wire shape as [startedAt] / [renewalDate] (`"2026-03-02T00:00:00"`, no
     * `Z`) — only the date half is ever used.
     *
     * `null` = no free trial, and the plan bills straight away. When it is set,
     * the billing date row on the detail card means "trial ends" instead of
     * "renews"; it must not be invented from [renewalDate]. See
     * `ui/screens/subscriptions/SubscriptionTrial.kt`.
     */
    val trialEndsAt: String? = null,
    /**
     * The price charged once a free trial ends, in VND (openapi
     * `Subscription.convertsToPrice`). `null` = not recorded.
     *
     * The server rejects this field without [trialEndsAt]
     * (`fieldErrors.convertsToPrice`), and the edit sheet never lets that
     * combination leave the phone — see `SubscriptionTrial.kt`.
     */
    val convertsToPrice: Int? = null,
    val autoRenew: Boolean = true,
    val status: SubscriptionStatus = SubscriptionStatus.ACTIVE,
    val accountEmail: String? = null,
    val paymentMethod: String? = null,
    val manageUrl: String? = null,
    val cancelUrl: String? = null,
    val notes: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val payments: List<Payment> = emptyList(),
    /**
     * User-chosen reminder schedule (openapi `Subscription.leadDays`): how many
     * days before `renewalDate` each reminder fires. Same shape and the same
     * rules as [Device.leadDays] — descending, `0..365` each, 1..5 entries.
     *
     * Defaulted rather than nullable so a payload from a server that predates
     * the field still renders the schedule the cron was actually using
     * ([DEFAULT_LEAD_DAYS]) instead of an empty row. See [normalizeLeadDays].
     */
    val leadDays: List<Int> = DEFAULT_LEAD_DAYS,
)

@Serializable
data class SubscriptionInput(
    val name: String,
    val category: String? = null,
    val brand: String? = null,
    val plan: String? = null,
    val billingCycle: BillingCycle = BillingCycle.MONTHLY,
    val intervalDays: Int? = null,
    val price: Int = 0,
    val startedAt: String,                 // YYYY-MM-DD
    val renewalDate: String? = null,
    /**
     * Trial end (`YYYY-MM-DD`). `null` drops the key (explicit nulls are off),
     * which the update contract reads as "unchanged". See
     * [Subscription.trialEndsAt] for the wire shape.
     */
    val trialEndsAt: String? = null,
    /**
     * Price after the trial, in VND. `null` drops the key. The API rejects it
     * when [trialEndsAt] is absent, so callers use
     * `convertsToPriceForRequest` in `SubscriptionTrial.kt` rather than sending
     * a raw value.
     */
    val convertsToPrice: Int? = null,
    val autoRenew: Boolean = true,
    val status: SubscriptionStatus = SubscriptionStatus.ACTIVE,
    val accountEmail: String? = null,
    val paymentMethod: String? = null,
    val manageUrl: String? = null,
    val cancelUrl: String? = null,
    val notes: String? = null,
    /**
     * Reminder schedule to store (openapi `SubscriptionInput.leadDays`).
     *
     * `null` omits the key → unchanged on update / server default on create.
     * The edit sheet always sends a normalised non-empty list; see
     * [DeviceInput.leadDays] for the same reasoning.
     */
    val leadDays: List<Int>? = null,
)

@Serializable
data class SubscriptionListResponse(val subscriptions: List<Subscription>)

@Serializable
data class SubscriptionResponse(val subscription: Subscription)

@Serializable
data class Payment(
    val id: String,
    val subscriptionId: String,
    val amount: Int,
    val paidAt: String,
    val note: String? = null,
    val createdAt: String? = null,
)

@Serializable
data class PaymentInput(
    val amount: Int,
    val paidAt: String,                    // YYYY-MM-DD
    val note: String? = null,
)

// ---- Wishlist ----

// Server enum: MUST | WANT | MAYBE.
@Serializable
enum class WishlistPriority(@StringRes val labelRes: Int) {
    MUST(R.string.enum_wishlist_priority_must),
    WANT(R.string.enum_wishlist_priority_want),
    MAYBE(R.string.enum_wishlist_priority_maybe),
}

// Server enum: WATCHING | DECIDED | SKIPPED | PURCHASED.
@Serializable
enum class WishlistStatus(@StringRes val labelRes: Int) {
    WATCHING(R.string.enum_wishlist_status_watching),
    DECIDED(R.string.enum_wishlist_status_decided),
    SKIPPED(R.string.enum_wishlist_status_skipped),
    PURCHASED(R.string.enum_wishlist_status_purchased),
}

@Serializable
data class WishlistItem(
    val id: String,
    val userId: String? = null,
    val name: String,
    val category: String? = null,
    val brand: String? = null,
    val initialPrice: Int? = null,
    val currentPrice: Int? = null,
    val buyUrl: String? = null,
    val imageUrl: String? = null,
    val targetDate: String? = null,
    val priority: WishlistPriority = WishlistPriority.WANT,
    val status: WishlistStatus = WishlistStatus.WATCHING,
    val notes: String? = null,
    val reminderIntervalDays: Int? = null,
    val lastNotifiedAt: String? = null,
    val purchasedDeviceId: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val prices: List<WishlistPrice> = emptyList(),
)

@Serializable
data class WishlistInput(
    val name: String,
    val category: String? = null,
    val brand: String? = null,
    val initialPrice: Int? = null,
    val currentPrice: Int? = null,
    val buyUrl: String? = null,
    val imageUrl: String? = null,
    val targetDate: String? = null,        // YYYY-MM-DD
    val priority: WishlistPriority = WishlistPriority.WANT,
    val status: WishlistStatus = WishlistStatus.WATCHING,
    val notes: String? = null,
    val reminderIntervalDays: Int? = null,
)

@Serializable
data class WishlistListResponse(val items: List<WishlistItem>)

@Serializable
data class WishlistResponse(val item: WishlistItem)

@Serializable
data class WishlistDetailResponse(
    val item: WishlistItem,
    val prices: List<WishlistPrice> = emptyList(),
)

@Serializable
data class WishlistPrice(
    val id: String,
    val itemId: String,
    val price: Int,
    val note: String? = null,
    val recordedAt: String? = null,
    val createdAt: String? = null,
)

@Serializable
data class PriceLogInput(
    val price: Int,
    val note: String? = null,
)

// ---- Cross-entity search ----

/**
 * Response of `GET /api/v1/search?q=&limit=` (openapi `SearchResults`).
 *
 * One round trip answers "where does this text appear at all?" across the four
 * entity kinds, so the search screen never fires four list requests and merges
 * them client-side. `limit` is **per group** (server default 20, hard cap 50) —
 * 20 devices + 20 subscriptions + 20 wishlist rows + 20 OCR hits at most.
 *
 * A blank query is a 200 with four empty groups, not a 400: clearing the search
 * box is a normal keystroke, so [isEmpty] can never be read as "the request
 * failed" (that is what an exception / [ApiErrorEnvelope] is for).
 *
 * Every group is defaulted. The server always serialises `[]` and never `null`,
 * but a default keeps a partial or older payload from throwing on the results
 * screen — the same leniency the other list envelopes take.
 */
@Serializable
data class SearchResults(
    /** The keyword the server actually matched, trimmed — echoed back to us. */
    val query: String = "",
    /** Matched devices, newest first. Result rows carry no `warranties`. */
    val devices: List<Device> = emptyList(),
    /** Matched subscriptions (name / brand / plan / accountEmail). */
    val subscriptions: List<Subscription> = emptyList(),
    /** Matched wishlist items (name / brand / notes). */
    val wishlist: List<WishlistItem> = emptyList(),
    /**
     * Attachments whose stored OCR transcript matches. Each row is an
     * [Attachment] with its `deviceId` present: `null` means the file is still
     * in the inbox, a real id means it is filed on that device. Only OCR text is
     * searched — a file that was never scanned never appears here.
     */
    val attachments: List<Attachment> = emptyList(),
) {
    /** Rows across all four groups — what the results header counts. */
    val total: Int
        get() = devices.size + subscriptions.size + wishlist.size + attachments.size

    /** `true` when a non-blank query matched nothing at all. */
    val isEmpty: Boolean
        get() = total == 0
}

// ---- Push ----

@Serializable
data class NativePushInput(
    val platform: String,    // "fcm"
    val token: String,
    val userAgent: String? = null,
)

@Serializable
data class PushSubscriptionMeta(
    val id: String,
    val endpoint: String,
    val platform: String,    // "web" | "apns" | "fcm"
    val userAgent: String? = null,
    val createdAt: String,
)

@Serializable
data class PushSubscriptionListResponse(
    val subscriptions: List<PushSubscriptionMeta> = emptyList(),
)

@Serializable
data class TestPushResponse(
    val sent: Int = 0,
    val failed: Int = 0,
)

// ---- Attachments ----

@Serializable
data class Attachment(
    val id: String,
    /**
     * Owning device, or **`null` for an inbox item** — an attachment that was
     * saved before the user picked a device (the capture-first inbox).
     *
     * The inbox is defined by exactly this: no device means "not filed yet". An
     * inbox item does **not** consume any device's 5 slots; that limit only
     * applies to the device it is eventually filed on.
     *
     * Nullable and defaulted because the field is optional on the wire: the
     * device-scoped reads (`GET /api/v1/devices/{id}/attachments`) predate the
     * inbox and do not echo it, and a payload that omits it must still decode.
     * The inbox endpoint returns only unfiled rows, so an absent value and an
     * explicit `null` mean the same thing to every caller.
     */
    val deviceId: String? = null,
    val fileName: String,
    val fileType: String,
    val fileSize: Long = 0,
    val description: String? = null,
    val uploadedAt: String? = null,
    /**
     * The OCR transcript the server stored on this row (`Attachment.extractedText`,
     * migration 0019), plaintext in the database and searchable through the
     * `attachments` group of `GET /api/v1/search`.
     *
     * **Absent when the file has never been scanned** — the server marks the
     * field `omitempty`, so a pre-OCR payload and an unscanned file both arrive
     * without the key. A default of `null` decodes both, and also keeps the
     * device/inbox list payloads (which predate the field) working unchanged.
     *
     * A re-scan that reads no text deliberately leaves the stored value in
     * place; the client must never treat a blank [extractedText] draft as
     * permission to clear it.
     */
    val extractedText: String? = null,
)

@Serializable
data class AttachmentListResponse(val attachments: List<Attachment> = emptyList())

/**
 * `{"attachment": {...}}` — the envelope of both the upload POST and the
 * description PATCH (`AttachmentMeta` in openapi).
 */
@Serializable
data class AttachmentResponse(val attachment: Attachment)

/**
 * Body of `PATCH /api/v1/attachments/{id}` (openapi `AttachmentDescriptionInput`).
 *
 * `description` is the only mutable field and the key is **required** — the
 * server answers 400 `fieldErrors.description = ["Thiếu description"]` when it
 * is missing — while `""` (or whitespace) clears it. Non-nullable for the same
 * reason as [UpdateProfileInput]: `ApiClient.json` drops nulls, so `""` is how
 * the UI says "clear". File metadata is not editable at all, hence no other
 * properties here.
 */
@Serializable
data class AttachmentDescriptionInput(val description: String)

/**
 * Body of `POST /api/v1/attachments/{id}/file` — the "Gán vào thiết bị" action
 * of the capture-first inbox.
 *
 * Three states, and all three are different:
 *
 *  * `deviceId = "<id>"` — file the attachment on that device. The server
 *    answers **409 `LIMIT_REACHED`** when the target already holds 5 files
 *    (`MAX_ATTACHMENTS_PER_DEVICE` in Go); an inbox item counts against no
 *    device until this call succeeds.
 *  * `deviceId = null` — send the attachment **back to the inbox**. This is the
 *    contract's documented unfile, and it is why the key must reach the wire
 *    even when it is null.
 *  * (there is no third "leave it alone" state — this endpoint always names a
 *    target).
 *
 * `ApiClient.json` sets `explicitNulls = false`, so a plain nullable property
 * would DROP `deviceId` for the unfile case and send `{}`; the server would then
 * have no target. The hand-written serializer below always writes the key, the
 * same device [UpdateLocaleInputSerializer] uses for its tri-state `locale`.
 *
 * The upload path is the mirror image: `POST /api/v1/attachments` **omits** the
 * optional `deviceId` part to create an inbox item (see
 * [com.warrly.network.ApiService.uploadAttachment]), which is exactly what
 * null-dropping gives it for free.
 */
@Serializable(with = FileAttachmentInputSerializer::class)
data class FileAttachmentInput(val deviceId: String?)

/**
 * Writes `{"deviceId": …}` **including an explicit `null`**.
 *
 * Pinned by `InboxSerializationTest.fileAttachmentInput_alwaysSendsTheKeyAndCanSendAnExplicitNull`;
 * without it the "return to inbox" call would silently send `{}`.
 */
object FileAttachmentInputSerializer : KSerializer<FileAttachmentInput> {
    override val descriptor: SerialDescriptor =
        buildClassSerialDescriptor("com.warrly.network.FileAttachmentInput") {
            element<String?>("deviceId")
        }

    override fun serialize(encoder: Encoder, value: FileAttachmentInput) {
        val jsonEncoder = encoder as? JsonEncoder
            ?: throw SerializationException("FileAttachmentInput is only serialized as JSON")
        jsonEncoder.encodeJsonElement(
            buildJsonObject {
                val target = value.deviceId
                put("deviceId", if (target == null) JsonNull else JsonPrimitive(target))
            },
        )
    }

    override fun deserialize(decoder: Decoder): FileAttachmentInput {
        val jsonDecoder = decoder as? JsonDecoder
            ?: throw SerializationException("FileAttachmentInput is only deserialized from JSON")
        val element = jsonDecoder.decodeJsonElement().jsonObject["deviceId"]
        return FileAttachmentInput(
            element?.takeIf { it !is JsonNull }?.jsonPrimitive?.content,
        )
    }
}

// ---- Account / Backup ----

@Serializable
data class DeleteAccountRequest(val password: String)

/** Counts returned by POST /api/v1/backup/import (mirrors services.ImportResult). */
@Serializable
data class ImportResult(
    val imported: Int = 0,
    val skipped: Int = 0,
    val wishlistImported: Int = 0,
    val wishlistSkipped: Int = 0,
    val subImported: Int = 0,
    val subSkipped: Int = 0,
)

@Serializable
data class ImportResultResponse(val ok: Boolean = true, val result: ImportResult)

// ---- Generic ----

@Serializable
data class OkResponse(val ok: Boolean = true)

@Serializable
data class ApiErrorEnvelope(
    val error: String,
    val message: String? = null,
    val fieldErrors: Map<String, List<String>>? = null,
)

// ---- Stats ----

@Serializable
data class UserStats(
    val devices: DeviceStats,
    val subscriptions: SubscriptionStats,
    val wishlist: WishlistStats,
)

// Money rollups are VND sums computed by Go over up to MAX_DEVICES_PER_USER
// (50) / MAX_WISHLIST_PER_USER (200) rows, each of which is an int32 on the
// wire. A single row fits in an `Int`, but the SUM does not — 2 devices at
// 1.5 tỷ already pass Int.MAX_VALUE — and kotlinx.serialization throws on an
// out-of-range Int, which would blank the whole "Thống kê" tab. Hence `Long`.
@Serializable
data class DeviceStats(
    val total: Int,
    val byStatus: Map<String, Int> = emptyMap(),
    /**
     * `SUM(Device.purchasePrice)` converted to VND by the server — one device's
     * locked `fxRate` per row, not a raw sum of mixed currencies. Android shows
     * this number as-is with a dong formatter; it must never add
     * [Device.purchasePrice] values itself (see `DeviceCurrency.kt`).
     */
    val totalPurchasePrice: Long = 0,
    /**
     * Warranty-package spend: `SUM(Warranty.cost)` across the user's devices,
     * converted to VND **per device** at that device's locked rate. Mixed
     * currencies therefore still add up, and the client does not convert.
     *
     * Added to `GET /api/v1/stats` as a *new* field (`devices.totalWarrantyCost`,
     * see docs/FEATURE_ROADMAP.md item #3). Nullable + defaulted so a server
     * that has not shipped the field yet decodes fine and the UI simply hides
     * the warranty tiles — never a crash, and never a misleading "0 ₫".
     */
    val totalWarrantyCost: Long? = null,
) {
    /**
     * Devices + warranty packages — mirrors the web `/stats` "Tổng chi mua sắm" KPI.
     *
     * Both operands are already VND on the wire (the server converts each row at
     * its locked rate), so this local addition is a sum of like units, not a
     * conversion. Summing `Device.purchasePrice` here instead would add 999 USD
     * to 25,000,000 ₫.
     */
    val totalSpend: Long
        get() = totalPurchasePrice + (totalWarrantyCost ?: 0)
}

@Serializable
data class SubscriptionStats(
    val total: Int,
    val byStatus: Map<String, Int> = emptyMap(),
    val totalMonthlyVnd: Long = 0,
)

@Serializable
data class WishlistStats(
    val total: Int,
    val byStatus: Map<String, Int> = emptyMap(),
    val totalCurrentPriceWatching: Long = 0,
)

// ---- Spending forecast (GET /api/v1/forecast) ----
//
// The forward-looking half of the app. A subscription charge is `price` charged
// ONCE per occurrence — never a monthly equivalent; LIFETIME contributes 0 and
// never appears as a charge; CUSTOM without a positive intervalDays is skipped
// entirely; only ACTIVE subscriptions count.
//
// Two honesty rules the UI must keep, straight from the API docs:
//  * `warrantyExpiringVnd` (the old package's cost) and `wishlistTargetVnd`
//    (the last recorded price) are "có thể phát sinh" — savings references, NOT
//    commitments. Never add them into the subscription total on screen.
//  * `subscriptionAutoRenewVnd` is the part that WILL be auto-charged; the rest
//    of `subscriptionVnd` is money the user still has to decide about. The
//    distinction is the point of the field.
//
// Every money/count field is int64 on the wire (the SUM is never narrowed to
// int32), so they are `Long` here — an out-of-range `Int` would throw inside
// kotlinx.serialization and blank the whole tab.

@Serializable
data class ForecastBucket(
    /** `YYYY-MM`, UTC. */
    val month: String,
    val subscriptionVnd: Long = 0,
    val subscriptionAutoRenewVnd: Long = 0,
    val subscriptionCount: Long = 0,
    /** Cost of packages expiring this month — a reference, NOT a charge. */
    val warrantyExpiringVnd: Long = 0,
    val warrantyExpiringCount: Long = 0,
    /** Last recorded price of wishlist items targeting this month — NOT a charge. */
    val wishlistTargetVnd: Long = 0,
    val wishlistTargetCount: Long = 0,
)

@Serializable
data class ForecastWarranty(
    val id: String,
    val deviceId: String = "",
    val deviceName: String = "",
    /**
     * Raw `STANDARD | EXTENDED | THIRD_PARTY`. Deliberately a String, like
     * [UpcomingReminder.type]: an enum member the app has never heard of must
     * degrade to the raw code, not throw away the whole forecast.
     */
    val type: String = "STANDARD",
    val provider: String? = null,
    val endDate: String = "",
    /** Bucket this row was counted in. */
    val month: String = "",
    val months: Int = 0,
    /** `null` = no recorded price (≠ 0 ₫). Never a charge. */
    val costVnd: Long? = null,
)

@Serializable
data class ForecastWishlistItem(
    val id: String,
    val name: String,
    val targetDate: String = "",
    val month: String = "",
    val priority: String = "WANT",
    val status: String = "WATCHING",
    /** Last recorded price; `null` = never entered. Never a charge. */
    val currentPriceVnd: Long? = null,
)

@Serializable
data class Forecast(
    val generatedAt: String = "",
    /** Inclusive start = `generatedAt`. */
    val windowStart: String = "",
    /** Exclusive end: a charge exactly here belongs to no bucket. */
    val windowEnd: String = "",
    /** Requested horizon, 1–24. */
    val months: Int = 0,
    val currency: String = "VND",
    val subscriptionTotalVnd: Long = 0,
    val subscriptionAutoRenewTotalVnd: Long = 0,
    /**
     * Canonical monthly equivalent — EQUAL to
     * `subscriptions.totalMonthlyVnd` of `GET /stats` for the same data, so the
     * "~X/tháng" line can never disagree with the tiles above. Do not use it to
     * compute a 12-month total.
     */
    val subscriptionMonthlyAverageVnd: Long = 0,
    /** Packages contributing ≥1 charge in the window. */
    val subscriptionsCount: Long = 0,
    /** Charges themselves (one QUARTERLY package contributes 4). */
    val chargesCount: Long = 0,
    /**
     * Calendar months the window touches — normally `months + 1` (the partial
     * current month plus `months` full ones), or exactly `months` when the call
     * lands on 00:00 of the 1st. Never assume 12.
     */
    val buckets: List<ForecastBucket> = emptyList(),
    val upcomingWarranties: List<ForecastWarranty> = emptyList(),
    val upcomingWishlist: List<ForecastWishlistItem> = emptyList(),
    /** Vietnamese honesty line about the model — rendered as-is. */
    val note: String = "",
)

// ---- Upcoming reminders ----

@Serializable
data class RemindersResponse(val reminders: List<UpcomingReminder> = emptyList())

@Serializable
data class UpcomingReminder(
    val id: String,             // warranty id
    val deviceId: String,
    val device: ReminderDevice,
    val type: String,           // STANDARD | EXTENDED | THIRD_PARTY
    val provider: String? = null,
    val startDate: String,
    val endDate: String,
    val months: Int,
    /**
     * True only on a row returned by `GET /api/v1/reminders?includeDismissed=true`
     * that the user has hidden ("Đã xem, ẩn đi"). The server omits the field
     * entirely on the default feed (openapi: `isDismissed` is serialised only
     * when true), so a missing key means "visible" — hence the `false` default.
     *
     * Hidden rows are returned regardless of the `withinDays` window and
     * regardless of the owning device's status, which is why the "Đã ẩn" list
     * reads this flag instead of inferring hidden-ness from dates.
     */
    val isDismissed: Boolean = false,
)

@Serializable
data class ReminderDevice(
    val id: String,
    val name: String,
    val category: String,
    /**
     * Device status as of the read. Only hidden rows can carry a non-ACTIVE
     * status (the default feed filters to ACTIVE devices); the "Đã ẩn" card
     * renders the label so a reminder on a sold/broken/lost device explains
     * itself. Defaults to ACTIVE for payloads from a server that predates the
     * field — the same fallback web and iOS use.
     */
    val status: DeviceStatus = DeviceStatus.ACTIVE,
)

// ---- "Việc cần xử lý" — GET /api/v1/actions ----
//
// The queue of things the app can DERIVE from rows that already exist but cannot
// decide on its own. Nothing here is a new stored state: an item is a conclusion
// drawn from data the user typed, which is why the list can shrink without
// anything being deleted.
//
// Two contract details drive the UI and are easy to get wrong:
//  * `snoozed=true` only ADDS rows; it never removes one. `counts` always counts
//    the ACTIONABLE subset, so a badge built from `counts` cannot change meaning
//    with the flag. `snoozedCount` is the separate "đang hoãn" number.
//  * `itemKey` (`<KIND>:<entityId>`) is the identity used to snooze — the row's
//    own id, never a position in the list.

/**
 * How many items are in the set being counted. Shared by the action queue and
 * the subscription audit — two different sets, one way of counting them.
 *
 * No defaults on purpose: this drives a badge, and a missing count must fail
 * loudly rather than render as a confident "0 việc".
 */
@Serializable
data class ActionCounts(
    /** For the queue: items **đang cần xử lý**, never the snoozed ones. */
    val total: Int,
    val high: Int,
    val medium: Int,
    val low: Int,
)

/**
 * One derived thing that needs the user to decide something (openapi
 * `ActionItem`).
 *
 * [title] and [detail] are display-ready Vietnamese written by the server, and
 * they are rendered verbatim — the client must not re-word them, because each
 * sentence names the actual dates and amounts that produced the item.
 *
 * [kind] and [severity] are raw codes (deliberately `String`, not enums: a kind
 * this build has never heard of must degrade, not throw away the whole queue).
 * The client switches on [kind] only to pick an icon and a destination.
 */
@Serializable
data class ActionItem(
    /** `<KIND>:<entityId>` — passed back verbatim to the snooze endpoints. */
    val itemKey: String,
    /** One of the ten documented kinds, e.g. `WARRANTY_EXPIRED`. */
    val kind: String,
    /** `HIGH | MEDIUM | LOW`. */
    val severity: String,
    val title: String,
    val detail: String,
    val deviceId: String? = null,
    val warrantyId: String? = null,
    val subscriptionId: String? = null,
    val wishlistItemId: String? = null,
    /** The date the item is about; absent when it has no single date. */
    val dueDate: String? = null,
    /** Money involved (VND). **`Long`**: the server sends int64. */
    val amountVnd: Long? = null,
    /**
     * Present **only** on `?snoozed=true` rows that are currently hidden — the
     * exact set [ActionCounts] excludes from the badge. Absent = actionable now.
     */
    val snoozedUntil: String? = null,
) {
    /** `true` when this row is hidden by a snooze rather than waiting for work. */
    val isSnoozed: Boolean
        get() = !snoozedUntil.isNullOrBlank()
}

/** `GET /api/v1/actions` response (openapi `ActionQueue`). */
@Serializable
data class ActionQueue(
    /** When the server built the queue; every day count in it is relative to this. */
    val generatedAt: String = "",
    /** Already sorted by the server; the client re-sorts so its own grouping is stable. */
    val items: List<ActionItem> = emptyList(),
    /** Always the actionable subset — see [ActionCounts]. Required, never defaulted. */
    val counts: ActionCounts,
    /** How many items a snooze is currently hiding, even when not in [items]. */
    val snoozedCount: Int = 0,
    /**
     * The server's own sentence about what this queue is and is **not** (not a
     * push feed; snoozing here does not touch warranty reminders). Shown as-is;
     * the UI hides the card when it is blank rather than inventing a substitute.
     */
    val note: String = "",
)

/**
 * Body of `POST /api/v1/actions/{itemKey}/snooze`.
 *
 * Non-nullable [days]: the UI always offers an explicit duration, so the client
 * never relies on the server's 90-day default. Valid range is `1–365`; anything
 * else is a 400 carrying `fieldErrors.days`, which is surfaced as-is.
 */
@Serializable
data class SnoozeInput(val days: Int)

/**
 * `POST /api/v1/actions/{itemKey}/snooze` response (openapi `SnoozeResult`).
 *
 * [days] is what the server actually applied — echoed into the confirmation so
 * the UI never claims a duration it did not ask for.
 */
@Serializable
data class SnoozeResult(
    val itemKey: String,
    val snoozedUntil: String = "",
    val days: Int = 0,
)

// ---- Tự soát gói đăng ký — GET /api/v1/subscriptions/audit ----
//
// ⚠️ The honesty rules this payload exists to enforce, kept next to the model so
// a future UI cannot quietly break them:
//  * The app has NO usage telemetry and cannot read bank transactions. A finding
//    is never "bạn không dùng gói này"; the server's phrase is "lâu rồi không
//    thấy ghi nhận gì", about RECORDING, not usage.
//  * `advisory` is always true and there is no write path: nothing is cancelled,
//    no price edited. Hence no "huỷ gói" affordance anywhere on this screen.
//  * `material = false` on a small price rise means "minor", not an alert.
//
// Every money field is int64 on the wire → `Long` (an out-of-range `Int` throws
// inside kotlinx.serialization and would blank the whole screen).

/** The constants that produced the findings, so a verdict is explainable. */
@Serializable
data class SubscriptionAuditThresholds(
    /** Minimum number of machine charges before `QUIET_AUTO_RENEW` (3). */
    val quietMinAutoCharges: Int = 0,
    /** The FIRST machine charge must be at least this many months old (6). */
    val quietMinMonths: Int = 0,
    /** Horizon in which a finding is still actionable before money moves (14). */
    val upcomingRenewalDays: Int = 0,
    /** Rise (%) from which `material` becomes true (5). Every rise is still reported. */
    val priceRiseMinPercent: Int = 0,
    /** Always true: duplicate name matching strips diacritics and case. */
    val duplicateNormalized: Boolean = false,
)

/** One advisory conclusion (openapi `SubscriptionAuditFinding`). */
@Serializable
data class SubscriptionAuditFinding(
    /** `<KIND>:<id-or-id-pair>` — stable across calls. */
    val findingKey: String,
    /** `QUIET_AUTO_RENEW | PRICE_INCREASED | DUPLICATE` (raw: may grow). */
    val kind: String,
    val severity: String,
    /** Server-written Vietnamese; rendered verbatim. */
    val title: String,
    /** The server's own sentence with the numbers behind it; rendered verbatim. */
    val detail: String,
    /** One id for the first two rules, two ids for `DUPLICATE`. */
    val subscriptionIds: List<String> = emptyList(),
    val names: List<String> = emptyList(),
    /** Month-equivalent total of the involved plans (VND, int64). `0` for LIFETIME. */
    val monthlyVnd: Long = 0,
    /** `QUIET_AUTO_RENEW`: total the MACHINE charged — not every payment. */
    val chargedTotalVnd: Long = 0,
    /** `QUIET_AUTO_RENEW`: how many machine charges there were. */
    val chargeCount: Long = 0,
    /**
     * Newest payment RECORDED. ⚠️ Deliberately **not** "last used" — the app has
     * no way to know that, and no label may imply otherwise.
     */
    val lastRecordedAt: String? = null,
    val nextRenewalAt: String? = null,
    val daysUntilRenewal: Int? = null,
    /** `PRICE_INCREASED`: previous period's amount. */
    val previousAmountVnd: Long? = null,
    /** `PRICE_INCREASED`: this period's amount. */
    val amountVnd: Long? = null,
    val increaseVnd: Long? = null,
    /** Rounded percent; `null` when the previous amount was 0 (not divisible). */
    val increasePercent: Int? = null,
    /**
     * `false` when the rise is below `priceRiseMinPercent`. The finding is still
     * reported — only its prominence is up to the client, and `false` must read
     * as minor rather than as an alert.
     */
    val material: Boolean? = null,
    /** `DUPLICATE`: which signal matched — `SAME_NAME` / `SAME_BRAND_CATEGORY`. */
    val reason: String? = null,
)

/**
 * `GET /api/v1/subscriptions/audit` response (openapi `SubscriptionAudit`).
 *
 * [thresholds] is nullable even though the contract marks it required: with no
 * thresholds there is no honest way to say which rule fired, and the UI then
 * omits the rule line instead of inventing a threshold. [advisory] defaults to
 * `false` so the "không có gì bị sửa hay huỷ tự động" reassurance is only ever
 * shown when the server actually asserted it.
 */
@Serializable
data class SubscriptionAudit(
    val generatedAt: String = "",
    /** Always an array, never null. Sorted server-side; the client re-sorts. */
    val findings: List<SubscriptionAuditFinding> = emptyList(),
    /** Required: it drives the "N phát hiện" badge, so it is never defaulted. */
    val counts: ActionCounts,
    val advisory: Boolean = false,
    val thresholds: SubscriptionAuditThresholds? = null,
    /** The server's sentence about what the analysis cannot know. Rendered verbatim. */
    val note: String = "",
)


// ---- Phiếu bàn giao bảo hành / link chia sẻ — FEATURE_IDEAS #2 ----
//
// ⚠️ The single most important rule in this block, kept next to the model:
// **the token is returned exactly once**, by `POST /api/v1/devices/{id}/shares`.
// The server stores only its sha256, so `GET .../shares` can never return it and
// there is no "show my link again" call to add later. A client that lets the user
// dismiss the create response without copying is asking them to mint a new link.

/**
 * One share link as its **owner** sees it (openapi `DeviceShare`).
 *
 * Deliberately without `token`: this shape is what the list endpoint returns and
 * no amount of client code can turn it into a usable URL. Only
 * [CreatedDeviceShare] carries the credential, and only on create.
 */
@Serializable
data class DeviceShare(
    val id: String,
    val deviceId: String,
    /** RFC3339 with `Z`. There is no such thing as a permanent link (1–90 days). */
    val expiresAt: String,
    /** Non-null once revoked; a revoked row stays in the list until deleted. */
    val revokedAt: String? = null,
    /** `true` = the certificate also carries the full serial/IMEI, not just the masked one. */
    val includeSerial: Boolean = false,
    /** How many times the certificate was opened. Owner-only. */
    val viewCount: Int = 0,
    val lastViewedAt: String? = null,
    val createdAt: String = "",
)

/**
 * The **create** response (openapi `CreatedDeviceShare`) — the only place
 * [token] ever exists outside the server's hash.
 *
 * [sharePath] is a **path**, not an absolute URL: the server does not know which
 * host the client reaches it through. Pair it with `BuildConfig.BASE_URL` via
 * [com.warrly.ui.screens.devices.shareUrl].
 */
@Serializable
data class CreatedDeviceShare(
    val id: String,
    val deviceId: String,
    val expiresAt: String,
    val revokedAt: String? = null,
    val includeSerial: Boolean = false,
    val viewCount: Int = 0,
    val lastViewedAt: String? = null,
    val createdAt: String = "",
    /** **Credential. Shown once.** Never persisted by this client. */
    val token: String = "",
    /** e.g. `/api/v1/public/shares/<token>`. Relative to the API base URL. */
    val sharePath: String = "",
)

/**
 * Body of `POST /api/v1/devices/{id}/shares`.
 *
 * Both fields are non-nullable and always sent, so the client never leans on the
 * server's defaults and the user can see exactly what was requested. An unknown
 * field is a 400 (`expiresInDay` must not silently become a 30-day link), which
 * is why the property names mirror openapi exactly.
 *
 * [expiresInDays] is bounded 1–90 server-side; there is no "never expires".
 */
@Serializable
data class CreateShareInput(
    val expiresInDays: Int = DEFAULT_EXPIRES_IN_DAYS,
    val includeSerial: Boolean = false,
) {
    companion object {
        const val DEFAULT_EXPIRES_IN_DAYS = 30
        const val MIN_EXPIRES_IN_DAYS = 1
        const val MAX_EXPIRES_IN_DAYS = 90
    }
}

@Serializable
data class CreateShareResponse(val share: CreatedDeviceShare)

/**
 * `GET /api/v1/devices/{id}/shares`.
 *
 * `shares` is always `[]`, never `null`, and a device belonging to someone else
 * answers `[]` rather than 404 — hence the default, which keeps the "no links"
 * rendering path the same shape as the empty one.
 */
@Serializable
data class DeviceShareListResponse(val shares: List<DeviceShare> = emptyList())

// ---- Danh bạ bảo hành — FEATURE_IDEAS #15 ----
//
// ⚠️ The honesty rule this payload exists to enforce: the app does **not** store
// hotlines or service-centre addresses. `phoneSource` says where a number came
// from and `null` means "app không biết". A client must never render a phone the
// user did not type, and must never imply a hotline exists when there is none.

/**
 * One brand's directory row (openapi `BrandServiceInfo`, table `BrandServiceInfo`,
 * migration 0012). Also the element type of `Catalog.brandServiceInfo`.
 *
 * **There is no `phone` and no `address`** — the table has no such columns,
 * because this repo cannot verify a hotline and "a wrong hotline is worse than an
 * empty one" (migration 0008's decision, kept by 0012). Only URLs.
 */
@Serializable
data class BrandServiceInfo(
    /** `Brand.id`, e.g. `samsung`. */
    val brandId: String,
    /** Display name, from the `Brand` table. */
    val name: String,
    /** The brand's own authorised-service-centre locator. `null` = none verified. */
    val serviceLocatorUrl: String? = null,
    /** The brand's general support page. */
    val supportUrl: String? = null,
    /** Vietnamese note about what the links are for. Rendered verbatim. */
    val notes: String? = null,
)

/**
 * A `WarrantyProvider` catalog row (openapi `WarrantyProviderRef`).
 *
 * ⚠️ `phone`/`address` are `null` on every seeded row (migration 0008). Show
 * [WarrantyCentre.phone] / [WarrantyCentre.address] instead — those are what the
 * **user** wrote.
 */
@Serializable
data class WarrantyProviderRef(
    val id: String,
    val name: String,
    val phone: String? = null,
    val address: String? = null,
    val websiteUrl: String? = null,
    val notes: String? = null,
)

/**
 * Where a [WarrantyCentre.phone] came from. There is deliberately no third value.
 *
 * ⚠️ The wire values are **lowercase** (`"user"` / `"none"`, openapi
 * `WarrantyCentre.phoneSource`) while every other enum in this API is SCREAMING
 * CASE, so the serial names are pinned explicitly. Do not drop them "for
 * consistency" with the enums above: kotlinx.serialization matches enum names
 * case-**sensitively**, and without these annotations the entire directory fails
 * to decode with "does not contain element with name 'none'" — this field is the
 * one place where a wrong guess decides whether a phone number is shown at all.
 */
@Serializable
enum class PhoneSource(@StringRes val labelRes: Int) {
    /** The user typed this number. The app is never the source of a phone number. */
    @SerialName("user")
    USER(R.string.enum_phone_source_user),

    /** There is no number. Render "chưa có số", never a hotline and never a guess. */
    @SerialName("none")
    NONE(R.string.enum_phone_source_none),
}

/**
 * One warranty's contact row (openapi `WarrantyCentre`) — **one per warranty of
 * the device, including warranties that match no catalog row**.
 *
 * [provider] being `null` is normal, not an error: either no catalog row exists
 * for the free-text brand, or the match was **ambiguous** and the server refused
 * to guess. [providerInput] is what the user actually typed and is **always**
 * shown next to it, because a null [provider] is only meaningful beside the text
 * it failed to match.
 */
@Serializable
data class WarrantyCentre(
    val warrantyId: String,
    val warrantyType: WarrantyType = WarrantyType.STANDARD,
    val endDate: String? = null,
    /** Computed server-side: is [endDate] still in the future. */
    val isActive: Boolean = false,
    /** `Warranty.provider` verbatim. Always rendered, even when [provider] is null. */
    val providerInput: String? = null,
    val provider: WarrantyProviderRef? = null,
    /** `Warranty.address` — written by **the user**. The app never fills this in. */
    val address: String? = null,
    /** `Warranty.phone` — written by **the user**. See [phoneSource]. */
    val phone: String? = null,
    val phoneSource: PhoneSource = PhoneSource.NONE,
)

/**
 * `GET /api/v1/devices/{id}/service-directory` (openapi `ServiceDirectory`).
 *
 * [brand] is `null` when the app has **no information for that brand** — either
 * because only 16 brands are seeded (migration 0012) or because the free-text
 * match **tied** and the server refuses to guess. That is a valid answer, not an
 * empty box: the UI shows [brandInput] plus a Vietnamese sentence saying the app
 * has nothing for it. The client must **not** invent a URL.
 *
 * [disclaimer] is the server's own Vietnamese explanation of why so many fields
 * are `null`; it is rendered verbatim.
 */
@Serializable
data class ServiceDirectory(
    val deviceId: String = "",
    val deviceName: String = "",
    /** Category **code**; the Vietnamese label comes from `CategoryLabels.kt`. */
    val category: String = "",
    /** `Device.brand` verbatim. `null` when the user never recorded one. */
    val brandInput: String? = null,
    val brand: BrandServiceInfo? = null,
    /** One row per warranty. Always an array, never null. */
    val centres: List<WarrantyCentre> = emptyList(),
    val disclaimer: String = "",
)

@Serializable
data class ServiceDirectoryResponse(val directory: ServiceDirectory)
