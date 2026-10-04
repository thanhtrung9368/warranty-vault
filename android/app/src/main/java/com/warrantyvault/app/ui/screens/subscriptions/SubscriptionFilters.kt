package com.warrantyvault.app.ui.screens.subscriptions

import androidx.annotation.StringRes
import com.warrantyvault.app.R
import com.warrantyvault.app.network.BillingCycle
import com.warrantyvault.app.network.Subscription
import com.warrantyvault.app.network.SubscriptionStatus
import com.warrantyvault.app.ui.components.parseIsoDate
import kotlin.math.roundToInt

/**
 * Status facets of the web `subscription-filter-bar.tsx`, same keys and same
 * copy. `ACTIVE_PAUSED` is the web's default: "Đang dùng" means the subscription
 * still costs money, so CANCELED/EXPIRED rows are hidden until the user asks for
 * them.
 *
 * The label is a `@StringRes` id, not a sentence: this enum is a *facet*, and a
 * facet rendered in Vietnamese inside an otherwise English filter bar is the
 * silent-fallback bug the resource split exists to prevent. Call sites resolve it
 * with `stringResource(filter.labelRes)` or `s.get(filter.labelRes)`.
 */
enum class SubscriptionStatusFilter(val key: String, @StringRes val labelRes: Int) {
    ActivePaused("ACTIVE_PAUSED", R.string.subfilter_active_paused),
    Active("ACTIVE", R.string.subfilter_active),
    Paused("PAUSED", R.string.subfilter_paused),
    Canceled("CANCELED", R.string.subfilter_canceled),
    Expired("EXPIRED", R.string.subfilter_expired),
    All("ALL", R.string.subfilter_all);

    /** The statuses this facet keeps (`null` = keep everything). */
    val statuses: Set<SubscriptionStatus>?
        get() = when (this) {
            ActivePaused -> setOf(SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED)
            Active -> setOf(SubscriptionStatus.ACTIVE)
            Paused -> setOf(SubscriptionStatus.PAUSED)
            Canceled -> setOf(SubscriptionStatus.CANCELED)
            Expired -> setOf(SubscriptionStatus.EXPIRED)
            All -> null
        }

    companion object {
        fun fromKey(key: String): SubscriptionStatusFilter =
            entries.firstOrNull { it.key == key } ?: ActivePaused
    }
}

/** Sort choices from the web dropdown, same order and same labels. */
enum class SubscriptionSort(@StringRes val labelRes: Int) {
    RenewalAsc(R.string.subsort_renewal_asc),
    RenewalDesc(R.string.subsort_renewal_desc),
    MonthlyDesc(R.string.subsort_monthly_desc),
    MonthlyAsc(R.string.subsort_monthly_asc),
    PriceDesc(R.string.subsort_price_desc),
    RecentDesc(R.string.sort_recent_desc),
}

/**
 * Pure port of `monthlyEquivalent()` in
 * `website/src/lib/subscription-types.ts`: normalises one billing cycle to a
 * monthly figure so `MONTHLY` and `YEARLY` rows can be compared.
 *
 * `null` = not normalisable (LIFETIME costs nothing per month, CUSTOM without a
 * usable `intervalDays`). Callers treat null as 0 when sorting, exactly like
 * the web's `?? 0`.
 *
 * NB: `GET /api/v1/stats` computes `subscriptions.totalMonthlyVnd` in SQL with
 * integer division for QUARTERLY (`price/3`) and YEARLY (`price/12`), which
 * disagrees with this rounding formula — a pre-existing Go↔web discrepancy,
 * reported rather than papered over here.
 */
fun monthlyEquivalent(price: Int, cycle: BillingCycle, intervalDays: Int?): Int? {
    if (cycle == BillingCycle.LIFETIME) return 0
    val days = when (cycle) {
        BillingCycle.MONTHLY -> 30
        BillingCycle.QUARTERLY -> 91
        BillingCycle.YEARLY -> 365
        BillingCycle.CUSTOM -> intervalDays?.takeIf { it > 0 } ?: return null
        BillingCycle.LIFETIME -> return 0
    }
    return ((price.toDouble() * 30.0) / days).roundToInt()
}

/**
 * Search + status facet + sort over an already-fetched list. `GET
 * /api/v1/subscriptions` takes no query parameters, so this mirrors
 * `applyFilter()` in `website/src/app/(app)/subscriptions/page.tsx` client-side.
 */
fun filterAndSortSubscriptions(
    rows: List<Subscription>,
    query: String = "",
    status: SubscriptionStatusFilter = SubscriptionStatusFilter.ActivePaused,
    sort: SubscriptionSort = SubscriptionSort.RenewalAsc,
): List<Subscription> {
    var out = rows
    val term = query.trim().lowercase()
    if (term.isNotEmpty()) {
        out = out.filter {
            it.name.lowercase().contains(term) ||
                (it.brand?.lowercase()?.contains(term) ?: false) ||
                (it.plan?.lowercase()?.contains(term) ?: false) ||
                (it.notes?.lowercase()?.contains(term) ?: false)
        }
    }
    status.statuses?.let { keep -> out = out.filter { it.status in keep } }

    val sorted = when (sort) {
        SubscriptionSort.RenewalAsc ->
            out.sortedBy { orderKey(it.renewalDate) }
        SubscriptionSort.RenewalDesc ->
            out.sortedByDescending { orderKey(it.renewalDate) }
        SubscriptionSort.MonthlyDesc ->
            out.sortedByDescending { monthlyEquivalent(it.price, it.billingCycle, it.intervalDays) ?: 0 }
        SubscriptionSort.MonthlyAsc ->
            out.sortedBy { monthlyEquivalent(it.price, it.billingCycle, it.intervalDays) ?: 0 }
        SubscriptionSort.PriceDesc ->
            out.sortedByDescending { it.price }
        SubscriptionSort.RecentDesc ->
            out.sortedByDescending { orderKey(it.createdAt) }
    }
    return sorted
}

/**
 * Sort key for an ISO date — epoch *days*, which orders identically to the
 * web's epoch milliseconds. A missing/unparseable date yields 0, matching
 * `new Date(null).getTime()` in `applyFilter()`, so undated rows sort first
 * ascending.
 */
private fun orderKey(iso: String?): Long = parseIsoDate(iso)?.toEpochDay() ?: 0L
