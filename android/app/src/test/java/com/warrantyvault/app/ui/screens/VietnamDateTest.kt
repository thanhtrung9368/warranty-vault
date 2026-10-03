package com.warrantyvault.app.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The `dd/MM/yyyy` display convention, shared by the exchange-window card, the
 * handover certificate (#2) and the warranty directory (#15).
 */
class VietnamDateTest {

    @Test
    fun formatsTheDateHalfOfEveryWireShapeTheApiSends() {
        // Naive UTC (purchaseDate / soldAt / receivedAt / returnDeadline).
        assertEquals("02/03/2026", vietnamDate("2026-03-02T00:00:00"))
        assertEquals("02/03/2026", vietnamDate("2026-03-02"))
        // RFC3339 UTC (share expiresAt / createdAt / lastViewedAt).
        assertEquals("02/03/2026", vietnamDate("2026-03-02T17:04:05Z"))
    }

    @Test
    fun keepsTheServersCalendarDayInsteadOfShiftingItByTheDeviceOffset() {
        // 23:30Z is already the 3rd in Vietnam, but the server wrote the 2nd and a
        // date-shifted expiry on the certificate screen is the one error this
        // helper exists to prevent. The date half is taken as written.
        assertEquals("02/03/2026", vietnamDate("2026-03-02T23:30:00Z"))
        assertEquals("02/03/2026", vietnamDate("2026-03-02T00:00:00+07:00"))
    }

    @Test
    fun returnsNullRatherThanAHalfParsedDate() {
        assertNull(vietnamDate(null))
        assertNull(vietnamDate(""))
        assertNull(vietnamDate("   "))
        assertNull(vietnamDate("2026/03/02"))
        assertNull(vietnamDate("2026-3-2"))
        assertNull(vietnamDate("26-03-02"))
        assertNull(vietnamDate("2026-03"))
        assertNull(vietnamDate("abcd-ef-gh"))
        assertNull(vietnamDate("2026-0a-02"))
    }

    @Test
    fun doesNotRollOverAnImpossibleDayLikeALenientDateParserWould() {
        // `SimpleDateFormat(lenient)` turns 2026-02-31 into 03/03/2026 — a date the
        // server never sent. The shape check renders it verbatim instead of
        // "fixing" it, because silently moving a date is worse than echoing a bad one.
        assertEquals("31/02/2026", vietnamDate("2026-02-31T00:00:00"))
    }

    @Test
    fun trimsSurroundingWhitespaceBeforeReadingTheShape() {
        assertEquals("01/04/2026", vietnamDate("  2026-04-01T00:00:00  "))
    }
}
