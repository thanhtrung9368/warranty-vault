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

@Serializable
data class DeviceResponse(val device: Device)

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
