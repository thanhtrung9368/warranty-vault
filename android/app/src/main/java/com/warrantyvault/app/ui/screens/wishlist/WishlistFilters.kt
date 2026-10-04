package com.warrantyvault.app.ui.screens.wishlist

import androidx.annotation.StringRes
import com.warrantyvault.app.R
import com.warrantyvault.app.network.WishlistItem
import com.warrantyvault.app.network.WishlistPriority
import com.warrantyvault.app.network.WishlistStatus
import com.warrantyvault.app.ui.components.parseIsoDate

/**
 * Status facets of the web `wishlist-filter-bar.tsx` — same keys, same copy,
 * same default (`ACTIVE` = "Đang theo dõi", i.e. WATCHING + DECIDED, mirroring
 * `WISHLIST_ACTIVE_STATUSES` in `website/src/lib/wishlist-types.ts`).
 */
enum class WishlistStatusFilter(val key: String, @StringRes val labelRes: Int) {
    Active("ACTIVE", R.string.wishfilter_active),
    Watching("WATCHING", R.string.wishfilter_watching),
    Decided("DECIDED", R.string.wishfilter_decided),
    Purchased("PURCHASED", R.string.wishfilter_purchased),
    All("ALL", R.string.wishfilter_all);

    /** The statuses this facet keeps (`null` = keep everything). */
    val statuses: Set<WishlistStatus>?
        get() = when (this) {
            Active -> setOf(WishlistStatus.WATCHING, WishlistStatus.DECIDED)
            Watching -> setOf(WishlistStatus.WATCHING)
            Decided -> setOf(WishlistStatus.DECIDED)
            Purchased -> setOf(WishlistStatus.PURCHASED)
            All -> null
        }

    companion object {
        fun fromKey(key: String): WishlistStatusFilter =
            entries.firstOrNull { it.key == key } ?: Active
    }
}

/** Priority facet (web `priority` select). */
enum class WishlistPriorityFilter(val key: String, @StringRes val labelRes: Int) {
    All("ALL", R.string.wishfilter_all_tiers),
    Must("MUST", R.string.wishfilter_must),
    Want("WANT", R.string.wishfilter_want),
    Maybe("MAYBE", R.string.wishfilter_maybe);

    val priority: WishlistPriority?
        get() = when (this) {
            All -> null
            Must -> WishlistPriority.MUST
            Want -> WishlistPriority.WANT
            Maybe -> WishlistPriority.MAYBE
        }

    companion object {
        fun fromKey(key: String): WishlistPriorityFilter =
            entries.firstOrNull { it.key == key } ?: All
    }
}

/** Sort choices from the web dropdown, same order and same labels. */
enum class WishlistSort(@StringRes val labelRes: Int) {
    PriorityAsc(R.string.wishsort_priority_asc),
    TargetAsc(R.string.wishsort_target_asc),
    TargetDesc(R.string.wishsort_target_desc),
    RecentDesc(R.string.sort_recent_desc),
    PriceDesc(R.string.wishsort_price_desc),
    PriceAsc(R.string.wishsort_price_asc),
}

/**
 * Priority ordering — mirrors `WISHLIST_PRIORITY_RANK` in
 * `website/src/lib/wishlist-types.ts`. `SKIPPED`/unknown ranks are not a thing
 * here because the enum is exhaustive.
 */
internal fun priorityRank(priority: WishlistPriority): Int = when (priority) {
    WishlistPriority.MUST -> 0
    WishlistPriority.WANT -> 1
    WishlistPriority.MAYBE -> 2
}

/**
 * Search + status + priority + sort over an already-fetched list. `GET
 * /api/v1/wishlist` takes no query parameters, so this mirrors `applyFilter()`
 * in `website/src/app/(app)/wishlist/page.tsx` client-side.
 *
 * The `priority` sort is a *compound* key on the web: rank first, then
 * soonest target date as the tie-breaker (undated items last).
 */
fun filterAndSortWishlist(
    rows: List<WishlistItem>,
    query: String = "",
    status: WishlistStatusFilter = WishlistStatusFilter.Active,
    priority: WishlistPriorityFilter = WishlistPriorityFilter.All,
    sort: WishlistSort = WishlistSort.PriorityAsc,
): List<WishlistItem> {
    var out = rows
    val term = query.trim().lowercase()
    if (term.isNotEmpty()) {
        out = out.filter {
            it.name.lowercase().contains(term) ||
                (it.brand?.lowercase()?.contains(term) ?: false) ||
                (it.notes?.lowercase()?.contains(term) ?: false)
        }
    }
    status.statuses?.let { keep -> out = out.filter { it.status in keep } }
    priority.priority?.let { want -> out = out.filter { it.priority == want } }

    return when (sort) {
        WishlistSort.PriorityAsc ->
            out.sortedWith(
                compareBy({ priorityRank(it.priority) }, { targetKey(it.targetDate) }),
            )
        WishlistSort.TargetAsc -> out.sortedBy { targetKey(it.targetDate) }
        WishlistSort.TargetDesc -> out.sortedByDescending { targetKey(it.targetDate) }
        WishlistSort.RecentDesc -> out.sortedByDescending { orderKey(it.createdAt) }
        WishlistSort.PriceDesc -> out.sortedByDescending { it.currentPrice ?: 0 }
        WishlistSort.PriceAsc -> out.sortedBy { it.currentPrice ?: 0 }
    }
}

/**
 * Undated items are treated as `+∞`, exactly like the web's
 * `Number.POSITIVE_INFINITY` — so they land **last** ascending and **first**
 * descending, which is the web's behaviour too (`cmp` flips the sign).
 */
private fun targetKey(iso: String?): Long = parseIsoDate(iso)?.toEpochDay() ?: Long.MAX_VALUE

/** Epoch days (ordering-equivalent to the web's epoch millis); 0 when missing. */
private fun orderKey(iso: String?): Long = parseIsoDate(iso)?.toEpochDay() ?: 0L
