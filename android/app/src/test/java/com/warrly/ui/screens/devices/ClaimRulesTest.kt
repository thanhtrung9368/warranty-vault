package com.warrly.ui.screens.devices

import com.warrly.i18n.ResCatalog
import com.warrly.network.ApiClient
import com.warrly.network.ClaimStatus
import com.warrly.network.DeviceStatus
import com.warrly.testing.Fixtures
import com.warrly.testing.httpError
import com.warrly.ui.components.PillKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Warranty claims — the pure half (`ClaimRules.kt`).
 *
 * What is pinned here is everything that would be a bug rather than a styling
 * choice: which statuses count as a live repair, the BROKEN-with-no-open-claim
 * nudge, the 409 code matching (case-insensitively, because the Go envelope
 * lowercases it), the tri-state warranty answer, and the null-vs-zero cost.
 *
 * The words are read out of `res/values-vi/` and `res/values/` through the same
 * [ResCatalog] seam every other pure formatter test uses, so a missing or
 * mistranslated key fails here rather than silently rendering the wrong language.
 *
 * The screen itself is not tested: this module has no instrumentation tests and
 * no Robolectric, so nothing here proves where the section sits or how it looks.
 */
class ClaimRulesTest {

    private val vi = ResCatalog.vietnamese()
    private val en = ResCatalog.english()

    // ---- status labels ---------------------------------------------------

    @Test
    fun claimStatusLabelsAreExactInBothLanguages() {
        assertEquals("Đang mở", claimStatusLabel(vi, ClaimStatus.OPEN))
        assertEquals("Open", claimStatusLabel(en, ClaimStatus.OPEN))

        assertEquals("Đang sửa", claimStatusLabel(vi, ClaimStatus.IN_REPAIR))
        assertEquals("In repair", claimStatusLabel(en, ClaimStatus.IN_REPAIR))

        assertEquals("Đã xử lý xong", claimStatusLabel(vi, ClaimStatus.RESOLVED))
        assertEquals("Resolved", claimStatusLabel(en, ClaimStatus.RESOLVED))

        assertEquals("Bị từ chối", claimStatusLabel(vi, ClaimStatus.REJECTED))
        assertEquals("Rejected", claimStatusLabel(en, ClaimStatus.REJECTED))

        assertEquals("Đã huỷ", claimStatusLabel(vi, ClaimStatus.CANCELLED))
        assertEquals("Cancelled", claimStatusLabel(en, ClaimStatus.CANCELLED))
    }

    // ---- open vs closed --------------------------------------------------

    /**
     * The live pair is exactly `OPEN` + `IN_REPAIR`; everything else is
     * terminal. This is what the one-open-per-device rule counts.
     */
    @Test
    fun onlyOpenAndInRepairCountAsLiveClaims() {
        assertTrue(isOpenClaim(ClaimStatus.OPEN))
        assertTrue(isOpenClaim(ClaimStatus.IN_REPAIR))
        assertFalse(isOpenClaim(ClaimStatus.RESOLVED))
        assertFalse(isOpenClaim(ClaimStatus.REJECTED))
        assertFalse(isOpenClaim(ClaimStatus.CANCELLED))

        assertFalse(isClosedClaim(ClaimStatus.OPEN))
        assertFalse(isClosedClaim(ClaimStatus.IN_REPAIR))
        assertTrue(isClosedClaim(ClaimStatus.RESOLVED))
        assertTrue(isClosedClaim(ClaimStatus.REJECTED))
        assertTrue(isClosedClaim(ClaimStatus.CANCELLED))
    }

    /**
     * The selector ignores terminal rows and finds the live one wherever it
     * sits in the list — the server's ordering is not the rule.
     */
    @Test
    fun openClaimOfFindsTheLiveClaimAndIgnoresTerminalOnes() {
        val resolved = Fixtures.claim(id = "claim-r", status = ClaimStatus.RESOLVED)
        val rejected = Fixtures.claim(id = "claim-x", status = ClaimStatus.REJECTED)
        val live = Fixtures.claim(id = "claim-live", status = ClaimStatus.IN_REPAIR)

        assertNull("no claims means no live claim", openClaimOf(emptyList()))
        assertNull(openClaimOf(listOf(resolved, rejected)))
        assertEquals(live, openClaimOf(listOf(resolved, live, rejected)))
    }

    // ---- the BROKEN dead end --------------------------------------------

    /**
     * The nudge is the feature's whole point: a device marked `BROKEN` with no
     * live repair is a dead end. A terminal claim does **not** silence it — the
     * last repair was rejected, the device is still broken.
     */
    @Test
    fun aBrokenDeviceWithoutALiveClaimIsNudged() {
        val closed = Fixtures.claim(status = ClaimStatus.RESOLVED)
        assertTrue(brokenWithoutOpenClaim(DeviceStatus.BROKEN, emptyList()))
        assertTrue(
            "a resolved/rejected/cancelled claim is not an open repair",
            brokenWithoutOpenClaim(DeviceStatus.BROKEN, listOf(closed)),
        )
        assertFalse(
            "an OPEN claim is the way out already",
            brokenWithoutOpenClaim(DeviceStatus.BROKEN, listOf(Fixtures.claim(status = ClaimStatus.OPEN))),
        )
        assertFalse(
            "IN_REPAIR is still a live repair",
            brokenWithoutOpenClaim(
                DeviceStatus.BROKEN,
                listOf(Fixtures.claim(status = ClaimStatus.IN_REPAIR)),
            ),
        )
    }

