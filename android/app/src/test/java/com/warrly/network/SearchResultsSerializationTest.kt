package com.warrly.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Wire-contract tests for `GET /api/v1/search` (openapi `SearchResults`).
 *
 * The response is consumed unconditionally by the results screen, so what
 * matters is that every group is a list — `[]` stays `[]`, a missing group is
 * empty rather than null — and that the fourth group, OCR `attachments`, keeps
 * its two load-bearing fields: the transcript and the nullable `deviceId` that
 * says whether the file is filed or still in the inbox.
 */
class SearchResultsSerializationTest {

    private val json = ApiClient.json

    @Test
    fun decodesTheFourGroupsAndTheEchoedQuery() {
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
              ],
              "attachments": [
                {
                  "id": "att-1",
                  "deviceId": null,
                  "fileName": "hoa-don.pdf",
                  "fileType": "application/pdf",
                  "fileSize": 2048,
                  "uploadedAt": "2025-01-02T03:04:05",
                  "extractedText": "SAMSUNG Galaxy S24 22.000.000"
                },
                {
                  "id": "att-2",
                  "deviceId": "dev-1",
                  "fileName": "phieu-bao-hanh.jpg",
                  "fileType": "image/jpeg",
                  "fileSize": 4096,
                  "uploadedAt": "2025-01-03T03:04:05",
                  "extractedText": "IMEI 123456789012345"
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
        assertEquals(2, res.attachments.size)
        assertEquals("SAMSUNG Galaxy S24 22.000.000", res.attachments[0].extractedText)
        assertEquals("an inbox hit has no device", null, res.attachments[0].deviceId)
        assertEquals("a filed hit names its device", "dev-1", res.attachments[1].deviceId)
        assertEquals(5, res.total)
        assertFalse(res.isEmpty)
    }

    @Test
    fun anAttachmentHitWithoutOcrTextDecodesAsNull() {
        // `extractedText` is omitempty on the server: a file that was never
        // scanned has no key at all. It must never fail the whole search decode
        // (that would hide every other group on the screen).
        val hit = json.decodeFromString(
            Attachment.serializer(),
            """{"id":"att-1","deviceId":null,"fileName":"a.pdf","fileType":"application/pdf"}""",
        )

        assertEquals("att-1", hit.id)
        assertNull(hit.deviceId)
        assertNull(hit.extractedText)
    }

    @Test
    fun emptyGroupsStayEmptyListsAndNeverNull() {
        val res = json.decodeFromString(
            SearchResults.serializer(),
            """{"query":"","devices":[],"subscriptions":[],"wishlist":[],"attachments":[]}""",
        )

        assertEquals("", res.query)
        assertTrue(res.devices.isEmpty())
        assertTrue(res.subscriptions.isEmpty())
        assertTrue(res.wishlist.isEmpty())
        assertTrue("an account that never scanned OCR still gets []", res.attachments.isEmpty())
        assertTrue(res.isEmpty)
        assertEquals(0, res.total)
    }

    @Test
    fun aBlankQueryIsAnEmptyResultNotAnErrorShape() {
        // What the server answers when the search box is cleared: 200, four
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
        assertEquals(emptyList<Attachment>(), res.attachments)
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
            attachments = listOf(
                Attachment(id = "a1", fileName = "a.pdf", fileType = "application/pdf"),
            ),
        )

        assertEquals(5, res.total)
        assertFalse(res.isEmpty)
    }

    @Test
    fun anAttachmentsOnlyResultIsNotAnEmptySearch() {
        // The screen must show a result group even when the keyword matched
        // nothing the user typed into a device/plan/wishlist field — that is the
        // whole promise of indexing the OCR transcript.
        val res = SearchResults(
            query = "củ sạc 65W",
            attachments = listOf(
                Attachment(id = "a1", fileName = "a.pdf", fileType = "application/pdf"),
            ),
        )

        assertEquals(1, res.total)
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
