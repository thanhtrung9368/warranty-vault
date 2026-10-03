package com.warrantyvault.app.ui.screens.search

import com.warrantyvault.app.network.SearchResults
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

/**
 * `SearchViewModel` — the grouped endpoint's client-side contract.
 *
 * The three states that must not be confused: Blank (nothing typed / cleared),
 * Empty (a real query that matched nothing), Error (the request failed). The
 * server returns 200 for a blank `q`, and the ViewModel doesn't even ask.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SearchViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    /** Captures the query parameters the ViewModel forwards. */
    private data class SearchCall(val q: String?, val limit: Int?)

    private class FakeSearchApi(
        private val results: suspend (String?) -> SearchResults = { SearchResults() },
        private val onCall: (SearchCall) -> Unit = {},
    ) : FakeApiService() {
        override suspend fun search(q: String?, limit: Int?): SearchResults {
            onCall(SearchCall(q, limit))
            return results(q)
        }
    }

    @Test
    fun blankQueryNeverReachesTheNetworkAndStaysBlank() = runTest(dispatcher) {
        var calls = 0
        val vm = SearchViewModel(FakeSearchApi(onCall = { calls++ }))

        vm.search("")
        advanceUntilIdle()

        assertEquals(SearchViewModel.State.Blank, vm.state.value)
        assertEquals("an empty box is not a request (and not an error)", 0, calls)
    }

    @Test
    fun whitespaceOnlyQueryIsBlankToo() = runTest(dispatcher) {
        var calls = 0
        val vm = SearchViewModel(FakeSearchApi(onCall = { calls++ }))

        vm.search("    ")
        advanceUntilIdle()

        assertEquals(SearchViewModel.State.Blank, vm.state.value)
        assertEquals(0, calls)
    }

    @Test
    fun clearingTheBoxGoesBackToBlankAfterResults() = runTest(dispatcher) {
        val vm = SearchViewModel(
            FakeSearchApi(results = { SearchResults(query = "samsung", devices = listOf(Fixtures.device())) }),
        )

        vm.search("samsung")
        advanceUntilIdle()
        assertTrue(vm.state.value is SearchViewModel.State.Loaded)

        // Deleting the last character must not surface a red banner.
        vm.search("")
        advanceUntilIdle()
        assertEquals(SearchViewModel.State.Blank, vm.state.value)
    }

    @Test
    fun searchTrimsTheQueryAndAsksForThePerGroupLimit() = runTest(dispatcher) {
        var call: SearchCall? = null
        val vm = SearchViewModel(FakeSearchApi(onCall = { call = it }))

        vm.search("  samsung  ")
        advanceUntilIdle()

        assertEquals(SearchCall(q = "samsung", limit = SearchViewModel.SEARCH_LIMIT_PER_GROUP), call)
        assertEquals(20, SearchViewModel.SEARCH_LIMIT_PER_GROUP)
    }

    @Test
    fun searchPublishesAllThreeGroups() = runTest(dispatcher) {
        val results = SearchResults(
            query = "samsung",
            devices = listOf(Fixtures.device(name = "Galaxy S24")),
            subscriptions = listOf(Fixtures.subscription(name = "Samsung Cloud")),
            wishlist = listOf(Fixtures.wishlistItem(name = "Galaxy Buds")),
        )
        val vm = SearchViewModel(FakeSearchApi(results = { results }))

        vm.search("samsung")
        advanceUntilIdle()

        assertEquals(SearchViewModel.State.Loaded(results), vm.state.value)
    }

    @Test
    fun threeEmptyGroupsAreAnEmptyStateNotAnError() = runTest(dispatcher) {
        // Exactly what GET /api/v1/search answers for a keyword that matches
        // nothing: 200 with `[]` in every group.
        val vm = SearchViewModel(
            FakeSearchApi(results = { SearchResults(query = "khong-co-gi") }),
        )

        vm.search("khong-co-gi")
        advanceUntilIdle()

        assertEquals(SearchViewModel.State.Empty("khong-co-gi"), vm.state.value)
    }

    @Test
    fun aGroupWithOnlyWishlistRowsIsNotAnEmptyState() = runTest(dispatcher) {
        val vm = SearchViewModel(
            FakeSearchApi(results = { SearchResults(query = "buds", wishlist = listOf(Fixtures.wishlistItem())) }),
        )

        vm.search("buds")
        advanceUntilIdle()

        assertTrue(vm.state.value is SearchViewModel.State.Loaded)
    }

    @Test
    fun overlongQueryIsRefusedLocallyWithoutACall() = runTest(dispatcher) {
        var calls = 0
        val vm = SearchViewModel(FakeSearchApi(onCall = { calls++ }))
        val tooLong = "a".repeat(SearchQuery.MAX_RUNES + 1)

        vm.search(tooLong)
        advanceUntilIdle()

        assertEquals(0, calls)
        assertEquals(
            SearchViewModel.State.Error(SearchQuery.TOO_LONG_MESSAGE, tooLong),
            vm.state.value,
        )
    }

    @Test
    fun exactlyTwoHundredRunesIsSent() = runTest(dispatcher) {
        var call: SearchCall? = null
        val vm = SearchViewModel(FakeSearchApi(onCall = { call = it }))
        val atLimit = "a".repeat(SearchQuery.MAX_RUNES)

        vm.search(atLimit)
        advanceUntilIdle()

        assertEquals(atLimit, call?.q)
    }

    @Test
    fun serverMessageIsShownAndTheQueryKeptForRetry() = runTest(dispatcher) {
        val serverDown = SearchViewModel(
            FakeSearchApi(results = { throw httpError(500, """{"error":"internal","message":"Máy chủ đang bận"}""") }),
        )
        serverDown.search("samsung")
        advanceUntilIdle()
        assertEquals(
            SearchViewModel.State.Error("Máy chủ đang bận", "samsung"),
            serverDown.state.value,
        )

        val offline = SearchViewModel(FakeSearchApi(results = { throw IOException("Không có kết nối mạng") }))
        offline.search("samsung")
        advanceUntilIdle()
        assertEquals(
            SearchViewModel.State.Error("Không có kết nối mạng", "samsung"),
            offline.state.value,
        )
    }

    @Test
    fun aFailedSearchDoesNotLookLikeAnEmptyResult() = runTest(dispatcher) {
        val vm = SearchViewModel(FakeSearchApi(results = { throw IOException("Không có kết nối mạng") }))

        vm.search("samsung")
        advanceUntilIdle()

        assertFalse("a failure must never render as \"không tìm thấy\"", vm.state.value is SearchViewModel.State.Empty)
    }

    @Test
    fun retryingAServerRejectionCanSucceed() = runTest(dispatcher) {
        var attempts = 0
        val recovered = SearchResults(query = "samsung", devices = listOf(Fixtures.device()))
        val vm = SearchViewModel(
            FakeSearchApi(
                results = {
                    attempts++
                    if (attempts == 1) throw httpError(503, """{"error":"unavailable","message":"Thử lại sau"}""")
                    recovered
                },
            ),
        )

        vm.search("samsung")
        advanceUntilIdle()
        val failed = vm.state.value as SearchViewModel.State.Error

        vm.search(failed.query)
        advanceUntilIdle()

        assertEquals(SearchViewModel.State.Loaded(recovered), vm.state.value)
    }
}
