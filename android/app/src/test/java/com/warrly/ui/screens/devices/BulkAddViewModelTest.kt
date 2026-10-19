package com.warrly.ui.screens.devices

import com.warrly.network.BulkDeviceFailure
import com.warrly.network.BulkDeviceRequest
import com.warrly.network.BulkDeviceResponse
import com.warrly.network.DeviceListResponse
import com.warrly.network.DeviceStatus
import com.warrly.testing.FakeApiService
import com.warrly.testing.Fixtures
import com.warrly.testing.httpError
import java.io.IOException
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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * `BulkAddViewModel` — the state transitions the screen's copy depends on.
 *
 * The two behaviours that must not regress are the ones the feature exists for:
 * **a partial success leaves only the failed rows, each with its own errors, and
 * a retry sends only those**, and **a 409 leaves every row untouched, reports a
 * current remaining-slot count, and never pretends a row was created**.
 *
 * The FakeApiService records the exact request bodies, so "retry only what
 * failed" is asserted on the wire, not just in the UI state.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BulkAddViewModelTest {

    private val dispatcher = StandardTestDispatcher()
    private val fixedToday = "2026-10-19"

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class FakeBulkApi(
        private val list: suspend () -> DeviceListResponse = { DeviceListResponse(emptyList()) },
        private val bulk: suspend (BulkDeviceRequest) -> BulkDeviceResponse = {
            BulkDeviceResponse()
        },
    ) : FakeApiService() {
        val requests = mutableListOf<BulkDeviceRequest>()
        var listCalls: Int = 0
            private set

        override suspend fun listDevices(
            q: String?,
            category: String?,
            status: String?,
            sort: String?,
            dir: String?,
        ): DeviceListResponse {
            listCalls++
            return list()
        }

        override suspend fun bulkCreateDevices(body: BulkDeviceRequest): BulkDeviceResponse {
            requests += body
            return bulk(body)
        }
    }

    private fun newVm(api: FakeBulkApi): BulkAddViewModel =
        BulkAddViewModel(api, today = { fixedToday })

    private fun activeDevices(count: Int) =
        (1..count).map { Fixtures.device(id = "dev-$it", status = DeviceStatus.ACTIVE) }

    // ---- the form ----------------------------------------------------------

    @Test
    fun theFormStartsWithOneRowDatedToday() = runTest(dispatcher) {
        val state = newVm(FakeBulkApi()).state.value

        assertEquals(1, state.rows.size)
        val row = state.rows.single()
        assertEquals(1, row.key)
        assertEquals(fixedToday, row.purchaseDate)
        assertEquals(DEFAULT_BULK_CATEGORY, row.category)
        assertNull("nothing submitted yet", state.lastCreated)
        assertEquals(0, state.addedCount)
    }

    @Test
    fun rowsKeepAtLeastOneAndStopAtFiftyWithStableNumbers() = runTest(dispatcher) {
        val vm = newVm(FakeBulkApi())

        vm.addRow()
        assertEquals(listOf(1, 2), vm.state.value.rows.map { it.key })

        vm.removeRow(1)
        assertEquals(listOf(2), vm.state.value.rows.map { it.key })

        vm.removeRow(2)
        assertEquals("the last row cannot be removed", listOf(2), vm.state.value.rows.map { it.key })

        repeat(60) { vm.addRow() }
        val rows = vm.state.value.rows
        assertEquals(MAX_BULK_DEVICES, rows.size)
        assertEquals("new rows continue above every number ever used", 51, rows.last().key)
    }

    // ---- request mapping ---------------------------------------------------

    @Test
    fun submitDropsUntouchedRowsAndSendsTheMinimumDeviceFields() = runTest(dispatcher) {
        val api = FakeBulkApi(
            bulk = { BulkDeviceResponse(created = listOf(Fixtures.device(id = "d1"))) },
        )
        val vm = newVm(api)

        vm.editRow(1, BulkDeviceField.NAME, "Tủ lạnh")
        vm.editRow(1, BulkDeviceField.CATEGORY, "FRIDGE")
        vm.editRow(1, BulkDeviceField.PRICE, "12990000")
        vm.addRow() // never filled; must not be sent
        vm.submit()
        advanceUntilIdle()

        val request = api.requests.single()
        assertEquals(1, request.devices.size)
        val sent = request.devices.single()
        assertEquals("Tủ lạnh", sent.name)
        assertEquals("FRIDGE", sent.category)
        assertEquals(fixedToday, sent.purchaseDate)
        assertEquals(12_990_000, sent.purchasePrice)
        assertEquals(com.warrly.network.DEFAULT_CURRENCY, sent.currency)
        assertEquals(DeviceStatus.ACTIVE, sent.status)

        val state = vm.state.value
        assertEquals(1, state.addedCount)
        assertEquals(1, state.lastCreated)
        assertEquals(0, state.lastFailed)
        assertEquals(1, state.lastBatchSize)
        assertEquals(1, state.rows.size)
        assertNull(state.rows.single().requestIndex)
    }

    @Test
    fun anEmptyFormNeverCallsTheApi() = runTest(dispatcher) {
        val api = FakeBulkApi()
        val vm = newVm(api)

        vm.submit()
        advanceUntilIdle()

        assertTrue(api.requests.isEmpty())
        assertFalse(vm.state.value.submitting)
        assertEquals(1, vm.state.value.rows.size)
    }

    // ---- partial success ---------------------------------------------------

    /**
     * The central flow: three rows sent, the server creates #1 and #3 and refuses
     * #2. The form must keep exactly row 2 (same stable number, same values, its
     * own field errors), and a retry after fixing it must post a one-device body
     * — not all three again.
     */
    @Test
    fun aPartialSuccessKeepsOnlyTheFailedRowAndARetrySendsOnlyThatRow() = runTest(dispatcher) {
        var calls = 0
        val api = FakeBulkApi(
            bulk = {
                calls++
                if (calls == 1) {
                    BulkDeviceResponse(
                        created = listOf(
                            Fixtures.device(id = "d1", name = "Tủ lạnh"),
                            Fixtures.device(id = "d3", name = "Tivi"),
                        ),
                        failed = listOf(
                            BulkDeviceFailure(
                                index = 1,
                                code = "validation_failed",
                                message = "Sửa dòng này",
                                fieldErrors = mapOf(
                                    "name" to listOf("Tên không hợp lệ"),
                                    "purchaseDate" to listOf("Ngày mua không hợp lệ"),
                                ),
                            ),
                        ),
                    )
                } else {
                    BulkDeviceResponse(created = listOf(Fixtures.device(id = "d2", name = "Máy giặt")))
                }
            },
        )
        val vm = newVm(api)

        vm.editRow(1, BulkDeviceField.NAME, "Tủ lạnh")
        vm.addRow()
        vm.editRow(2, BulkDeviceField.NAME, "Máy giặt")
        vm.addRow()
        vm.editRow(3, BulkDeviceField.NAME, "Tivi")
        vm.submit()
        advanceUntilIdle()

        assertEquals(3, api.requests.first().devices.size)
        val partial = vm.state.value
        assertEquals(1, partial.rows.size)
        val failedRow = partial.rows.single()
        assertEquals("row 2, not the first remaining row", 2, failedRow.key)
        assertEquals(1, failedRow.requestIndex)
        assertEquals("Máy giặt", failedRow.name)
        assertEquals(listOf("Tên không hợp lệ"), failedRow.fieldErrorsFor(BulkDeviceField.NAME))
        assertEquals(
            listOf("Ngày mua không hợp lệ"),
            failedRow.fieldErrorsFor(BulkDeviceField.PURCHASE_DATE),
        )
        assertEquals("Sửa dòng này", failedRow.message)
        assertEquals(2, partial.addedCount)
        assertEquals(2, partial.lastCreated)
        assertEquals(1, partial.lastFailed)
        assertEquals(3, partial.lastBatchSize)
        assertEquals(0, partial.unaccountedCount)
        assertNull(partial.limitReached)
        assertNull(partial.error)

        // Fix the name: only that field's error and the row sentence go away;
        // the date error is still there until that input changes too.
        vm.editRow(2, BulkDeviceField.NAME, "Máy giặt cửa ngang")
        val edited = vm.state.value.rows.single()
        assertEquals(emptyList<String>(), edited.fieldErrorsFor(BulkDeviceField.NAME))
        assertEquals(
            listOf("Ngày mua không hợp lệ"),
            edited.fieldErrorsFor(BulkDeviceField.PURCHASE_DATE),
        )
        assertNull(edited.message)

        vm.submit()
        advanceUntilIdle()

        assertEquals(2, api.requests.size)
        val retry = api.requests[1]
        assertEquals(1, retry.devices.size)
        assertEquals("Máy giặt cửa ngang", retry.devices.single().name)
        assertEquals(fixedToday, retry.devices.single().purchaseDate)

        val done = vm.state.value
        assertEquals("the earlier two successes are not forgotten", 3, done.addedCount)
        assertEquals(1, done.lastCreated)
        assertEquals(0, done.lastFailed)
        assertEquals(1, done.lastBatchSize)
        assertEquals(1, done.rows.size)
        assertNull(done.rows.single().requestIndex)
        assertEquals(0, done.unaccountedCount)
    }

    // ---- the all-or-nothing 409 -------------------------------------------

    @Test
    fun aLimitReached409KeepsEveryRowSaysNothingWasCreatedAndReportsRemainingSlots() =
        runTest(dispatcher) {
            val api = FakeBulkApi(
                list = { DeviceListResponse(activeDevices(48)) },
                bulk = {
                    throw httpError(
                        409,
                        """{"error":"limit_reached","message":"Đã đạt giới hạn 50 thiết bị"}""",
                    )
                },
            )
            val vm = newVm(api)
            vm.loadQuota()
            advanceUntilIdle()
            assertEquals(2, vm.state.value.quota?.newDeviceRemaining)

            vm.editRow(1, BulkDeviceField.NAME, "Tủ lạnh")
            vm.submit()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals("the typed batch is still there", 1, state.rows.size)
            assertEquals("Tủ lạnh", state.rows.single().name)
            assertEquals("nothing was created", 0, state.addedCount)
            assertNull(state.lastCreated)
            assertNull("a 409 is not a generic batch error", state.error)
            assertEquals(
                "Đã đạt giới hạn 50 thiết bị",
                state.limitReached?.serverMessage,
            )
            assertEquals(2, state.limitReached?.slots)
            assertEquals("quota read at open + re-read after the 409", 2, api.listCalls)
        }

    /**
     * The quota read is best effort. If the account's list cannot be refreshed
     * after the 409, the previously loaded quota still answers the question;
     * with no quota at all the copy says the limit was hit instead of inventing
     * a number.
     */
    @Test
    fun aLimitReached409FallsBackToTheKnownQuotaAndThenToNoNumber() = runTest(dispatcher) {
        var listCalls = 0
        val fallbackApi = FakeBulkApi(
            list = {
                listCalls++
                if (listCalls == 1) {
                    DeviceListResponse(activeDevices(48))
                } else {
                    throw IOException("offline")
                }
            },
            bulk = {
                throw httpError(409, """{"error":"limit_reached","message":"limit"}""")
            },
        )
        val fallbackVm = newVm(fallbackApi)
        fallbackVm.loadQuota()
        advanceUntilIdle()
        fallbackVm.editRow(1, BulkDeviceField.NAME, "Loa")
        fallbackVm.submit()
        advanceUntilIdle()
        assertEquals(2, fallbackVm.state.value.limitReached?.slots)

        val offlineApi = FakeBulkApi(
            list = { throw IOException("offline") },
            bulk = {
                throw httpError(409, """{"error":"limit_reached","message":"limit"}""")
            },
        )
        val offlineVm = newVm(offlineApi)
        offlineVm.loadQuota()
        advanceUntilIdle()
        offlineVm.editRow(1, BulkDeviceField.NAME, "Loa")
        offlineVm.submit()
        advanceUntilIdle()
        assertNull(offlineVm.state.value.limitReached?.slots)
        assertEquals("limit", offlineVm.state.value.limitReached?.serverMessage)
    }

    // ---- other batch-level failures ---------------------------------------

    @Test
    fun anOverFifty400ShowsTheServersMessageAndKeepsTheRows() = runTest(dispatcher) {
        val api = FakeBulkApi(
            bulk = {
                throw httpError(
                    400,
                    """{"error":"validation_failed","message":"Quá nhiều thiết bị","fieldErrors":{"devices":["Tối đa 50 thiết bị mỗi lần"]}}""",
                )
            },
        )
        val vm = newVm(api)
        vm.editRow(1, BulkDeviceField.NAME, "Tủ lạnh")
        vm.submit()
        advanceUntilIdle()

        val state = vm.state.value
        assertEquals(BulkFailureKind.OTHER, state.error?.kind)
        assertEquals(400, state.error?.status)
        assertEquals("Quá nhiều thiết bị", state.error?.serverMessage)
        assertEquals(listOf("Tối đa 50 thiết bị mỗi lần"), state.error?.deviceFieldErrors)
        assertNull(state.limitReached)
        assertEquals(1, state.rows.size)
        assertEquals("Tủ lạnh", state.rows.single().name)
        assertEquals(0, state.addedCount)
    }

    @Test
    fun aTransportFailureIsShownAsANetworkErrorAndKeepsTheRows() = runTest(dispatcher) {
        val api = FakeBulkApi(bulk = { throw IOException("offline") })
        val vm = newVm(api)
        vm.editRow(1, BulkDeviceField.NAME, "Loa")
        vm.submit()
        advanceUntilIdle()

        val state = vm.state.value
        assertEquals(BulkFailureKind.OTHER, state.error?.kind)
        assertNull(state.error?.status)
        assertNull(state.error?.serverMessage)
        assertNull(state.limitReached)
        assertEquals("Loa", state.rows.single().name)
        assertFalse(state.submitting)
    }

    // ---- quota -------------------------------------------------------------

    @Test
    fun loadQuotaCountsTheAccountsDevicesAndIgnoresAFailedRead() = runTest(dispatcher) {
        val api = FakeBulkApi(
            list = {
                DeviceListResponse(
                    listOf(
                        Fixtures.device(id = "a", status = DeviceStatus.ACTIVE),
                        Fixtures.device(id = "b", status = DeviceStatus.SOLD),
                    ),
                )
            },
        )
        val vm = newVm(api)
        vm.loadQuota()
        advanceUntilIdle()

        assertEquals(49, vm.state.value.quota?.activeRemaining)
        assertEquals(498, vm.state.value.quota?.storageRemaining)

        val offline = newVm(FakeBulkApi(list = { throw IOException("offline") }))
        offline.loadQuota()
        advanceUntilIdle()
        assertNull(offline.state.value.quota)
    }
}
