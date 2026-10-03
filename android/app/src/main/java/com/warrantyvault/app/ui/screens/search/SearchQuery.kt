package com.warrantyvault.app.ui.screens.search

/**
 * Pure rules for the global search box (`GET /api/v1/search`).
 *
 * Kept out of the composable so the two things that are easy to get wrong are
 * unit-tested instead of eyeballed:
 *
 *  1. **A blank query is not an error.** `q=` (or only spaces) returns 200 with
 *     three empty groups — deleting the last character of a search box must not
 *     paint a red banner. [normalize] is what decides "blank".
 *  2. **200 is counted in runes, not `String.length`.** The server bounds `q`
 *     with `utf8.RuneCountInString` (`services.MaxSearchQueryRunes`), so a
 *     Vietnamese string with combining marks or an emoji would be rejected by
 *     us too early if we counted UTF-16 units — one emoji is `length == 2` but
 *     a single rune.
 */
object SearchQuery {

    /** Same debounce as the per-list filter bars (`DevicesScreen`): 300 ms. */
    const val DEBOUNCE_MS = 300L

    /** Mirrors `services.MaxSearchQueryRunes`; over this the server answers 400. */
    const val MAX_RUNES = 200

    /**
     * The server's own copy for an over-long keyword
     * (`services.Search`: "Từ khoá tìm kiếm quá dài (tối đa %d ký tự)").
     * Surfaced before firing a request that is known to 400.
     */
    const val TOO_LONG_MESSAGE = "Từ khoá tìm kiếm quá dài (tối đa $MAX_RUNES ký tự)"

    /** The keyword as it goes on the wire — the server trims too. */
    fun normalize(raw: String): String = raw.trim()

    /** Unicode code points, the same unit the Go server counts. */
    fun runeCount(value: String): Int = value.codePointCount(0, value.length)

    /**
     * `null` when [raw] is safe to send, else the Vietnamese message to show.
     * A blank query is always valid — it just has nothing to search for.
     */
    fun error(raw: String): String? =
        if (runeCount(normalize(raw)) > MAX_RUNES) TOO_LONG_MESSAGE else null
}
