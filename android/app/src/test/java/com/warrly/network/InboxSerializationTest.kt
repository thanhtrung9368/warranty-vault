package com.warrly.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The capture-first inbox's wire shapes — the two places where "no device" is a
 * real instruction rather than a missing value, and the one place where the
 * opposite is true.
 *
 * These are pinned as JSON strings, not as objects: the bug they guard against is
 * **`ApiClient.json`'s `explicitNulls = false`**, which silently drops a null
 * property. A round-trip through `FileAttachmentInput` that sent `{}` would still
 * "round-trip" as null and look correct to a naive assertion.
 */
class InboxSerializationTest {

    // ---- POST /attachments/{id}/file --------------------------------------

    /**
     * The unfile call: `deviceId: null` sends the item **back to the inbox**.
     * Without the hand-written serializer the key would be dropped and the
     * server would receive `{}` — a 400, not an unfile.
     */
    @Test
    fun fileAttachmentInput_alwaysSendsTheKeyAndCanSendAnExplicitNull() {
        assertEquals(
            """{"deviceId":null}""",
            ApiClient.json.encodeToString(
                FileAttachmentInput.serializer(),
                FileAttachmentInput(deviceId = null),
            ),
        )
        assertEquals(
            """{"deviceId":"dev-1"}""",
            ApiClient.json.encodeToString(
                FileAttachmentInput.serializer(),
                FileAttachmentInput(deviceId = "dev-1"),
            ),
        )
    }

    @Test
    fun fileAttachmentInput_readsBothShapesBack() {
        assertEquals(
            FileAttachmentInput(deviceId = null),
            ApiClient.json.decodeFromString(
                FileAttachmentInput.serializer(),
                """{"deviceId":null}""",
            ),
        )
        assertEquals(
            FileAttachmentInput(deviceId = "dev-1"),
            ApiClient.json.decodeFromString(
                FileAttachmentInput.serializer(),
                """{"deviceId":"dev-1"}""",
            ),
        )
    }

    // ---- the Attachment DTO ----------------------------------------------

    /**
     * `deviceId` is optional on the shared `Attachment` shape, and **absent
     * means unfiled**. `GET /api/v1/inbox` is exactly this: the same
     * `Attachment` with no device. The device-scoped reads that predate the
     * field must still decode.
     */
    @Test
    fun anAttachmentWithoutADeviceIdIsAnInboxItem() {
        val noDevice = ApiClient.json.decodeFromString(
            Attachment.serializer(),
            """{"id":"att-1","fileName":"hoa-don.pdf","fileType":"application/pdf","fileSize":2048,"uploadedAt":"2025-01-02T03:04:05"}""",
        )
        assertNull(noDevice.deviceId)

        val filed = ApiClient.json.decodeFromString(
            Attachment.serializer(),
            """{"id":"att-2","deviceId":"dev-1","fileName":"hoa-don.pdf","fileType":"application/pdf","fileSize":2048}""",
        )
        assertEquals("dev-1", filed.deviceId)
    }

    /**
     * `GET /api/v1/inbox` is the **same envelope** as the device attachment
     * list (`{"attachments":[…]}`), so one decoder serves both. The payload here
     * is the server's actual shape: `AttachmentMeta` carries no `deviceId`, and
     * `uploadedAt` is RFC3339 with a `Z` (the Android date formatter takes only
     * the date half, so the suffix is irrelevant to display).
     */
    @Test
    fun theInboxEnvelopeIsTheSharedAttachmentList() {
        val payload = """
            {"attachments":[
              {"id":"att-1","fileName":"hoa-don.jpg","fileType":"image/jpeg",
               "fileSize":2048,"uploadedAt":"2025-01-02T03:04:05Z"}
            ]}
        """.trimIndent()

        val decoded = ApiClient.json.decodeFromString(
            AttachmentListResponse.serializer(),
            payload,
        )

        assertEquals(1, decoded.attachments.size)
        val row = decoded.attachments.single()
        assertEquals("att-1", row.id)
        assertNull("the inbox endpoint's rows have no device", row.deviceId)
        assertEquals("2025-01-02T03:04:05Z", row.uploadedAt)
    }
}
