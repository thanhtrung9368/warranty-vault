package com.warrantyvault.app.ui.screens.search

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The two rules of the global search box that are easy to get wrong: a blank
 * query is not an error, and "200" is counted in runes (what the Go service
 * counts) rather than UTF-16 units (what `String.length` counts).
 */
class SearchQueryTest {

    @Test
    fun blankAndWhitespaceOnlyQueriesStayValidAndNormalizeToEmpty() {
        assertEquals("", SearchQuery.normalize(""))
        assertEquals("", SearchQuery.normalize("   "))
        assertEquals("", SearchQuery.normalize("\n\t "))

        // A blank query is what the server answers with 200 + empty groups, so
        // the client must never treat it as invalid.
        assertNull(SearchQuery.error(""))
        assertNull(SearchQuery.error("   "))
    }

    @Test
    fun normalizeTrimsTheEndsAndKeepsInnerSpaces() {
        assertEquals("samsung cloud", SearchQuery.normalize("  samsung cloud  "))
        assertEquals("Điện thoại", SearchQuery.normalize("\tĐiện thoại\n"))
    }

    @Test
    fun twoHundredRunesIsAllowedAndTwoHundredAndOneIsRefused() {
        val atLimit = "a".repeat(SearchQuery.MAX_RUNES)
        val overLimit = "a".repeat(SearchQuery.MAX_RUNES + 1)

        assertNull(SearchQuery.error(atLimit))
        assertEquals(SearchQuery.TOO_LONG_MESSAGE, SearchQuery.error(overLimit))
    }

    @Test
    fun maxRunesAreCountedPerCodePointNotPerUtf16Unit() {
        // One emoji is 2 UTF-16 units but a single rune — `String.length` would
        // reject a 101-emoji keyword the server happily accepts.
        val emoji = "😀"
        assertEquals(2, emoji.length)
        assertEquals(1, SearchQuery.runeCount(emoji))

        val atLimit = emoji.repeat(SearchQuery.MAX_RUNES)
        assertEquals(2 * SearchQuery.MAX_RUNES, atLimit.length)
        assertNull(SearchQuery.error(atLimit))
        assertEquals(SearchQuery.TOO_LONG_MESSAGE, SearchQuery.error(emoji.repeat(SearchQuery.MAX_RUNES + 1)))
    }

    @Test
    fun vietnameseDiacriticsCountAsOneRuneEach() {
        // Precomposed NFC, what the Android keyboard and the API send: "Điện
        // thoại" is 10 code points even though it looks longer.
        assertEquals(10, SearchQuery.runeCount("Điện thoại"))
        assertNull(SearchQuery.error("Điện thoại"))
    }

    @Test
    fun theLengthIsMeasuredAfterTrimming() {
        val padded = "  " + "a".repeat(SearchQuery.MAX_RUNES) + "   "
        assertNull("surrounding spaces are not part of the keyword", SearchQuery.error(padded))
        assertEquals(
            SearchQuery.TOO_LONG_MESSAGE,
            SearchQuery.error("  " + "a".repeat(SearchQuery.MAX_RUNES + 1) + "  "),
        )
    }

    @Test
    fun theTooLongMessageUsesTheServersWording() {
        // Mirrors services.Search: "Từ khoá tìm kiếm quá dài (tối đa %d ký tự)".
        assertEquals("Từ khoá tìm kiếm quá dài (tối đa 200 ký tự)", SearchQuery.TOO_LONG_MESSAGE)
    }

    @Test
    fun debounceMatchesThePerListFilterBars() {
        assertEquals(300L, SearchQuery.DEBOUNCE_MS)
    }
}