    /** Every other device status is deliberately exempt from the nudge. */
    @Test
    fun theNudgeOnlyAppliesToBrokenDevices() {
        for (status in listOf(
            DeviceStatus.ACTIVE,
            DeviceStatus.EXPIRED,
            DeviceStatus.SOLD,
            DeviceStatus.LOST,
        )) {
            assertFalse("$status must not nag about a repair", brokenWithoutOpenClaim(status, emptyList()))
        }
    }

    /** The `Device` extension is the same predicate the section calls. */
    @Test
    fun theDeviceExtensionMatchesTheFieldPredicate() {
        assertTrue(
            Fixtures.device(status = DeviceStatus.BROKEN).isBrokenWithoutOpenClaim(),
        )
        assertFalse(
            Fixtures.device(
                status = DeviceStatus.BROKEN,
                claims = listOf(Fixtures.claim()),
            ).isBrokenWithoutOpenClaim(),
        )
        assertFalse(
            Fixtures.device(
                status = DeviceStatus.ACTIVE,
                claims = listOf(Fixtures.claim()),
            ).isBrokenWithoutOpenClaim(),
        )
    }

    // ---- the 409 ---------------------------------------------------------

    /**
     * The exact case that was documented in the task: the contract names
     * `LIMIT_REACHED`, the wire carries `limit_reached` because the Go envelope
     * writer lowercases domain codes, and both (plus any casing) must map to the
     * same actionable state.
     */
    @Test
    fun theClaimLimitCodeMatchesCaseInsensitively() {
        assertEquals(ClaimFailure.LIMIT_REACHED, claimFailure(409, "limit_reached"))
        assertEquals(ClaimFailure.LIMIT_REACHED, claimFailure(409, "LIMIT_REACHED"))
        assertEquals(ClaimFailure.LIMIT_REACHED, claimFailure(409, "Limit_Reached"))

        assertEquals("a different 409 is a different conflict", ClaimFailure.OTHER, claimFailure(409, "device_full"))
        assertEquals("the code alone is not the documented contract", ClaimFailure.OTHER, claimFailure(400, "limit_reached"))
        assertEquals(ClaimFailure.OTHER, claimFailure(409, null))
        assertEquals(ClaimFailure.OTHER, claimFailure(null, "limit_reached"))
    }

    /**
     * A blocked create points at the *other* live claim; when the blocked row is
     * the only live one (re-opening a ticket already being edited), there is no
     * self-link.
     */
    @Test
    fun theLimitTargetExcludesTheClaimBeingEdited() {
        val editing = Fixtures.claim(id = "claim-1", status = ClaimStatus.OPEN)
        val other = Fixtures.claim(id = "claim-2", status = ClaimStatus.IN_REPAIR)

        assertEquals(other, claimLimitTarget(listOf(other, editing)))
        assertNull(
            "editing the only live claim must not point back at itself",
            claimLimitTarget(listOf(editing), editingClaimId = editing.id),
        )
        assertEquals(
            other,
            claimLimitTarget(listOf(editing, other), editingClaimId = editing.id),
        )
        assertNull(claimLimitTarget(listOf(Fixtures.claim(status = ClaimStatus.RESOLVED))))
    }

    /**
     * The error body is one-shot. The parser must therefore return the machine
     * code, the server's translated sentence and `fieldErrors` from the same
     * read; a second read would see an empty body.
     */
    @Test
    fun theWriteErrorParsesCodeMessageAndFieldErrorsFromOneBody() {
        val error = httpError(
            409,
            """
                {
                  "error": "limit_reached",
                  "message": "Thiết bị đã có phiếu sửa chữa đang mở",
                  "fieldErrors": {"issue": ["Thiếu mô tả vấn đề"]}
                }
            """.trimIndent(),
        )

        val parsed = claimWriteError(error, ApiClient.json)

        assertEquals(ClaimFailure.LIMIT_REACHED, parsed.failure)
        assertEquals("Thiết bị đã có phiếu sửa chữa đang mở", parsed.serverMessage)
        assertEquals(listOf("Thiếu mô tả vấn đề"), parsed.fieldErrors["issue"])
    }

