package com.warrantyvault.app.ui.screens.search

import com.warrantyvault.app.network.Device
import com.warrantyvault.app.network.Subscription
import com.warrantyvault.app.network.WishlistItem
import com.warrantyvault.app.ui.components.CategoryLabels

/**
 * Group headings of the search results, one per entity kind.
 *
 * The copy is deliberately identical to the tab / page headers the rows lead
 * to ("Thiết bị", "Gói dịch vụ", "Wishlist") — a user tapping a result should
 * land on a screen that calls itself the same thing.
 */
object SearchGroups {
    const val DEVICES = "Thiết bị"
    const val SUBSCRIPTIONS = "Gói dịch vụ"
    const val WISHLIST = "Wishlist"

    /** `"Thiết bị (3)"` — the section header text. */
    fun header(label: String, count: Int): String = "$label ($count)"
}

/**
 * The one-line summary under a device result's name.
 *
 * The category name comes from the shared [CategoryLabels] table (never a
 * private map — `api/internal/services/category_seed_test.go` pins that table
 * against the web, iOS and migration copies), then brand, then model — so
 * "samsung" → "Điện thoại • Samsung • Galaxy S24" reads as where the match came
 * from. Blanks are dropped instead of rendering " •  • ".
 */
fun deviceSubtitle(device: Device): String =
    listOfNotNull(CategoryLabels.label(device.category), device.brand, device.model)
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .joinToString(" • ")

/**
 * Brand + plan for a subscription result ("Samsung • Cloud 200GB"). A
 * subscription with neither falls back to its billing cycle, which is always
 * set (the enum is non-nullable), so the line is never empty.
 */
fun subscriptionSubtitle(sub: Subscription): String {
    val parts = listOfNotNull(sub.brand, sub.plan)
        .map { it.trim() }
        .filter { it.isNotEmpty() }
    return if (parts.isEmpty()) sub.billingCycle.label else parts.joinToString(" • ")
}

/**
 * Brand for a wishlist result, falling back to the (shared-table) category
 * name and then to nothing — the row already shows both status and priority
 * pills, so the subtitle only has to say *what* the item is.
 */
fun wishlistSubtitle(item: WishlistItem): String {
    val brand = item.brand?.trim()
    if (!brand.isNullOrEmpty()) return brand
    val category = item.category?.trim()
    return if (category.isNullOrEmpty()) "" else CategoryLabels.label(category)
}
