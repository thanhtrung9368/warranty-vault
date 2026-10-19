package com.warrly.insurance

import java.time.LocalDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The pure half of the insurance PDF pack: what the client asks the Go renderer
 * for, and what it calls the file it writes.
 *
 * These rules are pinned separately from the Settings screen because every one
 * of them is a contract detail that no compiler checks: a `?deviceIds=` with an
 * empty value asks a different question from omitting the parameter, sending
 * `includeSold=false` is not the contract's "default", and a file name with a
 * space or a diacritic survives some mail clients and not others.
 */
class InsurancePackTest {

    // ---- The request --------------------------------------------------------

    @Test
    fun theDefaultRequestIsTheBareEndpointWithBothOptionalParametersOmitted() {
        val request = insurancePackRequest()

        assertNull("no list means ALL devices, not an empty selection", request.deviceIds)
        assertNull("the server default is false; the client must not send it", request.includeSold)
        assertEquals("", request.toQueryString())
    }

    @Test
    fun selectedDeviceIdsAreCommaJoinedInTheOrderTheyWereGiven() {
        val request = insurancePackRequest(listOf("dev-1", "dev-2", "dev-3"))

        assertEquals("dev-1,dev-2,dev-3", request.deviceIds)
        assertEquals("?deviceIds=dev-1,dev-2,dev-3", request.toQueryString())
    }

    @Test
    fun blanksAndDuplicatesAreDroppedWithoutReorderingTheRest() {
        val request = insurancePackRequest(listOf(" dev-1 ", "", "   ", "dev-2", "dev-1", "dev-3"))

        assertEquals("dev-1,dev-2,dev-3", request.deviceIds)
    }

    @Test
    fun anEmptySelectionFallsBackToAllDevicesRatherThanAnEmptyParameter() {
        // The contract has no "select nothing" spelling. `deviceIds=` would be a
        // different question (and an invalid one), so the only honest request is
        // the same one as "all devices".
        assertNull(insurancePackRequest(emptyList()).deviceIds)
        assertNull(insurancePackRequest(listOf("", "  ")).deviceIds)
        assertEquals("", insurancePackRequest(emptyList()).toQueryString())
    }

    @Test
    fun includeSoldIsOnlySentWhenItIsTrue() {
        // false is the default and is OMITTED, never `includeSold=false`.
        assertNull(insurancePackRequest(includeSold = false).includeSold)
        assertEquals("", insurancePackRequest(includeSold = false).toQueryString())

        assertEquals(true, insurancePackRequest(includeSold = true).includeSold)
        assertEquals("?includeSold=true", insurancePackRequest(includeSold = true).toQueryString())
    }

    @Test
    fun bothParametersAppearInTheContractOrder() {
        val request = insurancePackRequest(listOf("dev-1", "dev-2"), includeSold = true)

        assertEquals(
            "?deviceIds=dev-1,dev-2&includeSold=true",
            request.toQueryString(),
        )
    }

    // ---- The file -----------------------------------------------------------

    @Test
    fun theFileNameIsAnAsciiVietnameseSlugWithAPdfExtension() {
        val name = insurancePackFileName(LocalDateTime.of(2025, 10, 19, 8, 39))

        assertEquals("warrly-bang-ke-bao-hiem-20251019-0839.pdf", name)
        assertTrue("must stay ASCII for mail/cloud round-trips: $name", name.all { it.code < 128 })
        assertTrue("no spaces: $name", name.none { it.isWhitespace() })
        assertTrue("must be a PDF: $name", name.endsWith(".pdf"))
    }

    @Test
    fun theFileNameTracksTheInjectedClockToTheMinute() {
        assertEquals(
            "warrly-bang-ke-bao-hiem-20260101-0000.pdf",
            insurancePackFileName(LocalDateTime.of(2026, 1, 1, 0, 0)),
        )
        assertEquals(
            "warrly-bang-ke-bao-hiem-20261231-2359.pdf",
            insurancePackFileName(LocalDateTime.of(2026, 12, 31, 23, 59)),
        )
    }

    @Test
    fun theMimeTypeIsTheOneTheContractFixes() {
        assertEquals("application/pdf", INSURANCE_PACK_MIME)
    }
}
