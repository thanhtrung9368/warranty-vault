package com.warrly.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The multi-currency wire shape.
 *
 * `ApiClient.json` is the production configuration: `explicitNulls = false` and
 * `encodeDefaults = true`. Both matter here:
 *
 *  * `currency` must always reach the server (its default `VND` is the update
 *    contract's "unchanged / still dong" signal), and
 *  * a `null` `fxRate` is DROPPED — which is exactly right for VND and exactly
 *    why the form refuses to submit a non-VND device without a positive rate
 *    (see `DeviceCurrencyTest.fxRateIsRequiredOnlyForANonVndCurrency`).
 */
class DeviceCurrencySerializationTest {

    private val json = ApiClient.json

    @Test
    fun deviceDecodesTheCurrencyTheLockedRateAndBothVndValues() {
        val raw = """
            {
              "id": "dev-1", "name": "iPhone 15 Pro", "category": "PHONE",
              "purchaseDate": "2026-01-10T00:00:00",
              "purchasePrice": 999, "currency": "USD", "fxRate": 25000,
              "purchasePriceVnd": 24975000,
              "soldAt": "2026-03-01T00:00:00", "soldPrice": 900,
              "soldPriceVnd": 22500000,
              "status": "SOLD",
              "warranties": [
                {"id": "w1", "deviceId": "dev-1", "startDate": "2026-01-10",
                 "endDate": "2027-01-10", "months": 12, "cost": 99}
              ]
            }
        """.trimIndent()

        val device = json.decodeFromString(Device.serializer(), raw)

        assertEquals("USD", device.currency)
        assertEquals(25_000, device.fxRate)
        assertEquals(24_975_000L, device.purchasePriceVnd)
        assertEquals(22_500_000L, device.soldPriceVnd)
        assertEquals("Warranty.cost is in the device's currency", 99, device.warranties.single().cost)
    }

    @Test
    fun anOlderPayloadDecodesAsADongOnlyDevice() {
        val device = json.decodeFromString(
            Device.serializer(),
            """{"id":"dev-1","name":"Chuột","category":"ACCESSORY","purchaseDate":"2024-05-05"}""",
        )

        assertEquals("VND is the contract default", "VND", device.currency)
        assertNull("a VND device has no rate", device.fxRate)
        assertNull("a pre-multi-currency server sends no VND values", device.purchasePriceVnd)
        assertNull(device.soldPriceVnd)
    }

    @Test
    fun aVndDeviceInputSendsCurrencyAndDropsTheNullRate() {
        val encoded = json.encodeToString(
            DeviceInput.serializer(),
            DeviceInput(
                name = "iPhone 15 Pro",
                category = "PHONE",
                purchaseDate = "2026-01-10",
                purchasePrice = 30_000_000,
            ),
        )

        assertTrue("currency must always be sent: $encoded", encoded.contains("\"currency\":\"VND\""))
        assertFalse(
            "explicitNulls = false drops fxRate for VND, which is the contract's pair: $encoded",
            encoded.contains("fxRate"),
        )
    }

    @Test
    fun aForeignDeviceInputSendsTheLockedRate() {
        val encoded = json.encodeToString(
            DeviceInput.serializer(),
            DeviceInput(
                name = "iPhone 15 Pro",
                category = "PHONE",
                purchaseDate = "2026-01-10",
                purchasePrice = 999,
                currency = "USD",
                fxRate = 25_000,
            ),
        )

        assertTrue(encoded.contains("\"currency\":\"USD\""))
        assertTrue("the locked rate must reach the wire: $encoded", encoded.contains("\"fxRate\":25000"))
    }

    /**
     * Documents *why* the sheet has to block this combination locally rather
     * than let the server answer 400: a null rate is not encoded at all, so a
     * USD body silently becomes a USD row with no rate.
     */
    @Test
    fun aForeignDeviceWithANullRateLosesTheKeySoTheFormMustBlockIt() {
        val encoded = json.encodeToString(
            DeviceInput.serializer(),
            DeviceInput(
                name = "iPhone 15 Pro",
                category = "PHONE",
                purchaseDate = "2026-01-10",
                currency = "USD",
                fxRate = null,
            ),
        )

        assertTrue(encoded.contains("\"currency\":\"USD\""))
        assertFalse("the server would answer 400 fieldErrors.fxRate: $encoded", encoded.contains("fxRate"))
    }

    @Test
    fun fxRatesDecodesTheQuoteMapAndToleratesOptionalFields() {
        val full = json.decodeFromString(
            FxRates.serializer(),
            """{"base":"USD","rates":{"VND":25470.5},"fetchedAt":"2026-10-19T00:00:00Z","stale":true}""",
        )
        assertEquals("USD", full.base)
        assertEquals(25_470.5, full.rates.getValue("VND"), 0.0)
        assertEquals("2026-10-19T00:00:00Z", full.fetchedAt)
        assertTrue(full.stale)

        val minimal = json.decodeFromString(FxRates.serializer(), """{"base":"EUR","rates":{}}""")
        assertEquals("EUR", minimal.base)
        assertTrue(minimal.rates.isEmpty())
        assertNull(minimal.fetchedAt)
        assertFalse(minimal.stale)
    }
}
