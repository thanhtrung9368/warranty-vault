package com.warrly.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Wire-contract tests for the brand warranty lookup.
 *
 * The frozen contract adds five nullable fields to `Device`, one computed
 * `warrantyMismatch`, and `warrantyLookupUrl` to `brands/{brandId}/service-info`.
 * These tests decode the literal openapi shapes through the **production**
 * [ApiClient.json], because a field that silently defaulted would turn the
 * whole feature into "the app is not sure" — and a `brandLookupUrl` that decoded
 * from the wrong key would be a guessed URL, the one thing it must never be.
 */
class BrandWarrantySerializationTest {

    private val json = ApiClient.json

    private val deviceWithBrandWarranty = """
        {
          "id": "dev_1",
          "userId": "user_1",
          "name": "iPhone 15 Pro",
          "category": "PHONE",
          "brand": "Apple",
          "model": "A3102",
          "serialNumber": "SN-123",
          "purchaseDate": "2024-03-01",
          "purchasePrice": 30000000,
          "brandWarrantyStatus": "PRE_ACTIVATED",
          "brandWarrantyStart": "2024-01-14T00:00:00",
          "brandWarrantyEnd": "2026-01-14T00:00:00",
          "brandCheckedAt": "2026-10-19T02:24:20Z",
          "brandLookupUrl": "https://checkcoverage.apple.com/",
          "warrantyMismatch": {
            "kind": "STARTS_BEFORE",
            "days": 47,
            "brandDate": "2024-01-14",
            "purchaseDate": "2024-03-01"
          }
        }
    """.trimIndent()

    @Test
    fun aCheckedDeviceDecodesAllFiveFieldsAndTheComputedMismatch() {
        val device = json.decodeFromString(Device.serializer(), deviceWithBrandWarranty)

        assertEquals(BrandWarrantyStatus.PRE_ACTIVATED, device.brandWarrantyStatus)
        assertEquals("2024-01-14T00:00:00", device.brandWarrantyStart)
        assertEquals("2026-01-14T00:00:00", device.brandWarrantyEnd)
        assertEquals("2026-10-19T02:24:20Z", device.brandCheckedAt)
        assertEquals("https://checkcoverage.apple.com/", device.brandLookupUrl)

        val mismatch = device.warrantyMismatch
        requireNotNull(mismatch)
        assertEquals("STARTS_BEFORE", mismatch.kind)
        assertEquals(47, mismatch.days)
        assertEquals("2024-01-14", mismatch.brandDate)
        assertEquals("2024-03-01", mismatch.purchaseDate)
    }

    @Test
    fun aServerThatPredatesTheFeatureStillDecodesTheDevice() {
        val device = json.decodeFromString(
            Device.serializer(),
            """{"id":"dev_1","name":"iPhone","category":"PHONE","purchaseDate":"2024-03-01"}""",
        )

        assertNull(device.brandWarrantyStatus)
        assertNull(device.brandWarrantyStart)
        assertNull(device.brandWarrantyEnd)
        assertNull(device.brandCheckedAt)
        assertNull(device.brandLookupUrl)
        assertNull("no mismatch and never checked must both read as null", device.warrantyMismatch)
    }

    /**
     * The kind is a raw string on purpose: a future server kind must degrade to
     * "the dates differ, show both" instead of failing the whole device decode.
     */
    @Test
    fun anUnknownMismatchKindDoesNotFailTheDevice() {
        val raw = """
            {"id":"dev_1","name":"iPhone","category":"PHONE","purchaseDate":"2024-03-01",
             "warrantyMismatch":{"kind":"REPAIRED_AND_REREGISTERED","days":12,
             "brandDate":"2024-02-01","purchaseDate":"2024-03-01"}}
        """.trimIndent()

        val device = json.decodeFromString(Device.serializer(), raw)
        assertEquals("REPAIRED_AND_REREGISTERED", device.warrantyMismatch?.kind)
        assertEquals(12, device.warrantyMismatch?.days)
    }

