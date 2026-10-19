package com.warrly.ui.screens.devices

import com.warrly.network.BrandOption
import com.warrly.network.BrandServiceInfo
import com.warrly.network.BrandServiceInfoResponse
import com.warrly.network.Catalog
import com.warrly.testing.FakeApiService
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The two-step lookup orchestration (`BrandWarrantyLookup.kt`):
 * free-text brand → catalog id → `GET /brands/{id}/service-info` → one of the
 * three [BrandLookupState] answers.
 *
 * The pure rules are covered by [BrandWarrantyRulesTest]; this file pins the
 * **wiring**, which is where a guessed URL or a swallowed envelope would hide:
 *
 *  * `{"serviceInfo": null}` (a known brand with no directory row) is `NoUrl`,
 *    not an error and not a fallback to another link;
 *  * an unknown brand never calls the endpoint with a guessed id;
 *  * a brand with no recorded name makes no network call at all.
 */
class BrandWarrantyLookupTest {

    private val catalog = Catalog(
        categories = emptyList(),
        brands = listOf(
            BrandOption(id = "apple", name = "Apple"),
            BrandOption(id = "samsung", name = "Samsung"),
        ),
        stores = emptyList(),
        warrantyProviders = emptyList(),
    )

    private class FakeLookupApi(
        private val catalog: Catalog,
        private val info: (String) -> BrandServiceInfoResponse,
    ) : FakeApiService() {
        var catalogCalls = 0
        var infoCalls = 0
        var askedBrandId: String? = null

        override suspend fun catalog(): Catalog {
            catalogCalls++
            return catalog
        }

        override suspend fun getBrandServiceInfo(brandId: String): BrandServiceInfoResponse {
            infoCalls++
            askedBrandId = brandId
            return info(brandId)
        }
    }

    @Test
    fun aKnownBrandWithAVerifiedPageOpensIt() = runTest {
        val api = FakeLookupApi(catalog) {
            BrandServiceInfoResponse(
                BrandServiceInfo(
                    brandId = "apple",
                    name = "Apple",
                    warrantyLookupUrl = "https://checkcoverage.apple.com/",
                ),
            )
        }

        val state = loadBrandLookupState(api, " apple ")

        assertEquals(
            BrandLookupState.Available("https://checkcoverage.apple.com/"),
            state,
        )
        assertEquals(1, api.infoCalls)
        assertEquals("the endpoint takes the catalog id, not the display name", "apple", api.askedBrandId)
        assertEquals(1, api.catalogCalls)
    }

    @Test
    fun aKnownBrandWithNoDirectoryRowIsNoUrl() = runTest {
        val api = FakeLookupApi(catalog) { BrandServiceInfoResponse(serviceInfo = null) }

        assertEquals(brandLookupState("Apple", null), loadBrandLookupState(api, "Apple"))
        assertEquals(1, api.infoCalls)
    }

    @Test
    fun aBrandMissingFromTheCatalogNeverAsksTheServerForAGuess() = runTest {
        val api = FakeLookupApi(catalog) {
            throw AssertionError("must not call service-info for an unmatched brand")
        }

        assertEquals(BrandLookupState.NoUrl, loadBrandLookupState(api, "Nokia"))
        assertEquals(1, api.catalogCalls)
        assertEquals(0, api.infoCalls)
    }

    @Test
    fun aDeviceWithNoBrandRecordedMakesNoRequest() = runTest {
        val api = FakeLookupApi(catalog) {
            throw AssertionError("must not call service-info without a brand")
        }

        assertEquals(BrandLookupState.NoBrand, loadBrandLookupState(api, null))
        assertEquals(0, api.catalogCalls)
        assertEquals(0, api.infoCalls)
    }

    @Test
    fun theCatalogTheFormAlreadyLoadedIsReused() = runTest {
        val api = FakeLookupApi(catalog) {
            BrandServiceInfoResponse(
                BrandServiceInfo(
                    brandId = "samsung",
                    name = "Samsung",
                    warrantyLookupUrl = "https://www.samsung.com/vn/support/warranty/",
                ),
            )
        }

        val state = loadBrandLookupState(api, "Samsung", catalog.brands)

        assertEquals(
            BrandLookupState.Available("https://www.samsung.com/vn/support/warranty/"),
            state,
        )
        assertEquals("the form's catalog is reused", 0, api.catalogCalls)
        assertEquals(1, api.infoCalls)
    }

    @Test
    fun aRowWithoutALookupUrlIsNoUrl() = runTest {
        val api = FakeLookupApi(catalog) {
            BrandServiceInfoResponse(
                BrandServiceInfo(brandId = "apple", name = "Apple", warrantyLookupUrl = null),
            )
        }

        assertEquals(BrandLookupState.NoUrl, loadBrandLookupState(api, "Apple"))
    }
}
