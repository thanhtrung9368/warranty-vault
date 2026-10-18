package com.warrly.ui.screens.reminders

import com.warrly.network.DeviceStatus
import com.warrly.network.OkResponse
import com.warrly.network.RemindersResponse
import com.warrly.testing.FakeApiService
import com.warrly.testing.Fixtures
import com.warrly.testing.httpError
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

/**
 * `RemindersViewModel` — the unchanged upcoming feed, the widened "Đã ẩn"
 * read, and the dismiss/restore round trip.
 *
 * The two reads are separate calls by design: the default one must stay
 * `GET /api/v1/reminders?withinDays=30` (no `includeDismissed` parameter at
 * all), while the hidden list comes from a second, opt-in call. These tests pin
 * both the request shape and the way the two results combine.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RemindersViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private data class ReminderRequest(val withinDays: Int, val includeDismissed: Boolean?)

    private class FakeRemindersApi(
        private val upcoming: suspend () -> RemindersResponse = { RemindersResponse(emptyList()) },
        private val widened: suspend () -> RemindersResponse = upcoming,
        private val dismiss: suspend (String) -> Unit = {},
        private val restore: suspend (String) -> Unit = {},
    ) : FakeApiService() {
        /** Every list call, in order, so the default request can be pinned. */
        val requests = mutableListOf<ReminderRequest>()

        override suspend fun listUpcomingReminders(
            withinDays: Int,
            includeDismissed: Boolean?,
        ): RemindersResponse {
            requests += ReminderRequest(withinDays, includeDismissed)
            return if (includeDismissed == true) widened() else upcoming()
        }

        override suspend fun dismissWarrantyReminder(id: String): OkResponse {
            dismiss(id)
            return OkResponse()
        }

        override suspend fun restoreWarrantyReminder(id: String): OkResponse {
            restore(id)
            return OkResponse()
        }
    }

    @Test
    fun load_publishesTheUpcomingReminders() = runTest(dispatcher) {
        val reminders = listOf(Fixtures.upcomingReminder(id = "war-1"), Fixtures.upcomingReminder(id = "war-2"))
        val vm = RemindersViewModel(FakeRemindersApi(upcoming = { RemindersResponse(reminders) }))

        vm.load()
        advanceUntilIdle()

        assertEquals(RemindersViewModel.State.Loaded(reminders), vm.state.value)
    }

    @Test
    fun load_keepsTheDefaultRequestUnchangedAndReadsHiddenRowsSeparately() = runTest(dispatcher) {
        val active = Fixtures.upcomingReminder(id = "war-1", endDate = "2026-11-01")
        // A hidden row on a device that was sold *after* the reminder was
        // dismissed — outside the default feed on both counts.
        val hidden = Fixtures.upcomingReminder(
            id = "war-hidden",
            endDate = "2024-01-01",
            isDismissed = true,
            deviceStatus = DeviceStatus.SOLD,
        )
        val api = FakeRemindersApi(
            upcoming = { RemindersResponse(listOf(active)) },
            widened = { RemindersResponse(listOf(active, hidden)) },
        )
        val vm = RemindersViewModel(api)

        vm.load()
        advanceUntilIdle()

        // The first call is exactly the pre-flag request: `withinDays=30` and
        // no `includeDismissed` (null is omitted by Retrofit). The second is
        // the opt-in read — the widest accepted window, flag on.
        assertEquals(
            listOf(
                ReminderRequest(30, null),
                ReminderRequest(DISMISSED_WINDOW_DAYS, true),
            ),
            api.requests,
        )

        val loaded = vm.state.value as RemindersViewModel.State.Loaded
        assertEquals("the default feed is still the upcoming list", listOf(active), loaded.items)
        assertEquals(
            "the widened feed contributes exactly the hidden, non-ACTIVE row",
            listOf(
                DismissedReminder(
                    warrantyId = "war-hidden",
                    deviceId = "dev-1",
                    deviceName = "iPhone 15 Pro",
                    deviceCategory = "PHONE",
                    deviceStatus = DeviceStatus.SOLD,
                    warrantyType = "STANDARD",
                    warrantyProvider = null,
                    endDate = "2024-01-01",
                ),
            ),
            loaded.dismissed,
        )
        assertFalse(loaded.dismissedUnavailable)
    }

    @Test
    fun load_whenTheHiddenFeedFails_keepsTheUpcomingListAndFlagsTheSection() = runTest(dispatcher) {
        val active = Fixtures.upcomingReminder(id = "war-1")
        val vm = RemindersViewModel(
            FakeRemindersApi(
                upcoming = { RemindersResponse(listOf(active)) },
                widened = { throw IOException("Không có kết nối mạng") },
            ),
        )

        vm.load()
        advanceUntilIdle()

        assertEquals(
            RemindersViewModel.State.Loaded(
                items = listOf(active),
                dismissed = emptyList(),
                dismissedUnavailable = true,
            ),
            vm.state.value,
        )
    }

    @Test
    fun dismiss_callsTheApiReloadsBothFeedsAndSignalsSuccess() = runTest(dispatcher) {
        val dismissedId = "war-1"
        var calls = 0
        var seenId: String? = null
        val vm = RemindersViewModel(
            FakeRemindersApi(
                upcoming = {
                    calls++
                    val items = if (calls == 1) {
                        listOf(Fixtures.upcomingReminder(id = dismissedId), Fixtures.upcomingReminder(id = "war-2"))
                    } else {
                        listOf(Fixtures.upcomingReminder(id = "war-2"))
                    }
                    RemindersResponse(items)
                },
                widened = { RemindersResponse(emptyList()) },
                dismiss = { seenId = it },
            ),
        )
        var success = false
        var error: String? = null

        vm.load()
        advanceUntilIdle()

        vm.dismiss(dismissedId, onError = { error = it }, onSuccess = { success = true })
        advanceUntilIdle()

        assertEquals(dismissedId, seenId)
        assertTrue("onSuccess must fire after the reload", success)
        assertFalse("no error callback expected", error != null)
        assertEquals(2, calls)
        assertEquals(
            RemindersViewModel.State.Loaded(listOf(Fixtures.upcomingReminder(id = "war-2"))),
            vm.state.value,
        )
    }

    @Test
    fun restore_removesTheHiddenRowAndSignalsSuccess() = runTest(dispatcher) {
        val hidden = Fixtures.upcomingReminder(
            id = "war-hidden",
            endDate = "2024-01-01",
            isDismissed = true,
            deviceStatus = DeviceStatus.SOLD,
        )
        var restored = false
        var restoredId: String? = null
        val vm = RemindersViewModel(
            FakeRemindersApi(
                upcoming = { RemindersResponse(emptyList()) },
                widened = { RemindersResponse(if (restored) emptyList() else listOf(hidden)) },
                restore = {
                    restoredId = it
                    restored = true
                },
            ),
        )

        vm.load()
        advanceUntilIdle()
        assertEquals(
            1,
            (vm.state.value as RemindersViewModel.State.Loaded).dismissed.size,
        )

        var success = false
        var error: String? = null
        vm.restore("war-hidden", onError = { error = it }, onSuccess = { success = true })
        advanceUntilIdle()

        assertEquals("war-hidden", restoredId)
        assertTrue("onSuccess must fire after the reload", success)
        assertFalse("no error callback expected", error != null)
        assertEquals(
            RemindersViewModel.State.Loaded(items = emptyList()),
            vm.state.value,
        )
    }

    @Test
    fun dismissAndRestore_reportFailuresThroughOnError() = runTest(dispatcher) {
        val reminders = { RemindersResponse(listOf(Fixtures.upcomingReminder())) }

        val vm = RemindersViewModel(
            FakeRemindersApi(
                upcoming = reminders,
                widened = { RemindersResponse(emptyList()) },
                dismiss = { throw httpError(409, """{"error":"conflict","message":"Nhắc nhở đã được tắt"}""") },
                restore = { throw IOException("Không có kết nối mạng") },
            ),
        )
        vm.load()
        advanceUntilIdle()

        var success = false
        var dismissError: String? = null
        vm.dismiss("war-1", onError = { dismissError = it }, onSuccess = { success = true })
        advanceUntilIdle()
        assertEquals("Nhắc nhở đã được tắt", dismissError)
        assertFalse("onSuccess must not fire on failure", success)

        var restoreSuccess = false
        var restoreError: String? = null
        vm.restore(
            "war-1",
            onError = { restoreError = it },
            onSuccess = { restoreSuccess = true },
        )
        advanceUntilIdle()
        assertEquals("Không có kết nối mạng", restoreError)
        assertFalse("onSuccess must not fire when restore fails", restoreSuccess)
    }
}
