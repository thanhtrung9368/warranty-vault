package com.warrantyvault.app.ui.screens.stats

import com.warrantyvault.app.network.Forecast
import com.warrantyvault.app.network.ForecastBucket
import com.warrantyvault.app.network.UserStats
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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException

/** `StatsViewModel` — the "Thống kê" tab snapshot. */
@OptIn(ExperimentalCoroutinesApi::class)
class StatsViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    /**
     * A real `ApiService` always has both calls, so this fake answers both: the
     * forecast defaults to a transport failure, which is exactly the additive
     * case the screen has to survive ("/stats vẫn phải hiện").
     */
    private class FakeStatsApi(
        // Declared first so the existing `FakeStatsApi { stats }` trailing-lambda
        // call sites keep binding to the stats loader.
        private val forecast: suspend () -> Forecast = { throw IOException("Không có kết nối mạng") },
        private val stats: suspend () -> UserStats,
    ) : FakeApiService() {
        var requestedMonths: Int? = null
            private set

        override suspend fun getStats(): UserStats = stats()

        override suspend fun getForecast(months: Int?): Forecast {
            requestedMonths = months
            return forecast()
        }
    }

    private fun forecast(
        months: Int = 12,
        total: Long = 3_120_000,
        autoRenew: Long = 2_000_000,
        buckets: List<ForecastBucket> = emptyList(),
        note: String = "Chỉ tính các gói đang ACTIVE; gói LIFETIME không bao giờ bị trừ.",
    ) = Forecast(
        generatedAt = "2026-03-01T00:00:00Z",
        windowStart = "2026-03-01T00:00:00Z",
        windowEnd = "2027-03-01T00:00:00Z",
        months = months,
        subscriptionTotalVnd = total,
        subscriptionAutoRenewTotalVnd = autoRenew,
        subscriptionMonthlyAverageVnd = 260_000,
        subscriptionsCount = 2,
        chargesCount = 12,
        buckets = buckets,
        note = note,
    )

    @Test
    fun load_publishesTheStatsSnapshot() = runTest(dispatcher) {
        val stats = Fixtures.stats(devices = 7, subscriptions = 3, wishlist = 5)
        val vm = StatsViewModel(FakeStatsApi { stats })

        vm.load()
        advanceUntilIdle()

        val state = vm.state.value
        assertTrue("expected Loaded but was $state", state is StatsViewModel.State.Loaded)
        assertEquals(stats, (state as StatsViewModel.State.Loaded).stats)
        assertEquals(7, state.stats.devices.total)
        assertEquals(260_000, state.stats.subscriptions.totalMonthlyVnd)
    }

    @Test
    fun load_reportsServerFailuresWithTheVietnameseMessage() = runTest(dispatcher) {
        val vm = StatsViewModel(
            FakeStatsApi { throw httpError(503, """{"error":"feature_disabled","message":"Tính năng đang tắt"}""") },
        )

        vm.load()
        advanceUntilIdle()

        assertEquals(StatsViewModel.State.Error("Tính năng đang tắt"), vm.state.value)
    }

    @Test
    fun load_carriesTheWarrantyCostRollupThrough() = runTest(dispatcher) {
        val stats = Fixtures.stats(
            devices = 2,
            purchasePrice = 30_000_000,
            warrantyCost = 4_500_000,
        )
        val vm = StatsViewModel(FakeStatsApi { stats })

        vm.load()
        advanceUntilIdle()

        val loaded = vm.state.value as StatsViewModel.State.Loaded
        assertEquals(4_500_000L, loaded.stats.devices.totalWarrantyCost)
        assertEquals(34_500_000L, loaded.stats.devices.totalSpend)
    }

    @Test
    fun load_toleratesAServerWithoutTheWarrantyCostField() = runTest(dispatcher) {
        val stats = Fixtures.stats(devices = 2, purchasePrice = 30_000_000)
        val vm = StatsViewModel(FakeStatsApi { stats })

        vm.load()
        advanceUntilIdle()

        val loaded = vm.state.value as StatsViewModel.State.Loaded
        assertNull(loaded.stats.devices.totalWarrantyCost)
        assertEquals(30_000_000L, loaded.stats.devices.totalSpend)
    }
    @Test
    fun load_alsoFetchesTheForecastForTheRequestedWindow() = runTest(dispatcher) {
        val api = FakeStatsApi(
            stats = { Fixtures.stats(devices = 3) },
            forecast = { forecast() },
        )
        val vm = StatsViewModel(api)

        vm.load()
        advanceUntilIdle()

        val loaded = vm.state.value as StatsViewModel.State.Loaded
        assertEquals(3_120_000L, loaded.forecast?.subscriptionTotalVnd)
        assertEquals(2_000_000L, loaded.forecast?.subscriptionAutoRenewTotalVnd)
        // The window asked for is the VM's own constant, never a magic 12 inline.
        assertEquals(StatsViewModel.FORECAST_MONTHS, api.requestedMonths)
        assertEquals(12, api.requestedMonths)
    }

    @Test
    fun load_keepsTheStatsWhenOnlyTheForecastFails() = runTest(dispatcher) {
        val stats = Fixtures.stats(devices = 4, purchasePrice = 30_000_000)
        val vm = StatsViewModel(FakeStatsApi(stats = { stats }))

        vm.load()
        advanceUntilIdle()

        val loaded = vm.state.value as StatsViewModel.State.Loaded
        assertEquals(stats, loaded.stats)
        // Additive surface: no forecast, but no error screen either.
        assertNull(loaded.forecast)
    }

    @Test
    fun load_reportsStatsFailureWithoutCallingTheForecast() = runTest(dispatcher) {
        val api = FakeStatsApi(
            stats = { throw httpError(503, """{"error":"feature_disabled","message":"Tính năng đang tắt"}""") },
            forecast = { forecast() },
        )
        val vm = StatsViewModel(api)

        vm.load()
        advanceUntilIdle()

        assertEquals(StatsViewModel.State.Error("Tính năng đang tắt"), vm.state.value)
        assertNull(api.requestedMonths)
    }

    @Test
    fun load_carriesTheForecastCaveatsThroughUntouched() = runTest(dispatcher) {
        // The API's own honesty line and its bucket list are UI data, not
        // something the client may reinterpret on the way through.
        val note = "Tiền bảo hành và wishlist là khoản có thể phát sinh, không phải khoản chắc chắn trả."
        val payload = forecast(
            months = 3,
            buckets = listOf(
                ForecastBucket(month = "2026-03", subscriptionVnd = 260_000, subscriptionAutoRenewVnd = 260_000, subscriptionCount = 1),
                ForecastBucket(month = "2026-04", warrantyExpiringVnd = 4_000_000, warrantyExpiringCount = 1),
            ),
            note = note,
        )
        val vm = StatsViewModel(FakeStatsApi(stats = { Fixtures.stats() }, forecast = { payload }))

        vm.load()
        advanceUntilIdle()

        val loaded = vm.state.value as StatsViewModel.State.Loaded
        assertEquals(note, loaded.forecast?.note)
        assertEquals(3, loaded.forecast?.months)
        // Two buckets for a 3-month window — the count is the payload's, not 12.
        assertEquals(2, loaded.forecast?.buckets?.size)
    }
}
