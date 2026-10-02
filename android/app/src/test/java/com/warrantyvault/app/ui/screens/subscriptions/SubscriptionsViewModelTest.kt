package com.warrantyvault.app.ui.screens.subscriptions

import com.warrantyvault.app.network.SubscriptionListResponse
import com.warrantyvault.app.network.SubscriptionResponse
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

/** `SubscriptionsViewModel` + `SubscriptionDetailViewModel` (list state + local edits). */
@OptIn(ExperimentalCoroutinesApi::class)
class SubscriptionsViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class FakeSubscriptionsApi(
        private val list: suspend () -> SubscriptionListResponse = { SubscriptionListResponse(emptyList()) },
        private val one: suspend (String) -> SubscriptionResponse = { SubscriptionResponse(Fixtures.subscription()) },
    ) : FakeApiService() {
        override suspend fun listSubscriptions(): SubscriptionListResponse = list()
        override suspend fun getSubscription(id: String): SubscriptionResponse = one(id)
    }

    @Test
    fun load_publishesTheLoadedSubscriptions() = runTest(dispatcher) {
        val subs = listOf(Fixtures.subscription(id = "sub-1"), Fixtures.subscription(id = "sub-2", name = "Spotify"))
        val vm = SubscriptionsViewModel(FakeSubscriptionsApi(list = { SubscriptionListResponse(subs) }))

        vm.load()
        advanceUntilIdle()

        assertEquals(SubscriptionsViewModel.State.Loaded(subs), vm.state.value)
    }

    @Test
    fun load_mapsA401ToTheServerVietnameseMessage() = runTest(dispatcher) {
        val vm = SubscriptionsViewModel(
            FakeSubscriptionsApi(list = { throw httpError(401, """{"error":"unauthorized","message":"Phiên đăng nhập đã hết hạn"}""") }),
        )

        vm.load()
        advanceUntilIdle()

        assertEquals(SubscriptionsViewModel.State.Error("Phiên đăng nhập đã hết hạn"), vm.state.value)
    }

    @Test
    fun upsert_replacesAnExistingRowInPlaceAndPrependsANewOne() = runTest(dispatcher) {
        val first = Fixtures.subscription(id = "sub-1", name = "Netflix")
        val second = Fixtures.subscription(id = "sub-2", name = "Spotify")
        val vm = SubscriptionsViewModel(FakeSubscriptionsApi(list = { SubscriptionListResponse(listOf(first, second)) }))
        vm.load()
        advanceUntilIdle()

        val renamed = first.copy(name = "Netflix Premium")
        vm.upsert(renamed)
        assertEquals(
            "an edit must keep the original position",
            SubscriptionsViewModel.State.Loaded(listOf(renamed, second)),
            vm.state.value,
        )

        val created = Fixtures.subscription(id = "sub-3", name = "iCloud")
        vm.upsert(created)
        assertEquals(
            "a brand-new row lands on top",
            SubscriptionsViewModel.State.Loaded(listOf(created, renamed, second)),
            vm.state.value,
        )
    }

    @Test
    fun remove_dropsTheRowById() = runTest(dispatcher) {
        val first = Fixtures.subscription(id = "sub-1")
        val second = Fixtures.subscription(id = "sub-2")
        val vm = SubscriptionsViewModel(FakeSubscriptionsApi(list = { SubscriptionListResponse(listOf(first, second)) }))
        vm.load()
        advanceUntilIdle()

        vm.remove("sub-1")

        assertEquals(SubscriptionsViewModel.State.Loaded(listOf(second)), vm.state.value)
    }

    @Test
    fun detail_loadsByItsIdAndAcceptsAnEditedSubscription() = runTest(dispatcher) {
        var requestedId: String? = null
        val sub = Fixtures.subscription(id = "sub-7")
        val vm = SubscriptionDetailViewModel(
            FakeSubscriptionsApi(one = { id -> requestedId = id; SubscriptionResponse(sub) }),
            subscriptionId = "sub-7",
        )

        vm.load()
        advanceUntilIdle()

        assertEquals("sub-7", requestedId)
        assertEquals(SubscriptionDetailViewModel.State.Loaded(sub), vm.state.value)

        val renewed = sub.copy(renewalDate = "2025-02-01")
        vm.replace(renewed)
        assertEquals(SubscriptionDetailViewModel.State.Loaded(renewed), vm.state.value)
    }
}
