package com.warrantyvault.app.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Contract tests for the advisory `warnings` channel.
 *
 * This is the exact field that was invisible until now: `ApiClient.json` sets
 * `ignoreUnknownKeys = true`, so `{"device": {...}, "warnings": [...]}` decoded
 * into a `DeviceResponse` that had no such property and threw the list away
 * without an error. Nothing in the app could have noticed.
 */
class DeviceWarningsSerializationTest {

    private val json = ApiClient.json

    private val deviceJson = """
        {
          "id": "dev-1",
          "name": "iPhone 15 Pro",
          "category": "PHONE",
          "purchaseDate": "2024-03-01T00:00:00",
          "purchasePrice": 30000000,
          "status": "ACTIVE"
        }
    """.trimIndent()

    @Test
    fun createResponse_carriesTheWarningsNextToTheSavedDevice() {
        val res = json.decodeFromString(
            DeviceResponse.serializer(),
            """
                {
                  "device": $deviceJson,
                  "warnings": [
                    {
                      "code": "IMEI_CHECKSUM",
                      "field": "serialNumber",
                      "message": "15 số này không đúng checksum IMEI (Luhn) — có thể sai một chữ số."
                    }
                  ]
                }
            """.trimIndent(),
        )

        // The device WAS created — the warnings are additive, not a failure.
        assertEquals("dev-1", res.device.id)
        assertEquals(1, res.warnings.size)
        assertEquals("IMEI_CHECKSUM", res.warnings.single().code)
        assertEquals("serialNumber", res.warnings.single().field)
        assertTrue(res.warnings.single().message.contains("checksum"))
    }

    @Test
    fun warnings_defaultToEmptyOnTheDetailRead() {
        // `GET /api/v1/devices/{id}` answers `{"device": {...}}` with no key at
        // all, and must keep decoding — an empty list, never null.
        val res = json.decodeFromString(
            DeviceResponse.serializer(),
            """{"device": $deviceJson}""",
        )

        assertTrue(res.warnings.isEmpty())
    }

    @Test
    fun warnings_areEmptyNotMissingWhenTheServerSaysSo() {
        val res = json.decodeFromString(
            DeviceResponse.serializer(),
            """{"device": $deviceJson, "warnings": []}""",
        )

        assertTrue(res.warnings.isEmpty())
    }

    @Test
    fun warning_keepsAnUnknownCodeInsteadOfThrowing() {
        // Codes are stable strings, not an enum: a server that grows a fourth
        // advisory must not break the device list.
        val res = json.decodeFromString(
            DeviceResponse.serializer(),
            """
                {
                  "device": $deviceJson,
                  "warnings": [{"code": "SOMETHING_NEW", "field": "serialNumber", "message": "Xem lại giúp."}]
                }
            """.trimIndent(),
        )

        assertEquals("SOMETHING_NEW", res.warnings.single().code)
        assertEquals("Xem lại giúp.", res.warnings.single().message)
    }

    @Test
    fun warning_survivesAMissingMessageSoTheUiCanFallBack() {
        // `message` is required by the contract, but a blank one must still
        // decode: the UI falls back per code rather than showing an empty box.
        val res = json.decodeFromString(
            DeviceResponse.serializer(),
            """{"device": $deviceJson, "warnings": [{"code": "IMEI_LENGTH"}]}""",
        )

        assertEquals("IMEI_LENGTH", res.warnings.single().code)
        assertEquals("serialNumber", res.warnings.single().field)
        assertEquals("", res.warnings.single().message)
    }

    @Test
    fun draft_carriesBothUnmatchedAndWarnings() {
        val draft = json.decodeFromString(
            DraftDeviceResponse.serializer(),
            """
                {
                  "draft": {
                    "name": "Galaxy S24",
                    "confidence": "medium",
                    "unmatched": ["brand"],
                    "warnings": [
                      {
                        "code": "SERIAL_DUPLICATE",
                        "field": "serialNumber",
                        "message": "Serial này đã có ở một thiết bị khác của mày."
                      }
                    ]
                  }
                }
            """.trimIndent(),
        ).draft

        // Kept but wrong…
        assertEquals(1, draft.warnings.size)
        assertEquals("SERIAL_DUPLICATE", draft.warnings.single().code)
        // …versus dropped entirely. Two channels, two fields.
        assertEquals(listOf("brand"), draft.unmatched)
    }

    @Test
    fun draft_withoutWarnings_stillDecodes() {
        val draft = json.decodeFromString(
            DraftDeviceResponse.serializer(),
            """{"draft": {"name": "Galaxy S24"}}""",
        ).draft

        assertTrue(draft.warnings.isEmpty())
        assertTrue(draft.unmatched.isEmpty())
    }
}
