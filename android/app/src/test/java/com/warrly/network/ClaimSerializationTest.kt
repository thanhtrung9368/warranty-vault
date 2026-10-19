package com.warrly.network

import com.warrly.testing.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The warranty-claim wire shapes (`network/Models.kt`).
 *
 * Three things are pinned here because they are invisible in a round-trip
 * assertion and would only surface as a wrong request or a silent data loss:
 *
 *  1. **`closedAt` is server-owned** and must never appear in a request body.
 *  2. **`coveredByWarranty` is tri-state**, and `ApiClient.json`'s
 *     `explicitNulls = false` means a `null` is *dropped* — that is the correct
 *     "unknown" on the wire, while `false` must be sent rather than dropped as
 *     falsy.
 *  3. **`Device.claims` is detail-only**; the list endpoint omits it, so the
 *     field must default to an empty list there instead of throwing.
 */
class ClaimSerializationTest {

    private val json = ApiClient.json

    // ---- the response DTO ------------------------------------------------

    @Test
    fun claimDecodesEveryContractField() {
        val raw = """
            {
              "id": "claim-1",
              "deviceId": "dev-1",
              "warrantyId": "war-1",
              "status": "IN_REPAIR",
              "openedAt": "2026-03-02T00:00:00Z",
              "expectedReturnAt": "2026-03-09",
              "closedAt": null,
              "ticketNumber": "SC-123",
              "serviceCenter": "CellphoneS",
              "diagnosis": "Chân sạc lỏng",
              "outcome": "Đã thay chân sạc",
              "issue": "Không sạc được",
              "cost": 250000,
              "coveredByWarranty": true,
              "createdAt": "2026-03-02T01:02:03Z",
              "updatedAt": "2026-03-03T04:05:06Z"
            }
        """.trimIndent()

        val claim = json.decodeFromString(Claim.serializer(), raw)

        assertEquals("claim-1", claim.id)
        assertEquals("dev-1", claim.deviceId)
        assertEquals("war-1", claim.warrantyId)
        assertEquals(ClaimStatus.IN_REPAIR, claim.status)
        assertEquals("2026-03-02T00:00:00Z", claim.openedAt)
        assertEquals("2026-03-09", claim.expectedReturnAt)
        assertNull("the server has not closed an in-repair claim", claim.closedAt)
        assertEquals("SC-123", claim.ticketNumber)
        assertEquals("CellphoneS", claim.serviceCenter)
        assertEquals("Chân sạc lỏng", claim.diagnosis)
        assertEquals("Đã thay chân sạc", claim.outcome)
        assertEquals("Không sạc được", claim.issue)
        assertEquals(250_000, claim.cost)
        assertEquals(true, claim.coveredByWarranty)
        assertEquals("2026-03-02T01:02:03Z", claim.createdAt)
        assertEquals("2026-03-03T04:05:06Z", claim.updatedAt)
    }

    /**
     * `null` and `false` are different facts. An absent field (an older server)
     * and an explicit null both mean "unknown"; `false` means the user recorded
     * that the warranty does **not** pay.
     */
    @Test
    fun claimKeepsTheUnknownWarrantyPaymentDistinctFromNo() {
        val unknownAbsent = json.decodeFromString(
            Claim.serializer(),
            """{"id":"c1","deviceId":"dev-1","openedAt":"2026-03-02T00:00:00Z","issue":"Hỏng"}""",
        )
        assertNull(unknownAbsent.coveredByWarranty)

        val unknownExplicit = json.decodeFromString(
            Claim.serializer(),
            """{"id":"c1","deviceId":"dev-1","openedAt":"2026-03-02T00:00:00Z","issue":"Hỏng","coveredByWarranty":null}""",
        )
        assertNull(unknownExplicit.coveredByWarranty)

        val no = json.decodeFromString(
            Claim.serializer(),
            """{"id":"c1","deviceId":"dev-1","openedAt":"2026-03-02T00:00:00Z","issue":"Hỏng","coveredByWarranty":false}""",
        )
        assertEquals(false, no.coveredByWarranty)

        val closed = json.decodeFromString(
            Claim.serializer(),
            """{"id":"c1","deviceId":"dev-1","openedAt":"2026-03-02T00:00:00Z","issue":"Hỏng","status":"RESOLVED","closedAt":"2026-03-05T04:00:00Z"}""",
        )
        assertEquals(ClaimStatus.RESOLVED, closed.status)
        assertEquals("2026-03-05T04:00:00Z", closed.closedAt)
    }

    /** Every status spelling on the wire is the frozen contract's uppercase form. */
    @Test
    fun claimStatusWireSpellingsMatchTheContract() {
        for (status in ClaimStatus.entries) {
            val decoded = json.decodeFromString(
                Claim.serializer(),
                """{"id":"c1","deviceId":"dev-1","openedAt":"2026-03-02","issue":"Hỏng","status":"${status.name}"}""",
            )
            assertEquals(status, decoded.status)
        }
    }

    // ---- the create/update body -----------------------------------------

    /**
     * A minimal claim sends the two required fields (plus the defaulted status,
     * because `encodeDefaults = true`), and **no `closedAt`**. Null optionals are
     * dropped, which the contract reads as "not recorded".
     */
    @Test
    fun claimInputSendsRequiredFieldsAndNeverSendsClosedAt() {
        val encoded = json.encodeToString(
            ClaimInput.serializer(),
            ClaimInput(
                deviceId = "dev-1",
                openedAt = "2026-03-02",
                issue = "Không sạc được",
            ),
        )

        assertTrue("deviceId is required: $encoded", encoded.contains("\"deviceId\":\"dev-1\""))
        assertTrue("openedAt is sent date-only: $encoded", encoded.contains("\"openedAt\":\"2026-03-02\""))
        assertTrue(encoded.contains("\"issue\":\"Không sạc được\""))
        assertTrue(
            "status is defaulted and always encoded: $encoded",
            encoded.contains("\"status\":\"OPEN\""),
        )
        assertFalse(
            "closedAt is set by the server and must never be sent: $encoded",
            encoded.contains("closedAt"),
        )
        for (key in listOf("warrantyId", "expectedReturnAt", "ticketNumber", "serviceCenter", "diagnosis", "outcome", "cost", "coveredByWarranty")) {
            assertFalse("$key is null and must be dropped: $encoded", encoded.contains("\"$key\""))
        }
    }

