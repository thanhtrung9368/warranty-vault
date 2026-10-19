package com.warrly.ui.screens

import java.time.Clock
import java.time.LocalDate

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
 * ## Why `take(10)` for both wire shapes
 *
 * Two different date scalars reach this function (see the wire-date block at the
 * top of `network/Models.kt`):
 *
 *  * **calendar day** — `"2026-03-02"`, no time, no zone. This is what
 *    `purchaseDate`, `soldAt`, `receivedAt`, `activatedAt`, `extendedCoverBuyBy`,
 *    brand-warranty dates, warranty `startDate`/`endDate`, subscription dates,
 *    `WishlistItem.targetDate` and `Claim.expectedReturnAt` look like.
 *  * **RFC3339 UTC instant** — `"2026-03-02T17:04:05Z"`. This is what
 *    `expiresAt` / `createdAt` / `uploadedAt` / `brandCheckedAt` look like.
 *
 * Server-derived day fields (`effectiveWarrantyEnd`, `returnDeadline`,
 * `ActionItem.dueDate`, forecast dates) may arrive as either a plain day or a
 * midnight-UTC `Z` instant while the API migrates them; the 10-char prefix is
 * the same day in both cases.
 *
 * Both are rendered by taking the calendar date **as the server wrote it**.
 * That is deliberate:
 *
 *  * A calendar day has no instant and no offset. Parsing it with an
 *    offset-aware parser invents a timezone and can move the day (a UTC-midnight
 *    value becomes the previous/next day outside UTC); the day is already final.
 *  * For an instant, the 10-char prefix is its **UTC** day. Converting an expiry
 *    through the device's zone can show it a day late, which is the one error
 *    this screen cannot afford; the day is shown without conversion.
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

/** `"2026-03-02"` or `"2026-03-02T17:04:05Z"` → `"02/03/2026"`; malformed/blank/absent → `null`. */
internal fun vietnamDate(wire: String?): String? {
    val date = wire?.trim()?.take(10).orEmpty()
    val parts = date.split("-")
    if (parts.size != 3) return null
    val (year, month, day) = parts
    if (year.length != 4 || month.length != 2 || day.length != 2) return null
    if (parts.any { part -> part.any { !it.isDigit() } }) return null
    return "$day/$month/$year"
}

/**
 * Today, as a calendar day (`yyyy-MM-dd`) in the **user's** zone.
 *
 * Used for the default value a form offers for a date the user is entering —
 * purchase date, warranty start, claim date. It must be the device's local day:
 * the previous helper pinned `TimeZone.getTimeZone("UTC")`, so at 05:00 in
 * Vietnam (22:00 UTC the previous day) the form offered **yesterday**, and in
 * New York after 19:00 it offered tomorrow. A calendar day read off an instant in
 * the wrong zone is the same class of defect as the wire-format changes this
 * review has been about.
 *
 * A `Clock` is injectable so the rule can be pinned instead of depending on when
 * the suite runs.
 */
internal fun todayDayIso(clock: Clock = Clock.systemDefaultZone()): String =
    LocalDate.now(clock).toString()
