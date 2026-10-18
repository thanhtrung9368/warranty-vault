package com.warrly.ui.screens.inbox

import com.warrly.network.Attachment
import com.warrly.network.AttachmentListResponse
import com.warrly.network.Device
import com.warrly.network.FileAttachmentInput
import com.warrly.network.OkResponse
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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException

/**
 * `InboxViewModel` — loading the inbox, filing an item on a device, and the one
 * 409 the contract defines.
 *
 * These are the paths that must not be wrong: a successful file must remove the
 * row **and** send the chosen device id; a `LIMIT_REACHED` 409 must keep the row
 * (nothing was assigned) and expose the target so the dialog can name it; every
 * other failure must surface the server's message instead.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class InboxViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class FakeInboxApi(
        private val inbox: suspend () -> AttachmentListResponse = {
            AttachmentListResponse(
                listOf(
                    Fixtures.attachment(id = "att-1"),
                    Fixtures.attachment(id = "att-2", fileName = "bao-hanh.pdf"),
                ),
            )
        },
        private val file: suspend (String, FileAttachmentInput) -> Unit = { _, _ -> },
        private val delete: suspend (String) -> OkResponse = { OkResponse() },
    ) : FakeApiService() {
        override suspend fun getInbox(): AttachmentListResponse = inbox()

        override suspend fun fileAttachment(id: String, body: FileAttachmentInput) =
            file(id, body)

        override suspend fun deleteAttachment(id: String): OkResponse = delete(id)
    }

    private val device: Device = Fixtures.device(id = "dev-1", name = "iPhone 15 Pro")

    @Test
    fun loadShowsTheUnfiledAttachments() = runTest(dispatcher) {
        val vm = InboxViewModel(FakeInboxApi())

        vm.load()
        advanceUntilIdle()

        val loaded = vm.state.value as InboxViewModel.State.Loaded
        assertEquals(listOf("att-1", "att-2"), loaded.attachments.map(Attachment::id))
    }

    @Test
    fun loadFailureBecomesTheErrorState() = runTest(dispatcher) {
        val vm = InboxViewModel(
            FakeInboxApi(inbox = { throw httpError(500, """{"error":"server","message":"Máy chủ lỗi"}""") }),
        )

        vm.load()
        advanceUntilIdle()

        assertEquals(InboxViewModel.State.Error("Máy chủ lỗi"), vm.state.value)
    }

    /**
     * The whole point of "Gán vào thiết bị": the id goes to the file endpoint
     * and the row leaves the inbox, with no second read.
     */
    @Test
    fun filingSendsTheDeviceIdAndRemovesTheRowLocally() = runTest(dispatcher) {
        val sent = mutableListOf<Pair<String, String?>>()
        val vm = InboxViewModel(
            FakeInboxApi(file = { id, body -> sent += id to body.deviceId }),
        )
        vm.load()
        advanceUntilIdle()

        vm.file(Fixtures.attachment(id = "att-1"), device)
        advanceUntilIdle()

        assertEquals(listOf("att-1" to "dev-1"), sent)
        val loaded = vm.state.value as InboxViewModel.State.Loaded
        assertEquals(listOf("att-2"), loaded.attachments.map(Attachment::id))
        assertNull(vm.deviceFull.value)
    }

    /**
     * `409 LIMIT_REACHED`: the receipt was **not** assigned, so it must stay in
     * the list, and the target has to be kept for the dialog ("that device is
     * full — pick another, or delete").
     */
    @Test
    fun aLimitReachedConflictKeepsTheRowAndExposesTheFullDevice() = runTest(dispatcher) {
        val attachment = Fixtures.attachment(id = "att-1")
        val vm = InboxViewModel(
            FakeInboxApi(
                file = { _, _ ->
                    // The server's real envelope lowercases the service code.
                    throw httpError(409, """{"error":"limit_reached","message":"Tối đa 5 file/thiết bị"}""")
                },
            ),
        )
        vm.load()
        advanceUntilIdle()

        vm.file(attachment, device)
        advanceUntilIdle()

        assertEquals(InboxViewModel.DeviceFull(attachment, "iPhone 15 Pro"), vm.deviceFull.value)
        assertNull("a full device is not a generic error", vm.actionMessage.value)
        val loaded = vm.state.value as InboxViewModel.State.Loaded
        assertTrue("the row must stay: nothing was assigned", loaded.attachments.any { it.id == "att-1" })
    }

    /**
     * Any other failure is the server's to explain: it is translated by the Go
     * catalog and shown as-is, and the row stays where it is.
     */
    @Test
    fun anotherConflictShowsTheServerMessageInsteadOfTheFullDeviceDialog() = runTest(dispatcher) {
        val vm = InboxViewModel(
            FakeInboxApi(
                file = { _, _ ->
                    throw httpError(409, """{"error":"conflict","message":"Không gán được tệp"}""")
                },
            ),
        )
        vm.load()
        advanceUntilIdle()

        vm.file(Fixtures.attachment(id = "att-1"), device)
        advanceUntilIdle()

        assertNull(vm.deviceFull.value)
        assertEquals("Không gán được tệp", vm.actionMessage.value)
        val loaded = vm.state.value as InboxViewModel.State.Loaded
        assertTrue(loaded.attachments.any { it.id == "att-1" })
    }

    @Test
    fun deleteRemovesTheRow() = runTest(dispatcher) {
        val deleted = mutableListOf<String>()
        val vm = InboxViewModel(FakeInboxApi(delete = { id -> deleted += id; OkResponse() }))
        vm.load()
        advanceUntilIdle()

        vm.delete(Fixtures.attachment(id = "att-2"))
        advanceUntilIdle()

        assertEquals(listOf("att-2"), deleted)
        val loaded = vm.state.value as InboxViewModel.State.Loaded
        assertEquals(listOf("att-1"), loaded.attachments.map(Attachment::id))
    }

    @Test
    fun aFailedDeleteSurfacesTheMessageAndKeepsTheRow() = runTest(dispatcher) {
        val vm = InboxViewModel(
            FakeInboxApi(delete = { throw IOException("offline") }),
        )
        vm.load()
        advanceUntilIdle()

        vm.delete(Fixtures.attachment(id = "att-1"))
        advanceUntilIdle()

        assertEquals("offline", vm.actionMessage.value)
        val loaded = vm.state.value as InboxViewModel.State.Loaded
        assertTrue(loaded.attachments.any { it.id == "att-1" })
    }
}
