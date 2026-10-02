package com.warrantyvault.app.ui.screens.wishlist

import com.warrantyvault.app.network.WishlistDetailResponse
import com.warrantyvault.app.network.WishlistListResponse
import com.warrantyvault.app.network.WishlistPrice
import com.warrantyvault.app.network.WishlistStatus
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
import org.junit.Before
import org.junit.Test

/** `WishlistViewModel` + `WishlistDetailViewModel` (list state and price history). */
@OptIn(ExperimentalCoroutinesApi::class)
class WishlistViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private class FakeWishlistApi(
        private val list: suspend () -> WishlistListResponse = { WishlistListResponse(emptyList()) },
        private val one: suspend (String) -> WishlistDetailResponse = {
            WishlistDetailResponse(Fixtures.wishlistItem())
        },
    ) : FakeApiService() {
        override suspend fun listWishlist(): WishlistListResponse = list()
        override suspend fun getWishlistItem(id: String): WishlistDetailResponse = one(id)
    }

    @Test
    fun loadAndRemove_keepTheListInSync() = runTest(dispatcher) {
        val first = Fixtures.wishlistItem(id = "w-1")
        val second = Fixtures.wishlistItem(id = "w-2", name = "PlayStation 5")
        val vm = WishlistViewModel(FakeWishlistApi(list = { WishlistListResponse(listOf(first, second)) }))

        vm.load()
        advanceUntilIdle()
        assertEquals(WishlistViewModel.State.Loaded(listOf(first, second)), vm.state.value)

        vm.remove("w-2")
        assertEquals(WishlistViewModel.State.Loaded(listOf(first)), vm.state.value)
    }

    @Test
    fun upsert_prependsAnItemThatWasNotInTheListYet() = runTest(dispatcher) {
        val existing = Fixtures.wishlistItem(id = "w-1")
        val vm = WishlistViewModel(FakeWishlistApi(list = { WishlistListResponse(listOf(existing)) }))
        vm.load()
        advanceUntilIdle()

        val added = Fixtures.wishlistItem(id = "w-9", name = "Máy hút bụi")
        vm.upsert(added)

        assertEquals(WishlistViewModel.State.Loaded(listOf(added, existing)), vm.state.value)
    }

    @Test
    fun detail_loadsItemWithItsPriceHistoryAndKeepsPricesWhenOnlyTheItemIsReplaced() = runTest(dispatcher) {
        val item = Fixtures.wishlistItem(id = "w-1")
        val prices = listOf(
            WishlistPrice(id = "p-1", itemId = "w-1", price = 12_000_000, recordedAt = "2024-06-01"),
        )
        val vm = WishlistDetailViewModel(
            FakeWishlistApi(one = { WishlistDetailResponse(item = item, prices = prices) }),
            itemId = "w-1",
        )

        vm.load()
        advanceUntilIdle()
        assertEquals(WishlistDetailViewModel.State.Loaded(item, prices), vm.state.value)

        // A status flip from the list screen must not wipe the loaded price log.
        val purchased = item.copy(status = WishlistStatus.PURCHASED)
        vm.replace(purchased)
        assertEquals(WishlistDetailViewModel.State.Loaded(purchased, prices), vm.state.value)

        // An explicit price list (after logging a price) wins.
        val more = prices + WishlistPrice(id = "p-2", itemId = "w-1", price = 11_500_000)
        vm.replace(purchased, more)
        assertEquals(WishlistDetailViewModel.State.Loaded(purchased, more), vm.state.value)
    }
}
