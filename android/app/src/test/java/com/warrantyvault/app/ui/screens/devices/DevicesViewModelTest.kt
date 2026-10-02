package com.warrantyvault.app.ui.screens.devices

import com.warrantyvault.app.network.DeviceListResponse
import com.warrantyvault.app.network.DeviceResponse
import com.warrantyvault.app.network.DeviceStatus
import com.warrantyvault.app.network.OkResponse
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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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

    /** Captures the filter arguments the ViewModel forwards to the API. */
    private data class ListCall(
        val q: String?,
        val category: String?,
        val status: String?,
        val sort: String?,
        val dir: String?,
    )

    private class FakeDevicesApi(
        private val list: suspend () -> DeviceListResponse = { DeviceListResponse(emptyList()) },
        private val one: suspend (String) -> DeviceResponse = { DeviceResponse(Fixtures.device()) },
        private val onList: (ListCall) -> Unit = {},
    ) : FakeApiService() {
        override suspend fun listDevices(
            q: String?,
            category: String?,
            status: String?,
            sort: String?,
            dir: String?,
        ): DeviceListResponse {
            onList(ListCall(q, category, status, sort, dir))
            return list()
        }

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
    fun load_defaultsToNewestPurchaseFirstWithNoSearchOrStatus() = runTest(dispatcher) {
        var call: ListCall? = null
        val vm = DevicesViewModel(FakeDevicesApi(onList = { call = it }))

        vm.load()
        advanceUntilIdle()

        assertEquals(ListCall(q = null, category = null, status = null, sort = "purchaseDate", dir = "desc"), call)
    }

    @Test
    fun load_forwardsSearchStatusAndSortToTheApi() = runTest(dispatcher) {
        var call: ListCall? = null
        val vm = DevicesViewModel(FakeDevicesApi(onList = { call = it }))

        vm.load(query = "  iphone  ", status = DeviceStatus.EXPIRED, sort = DeviceSort.WarrantyEndAsc)
        advanceUntilIdle()

        assertEquals(
            ListCall(
                q = "iphone",
                category = null,
                status = "EXPIRED",
                sort = "warrantyEndDate",
                dir = "asc",
            ),
            call,
        )
    }

    @Test
    fun load_omitsABlankSearchTerm() = runTest(dispatcher) {
        var call: ListCall? = null
        val vm = DevicesViewModel(FakeDevicesApi(onList = { call = it }))

        vm.load(query = "   ")
        advanceUntilIdle()

        assertEquals(null, call?.q)
    }

    @Test
    fun everySortOptionMapsOntoTheOpenApiEnum() = runTest(dispatcher) {
        val allowed = setOf("purchaseDate", "warrantyEndDate", "price", "name")
        val dirs = setOf("asc", "desc")

        assertTrue("unexpected sort value", DeviceSort.entries.all { it.sort in allowed })
        assertTrue("unexpected dir value", DeviceSort.entries.all { it.dir in dirs })
        assertEquals("the web dropdown has 7 options", 7, DeviceSort.entries.size)
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

    @Test
    fun deviceDetail_replacingWithABarePatchResponseKeepsTheLoadedWarranties() = runTest(dispatcher) {
        // PATCH returns a bare device row (no warranties / attachments /
        // effectiveWarrantyEnd), which used to blank the detail sections.
        val warranty = Fixtures.warranty(id = "war-1", deviceId = "dev-9")
        val loaded = Fixtures.device(
            id = "dev-9",
            warranties = listOf(warranty),
            effectiveWarrantyEnd = "2026-03-01",
            attachmentCount = 2,
        )
        val vm = DeviceDetailViewModel(
            FakeDevicesApi(one = { DeviceResponse(loaded) }),
            deviceId = "dev-9",
        )
        vm.load()
        advanceUntilIdle()

        val patchResponse = Fixtures.device(id = "dev-9", brand = "Sony")
        assertTrue("the fixture must not carry warranties", patchResponse.warranties.isEmpty())
        vm.replaceDevice(patchResponse)

        val after = (vm.state.value as DeviceDetailViewModel.State.Loaded).device
        assertEquals("Sony", after.brand)
        assertEquals(listOf(warranty), after.warranties)
        assertEquals("2026-03-01", after.effectiveWarrantyEnd)
        assertEquals(2, after.attachmentCount)
    }

    // ---- delete device (web: DeleteDeviceButton) ----

    private class FakeDeleteApi(
        private val onDelete: suspend (String) -> Unit,
    ) : FakeApiService() {
        override suspend fun deleteDevice(id: String): OkResponse {
            onDelete(id)
            return OkResponse()
        }
    }

    @Test
    fun deleteDevice_signalsSuccessWithTheRequestedId() = runTest(dispatcher) {
        var deletedId: String? = null
        val vm = DeviceDetailViewModel(
            FakeDeleteApi { deletedId = it },
            deviceId = "dev-42",
        )

        var done = false
        var error: String? = null
        vm.delete(onDeleted = { done = true }, onError = { error = it })
        advanceUntilIdle()

        assertEquals("dev-42", deletedId)
        assertTrue("onDeleted must fire", done)
        assertEquals(null, error)
    }

    @Test
    fun deleteDevice_surfacesTheServerMessageAndDoesNotSignalSuccess() = runTest(dispatcher) {
        val vm = DeviceDetailViewModel(
            FakeDeleteApi { throw httpError(409, """{"error":"conflict","message":"Không xoá được thiết bị"}""") },
            deviceId = "dev-42",
        )

        var done = false
        var error: String? = null
        vm.delete(onDeleted = { done = true }, onError = { error = it })
        advanceUntilIdle()

        assertEquals("Không xoá được thiết bị", error)
        assertFalse("success must not fire on failure", done)
    }
}
