package com.warrantyvault.app.ui.screens.stats

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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** `StatsViewModel` — the "Thống kê" tab snapshot. */
@OptIn(ExperimentalCoroutinesApi::class)
class StatsViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class FakeStatsApi(private val stats: suspend () -> UserStats) : FakeApiService() {
        override suspend fun getStats(): UserStats = stats()
    }

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
}
