package com.warrantyvault.app.ui.screens.devices

import com.warrantyvault.app.network.DeviceResponse
import com.warrantyvault.app.testing.FakeApiService
import com.warrantyvault.app.testing.Fixtures
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
import org.junit.Before
import org.junit.Test

/**
 * `DeviceDetailViewModel.replaceDevice` — the display half of the edit round trip.
 *
 * `PATCH /api/v1/devices/{id}` answers with a bare device row: no `warranties`,
 * no `attachmentCount` and no derived `returnDeadline`. Assigning that response
 * straight into the Loaded state is what used to blank whole sections of the
 * detail screen until a manual refresh, and it would also hide the exchange-window
 * deadline the user just preserved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DeviceDetailViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class FakeDeviceApi(private val detail: () -> DeviceResponse) : FakeApiService() {
        override suspend fun getDevice(id: String): DeviceResponse = detail()
    }

    private suspend fun loadedViewModel(device: com.warrantyvault.app.network.Device): DeviceDetailViewModel {
        val vm = DeviceDetailViewModel(FakeDeviceApi { DeviceResponse(device) }, device.id)
        vm.load()
        return vm
    }

    @Test
    fun replaceDevice_carriesOverEverythingTheWriteResponseOmits() = runTest(dispatcher) {
        val detail = Fixtures.returnWindowDevice(
            returnWindowDays = 30,
            receivedAt = "2026-03-02T00:00:00",
            returnDeadline = "2026-04-01T00:00:00",
        ).copy(
            warranties = listOf(Fixtures.warranty(id = "war-1")),
            attachmentCount = 2,
        )
        val vm = loadedViewModel(detail)
        advanceUntilIdle()

        // What a PATCH actually returns: the columns (the window included, because
        // the sheet round-tripped it) and nothing derived.
        val writeResponse = Fixtures.returnWindowDevice(
            returnWindowDays = 30,
            receivedAt = "2026-03-02T00:00:00",
            returnDeadline = null,
        ).copy(name = "iPhone 15 Pro Max", warranties = emptyList(), attachmentCount = 0)

        vm.replaceDevice(writeResponse)

        val after = (vm.state.value as DeviceDetailViewModel.State.Loaded).device
        assertEquals("the edit itself must stick", "iPhone 15 Pro Max", after.name)
        assertEquals(
            "the derived deadline is not a column, and its inputs did not move, " +
                "so it is kept",
            "2026-04-01T00:00:00",
            after.returnDeadline,
        )
        assertEquals(1, after.warranties.size)
        assertEquals(2, after.attachmentCount)
    }

    /**
     * The window the form preserved is also what the screen still shows — and the
     * moment the stored window itself changes, the cached deadline goes with it
     * instead of lingering as a date the data no longer supports.
     */
    @Test
    fun replaceDevice_neverLeavesAStaleDeadlineOnScreen() = runTest(dispatcher) {
        val vm = loadedViewModel(
            Fixtures.returnWindowDevice(
                returnWindowDays = 30,
                receivedAt = "2026-03-02T00:00:00",
                returnDeadline = "2026-04-01T00:00:00",
            ),
        )
        advanceUntilIdle()

        // Same window ⇒ same deadline, still rendered.
        vm.replaceDevice(
            Fixtures.device(
                returnWindowDays = 30,
                receivedAt = "2026-03-02T00:00:00",
                returnDeadline = null,
            ),
        )
        assertEquals(
            "2026-04-01T00:00:00",
            (vm.state.value as DeviceDetailViewModel.State.Loaded).device.returnDeadline,
        )

        // Window cleared server-side (returnWindowDays: 0) ⇒ no deadline, and the
        // read-only row disappears rather than showing the old date.
        vm.replaceDevice(
            Fixtures.device(returnWindowDays = 0, receivedAt = null, returnDeadline = null),
        )
        val after = (vm.state.value as DeviceDetailViewModel.State.Loaded).device
        assertEquals(0, after.returnWindowDays)
        assertNull(after.receivedAt)
        assertNull("0 ngày ⇒ no deadline", after.returnDeadline)

        // …and a longer window ⇒ the old date is dropped until the next read,
        // because 30 days no longer describes it.
        vm.replaceDevice(
            Fixtures.device(
                returnWindowDays = 15,
                receivedAt = "2026-03-02T00:00:00",
                returnDeadline = null,
            ),
        )
        assertNull((vm.state.value as DeviceDetailViewModel.State.Loaded).device.returnDeadline)
    }
}
