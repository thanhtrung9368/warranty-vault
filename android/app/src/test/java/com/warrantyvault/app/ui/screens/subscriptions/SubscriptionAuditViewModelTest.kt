package com.warrantyvault.app.ui.screens.subscriptions

import com.warrantyvault.app.network.SubscriptionAudit
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
import java.io.IOException

/**
 * `SubscriptionAuditViewModel` — one read, no write path (there is none to
 * call), and the failure path.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SubscriptionAuditViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class FakeAuditApi(
        private val audit: suspend () -> SubscriptionAudit = { Fixtures.subscriptionAudit() },
    ) : FakeApiService() {
        var calls = 0
            private set

        override suspend fun getSubscriptionAudit(): SubscriptionAudit {
            calls++
            return audit()
        }
    }

    @Test
    fun load_publishesTheReportVerbatim() = runTest(dispatcher) {
        val audit = Fixtures.subscriptionAudit(
            findings = listOf(Fixtures.quietAuditFinding(), Fixtures.duplicateAuditFinding()),
        )
        val vm = SubscriptionAuditViewModel(FakeAuditApi { audit })

        vm.load()
        advanceUntilIdle()

        assertEquals(SubscriptionAuditViewModel.State.Loaded(audit), vm.state.value)
    }

    /** Reloading (pull-to-refresh) asks the server again — the report is not cached. */
    @Test
    fun load_canBeCalledAgainForPullToRefresh() = runTest(dispatcher) {
        val api = FakeAuditApi()
        val vm = SubscriptionAuditViewModel(api)

        vm.load()
        advanceUntilIdle()
        vm.load()
        advanceUntilIdle()

        assertEquals(2, api.calls)
    }

    @Test
    fun load_reportsTheServersVietnameseMessage() = runTest(dispatcher) {
        val vm = SubscriptionAuditViewModel(
            FakeAuditApi { throw httpError(500, """{"error":"internal","message":"Máy chủ đang bận"}""") },
        )

        vm.load()
        advanceUntilIdle()

        assertEquals(SubscriptionAuditViewModel.State.Error("Máy chủ đang bận"), vm.state.value)
    }

    @Test
    fun load_reportsAnOfflineFailureAsATransportMessage() = runTest(dispatcher) {
        val vm = SubscriptionAuditViewModel(
            FakeAuditApi { throw IOException("Không có kết nối mạng") },
        )

        vm.load()
        advanceUntilIdle()

        assertEquals(SubscriptionAuditViewModel.State.Error("Không có kết nối mạng"), vm.state.value)
    }
}
