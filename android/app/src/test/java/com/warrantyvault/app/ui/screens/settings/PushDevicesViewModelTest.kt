package com.warrantyvault.app.ui.screens.settings

import com.warrantyvault.app.network.PushSubscriptionListResponse
import com.warrantyvault.app.network.PushSubscriptionMeta
import com.warrantyvault.app.testing.FakeApiService
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

/** `PushDevicesViewModel` — the "Thiết bị nhận thông báo" list in Settings. */
@OptIn(ExperimentalCoroutinesApi::class)
class PushDevicesViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun sub(id: String, platform: String = "fcm") = PushSubscriptionMeta(
        id = id,
        endpoint = "https://fcm.googleapis.com/$id",
        platform = platform,
        userAgent = "WarrantyVault Android",
        createdAt = "2024-06-01T10:00:00Z",
    )

    private class FakePushApi(
        private val list: suspend () -> PushSubscriptionListResponse,
    ) : FakeApiService() {
        override suspend fun listPushSubscriptions(): PushSubscriptionListResponse = list()
    }

    @Test
    fun load_publishesTheRegisteredDevices() = runTest(dispatcher) {
        val subs = listOf(sub("p-1"), sub("p-2", platform = "web"))
        val vm = PushDevicesViewModel(FakePushApi { PushSubscriptionListResponse(subs) })

        vm.load()
        advanceUntilIdle()

        assertEquals(PushDevicesViewModel.State.Loaded(subs), vm.state.value)
    }

    @Test
    fun load_mapsFailuresToTheTransportMessage() = runTest(dispatcher) {
        val vm = PushDevicesViewModel(FakePushApi { throw IOException("Không có kết nối mạng") })

        vm.load()
        advanceUntilIdle()

        assertEquals(PushDevicesViewModel.State.Error("Không có kết nối mạng"), vm.state.value)
    }

    @Test
    fun removeLocally_dropsTheUnregisteredDeviceWithoutAReload() = runTest(dispatcher) {
        val keep = sub("p-1")
        val vm = PushDevicesViewModel(FakePushApi { PushSubscriptionListResponse(listOf(keep, sub("p-2"))) })
        vm.load()
        advanceUntilIdle()

        vm.removeLocally("p-2")

        assertEquals(PushDevicesViewModel.State.Loaded(listOf(keep)), vm.state.value)
    }
}
