package com.warrantyvault.app.ui.screens.reminders

import com.warrantyvault.app.network.OkResponse
import com.warrantyvault.app.network.RemindersResponse
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

/** `RemindersViewModel` — list loading plus the dismiss/restore round trip. */
@OptIn(ExperimentalCoroutinesApi::class)
class RemindersViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class FakeRemindersApi(
        private val list: suspend () -> RemindersResponse = { RemindersResponse(emptyList()) },
        private val dismiss: suspend (String) -> Unit = {},
        private val restore: suspend (String) -> Unit = {},
    ) : FakeApiService() {
        override suspend fun listUpcomingReminders(withinDays: Int): RemindersResponse = list()

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
        val vm = RemindersViewModel(FakeRemindersApi(list = { RemindersResponse(reminders) }))

        vm.load()
        advanceUntilIdle()

        assertEquals(RemindersViewModel.State.Loaded(reminders), vm.state.value)
    }

    @Test
    fun dismiss_callsTheApiReloadsTheListAndSignalsSuccess() = runTest(dispatcher) {
        val dismissedId = "war-1"
        var calls = 0
        var seenId: String? = null
        val vm = RemindersViewModel(
            FakeRemindersApi(
                list = {
                    calls++
                    val items = if (calls == 1) {
                        listOf(Fixtures.upcomingReminder(id = dismissedId), Fixtures.upcomingReminder(id = "war-2"))
                    } else {
                        listOf(Fixtures.upcomingReminder(id = "war-2"))
                    }
                    RemindersResponse(items)
                },
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
    fun dismissAndRestore_reportFailuresThroughOnError() = runTest(dispatcher) {
        val reminders = { RemindersResponse(listOf(Fixtures.upcomingReminder())) }

        val vm = RemindersViewModel(
            FakeRemindersApi(
                list = reminders,
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

        var restoreError: String? = null
        vm.restore("war-1", onError = { restoreError = it })
        advanceUntilIdle()
        assertEquals("Không có kết nối mạng", restoreError)
    }
}
