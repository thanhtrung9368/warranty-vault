package com.warrantyvault.app.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ---- Auth ----

@Serializable
data class AuthSuccess(val accessToken: String, val expiresAt: String, val user: User)

@Serializable
data class User(
    val id: String,
    val email: String,
    val name: String? = null,
    val aiOptIn: Boolean = false,
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
 * `displayName` is the ONLY accepted field and the key is **required**: a body
 * without it is 400 `fieldErrors.displayName = ["Thiếu displayName"]`, while an
 * empty (or whitespace-only) string clears the stored name (`User.name` → null).
 *
 * Deliberately non-nullable: `ApiClient.json` sets `explicitNulls = false`, so a
 * `null` would drop the key entirely and turn "clear my name" into a 400.
 * `""` is the documented clear value, so it is what the UI sends.
 *
 * There is no `email` / `newEmail` property because email change is NOT part of
 * the contract — sending one is an explicit 400, and the Settings UI must not
 * look like it can be edited.
 */
@Serializable
data class UpdateProfileInput(val displayName: String)

/** Response of `PATCH /api/v1/auth/me` — the fresh user plus a Vietnamese note. */
@Serializable
data class UpdateProfileResponse(
    val user: User,
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

@Serializable
enum class DeviceStatus {
    ACTIVE, EXPIRED, SOLD, BROKEN, LOST;

    val label: String
        get() = when (this) {
            ACTIVE -> "Đang dùng"
            EXPIRED -> "Hết bảo hành"
            SOLD -> "Đã bán"
            BROKEN -> "Hỏng"
            LOST -> "Mất"
        }
}

@Serializable
enum class WarrantyType {
    STANDARD, EXTENDED, THIRD_PARTY;

    val label: String
        get() = when (this) {
            STANDARD -> "Tiêu chuẩn"
            EXTENDED -> "Mở rộng"
            THIRD_PARTY -> "Bên thứ ba"
        }
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
    /** Sale price in VND. `null` = not sold; `0` is a real price (give-away). */
    val soldPrice: Int? = null,
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
 * [com.warrantyvault.app.ui.screens.devices.deviceWarningMessage] falls back to
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
    val cost: Int? = null,
    val address: String? = null,
    val phone: String? = null,
    val notes: String? = null,
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
    /** Sale price in VND. Negative is a 400; `0` is a valid give-away price. */
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
    val warrantyMonths: Int = 0,
    val warrantyProvider: String? = null,
    val warrantyAddress: String? = null,
    val warrantyPhone: String? = null,
    val warrantyNotes: String? = null,
    val fromWishlistId: String? = null,
)

// ---- AI receipt OCR ----

// Draft from POST /api/v1/ai/extract-receipt. Mirrors Go DraftDevice / openapi.
// Every field is nullable — the model returns null for anything it can't read.
// NEVER persisted directly; the form pre-fills from it and the user confirms.
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
)

@Serializable
data class DraftDeviceResponse(val draft: DraftDevice)

@Serializable
data class AIOptInRequest(val enabled: Boolean)

@Serializable
data class AIOptInResponse(val aiOptIn: Boolean)

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
     * [com.warrantyvault.app.network.ServiceDirectory], which is the endpoint
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
enum class SubscriptionStatus {
    ACTIVE, PAUSED, CANCELED, EXPIRED;

    val label: String
        get() = when (this) {
            ACTIVE -> "Đang hoạt động"
            PAUSED -> "Tạm dừng"
            CANCELED -> "Đã huỷ"
            EXPIRED -> "Hết hạn"
        }
}

@Serializable
enum class BillingCycle {
    MONTHLY, QUARTERLY, YEARLY, LIFETIME, CUSTOM;

    val label: String
        get() = when (this) {
            MONTHLY -> "Hàng tháng"
            QUARTERLY -> "Hàng quý"
            YEARLY -> "Hàng năm"
            LIFETIME -> "Lifetime / Trọn đời"
            CUSTOM -> "Tuỳ chỉnh"
        }
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
    val autoRenew: Boolean = true,
    val status: SubscriptionStatus = SubscriptionStatus.ACTIVE,
    val accountEmail: String? = null,
    val paymentMethod: String? = null,
    val manageUrl: String? = null,
    val cancelUrl: String? = null,
    val notes: String? = null,
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
enum class WishlistPriority {
    MUST, WANT, MAYBE;

    val label: String
        get() = when (this) {
            MUST -> "Phải mua"
            WANT -> "Muốn"
            MAYBE -> "Cân nhắc"
        }
}

// Server enum: WATCHING | DECIDED | SKIPPED | PURCHASED.
@Serializable
enum class WishlistStatus {
    WATCHING, DECIDED, SKIPPED, PURCHASED;

    val label: String
        get() = when (this) {
            WATCHING -> "Đang theo dõi"
            DECIDED -> "Quyết mua"
            SKIPPED -> "Bỏ qua"
            PURCHASED -> "Đã mua"
        }
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
 * One round trip answers "where does this text appear at all?" across the three
 * entity kinds, so the search screen never fires three list requests and merges
 * them client-side. `limit` is **per group** (server default 20, hard cap 50) —
 * 20 devices + 20 subscriptions + 20 wishlist rows at most.
 *
 * A blank query is a 200 with three empty groups, not a 400: clearing the search
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
) {
    /** Rows across all three groups — what the results header counts. */
    val total: Int
        get() = devices.size + subscriptions.size + wishlist.size

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
    val fileName: String,
    val fileType: String,
    val fileSize: Long = 0,
    val description: String? = null,
    val uploadedAt: String? = null,
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
    val totalPurchasePrice: Long = 0,
    /**
     * Warranty-package spend: `SUM(Warranty.cost)` across the user's devices.
     *
     * Added to `GET /api/v1/stats` as a *new* field (`devices.totalWarrantyCost`,
     * see docs/FEATURE_ROADMAP.md item #3). Nullable + defaulted so a server
     * that has not shipped the field yet decodes fine and the UI simply hides
     * the warranty tiles — never a crash, and never a misleading "0đ".
     */
    val totalWarrantyCost: Long? = null,
) {
    /** Devices + warranty packages — mirrors the web `/stats` "Tổng chi mua sắm" KPI. */
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
    /** `null` = no recorded price (≠ 0đ). Never a charge. */
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
)

@Serializable
data class ReminderDevice(
    val id: String,
    val name: String,
    val category: String,
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
 * [com.warrantyvault.app.ui.screens.devices.shareUrl].
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
enum class PhoneSource {
    /** The user typed this number. The app is never the source of a phone number. */
    @SerialName("user")
    USER,

    /** There is no number. Render "chưa có số", never a hotline and never a guess. */
    @SerialName("none")
    NONE,
    ;

    val label: String
        get() = when (this) {
            USER -> "Số do bạn tự ghi"
            NONE -> "Chưa có số điện thoại"
        }
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
