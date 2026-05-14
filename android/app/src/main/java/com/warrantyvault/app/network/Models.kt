package com.warrantyvault.app.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ---- Auth ----

@Serializable
data class AuthSuccess(val accessToken: String, val expiresAt: String, val user: User)

@Serializable
data class User(val id: String, val email: String, val name: String? = null)

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
    val warranties: List<Warranty> = emptyList(),
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
    val warrantyMonths: Int = 0,
    val warrantyProvider: String? = null,
    val warrantyAddress: String? = null,
    val warrantyPhone: String? = null,
    val warrantyNotes: String? = null,
    val fromWishlistId: String? = null,
)

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

@Serializable
data class AttachmentUploadResponse(val attachment: Attachment)

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

@Serializable
data class DeviceStats(
    val total: Int,
    val byStatus: Map<String, Int> = emptyMap(),
    val totalPurchasePrice: Int = 0,
)

@Serializable
data class SubscriptionStats(
    val total: Int,
    val byStatus: Map<String, Int> = emptyMap(),
    val totalMonthlyVnd: Int = 0,
)

@Serializable
data class WishlistStats(
    val total: Int,
    val byStatus: Map<String, Int> = emptyMap(),
    val totalCurrentPriceWatching: Int = 0,
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
