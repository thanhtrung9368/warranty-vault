package com.warrantyvault.app.testing

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
    ) = Device(
        id = id,
        userId = "user-1",
        name = name,
        category = category,
        brand = "Apple",
        purchaseDate = "2024-03-01",
        purchasePrice = 30_000_000,
        status = status,
        warranties = warranties,
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
    ) = Subscription(
        id = id,
        name = name,
        billingCycle = cycle,
        price = 260_000,
        startedAt = "2024-01-01",
        renewalDate = renewalDate,
        status = status,
    )

    fun wishlistItem(
        id: String = "wish-1",
        name: String = "Steam Deck",
        priority: WishlistPriority = WishlistPriority.WANT,
        status: WishlistStatus = WishlistStatus.WATCHING,
    ) = WishlistItem(
        id = id,
        name = name,
        priority = priority,
        status = status,
        currentPrice = 12_000_000,
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
    ) = UserStats(
        devices = DeviceStats(total = devices, byStatus = mapOf("ACTIVE" to devices)),
        subscriptions = SubscriptionStats(total = subscriptions, totalMonthlyVnd = 260_000),
        wishlist = WishlistStats(total = wishlist, totalCurrentPriceWatching = 12_000_000),
    )
}
