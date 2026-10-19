package com.warrly.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Contract tests for the bulk-device DTOs in `Models.kt`.
 *
 * The response is unusual for this app: a 200 can carry both persisted devices
 * and refused rows, and a row's refusal is matched by **request index**. These
 * tests pin that shape and the defaults that keep a partial success decodable
 * when one of the arrays or a failure detail is omitted.
 */
class BulkDeviceSerializationTest {

    private val json = ApiClient.json

    @Test
    fun theRequestIsTheFrozenDevicesEnvelope() {
        val body = BulkDeviceRequest(
            devices = listOf(
                DeviceInput(
                    name = "Tủ lạnh",
                    category = "FRIDGE",
                    purchaseDate = "2026-09-01",
                    purchasePrice = 12_990_000,
                ),
            ),
        )

        val encoded = json.encodeToString(BulkDeviceRequest.serializer(), body)

        assertTrue(encoded.startsWith("""{"devices":["""))
        assertTrue(encoded.contains("\"name\":\"Tủ lạnh\""))
        assertTrue(encoded.contains("\"purchaseDate\":\"2026-09-01\""))
        // explicitNulls = false: nullable optionals are omitted, not null.
        assertFalse(encoded.contains(":null"))
        assertFalse(encoded.contains("\"brand\""))

        val decoded = json.decodeFromString(BulkDeviceRequest.serializer(), encoded)
        assertEquals(1, decoded.devices.size)
        assertEquals("Tủ lạnh", decoded.devices.single().name)
    }

    @Test
    fun aPartialSuccessDecodesCreatedAndFailedWithItsOwnFieldErrors() {
        val raw = """
            {
              "created": [
                {"id":"d1","name":"Tủ lạnh","category":"FRIDGE","purchaseDate":"2026-09-01","purchasePrice":12990000}
              ],
              "failed": [
                {
                  "index": 1,
                  "code": "validation_failed",
                  "message": "Ngày mua không hợp lệ",
                  "fieldErrors": {"purchaseDate": ["Ngày mua không hợp lệ"]}
                }
              ]
            }
        """.trimIndent()

        val response = json.decodeFromString(BulkDeviceResponse.serializer(), raw)

        assertEquals(listOf("d1"), response.created.map(Device::id))
        val failure = response.failed.single()
        assertEquals(1, failure.index)
        assertEquals("validation_failed", failure.code)
        assertEquals("Ngày mua không hợp lệ", failure.message)
        assertEquals(listOf("Ngày mua không hợp lệ"), failure.fieldErrors["purchaseDate"])
    }

    /**
     * A server may omit an empty array or an empty detail. None of those
     * omissions may make the app drop a batch that really was partly created.
     */
    @Test
    fun missingArraysAndFailureDetailsDefaultInsteadOfFailingTheDecode() {
        val onlyCreated = json.decodeFromString(
            BulkDeviceResponse.serializer(),
            """{"created":[{"id":"d1","name":"Tivi","category":"TV","purchaseDate":"2026-09-01"}]}""",
        )
        assertEquals(1, onlyCreated.created.size)
        assertTrue(onlyCreated.failed.isEmpty())

        val onlyFailed = json.decodeFromString(
            BulkDeviceResponse.serializer(),
            """{"failed":[{"index":0}]}""",
        )
        assertTrue(onlyFailed.created.isEmpty())
        val failure = onlyFailed.failed.single()
        assertEquals(0, failure.index)
        assertEquals("", failure.code)
        assertEquals("", failure.message)
        assertTrue(failure.fieldErrors.isEmpty())
    }
}