    @Test
    fun theWriteBodyCarriesTheFiveFieldsWithTheEnumSpelledAsTheApiExpects() {
        val input = DeviceInput(
            name = "iPhone 15 Pro",
            category = "PHONE",
            purchaseDate = "2024-03-01",
            brandWarrantyStatus = BrandWarrantyStatus.PRE_ACTIVATED,
            brandWarrantyStart = "2024-01-14",
            brandWarrantyEnd = "2026-01-14",
            brandCheckedAt = "2026-10-19T02:24:20Z",
            brandLookupUrl = "https://checkcoverage.apple.com/",
        )
        val encoded = json.encodeToString(DeviceInput.serializer(), input)

        assertTrue(encoded.contains("\"brandWarrantyStatus\":\"PRE_ACTIVATED\""))
        assertTrue(encoded.contains("\"brandWarrantyStart\":\"2024-01-14\""))
        assertTrue(encoded.contains("\"brandWarrantyEnd\":\"2026-01-14\""))
        assertTrue(encoded.contains("\"brandCheckedAt\":\"2026-10-19T02:24:20Z\""))
        assertTrue(encoded.contains("\"brandLookupUrl\":\"https://checkcoverage.apple.com/\""))
    }

    /**
     * `explicitNulls = false` drops a null field entirely. For a device that was
     * never checked that is the correct "not recorded" body; the client must not
     * send `"brandWarrantyStatus":null`, which the API's required-when-set rule
     * would read differently.
     */
    @Test
    fun anUncheckedWriteOmitsAllFiveKeys() {
        val encoded = json.encodeToString(
            DeviceInput.serializer(),
            DeviceInput(name = "iPhone", category = "PHONE", purchaseDate = "2024-03-01"),
        )

        assertFalse(encoded.contains("brandWarrantyStatus"))
        assertFalse(encoded.contains("brandWarrantyStart"))
        assertFalse(encoded.contains("brandWarrantyEnd"))
        assertFalse(encoded.contains("brandCheckedAt"))
        assertFalse(encoded.contains("brandLookupUrl"))
    }

    @Test
    fun serviceInfoCarriesTheLookupUrlAndAnOlderPayloadLeavesItNull() {
        val current = json.decodeFromString(
            BrandServiceInfo.serializer(),
            """
                {"brandId":"apple","name":"Apple","serviceLocatorUrl":null,
                 "supportUrl":"https://support.apple.com/vi-vn",
                 "warrantyLookupUrl":"https://checkcoverage.apple.com/","notes":null}
            """.trimIndent(),
        )
        assertEquals("https://checkcoverage.apple.com/", current.warrantyLookupUrl)
        assertEquals("Apple", current.name)

        val older = json.decodeFromString(
            BrandServiceInfo.serializer(),
            """{"brandId":"acme","name":"Acme","serviceLocatorUrl":null,"supportUrl":null,"notes":null}""",
        )
        assertNull("a missing URL is null, never a constructed one", older.warrantyLookupUrl)
    }

    /**
     * The endpoint's 200 envelope. `serviceInfo: null` is a **known brand with
     * no directory row**, which the contract documents as a normal answer — the
     * client must read it as "no sourced page", not as a failed request.
     */
    @Test
    fun serviceInfoIsAnEnvelopeWhoseNullIsANormalAnswer() {
        val present = json.decodeFromString(
            BrandServiceInfoResponse.serializer(),
            """
                {"serviceInfo":{"brandId":"apple","name":"Apple",
                 "serviceLocatorUrl":"https://support.apple.com/vi-vn",
                 "supportUrl":null,
                 "warrantyLookupUrl":"https://checkcoverage.apple.com/","notes":null}}
            """.trimIndent(),
        )
        assertEquals("apple", present.serviceInfo?.brandId)
        assertEquals(
            "https://checkcoverage.apple.com/",
            present.serviceInfo?.warrantyLookupUrl,
        )

        val none = json.decodeFromString(
            BrandServiceInfoResponse.serializer(),
            """{"serviceInfo":null}""",
        )
        assertNull("a known brand without a directory row is not an error", none.serviceInfo)
    }

    /**
     * Some brands genuinely have no page. The model has to preserve that null
     * rather than falling back to the support URL or the locator — the UI decides
     * "we do not have this brand's page" from exactly this field.
     */
    @Test
    fun aBrandWithoutALookupPageKeepsItsOtherLinksSeparate() {
        val info = json.decodeFromString(
            BrandServiceInfo.serializer(),
            """
                {"brandId":"acme","name":"Acme",
                 "serviceLocatorUrl":"https://acme.example/service",
                 "supportUrl":"https://acme.example/support","warrantyLookupUrl":null}
            """.trimIndent(),
        )

        assertNull(info.warrantyLookupUrl)
        assertEquals("https://acme.example/service", info.serviceLocatorUrl)
        assertEquals("https://acme.example/support", info.supportUrl)
    }
}
