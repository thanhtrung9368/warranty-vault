package com.warrantyvault.app.ui.screens.search

import com.warrantyvault.app.network.BillingCycle
import com.warrantyvault.app.network.WishlistItem
import com.warrantyvault.app.testing.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The subtitle lines of the search result rows. Two of them exist to prove a
 * parity rule rather than a formatting taste:
 *  - the device category name comes from the shared `CategoryLabels` table
 *    (`api/internal/services/category_seed_test.go` pins that table against the
 *    web / iOS / migration copies — a private map here would drift silently);
 *  - the group headers reuse the exact copy of the screens the rows lead to.
 */
class SearchResultTextTest {

    @Test
    fun deviceSubtitleReadsCategoryBrandModelFromTheSharedTable() {
        val device = Fixtures.device(category = "PHONE", brand = "Samsung", name = "Galaxy S24")
            .copy(model = "SM-S921")

        assertEquals("Điện thoại • Samsung • SM-S921", deviceSubtitle(device))
    }

    @Test
    fun deviceSubtitleDropsMissingAndBlankParts() {
        val bare = Fixtures.device(category = "LAPTOP", brand = null, name = "ThinkPad")
            .copy(model = null)
        assertEquals("Laptop", deviceSubtitle(bare))

        val blankBrand = Fixtures.device(category = "TV", brand = "   ", name = "Tivi")
            .copy(model = null)
        assertEquals("Tivi", deviceSubtitle(blankBrand))
    }

    @Test
    fun deviceSubtitleFallsBackToKhacForAnUnknownCategory() {
        val unknown = Fixtures.device(category = "SOMETHING_NEW", brand = null, name = "Món lạ")
            .copy(model = null)
        assertEquals("SOMETHING_NEW", deviceSubtitle(unknown))

        val blank = Fixtures.device(category = "", brand = null, name = "Món lạ").copy(model = null)
        assertEquals("Khác", deviceSubtitle(blank))
    }

    @Test
    fun subscriptionSubtitleJoinsBrandAndPlan() {
        val sub = Fixtures.subscription(brand = "Samsung", plan = "Cloud 200GB")
        assertEquals("Samsung • Cloud 200GB", subscriptionSubtitle(sub))

        val brandOnly = Fixtures.subscription(brand = "Samsung", plan = "  ")
        assertEquals("Samsung", subscriptionSubtitle(brandOnly))
    }

    @Test
    fun subscriptionSubtitleFallsBackToTheBillingCycle() {
        val yearly = Fixtures.subscription(brand = null, plan = null, cycle = BillingCycle.YEARLY)
        assertEquals("Hàng năm", subscriptionSubtitle(yearly))
    }

    @Test
    fun wishlistSubtitlePrefersBrandThenTheCategoryTableThenNothing() {
        val branded = Fixtures.wishlistItem(brand = "Valve", category = "GAMING_CONSOLE")
        assertEquals("Valve", wishlistSubtitle(branded))

        val categorised = Fixtures.wishlistItem(brand = null, category = "HEADPHONE")
        assertEquals("Tai nghe", wishlistSubtitle(categorised))

        val bare = WishlistItem(id = "wish-9", name = "Món gì đó")
        assertEquals("", wishlistSubtitle(bare))
    }

    @Test
    fun groupHeadersUseTheSameCopyAsTheScreensTheyLeadTo() {
        // "Thiết bị" is the Devices tab + its PageHeader, "Gói dịch vụ" the
        // Subscriptions one, "Wishlist" the wishlist page.
        assertEquals("Thiết bị", SearchGroups.DEVICES)
        assertEquals("Gói dịch vụ", SearchGroups.SUBSCRIPTIONS)
        assertEquals("Wishlist", SearchGroups.WISHLIST)

        assertEquals("Thiết bị (3)", SearchGroups.header(SearchGroups.DEVICES, 3))
        assertEquals("Wishlist (0)", SearchGroups.header(SearchGroups.WISHLIST, 0))
    }
}
