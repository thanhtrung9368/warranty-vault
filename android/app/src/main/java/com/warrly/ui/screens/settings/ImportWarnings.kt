package com.warrly.ui.screens.settings

/**
 * The warnings that belong on screen after a restore.
 *
 * The API omits `warnings` entirely for a clean, self-describing backup, so a
 * normal import must show nothing extra. It may also (now or later) keep the
 * key with a blank entry; a blank line would draw an empty orange card with no
 * text, which is worse than no card. Both cases collapse to an empty list here.
 *
 * Messages are kept byte-for-byte — not trimmed, reordered or re-worded. They
 * are already localized by the server (the client sends `Accept-Language` from
 * the UI language) and rendered as plain `Text`, so there is exactly one copy
 * of the sentence and no second translation that could drift from what the API
 * means.
 *
 * Deliberately pure: the JVM test pins the "show" and "show nothing" sides of
 * the rule without Robolectric. Whether the card is *visible* on a phone (colour
 * contrast, and being pinned above the scrolling content rather than below the
 * fold) is only verifiable by screenshot.
 */
fun importWarningsForDisplay(warnings: List<String>): List<String> =
    warnings.filter { it.isNotBlank() }
