package com.warrantyvault.app.ui.screens.dashboard

import com.warrantyvault.app.network.DeviceListResponse
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
        private val devices: suspend () -> DeviceListResponse = { DeviceListResponse(emptyList()) },
    ) : FakeApiService() {
        override suspend fun getStats(): UserStats = stats()
        override suspend fun listUpcomingReminders(withinDays: Int): RemindersResponse = reminders()
        override suspend fun listSubscriptions(): SubscriptionListResponse = subscriptions()
        override suspend fun listWishlist(): WishlistListResponse = wishlist()
        override suspend fun listDevices(
            q: String?,
            category: String?,
            status: String?,
            sort: String?,
            dir: String?,
        ): DeviceListResponse = devices()
    }

    @Test
    fun load_mergesStatsRemindersSubscriptionsWishlistAndDevices() = runTest(dispatcher) {
        val stats = Fixtures.stats(devices = 4)
        val reminders = listOf(Fixtures.upcomingReminder(id = "war-1"))
        val subs = listOf(Fixtures.subscription())
        val wishlist = listOf(Fixtures.wishlistItem())
        val devices = listOf(Fixtures.device(id = "dev-1", effectiveWarrantyEnd = "2026-01-01"))
        val vm = DashboardViewModel(
            FakeDashboardApi(
                stats = { stats },
                reminders = { RemindersResponse(reminders) },
                subscriptions = { SubscriptionListResponse(subs) },
                wishlist = { WishlistListResponse(wishlist) },
                devices = { DeviceListResponse(devices) },
            ),
        )

        vm.load()
        advanceUntilIdle()

        assertEquals(
            DashboardViewModel.State.Loaded(
                DashboardData(
                    stats = stats,
                    reminders = reminders,
                    subscriptions = subs,
                    wishlist = wishlist,
                    devices = devices,
                ),
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

    @Test
    fun load_failsWhenTheDeviceListFails() = runTest(dispatcher) {
        // The warranty grid reads the device list, so a failure there must not
        // silently degrade to "0 đã hết hạn".
        val vm = DashboardViewModel(
            FakeDashboardApi(devices = { throw httpError(503, """{"error":"unavailable","message":"Tạm thời không có"}""") }),
        )

        vm.load()
        advanceUntilIdle()

        assertEquals(DashboardViewModel.State.Error("Tạm thời không có"), vm.state.value)
    }
}
