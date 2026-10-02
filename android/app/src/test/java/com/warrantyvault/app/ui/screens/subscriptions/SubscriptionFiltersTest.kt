package com.warrantyvault.app.ui.screens.subscriptions

import com.warrantyvault.app.network.BillingCycle
import com.warrantyvault.app.network.SubscriptionStatus
import com.warrantyvault.app.testing.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Client-side subscription filtering — `GET /api/v1/subscriptions` takes no
 * query parameters, so search / facet / sort are pure functions here, ported
 * from `applyFilter()` in `website/src/app/(app)/subscriptions/page.tsx`.
 */
class SubscriptionFiltersTest {

    // ---- monthlyEquivalent (website/src/lib/subscription-types.ts) ----

    @Test
    fun monthlyEquivalent_normalisesEachCycleLikeTheWeb() {
        assertEquals(260_000, monthlyEquivalent(260_000, BillingCycle.MONTHLY, null))
        // round(300000 * 30 / 91) = 98901
        assertEquals(98_901, monthlyEquivalent(300_000, BillingCycle.QUARTERLY, null))
        // round(1200000 * 30 / 365) = 98630
        assertEquals(98_630, monthlyEquivalent(1_200_000, BillingCycle.YEARLY, null))
        // CUSTOM uses its own interval
        assertEquals(428_571, monthlyEquivalent(100_000, BillingCycle.CUSTOM, 7))
    }

    @Test
    fun monthlyEquivalent_returnsNullWhenItCannotNormalise() {
        assertEquals(0, monthlyEquivalent(9_990_000, BillingCycle.LIFETIME, null))
        assertNull(monthlyEquivalent(100_000, BillingCycle.CUSTOM, null))
        assertNull("intervalDays = 0 is unusable", monthlyEquivalent(100_000, BillingCycle.CUSTOM, 0))
        assertNull(monthlyEquivalent(100_000, BillingCycle.CUSTOM, -5))
    }

    // ---- Search ----

    @Test
    fun searchMatchesNameBrandPlanAndNotes() {
        val rows = listOf(
            Fixtures.subscription(id = "a", name = "Netflix"),
            Fixtures.subscription(id = "b", name = "Spotify", brand = "Spotify AB"),
            Fixtures.subscription(id = "c", name = "iCloud", plan = "200GB"),
            Fixtures.subscription(id = "d", name = "Figma", notes = "dùng cho công việc"),
        )

        assertEquals(listOf("a"), filterAndSortSubscriptions(rows, query = "netfl").map { it.id })
        assertEquals(listOf("b"), filterAndSortSubscriptions(rows, query = "spotify ab").map { it.id })
        assertEquals(listOf("c"), filterAndSortSubscriptions(rows, query = "200gb").map { it.id })
        assertEquals(listOf("d"), filterAndSortSubscriptions(rows, query = "công việc").map { it.id })
        assertEquals(listOf("a", "b", "c", "d"), filterAndSortSubscriptions(rows, query = "  ").map { it.id })
    }

    // ---- Status facets ----

    @Test
    fun defaultFacetHidesCanceledAndExpired() {
        val rows = listOf(
            Fixtures.subscription(id = "active", status = SubscriptionStatus.ACTIVE),
            Fixtures.subscription(id = "paused", status = SubscriptionStatus.PAUSED),
            Fixtures.subscription(id = "canceled", status = SubscriptionStatus.CANCELED),
            Fixtures.subscription(id = "expired", status = SubscriptionStatus.EXPIRED),
        )

        val visible = filterAndSortSubscriptions(rows, sort = SubscriptionSort.RecentDesc)
        assertEquals(setOf("active", "paused"), visible.map { it.id }.toSet())

        assertEquals(
            setOf("canceled"),
            filterAndSortSubscriptions(
                rows,
                status = SubscriptionStatusFilter.Canceled,
                sort = SubscriptionSort.RecentDesc,
            ).map { it.id }.toSet(),
        )
        assertEquals(
            4,
            filterAndSortSubscriptions(rows, status = SubscriptionStatusFilter.All).size,
        )
    }

    @Test
    fun unknownFacetKeyFallsBackToTheWebDefault() {
        assertEquals(SubscriptionStatusFilter.ActivePaused, SubscriptionStatusFilter.fromKey("nope"))
        assertEquals(SubscriptionStatusFilter.Active, SubscriptionStatusFilter.fromKey("ACTIVE"))
    }

    // ---- Sort ----

    @Test
    fun monthlySortUsesTheNormalisedFigureNotTheRawPrice() {
        val yearly = Fixtures.subscription(
            id = "yearly",
            name = "Yearly",
            cycle = BillingCycle.YEARLY,
            price = 1_200_000, // 98.630/tháng
        )
        val monthly = Fixtures.subscription(
            id = "monthly",
            name = "Monthly",
            cycle = BillingCycle.MONTHLY,
            price = 200_000, // 200.000/tháng — pricier per month, cheaper per cycle
        )

        assertEquals(
            listOf("monthly", "yearly"),
            filterAndSortSubscriptions(
                listOf(yearly, monthly),
                sort = SubscriptionSort.MonthlyDesc,
            ).map { it.id },
        )
        assertEquals(
            listOf("yearly", "monthly"),
            filterAndSortSubscriptions(
                listOf(yearly, monthly),
                sort = SubscriptionSort.MonthlyAsc,
            ).map { it.id },
        )
    }

    @Test
    fun renewalSortPutsUndatedRowsFirstAscending() {
        val rows = listOf(
            Fixtures.subscription(id = "later", renewalDate = "2025-06-01"),
            Fixtures.subscription(id = "undated", renewalDate = null),
            Fixtures.subscription(id = "sooner", renewalDate = "2025-02-01"),
        )

        assertEquals(
            listOf("undated", "sooner", "later"),
            filterAndSortSubscriptions(rows, sort = SubscriptionSort.RenewalAsc).map { it.id },
        )
        assertEquals(
            listOf("later", "sooner", "undated"),
            filterAndSortSubscriptions(rows, sort = SubscriptionSort.RenewalDesc).map { it.id },
        )
    }

    @Test
    fun priceSortUsesTheRawCyclePrice() {
        val rows = listOf(
            Fixtures.subscription(id = "cheap", price = 50_000),
            Fixtures.subscription(id = "dear", price = 900_000),
        )

        assertEquals(
            listOf("dear", "cheap"),
            filterAndSortSubscriptions(rows, sort = SubscriptionSort.PriceDesc).map { it.id },
        )
    }
}
