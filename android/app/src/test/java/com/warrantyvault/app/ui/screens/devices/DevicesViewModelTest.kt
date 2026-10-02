package com.warrantyvault.app.ui.screens.devices

import com.warrantyvault.app.network.DeviceListResponse
import com.warrantyvault.app.network.DeviceResponse
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

/** `DevicesViewModel` + `DeviceDetailViewModel` load/error/patch behaviour. */
@OptIn(ExperimentalCoroutinesApi::class)
class DevicesViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class FakeDevicesApi(
        private val list: suspend () -> DeviceListResponse = { DeviceListResponse(emptyList()) },
        private val one: suspend (String) -> DeviceResponse = { DeviceResponse(Fixtures.device()) },
    ) : FakeApiService() {
        override suspend fun listDevices(
            q: String?,
            category: String?,
            status: String?,
            sort: String?,
            dir: String?,
        ): DeviceListResponse = list()

        override suspend fun getDevice(id: String): DeviceResponse = one(id)
    }

    @Test
    fun load_publishesTheLoadedDevices() = runTest(dispatcher) {
        val devices = listOf(Fixtures.device(id = "dev-1"), Fixtures.device(id = "dev-2", name = "iPad"))
        val vm = DevicesViewModel(FakeDevicesApi(list = { DeviceListResponse(devices) }))

        vm.load()
        advanceUntilIdle()

        assertEquals(DevicesViewModel.State.Loaded(devices), vm.state.value)
    }

    @Test
    fun load_mapsFailuresToAVietnameseMessage() = runTest(dispatcher) {
        val serverDown = DevicesViewModel(
            FakeDevicesApi(list = { throw httpError(500, """{"error":"internal","message":"Máy chủ đang bận"}""") }),
        )
        serverDown.load()
        advanceUntilIdle()
        assertEquals(DevicesViewModel.State.Error("Máy chủ đang bận"), serverDown.state.value)

        val offline = DevicesViewModel(FakeDevicesApi(list = { throw IOException("Không có kết nối mạng") }))
        offline.load()
        advanceUntilIdle()
        assertEquals(DevicesViewModel.State.Error("Không có kết nối mạng"), offline.state.value)
    }

    @Test
    fun prepend_putsTheNewDeviceFirstWithoutRefetching() = runTest(dispatcher) {
        val existing = Fixtures.device(id = "dev-1")
        val created = Fixtures.device(id = "dev-new", name = "Máy ảnh")
        val vm = DevicesViewModel(FakeDevicesApi(list = { DeviceListResponse(listOf(existing)) }))
        vm.load()
        advanceUntilIdle()

        vm.prepend(created)

        assertEquals(DevicesViewModel.State.Loaded(listOf(created, existing)), vm.state.value)
    }

    @Test
    fun prepend_beforeLoad_isIgnored() = runTest(dispatcher) {
        val vm = DevicesViewModel(FakeDevicesApi())

        vm.prepend(Fixtures.device())

        assertEquals(DevicesViewModel.State.Loading, vm.state.value)
    }

    @Test
    fun deviceDetail_loadsTheRequestedIdAndAcceptsLocalReplacement() = runTest(dispatcher) {
        var requestedId: String? = null
        val device = Fixtures.device(id = "dev-9", name = "Tai nghe")
        val vm = DeviceDetailViewModel(
            FakeDevicesApi(one = { id -> requestedId = id; DeviceResponse(device) }),
            deviceId = "dev-9",
        )

        vm.load()
        advanceUntilIdle()

        assertEquals("dev-9", requestedId)
        assertEquals(DeviceDetailViewModel.State.Loaded(device), vm.state.value)

        val edited = device.copy(name = "Tai nghe Bluetooth")
        vm.replaceDevice(edited)
        assertEquals(DeviceDetailViewModel.State.Loaded(edited), vm.state.value)
    }
}
