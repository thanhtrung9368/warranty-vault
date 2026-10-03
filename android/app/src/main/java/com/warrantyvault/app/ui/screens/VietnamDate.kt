package com.warrantyvault.app.ui.screens

/**
 * The app's one date-display convention: `dd/MM/yyyy`.
 *
 * This lived in `devices/DeviceReturnWindow.kt` as `returnDeadlineLabel` and is
 * lifted here because two more features now need the same rule — the handover
 * certificate's expiry (#2) and the warranty directory's coverage end (#15) —
 * and three copies of a date rule is how three clients end up disagreeing.
 * `export/CsvExport.kt` already formats dates this way for the same reason
 * (vi-VN Excel reads `dd/MM/yyyy`), so this is the convention, not a new one.
 *
 * ## Why `take(10)` and never an instant-parse
 *
 * Two different wire shapes reach this function:
 *
 *  * **naive UTC** — `"2026-03-02T00:00:00"`, no `Z`, no offset. This is what
 *    `purchaseDate`, `soldAt`, `receivedAt` and `returnDeadline` look like.
 *  * **RFC3339 UTC** — `"2026-03-02T17:04:05Z"`. This is what `expiresAt` /
 *    `createdAt` / `lastViewedAt` on a share link look like.
 *
 * Both are rendered by taking the calendar date **as the server wrote it**.
 * That is deliberate:
 *
 *  * For the naive values, an offset-aware parse is simply wrong — it would move
 *    the day (23:30Z becomes the 3rd in Vietnam) for a value that never had a
 *    timezone to begin with.
 *  * For the RFC3339 values the day is already the server's UTC day, and an
 *    expiry shown a day late would be the one error this screen cannot afford.
 *
 * So: never invent a date, never guess one, and return `null` rather than a
 * half-parsed string when the value is not a well-formed `YYYY-MM-DD...`.
 *
 * ## Why a string, not a `SimpleDateFormat`
 *
 * A `SimpleDateFormat` on a malformed value either throws or (with `lenient`)
 * silently rolls `2026-02-31` over to 3 March. The wire is a fixed
 * `YYYY-MM-DD` prefix, so this checks that shape exactly and gives up otherwise.
 */

/** `"2026-03-02T00:00:00"` → `"02/03/2026"`; malformed/blank/absent → `null`. */
internal fun vietnamDate(wire: String?): String? {
    val date = wire?.trim()?.take(10).orEmpty()
    val parts = date.split("-")
    if (parts.size != 3) return null
    val (year, month, day) = parts
    if (year.length != 4 || month.length != 2 || day.length != 2) return null
    if (parts.any { part -> part.any { !it.isDigit() } }) return null
    return "$day/$month/$year"
}
