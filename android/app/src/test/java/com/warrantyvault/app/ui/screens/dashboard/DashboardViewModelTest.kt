package com.warrantyvault.app.ui.screens.dashboard

import com.warrantyvault.app.network.RemindersResponse
import com.warrantyvault.app.network.SubscriptionListResponse
import com.warrantyvault.app.network.UserStats
import com.warrantyvault.app.network.WishlistListResponse
import com.warrantyvault.app.testing.FakeApiService
import com.warrantyvault.app.testing.Fixtures
import com.warrantyvault.app.testing.httpError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

/** `DashboardViewModel` fans out to four endpoints and merges them into one payload. */
@OptIn(ExperimentalCoroutinesApi::class)
class DashboardViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class FakeDashboardApi(
        private val stats: suspend () -> UserStats = { Fixtures.stats() },
        private val reminders: suspend () -> RemindersResponse = { RemindersResponse(emptyList()) },
        private val subscriptions: suspend () -> SubscriptionListResponse = { SubscriptionListResponse(emptyList()) },
        private val wishlist: suspend () -> WishlistListResponse = { WishlistListResponse(emptyList()) },
    ) : FakeApiService() {
        override suspend fun getStats(): UserStats = stats()
        override suspend fun listUpcomingReminders(withinDays: Int): RemindersResponse = reminders()
        override suspend fun listSubscriptions(): SubscriptionListResponse = subscriptions()
        override suspend fun listWishlist(): WishlistListResponse = wishlist()
    }

    @Test
    fun load_mergesStatsRemindersSubscriptionsAndWishlist() = runTest(dispatcher) {
        val stats = Fixtures.stats(devices = 4)
        val reminders = listOf(Fixtures.upcomingReminder(id = "war-1"))
        val subs = listOf(Fixtures.subscription())
        val wishlist = listOf(Fixtures.wishlistItem())
        val vm = DashboardViewModel(
            FakeDashboardApi(
                stats = { stats },
                reminders = { RemindersResponse(reminders) },
                subscriptions = { SubscriptionListResponse(subs) },
                wishlist = { WishlistListResponse(wishlist) },
            ),
        )

        vm.load()
        advanceUntilIdle()

        assertEquals(
            DashboardViewModel.State.Loaded(
                DashboardData(stats = stats, reminders = reminders, subscriptions = subs, wishlist = wishlist),
            ),
            vm.state.value,
        )
    }

    @Test
    fun load_failsTheWholeDashboardWhenAnyEndpointFails() = runTest(dispatcher) {
        val vm = DashboardViewModel(
            FakeDashboardApi(reminders = { throw httpError(500, """{"error":"internal","message":"Máy chủ đang bận"}""") }),
        )

        vm.load()
        advanceUntilIdle()

        assertEquals(DashboardViewModel.State.Error("Máy chủ đang bận"), vm.state.value)
    }
}
