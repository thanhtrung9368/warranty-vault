package com.warrantyvault.app.ui.screens.wishlist

import com.warrantyvault.app.network.WishlistPriority
import com.warrantyvault.app.network.WishlistStatus
import com.warrantyvault.app.testing.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Client-side wishlist filtering — `GET /api/v1/wishlist` takes no query
 * parameters, so search / facets / sort are pure functions here, ported from
 * `applyFilter()` in `website/src/app/(app)/wishlist/page.tsx`.
 */
class WishlistFiltersTest {

    @Test
    fun searchMatchesNameBrandAndNotes() {
        val rows = listOf(
            Fixtures.wishlistItem(id = "a", name = "Steam Deck"),
            Fixtures.wishlistItem(id = "b", name = "Máy ảnh", brand = "Fujifilm"),
            Fixtures.wishlistItem(id = "c", name = "Bàn phím", notes = "loại im lặng"),
        )

        assertEquals(listOf("a"), filterAndSortWishlist(rows, query = "steam").map { it.id })
        assertEquals(listOf("b"), filterAndSortWishlist(rows, query = "fujifilm").map { it.id })
        assertEquals(listOf("c"), filterAndSortWishlist(rows, query = "im lặng").map { it.id })
        assertEquals(3, filterAndSortWishlist(rows, query = "").size)
    }

    @Test
    fun defaultFacetKeepsOnlyTheActiveBucket() {
        val rows = listOf(
            Fixtures.wishlistItem(id = "watching", status = WishlistStatus.WATCHING),
            Fixtures.wishlistItem(id = "decided", status = WishlistStatus.DECIDED),
            Fixtures.wishlistItem(id = "skipped", status = WishlistStatus.SKIPPED),
            Fixtures.wishlistItem(id = "purchased", status = WishlistStatus.PURCHASED),
        )

        assertEquals(
            setOf("watching", "decided"),
            filterAndSortWishlist(rows).map { it.id }.toSet(),
        )
        assertEquals(
            setOf("purchased"),
            filterAndSortWishlist(rows, status = WishlistStatusFilter.Purchased)
                .map { it.id }.toSet(),
        )
        assertEquals(4, filterAndSortWishlist(rows, status = WishlistStatusFilter.All).size)
    }

    @Test
    fun unknownFacetKeysFallBackToTheWebDefaults() {
        assertEquals(WishlistStatusFilter.Active, WishlistStatusFilter.fromKey("nope"))
        assertEquals(WishlistPriorityFilter.All, WishlistPriorityFilter.fromKey("nope"))
        assertEquals(WishlistStatusFilter.Decided, WishlistStatusFilter.fromKey("DECIDED"))
    }

    @Test
    fun priorityFacetKeepsExactlyThatPriority() {
        val rows = listOf(
            Fixtures.wishlistItem(id = "must", priority = WishlistPriority.MUST),
            Fixtures.wishlistItem(id = "want", priority = WishlistPriority.WANT),
            Fixtures.wishlistItem(id = "maybe", priority = WishlistPriority.MAYBE),
        )

        assertEquals(
            listOf("must"),
            filterAndSortWishlist(rows, priority = WishlistPriorityFilter.Must).map { it.id },
        )
        assertEquals(3, filterAndSortWishlist(rows, priority = WishlistPriorityFilter.All).size)
    }

    @Test
    fun prioritySortIsCompoundAndUndatedItemsGoLast() {
        val rows = listOf(
            Fixtures.wishlistItem(id = "maybe", priority = WishlistPriority.MAYBE, targetDate = "2025-01-01"),
            Fixtures.wishlistItem(id = "want-late", priority = WishlistPriority.WANT, targetDate = "2025-09-01"),
            Fixtures.wishlistItem(id = "want-undated", priority = WishlistPriority.WANT, targetDate = null),
            Fixtures.wishlistItem(id = "want-soon", priority = WishlistPriority.WANT, targetDate = "2025-03-01"),
            Fixtures.wishlistItem(id = "must", priority = WishlistPriority.MUST, targetDate = "2025-12-01"),
        )

        assertEquals(
            listOf("must", "want-soon", "want-late", "want-undated", "maybe"),
            filterAndSortWishlist(rows, sort = WishlistSort.PriorityAsc).map { it.id },
        )
    }

    @Test
    fun targetSortTreatsUndatedItemsAsInfinity() {
        val rows = listOf(
            Fixtures.wishlistItem(id = "late", targetDate = "2025-09-01"),
            Fixtures.wishlistItem(id = "undated", targetDate = null),
            Fixtures.wishlistItem(id = "soon", targetDate = "2025-03-01"),
        )

        // Ascending → undated last; descending → undated first, because the web
        // models a missing targetDate as +Infinity and flips the sign for desc.
        assertEquals(
            listOf("soon", "late", "undated"),
            filterAndSortWishlist(rows, sort = WishlistSort.TargetAsc).map { it.id },
        )
        assertEquals(
            listOf("undated", "late", "soon"),
            filterAndSortWishlist(rows, sort = WishlistSort.TargetDesc).map { it.id },
        )
    }

    @Test
    fun priceSortTreatsAMissingPriceAsZero() {
        val rows = listOf(
            Fixtures.wishlistItem(id = "unpriced", currentPrice = null),
            Fixtures.wishlistItem(id = "dear", currentPrice = 30_000_000),
            Fixtures.wishlistItem(id = "cheap", currentPrice = 1_000_000),
        )

        assertEquals(
            listOf("dear", "cheap", "unpriced"),
            filterAndSortWishlist(rows, sort = WishlistSort.PriceDesc).map { it.id },
        )
        assertEquals(
            listOf("unpriced", "cheap", "dear"),
            filterAndSortWishlist(rows, sort = WishlistSort.PriceAsc).map { it.id },
        )
    }

    @Test
    fun filtersCompose() {
        val rows = listOf(
            Fixtures.wishlistItem(
                id = "hit",
                name = "Steam Deck OLED",
                priority = WishlistPriority.MUST,
                status = WishlistStatus.DECIDED,
            ),
            Fixtures.wishlistItem(
                id = "wrong-status",
                name = "Steam Deck LCD",
                priority = WishlistPriority.MUST,
                status = WishlistStatus.PURCHASED,
            ),
            Fixtures.wishlistItem(
                id = "wrong-priority",
                name = "Steam Deck cũ",
                priority = WishlistPriority.MAYBE,
                status = WishlistStatus.DECIDED,
            ),
        )

        assertEquals(
            listOf("hit"),
            filterAndSortWishlist(
                rows,
                query = "steam",
                status = WishlistStatusFilter.Decided,
                priority = WishlistPriorityFilter.Must,
            ).map { it.id },
        )
    }
}
