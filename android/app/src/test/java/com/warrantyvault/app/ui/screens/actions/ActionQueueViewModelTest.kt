package com.warrantyvault.app.ui.screens.actions

import com.warrantyvault.app.network.ActionQueue
import com.warrantyvault.app.network.OkResponse
import com.warrantyvault.app.network.SnoozeInput
import com.warrantyvault.app.network.SnoozeResult
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

/**
 * `ActionQueueViewModel` — loading the queue, the `snoozed` flag, and the
 * snooze/un-snooze round trip.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ActionQueueViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class FakeActionsApi(
        private val queue: suspend (Boolean?) -> ActionQueue = { Fixtures.actionQueue() },
        private val snooze: suspend (String, SnoozeInput) -> SnoozeResult = { key, body ->
            SnoozeResult(itemKey = key, snoozedUntil = "2026-06-02T00:00:00Z", days = body.days)
        },
        private val unsnooze: suspend (String) -> Unit = {},
    ) : FakeApiService() {
        override suspend fun listActionItems(snoozed: Boolean?): ActionQueue = queue(snoozed)

        override suspend fun snoozeActionItem(itemKey: String, body: SnoozeInput): SnoozeResult =
            snooze(itemKey, body)

        override suspend fun unsnoozeActionItem(itemKey: String): OkResponse {
            unsnooze(itemKey)
            return OkResponse()
        }
    }

    /**
     * The default read must be the bare call: `snoozed` is null (the parameter is
     * not sent at all), never `false`. Only the "Đang hoãn" chip turns it on, and
     * then the flag is remembered for the reloads that follow.
     */
    @Test
    fun load_sendsNoSnoozedParameterByDefaultAndTrueWhenAsked() = runTest(dispatcher) {
        val seen = mutableListOf<Boolean?>()
        val vm = ActionQueueViewModel(
            FakeActionsApi(queue = { snoozed ->
                seen += snoozed
                Fixtures.actionQueue()
            }),
        )

        vm.load()
        advanceUntilIdle()
        assertEquals(listOf<Boolean?>(null), seen)
        assertEquals(
            ActionQueueViewModel.State.Loaded(Fixtures.actionQueue(), includeSnoozed = false),
            vm.state.value,
        )

        vm.toggleSnoozed()
        advanceUntilIdle()
        assertEquals(listOf(null, true), seen)
        assertTrue((vm.state.value as ActionQueueViewModel.State.Loaded).includeSnoozed)

        // …and toggling back off asks for the default read again.
        vm.toggleSnoozed()
        advanceUntilIdle()
        assertEquals(listOf(null, true, null), seen)
    }

    @Test
    fun load_reportsFailuresWithTheServersVietnameseMessage() = runTest(dispatcher) {
        val vm = ActionQueueViewModel(
            FakeActionsApi(queue = { throw httpError(500, """{"error":"internal","message":"Máy chủ đang bận"}""") }),
        )

        vm.load()
        advanceUntilIdle()

        assertEquals(ActionQueueViewModel.State.Error("Máy chủ đang bận"), vm.state.value)
    }

    @Test
    fun snooze_sendsTheChosenDurationReloadsAndReportsWhatTheServerApplied() = runTest(dispatcher) {
        var seenKey: String? = null
        var seenDays: Int? = null
        var loads = 0
        val vm = ActionQueueViewModel(
            FakeActionsApi(
                queue = {
                    loads++
                    Fixtures.actionQueue()
                },
                snooze = { key, body ->
                    seenKey = key
                    seenDays = body.days
                    SnoozeResult(itemKey = key, snoozedUntil = "2026-06-02T00:00:00Z", days = body.days)
                },
            ),
        )
        vm.load()
        advanceUntilIdle()

        var applied: SnoozeResult? = null
        var error: String? = null
        vm.snooze("WARRANTY_EXPIRED:war-1", days = 30, onSnoozed = { applied = it }, onError = { error = it })
        advanceUntilIdle()

        assertEquals("WARRANTY_EXPIRED:war-1", seenKey)
        assertEquals(30, seenDays)
        assertEquals(30, applied?.days)
        assertNull(error)
        // The queue is re-read after the write, so the row really is gone.
        assertEquals(2, loads)
    }

    @Test
    fun snooze_reportsFieldErrorsInsteadOfPretendingItWorked() = runTest(dispatcher) {
        val vm = ActionQueueViewModel(
            FakeActionsApi(
                snooze = { _, _ ->
                    throw httpError(
                        400,
                        """{"error":"bad_input","message":"Dữ liệu không hợp lệ","fieldErrors":{"days":["Số ngày hoãn phải từ 1 tới 365"]}}""",
                    )
                },
            ),
        )
        vm.load()
        advanceUntilIdle()

        var applied: SnoozeResult? = null
        var error: String? = null
        vm.snooze("A:1", days = 999, onSnoozed = { applied = it }, onError = { error = it })
        advanceUntilIdle()

        assertNull("a rejected snooze must not report success", applied)
        assertEquals("Dữ liệu không hợp lệ", error)
    }

    @Test
    fun unsnooze_callsTheDeleteAndReloads() = runTest(dispatcher) {
        var seenKey: String? = null
        var loads = 0
        val vm = ActionQueueViewModel(
            FakeActionsApi(
                queue = {
                    loads++
                    Fixtures.actionQueue()
                },
                unsnooze = { seenKey = it },
            ),
        )
        vm.load()
        advanceUntilIdle()

        var done = false
        var error: String? = null
        vm.unsnooze("A:1", onDone = { done = true }, onError = { error = it })
        advanceUntilIdle()

        assertEquals("A:1", seenKey)
        assertTrue(done)
        assertNull(error)
        assertEquals(2, loads)
    }

    /**
     * A 404 here is meaningful, not noise: the server refuses to answer 200 when
     * the item was not actually snoozed, so the state had drifted and the user is
     * told so.
     */
    @Test
    fun unsnooze_surfacesTheNotFoundInsteadOfSwallowingIt() = runTest(dispatcher) {
        val vm = ActionQueueViewModel(
            FakeActionsApi(
                unsnooze = {
                    throw httpError(404, """{"error":"not_found","message":"Việc này không đang được hoãn"}""")
                },
            ),
        )
        vm.load()
        advanceUntilIdle()

        var done = false
        var error: String? = null
        vm.unsnooze("A:1", onDone = { done = true }, onError = { error = it })
        advanceUntilIdle()

        assertTrue(!done)
        assertEquals("Việc này không đang được hoãn", error)
    }

    @Test
    fun offlineFailuresUseTheTransportMessage() = runTest(dispatcher) {
        val vm = ActionQueueViewModel(
            FakeActionsApi(queue = { throw IOException("Không có kết nối mạng") }),
        )

        vm.load()
        advanceUntilIdle()

        assertEquals(ActionQueueViewModel.State.Error("Không có kết nối mạng"), vm.state.value)
    }
}