    /**
     * The falsy-looking values are real data: a free repair (`0`) and an
     * explicit "the warranty does not pay" (`false`) must reach the wire.
     */
    @Test
    fun claimInputKeepsZeroCostAndFalseWarrantyCoverage() {
        val encoded = json.encodeToString(
            ClaimInput.serializer(),
            ClaimInput(
                deviceId = "dev-1",
                warrantyId = "war-1",
                status = ClaimStatus.RESOLVED,
                openedAt = "2026-03-02",
                expectedReturnAt = "2026-03-09",
                ticketNumber = "SC-123",
                serviceCenter = "CellphoneS",
                diagnosis = "Chân sạc lỏng",
                outcome = "Đã thay chân sạc",
                issue = "Không sạc được",
                cost = 0,
                coveredByWarranty = false,
            ),
        )

        assertTrue(encoded.contains("\"warrantyId\":\"war-1\""))
        assertTrue(encoded.contains("\"status\":\"RESOLVED\""))
        assertTrue(encoded.contains("\"expectedReturnAt\":\"2026-03-09\""))
        assertTrue(encoded.contains("\"ticketNumber\":\"SC-123\""))
        assertTrue("a 0 cost is a real free repair: $encoded", encoded.contains("\"cost\":0"))
        assertTrue(
            "false is a recorded answer, not an absent one: $encoded",
            encoded.contains("\"coveredByWarranty\":false"),
        )
        assertFalse("still never the server's field", encoded.contains("closedAt"))
    }

    @Test
    fun claimInputSendsTrueWarrantyCoverage() {
        val encoded = json.encodeToString(
            ClaimInput.serializer(),
            ClaimInput(
                deviceId = "dev-1",
                openedAt = "2026-03-02",
                issue = "Không sạc được",
                coveredByWarranty = true,
            ),
        )
        assertTrue(encoded.contains("\"coveredByWarranty\":true"))
    }

    // ---- envelopes / device detail --------------------------------------

    @Test
    fun claimListResponseDefaultsToEmptyAndDecodesRows() {
        assertTrue(
            json.decodeFromString(ClaimListResponse.serializer(), "{}").claims.isEmpty(),
        )

        val decoded = json.decodeFromString(
            ClaimListResponse.serializer(),
            """{"claims":[{"id":"c1","deviceId":"dev-1","openedAt":"2026-03-02","issue":"Hỏng"}]}""",
        )
        assertEquals(1, decoded.claims.size)
        assertEquals("c1", decoded.claims.single().id)
    }

    @Test
    fun claimResponseDecodesTheSingleCheapEnvelope() {
        val decoded = json.decodeFromString(
            ClaimResponse.serializer(),
            """{"claim":{"id":"c1","deviceId":"dev-1","openedAt":"2026-03-02","issue":"Hỏng"}}""",
        )
        assertEquals("c1", decoded.claim.id)
        assertEquals(ClaimStatus.OPEN, decoded.claim.status)
    }

    /**
     * `GET /api/v1/devices/{id}` carries the claims array; every other device
     * payload omits it and must still decode. The list screen in particular must
     * not mistake "not included" for "the device has no claims" — it simply does
     * not render the section.
     */
    @Test
    fun theDeviceDetailCarriesClaimsAndOtherDevicePayloadsDefaultToNone() {
        val detail = json.decodeFromString(
            Device.serializer(),
            """
                {
                  "id": "dev-1",
                  "name": "iPhone 15 Pro",
                  "category": "PHONE",
                  "purchaseDate": "2024-03-01",
                  "status": "BROKEN",
                  "claims": [
                    {
                      "id": "claim-1",
                      "deviceId": "dev-1",
                      "status": "OPEN",
                      "openedAt": "2026-03-02T00:00:00",
                      "ticketNumber": "SC-123",
                      "issue": "Không sạc được"
                    }
                  ]
                }
            """.trimIndent(),
        )

        assertEquals(DeviceStatus.BROKEN, detail.status)
        assertEquals(1, detail.claims.size)
        assertEquals("claim-1", detail.claims.single().id)

        val listRow = json.decodeFromString(
            Device.serializer(),
            """{"id":"dev-2","name":"Chuột","category":"ACCESSORY","purchaseDate":"2024-05-05"}""",
        )
        assertTrue("a list row carries no claims and must still decode", listRow.claims.isEmpty())
    }

    /** The fixture round-trips, so the DTO and the test builder cannot drift. */
    @Test
    fun theClaimFixtureRoundTripsThroughJson() {
        val claim = Fixtures.claim(
            status = ClaimStatus.RESOLVED,
            expectedReturnAt = "2026-03-09",
            closedAt = "2026-03-10T04:00:00Z",
            ticketNumber = "SC-123",
            serviceCenter = "CellphoneS",
            diagnosis = "Chân sạc lỏng",
            outcome = "Đã thay chân sạc",
            cost = 250_000,
            coveredByWarranty = false,
        )
        assertEquals(
            claim,
            json.decodeFromString(
                Claim.serializer(),
                json.encodeToString(Claim.serializer(), claim),
            ),
        )
    }
}
