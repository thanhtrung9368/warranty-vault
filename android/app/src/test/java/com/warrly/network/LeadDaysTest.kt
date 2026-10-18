package com.warrly.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The client half of the `leadDays` contract (openapi `Device.leadDays` /
 * `Subscription.leadDays`).
 *
 * The server is the authority (it sorts, dedupes, clamps and rejects), but the
 * picker has to show the same answer while the user is still typing, and the
 * request body must be valid before it leaves the phone. These tests pin the
 * four rules that would otherwise drift between Android, iOS and Go: clamp
 * 0..365, dedupe, descending sort, and the 1..5 entry window — including the
 * deliberate difference between "empty" (invalid, required-field error) and
 * "absent" (key omitted).
 */
class LeadDaysTest {

    @Test
    fun theDefaultIsTheOneTheServerAppliesWhenCreateOmitsTheField() {
        assertEquals(listOf(30, 7), DEFAULT_LEAD_DAYS)
    }

    @Test
    fun entriesAreClampedToTheContractRange() {
        // 0 is valid ("nhắc đúng ngày hết hạn"); negative and >365 are clamped,
        // never dropped — the user's intent survives as the nearest legal day.
        assertEquals(listOf(365, 0), normalizeLeadDays(listOf(-3, 0, 400)))
        assertEquals(listOf(365), normalizeLeadDays(listOf(999)))
        assertEquals(listOf(0), normalizeLeadDays(listOf(0)))
    }

    @Test
    fun duplicateEntriesAreRemovedAndTheResultSortsDescending() {
        assertEquals(listOf(30, 7, 1), normalizeLeadDays(listOf(7, 30, 7, 1)))
        // Clamping happens before dedupe: 400 and 365 are the same legal day.
        assertEquals(listOf(365), normalizeLeadDays(listOf(365, 400)))
    }

    @Test
    fun atMostFiveEntriesSurvive() {
        assertEquals(listOf(7, 6, 5, 4, 3), normalizeLeadDays(listOf(1, 2, 3, 4, 5, 6, 7)))
        assertEquals(5, normalizeLeadDays(listOf(60, 30, 14, 7, 1, 0)).size)
    }

    @Test
    fun emptyStaysEmptyAndIsNotAValidRequestValue() {
        assertEquals(emptyList<Int>(), normalizeLeadDays(emptyList()))
        assertFalse("zero reminders is a 400, not a default", isValidLeadDays(emptyList()))
        assertNull(leadDaysForRequest(emptyList()))
    }

    @Test
    fun validityFollowsTheOneToFiveEntryWindow() {
        assertTrue(isValidLeadDays(listOf(0)))
        assertTrue(isValidLeadDays(listOf(365)))
        assertTrue(isValidLeadDays(listOf(365, 0)))
        assertTrue(isValidLeadDays(listOf(60, 30, 14, 7, 1)))

        assertFalse("six entries is over the cap", isValidLeadDays(listOf(60, 30, 14, 7, 1, 0)))
        assertFalse("duplicates are rejected", isValidLeadDays(listOf(30, 30)))
        assertFalse("out of range", isValidLeadDays(listOf(366)))
        assertFalse("out of range", isValidLeadDays(listOf(-1)))
    }

    @Test
    fun theRequestValueIsNormalisedButStillAbsentWhenEmpty() {
        assertEquals(listOf(30, 7), leadDaysForRequest(listOf(7, 30, 7)))
        assertEquals(listOf(365, 0), leadDaysForRequest(listOf(0, 400)))
        assertNull("an empty picker must omit the key, not send []", leadDaysForRequest(listOf()))
    }
}
