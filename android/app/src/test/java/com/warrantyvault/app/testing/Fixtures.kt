package com.warrantyvault.app.testing

import com.warrantyvault.app.network.Attachment
import com.warrantyvault.app.network.BillingCycle
import com.warrantyvault.app.network.Device
import com.warrantyvault.app.network.DeviceStats
import com.warrantyvault.app.network.DeviceStatus
import com.warrantyvault.app.network.ReminderDevice
import com.warrantyvault.app.network.Subscription
import com.warrantyvault.app.network.SubscriptionStats
import com.warrantyvault.app.network.SubscriptionStatus
import com.warrantyvault.app.network.UpcomingReminder
import com.warrantyvault.app.network.UserStats
import com.warrantyvault.app.network.Warranty
import com.warrantyvault.app.network.WarrantyType
import com.warrantyvault.app.network.WishlistItem
import com.warrantyvault.app.network.WishlistPriority
import com.warrantyvault.app.network.WishlistStats
import com.warrantyvault.app.network.WishlistStatus

/** Shared minimal builders so tests only spell out the fields they assert on. */
object Fixtures {

    fun device(
        id: String = "dev-1",
        name: String = "iPhone 15 Pro",
        category: String = "PHONE",
        status: DeviceStatus = DeviceStatus.ACTIVE,
        warranties: List<Warranty> = emptyList(),
        effectiveWarrantyEnd: String? = null,
        attachmentCount: Int = 0,
        brand: String? = "Apple",
        purchasePrice: Int = 30_000_000,
        soldAt: String? = null,
        soldPrice: Int? = null,
    ) = Device(
        id = id,
        userId = "user-1",
        name = name,
        category = category,
        brand = brand,
        purchaseDate = "2024-03-01",
        purchasePrice = purchasePrice,
        status = status,
        notes = null,
        soldAt = soldAt,
        soldPrice = soldPrice,
        warranties = warranties,
        effectiveWarrantyEnd = effectiveWarrantyEnd,
        attachmentCount = attachmentCount,
    )

    /** A recorded sale — the server always writes the pair together. */
    fun soldDevice(soldPrice: Int = 25_000_000, soldAt: String = "2026-03-01T00:00:00") =
        device(soldAt = soldAt, soldPrice = soldPrice)

    fun attachment(
        id: String = "att-1",
        fileName: String = "hoa-don.pdf",
        fileType: String = "application/pdf",
        description: String? = null,
    ) = Attachment(
        id = id,
        fileName = fileName,
        fileType = fileType,
        fileSize = 2048,
        description = description,
        uploadedAt = "2025-01-02T03:04:05",
    )

    fun warranty(id: String = "war-1", deviceId: String = "dev-1") = Warranty(
        id = id,
        deviceId = deviceId,
        type = WarrantyType.STANDARD,
        startDate = "2024-03-01",
        endDate = "2026-03-01",
        months = 24,
    )

    fun subscription(
        id: String = "sub-1",
        name: String = "Netflix",
        status: SubscriptionStatus = SubscriptionStatus.ACTIVE,
        cycle: BillingCycle = BillingCycle.MONTHLY,
        renewalDate: String? = "2025-01-01",
        price: Int = 260_000,
        intervalDays: Int? = null,
        brand: String? = null,
        plan: String? = null,
        notes: String? = null,
        createdAt: String? = null,
    ) = Subscription(
        id = id,
        name = name,
        brand = brand,
        plan = plan,
        billingCycle = cycle,
        intervalDays = intervalDays,
        price = price,
        startedAt = "2024-01-01",
        renewalDate = renewalDate,
        status = status,
        notes = notes,
        createdAt = createdAt,
    )

    fun wishlistItem(
        id: String = "wish-1",
        name: String = "Steam Deck",
        category: String? = null,
        priority: WishlistPriority = WishlistPriority.WANT,
        status: WishlistStatus = WishlistStatus.WATCHING,
        currentPrice: Int? = 12_000_000,
        targetDate: String? = null,
        brand: String? = null,
        notes: String? = null,
        createdAt: String? = null,
    ) = WishlistItem(
        id = id,
        name = name,
        category = category,
        priority = priority,
        status = status,
        currentPrice = currentPrice,
        targetDate = targetDate,
        brand = brand,
        notes = notes,
        createdAt = createdAt,
    )

    fun upcomingReminder(
        id: String = "war-1",
        deviceId: String = "dev-1",
        endDate: String = "2025-06-01",
    ) = UpcomingReminder(
        id = id,
        deviceId = deviceId,
        device = ReminderDevice(id = deviceId, name = "iPhone 15 Pro", category = "PHONE"),
        type = WarrantyType.STANDARD.name,
        startDate = "2023-06-01",
        endDate = endDate,
        months = 24,
    )

    fun stats(
        devices: Int = 3,
        subscriptions: Int = 2,
        wishlist: Int = 1,
        purchasePrice: Long = 30_000_000,
        /** `null` models a Go build that predates `devices.totalWarrantyCost`. */
        warrantyCost: Long? = null,
    ) = UserStats(
        devices = DeviceStats(
            total = devices,
            byStatus = mapOf("ACTIVE" to devices),
            totalPurchasePrice = purchasePrice,
            totalWarrantyCost = warrantyCost,
        ),
        subscriptions = SubscriptionStats(total = subscriptions, totalMonthlyVnd = 260_000),
        wishlist = WishlistStats(total = wishlist, totalCurrentPriceWatching = 12_000_000),
    )
}
