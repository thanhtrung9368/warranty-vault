package com.warrly.ui.screens

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
        // Calendar days (purchaseDate / soldAt / receivedAt / warranty dates…).
        assertEquals("02/03/2026", vietnamDate("2026-03-02"))
        // A derived day may still arrive as a midnight-UTC instant from an older
        // payload; the current API sends the plain day.
        assertEquals("02/03/2026", vietnamDate("2026-03-02T00:00:00Z"))
        // Real instants (share expiresAt / createdAt / lastViewedAt).
        assertEquals("02/03/2026", vietnamDate("2026-03-02T17:04:05Z"))
    }

    @Test
    fun keepsTheServersUtcDayInsteadOfConvertingTheDeviceOffset() {
        // 23:30Z is already the 3rd in Vietnam, but the value's UTC day is the
        // 2nd. This helper never converts; it reads the date the server wrote.
        // (For a real instant that is a UTC-day display choice, not a local-day
        // conversion — see WireDateShapeTest.)
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
