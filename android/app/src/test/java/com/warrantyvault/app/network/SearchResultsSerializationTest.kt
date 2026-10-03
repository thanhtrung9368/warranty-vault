package com.warrantyvault.app.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Wire-contract tests for `GET /api/v1/search` (openapi `SearchResults`).
 *
 * The response is consumed unconditionally by the results screen, so what
 * matters is that every group is a list — `[]` stays `[]`, a missing group is
 * empty rather than null — and that a blank query still decodes as a normal
 * (empty) result instead of an error shape.
 */
class SearchResultsSerializationTest {

    private val json = ApiClient.json

    @Test
    fun decodesTheThreeGroupsAndTheEchoedQuery() {
        val raw = """
            {
              "query": "samsung",
              "devices": [
                {
                  "id": "dev-1",
                  "userId": "u1",
                  "name": "Galaxy S24",
                  "category": "PHONE",
                  "brand": "Samsung",
                  "model": "SM-S921",
                  "serialNumber": "IMEI-123",
                  "purchaseDate": "2024-03-01T00:00:00",
                  "purchasePrice": 22000000,
                  "status": "ACTIVE"
                }
              ],
              "subscriptions": [
                {
                  "id": "sub-1",
                  "userId": "u1",
                  "name": "Samsung Cloud",
                  "brand": "Samsung",
                  "plan": "200GB",
                  "billingCycle": "MONTHLY",
                  "price": 55000,
                  "startedAt": "2024-01-01T00:00:00",
                  "renewalDate": "2025-01-01T00:00:00",
                  "status": "ACTIVE"
                }
              ],
              "wishlist": [
                {
                  "id": "wish-1",
                  "name": "Galaxy Buds",
                  "brand": "Samsung",
                  "priority": "WANT",
                  "status": "WATCHING"
                }
              ]
            }
        """.trimIndent()

        val res = json.decodeFromString(SearchResults.serializer(), raw)

        assertEquals("samsung", res.query)
        assertEquals("Galaxy S24", res.devices.single().name)
        assertEquals(DeviceStatus.ACTIVE, res.devices.single().status)
        assertEquals("Samsung Cloud", res.subscriptions.single().name)
        assertEquals(BillingCycle.MONTHLY, res.subscriptions.single().billingCycle)
        assertEquals("Galaxy Buds", res.wishlist.single().name)
        assertEquals(WishlistPriority.WANT, res.wishlist.single().priority)
        assertEquals(3, res.total)
        assertFalse(res.isEmpty)
    }

    @Test
    fun emptyGroupsStayEmptyListsAndNeverNull() {
        val res = json.decodeFromString(
            SearchResults.serializer(),
            """{"query":"","devices":[],"subscriptions":[],"wishlist":[]}""",
        )

        assertEquals("", res.query)
        assertTrue(res.devices.isEmpty())
        assertTrue(res.subscriptions.isEmpty())
        assertTrue(res.wishlist.isEmpty())
        assertTrue(res.isEmpty)
        assertEquals(0, res.total)
    }

    @Test
    fun aBlankQueryIsAnEmptyResultNotAnErrorShape() {
        // What the server answers when the search box is cleared: 200, three
        // empty groups, `query` echoing the trimmed input.
        val res = json.decodeFromString(SearchResults.serializer(), """{"query":"","devices":[],"subscriptions":[]}""")

        assertEquals("", res.query)
        assertTrue(res.isEmpty)
    }

    @Test
    fun missingGroupsDefaultToEmptyLists() {
        val res = json.decodeFromString(SearchResults.serializer(), """{"query":"iphone"}""")

        assertEquals("iphone", res.query)
        assertEquals(emptyList<Device>(), res.devices)
        assertEquals(emptyList<Subscription>(), res.subscriptions)
        assertEquals(emptyList<WishlistItem>(), res.wishlist)
        assertTrue(res.isEmpty)
    }

    @Test
    fun totalCountsRowsAcrossEveryGroup() {
        val res = SearchResults(
            query = "a",
            devices = listOf(Device(id = "d1", name = "A", category = "PHONE", purchaseDate = "2024-01-01")),
            subscriptions = listOf(Subscription(id = "s1", name = "A", startedAt = "2024-01-01")),
            wishlist = listOf(
                WishlistItem(id = "w1", name = "A"),
                WishlistItem(id = "w2", name = "A"),
            ),
        )

        assertEquals(4, res.total)
        assertFalse(res.isEmpty)
    }

    @Test
    fun searchRowsDecodeWithoutTheListOnlyProjectionFields() {
        // SearchDevices is a plain `SELECT *` on Device: no warranties array, no
        // effectiveWarrantyEnd / attachmentCount (those belong to the list
        // projection). The DTO defaults keep that from crashing the screen.
        val raw = """
            {
              "id": "dev-1",
              "userId": "u1",
              "name": "Galaxy S24",
              "category": "PHONE",
              "purchaseDate": "2024-03-01T00:00:00",
              "purchasePrice": 0,
              "status": "ACTIVE"
            }
        """.trimIndent()

        val device = json.decodeFromString(Device.serializer(), raw)

        assertTrue("no warranties key on a search row", device.warranties.isEmpty())
        assertEquals(null, device.effectiveWarrantyEnd)
        assertEquals(0, device.attachmentCount)
    }
}