    @Test
    fun aNonConflictFailureIsNotReportedAsTheClaimLimit() {
        val parsed = claimWriteError(
            httpError(
                400,
                """{"error":"validation_failed","message":"Dữ liệu không hợp lệ","fieldErrors":{"cost":["Chi phí không hợp lệ"]}}""",
            ),
            ApiClient.json,
        )
        assertEquals(ClaimFailure.OTHER, parsed.failure)
        assertEquals("Dữ liệu không hợp lệ", parsed.serverMessage)
        assertEquals(listOf("Chi phí không hợp lệ"), parsed.fieldErrors["cost"])

        // A dead socket is not an HTTP response and must not be mistaken for
        // the contract's 409.
        val socket = claimWriteError(java.io.IOException("timeout"), ApiClient.json)
        assertEquals(ClaimFailure.OTHER, socket.failure)
        assertNull(socket.serverMessage)
        assertTrue(socket.fieldErrors.isEmpty())
    }

    // ---- cost ------------------------------------------------------------

    /**
     * The money shape follows the UI language (Go's canonical formats). `null`
     * and `0` must stay different: "not recorded" versus "free repair".
     */
    @Test
    fun theCostLabelUsesTheLanguageMoneyShapeAndKeepsZero() {
        assertEquals("1.200.000 ₫", claimCostLabel(vi, 1_200_000))
        assertEquals("₫1,200,000", claimCostLabel(en, 1_200_000))
        assertEquals("0 ₫", claimCostLabel(vi, 0))
        assertEquals("₫0", claimCostLabel(en, 0))
        assertNull("null means no cost was recorded", claimCostLabel(vi, null))
        assertNull(claimCostLabel(en, null))
    }

    /**
     * The form's cost rule: blank is "not recorded"; anything else must be a
     * whole, non-negative VND amount that fits in an `Int`. A pasted negative or
     * an overflowing number must not reach the request.
     */
    @Test
    fun theCostInputIsWholeNonNegativeVnd() {
        assertTrue("blank is allowed", claimCostIsValid(""))
        assertTrue(claimCostIsValid("0"))
        assertTrue(claimCostIsValid("1200000"))
        assertFalse("negative is not a cost", claimCostIsValid("-1"))
        assertFalse("VND has no fractional unit here", claimCostIsValid("1.5"))
        assertFalse(claimCostIsValid("abc"))
        assertFalse("Int.MAX_VALUE + 1 overflows the wire field", claimCostIsValid("2147483648"))

        assertNull("blank means not recorded", claimCostValue(""))
        assertNull("negative never becomes a value", claimCostValue("-1"))
        assertEquals(0, claimCostValue("0"))
        assertEquals(1_200_000, claimCostValue("1200000"))
    }

    // ---- tri-state warranty payment --------------------------------------

    /**
     * Three distinct words. `null` must never render as "No": "not recorded" and
     * "the warranty refused" are different facts.
     */
    @Test
    fun theCoveredByWarrantyLabelKeepsUnknownSeparateFromNo() {
        assertEquals("Có", coveredByWarrantyLabel(vi, true))
        assertEquals("Không", coveredByWarrantyLabel(vi, false))
        assertEquals("Không rõ", coveredByWarrantyLabel(vi, null))

        assertEquals("Yes", coveredByWarrantyLabel(en, true))
        assertEquals("No", coveredByWarrantyLabel(en, false))
        assertEquals("Not specified", coveredByWarrantyLabel(en, null))
    }

    // ---- ordering / colour ----------------------------------------------

    /**
     * A live repair is the row the user came to see; it must not sink below a
     * year of closed tickets. Within a bucket, newest `openedAt` wins.
     */
    @Test
    fun theDisplayOrderPutsLiveClaimsFirstThenNewest() {
        val olderLive = Fixtures.claim(
            id = "live-old",
            status = ClaimStatus.OPEN,
            openedAt = "2026-01-01T00:00:00",
        )
        val newerLive = Fixtures.claim(
            id = "live-new",
            status = ClaimStatus.IN_REPAIR,
            openedAt = "2026-02-01T00:00:00",
        )
        val newerClosed = Fixtures.claim(
            id = "closed-new",
            status = ClaimStatus.RESOLVED,
            openedAt = "2026-03-01T00:00:00",
        )
        val olderClosed = Fixtures.claim(
            id = "closed-old",
            status = ClaimStatus.REJECTED,
            openedAt = "2025-12-01T00:00:00",
        )

        assertEquals(
            listOf("live-new", "live-old", "closed-new", "closed-old"),
            claimsInDisplayOrder(listOf(olderClosed, newerClosed, olderLive, newerLive))
                .map { it.id },
        )
    }

    @Test
    fun theStatusPillKindDistinguishesTheLivePairAndTheTerminalStates() {
        assertEquals(PillKind.Warning, claimStatusPillKind(ClaimStatus.OPEN))
        assertEquals(PillKind.Info, claimStatusPillKind(ClaimStatus.IN_REPAIR))
        assertEquals(PillKind.Success, claimStatusPillKind(ClaimStatus.RESOLVED))
        assertEquals(PillKind.Danger, claimStatusPillKind(ClaimStatus.REJECTED))
        assertEquals(PillKind.Neutral, claimStatusPillKind(ClaimStatus.CANCELLED))
    }
}
