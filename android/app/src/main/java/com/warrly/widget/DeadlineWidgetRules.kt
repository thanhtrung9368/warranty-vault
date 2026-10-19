package com.warrly.widget

import com.warrly.R
import com.warrly.i18n.AppStrings
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * Everything the widget *decides*, without a `Context`, a `RemoteViews` or a
 * clock.
 *
 * The same seam the rest of the app uses for screen copy (`InboxRules.kt`,
 * `ClaimRules.kt`, `WarrantyTerms.kt`): take [AppStrings] plus plain values,
 * return plain values, and let a JVM test pin both languages through
 * `ResCatalog` without Robolectric. `DeadlineWidgetRenderer` is then only the
 * Android glue that copies this result into view ids.
 *
 * Four rules live here, one per thing the report asks to be pure:
 *  1. **The snapshot shape** — `deadlineSnapshot()` in `DeadlineSnapshot.kt`.
 *  2. **The "as of" copy** — [asOfLabel] plus [snapshotFreshness].
 *  3. **The days-remaining labels** — [daysLabel] (`today` / `tomorrow` /
 *     plural).
 *  4. **The empty state** — [widgetContent] returns one of three states so the
 *     renderer never has to guess what a blank list means.
 */

/** How many rows the home-screen layout has room for. */
const val WIDGET_MAX_ROWS: Int = 2

/**
 * A snapshot younger than this is rendered without a warning.
 *
 * The widget's update period is six hours, so a capture under a day old is the
 * normal case. At or above this age the footer says "Stale · as of …" instead of
 * a bare timestamp: the user is holding a phone, and the only thing a widget can
 * honestly claim is when its data was captured.
 */
const val STALE_AFTER_MILLIS: Long = 24L * 60L * 60L * 1000L

/**
 * A week-old capture is no longer "a bit behind": it gets a sentence that tells
 * the user what to do, and the footer switches to the warning colour.
 */
const val OLD_AFTER_MILLIS: Long = 7L * 24L * 60L * 60L * 1000L

/** The three things a snapshot's age can mean to the widget. */
enum class SnapshotFreshness {
    /** Captured less than [STALE_AFTER_MILLIS] ago. */
    FRESH,

    /** Captured between [STALE_AFTER_MILLIS] and [OLD_AFTER_MILLIS] ago. */
    STALE,

    /** Captured at least [OLD_AFTER_MILLIS] ago. */
    OLD,
}

/** Which surface the widget should draw. */
enum class WidgetState {
    /** Nothing has ever been captured (fresh install, signed out, cleared). */
    NO_SNAPSHOT,

    /** A snapshot exists but has no deadline left inside it. */
    EMPTY,

    /** One or two deadline rows. */
    ROWS,
}

/** One rendered row: the device label and the localized day count. */
data class WidgetRow(
    val deviceName: String,
    val daysLabel: String,
)

/**
 * The complete, already-localized description of one widget paint.
 *
 * [emptyTitle]/[emptyBody] are non-null only for [WidgetState.NO_SNAPSHOT] and
 * [WidgetState.EMPTY]; [footer] is non-null whenever a snapshot exists (even an
 * empty one), because "when was this captured" is always part of the answer.
 */
data class WidgetContent(
    val state: WidgetState,
    val rows: List<WidgetRow> = emptyList(),
    /** Upcoming deadlines beyond the rows drawn, for the "+N more" line. */
    val moreCount: Int = 0,
    val emptyTitle: String? = null,
    val emptyBody: String? = null,
    val footer: String? = null,
    val freshness: SnapshotFreshness? = null,
)

/**
 * How old a capture is, with future timestamps treated as fresh.
 *
 * A device clock can be behind the server's (or the capture can be written a few
 * seconds ahead during a manual clock change); a negative age is not a reason to
 * show "stale", so it degrades to [SnapshotFreshness.FRESH].
 */
fun snapshotFreshness(capturedAtMillis: Long, nowMillis: Long): SnapshotFreshness {
    val age = nowMillis - capturedAtMillis
    return when {
        age < STALE_AFTER_MILLIS -> SnapshotFreshness.FRESH
        age < OLD_AFTER_MILLIS -> SnapshotFreshness.STALE
        else -> SnapshotFreshness.OLD
    }
}

/**
 * Whole calendar days from [today] to [endDate], or `null` when the date is not
 * a real `YYYY-MM-DD`.
 *
 * `ChronoUnit.DAYS` on two `LocalDate`s is exact across DST and time zones: the
 * wire date is a calendar date, and the widget shows calendar days — not
 * "24-hour periods". `0` means today, `1` tomorrow.
 */
fun daysRemaining(endDate: String, today: LocalDate): Int? {
    val date = parseEndDate(endDate) ?: return null
    return ChronoUnit.DAYS.between(today, date).toInt()
}

/**
 * The trailing label for a row.
 *
 * `0` and `1` get named days rather than "0 days left" / "1 day left" — a
 * deadline that is today reads better as "today" — and everything else goes
 * through the plural so English never says "1 days" and Vietnamese never needs
 * an `one` form it does not inflect.
 *
 * Negative values are not rendered by [widgetContent] (expired rows are
 * filtered), but they are still handled by the plural so a future caller cannot
 * crash on a count the UI never expected.
 */
fun daysLabel(s: AppStrings, days: Int): String = when (days) {
    0 -> s.get(R.string.widget_expires_today)
    1 -> s.get(R.string.widget_expires_tomorrow)
    else -> s.quantity(R.plurals.widget_days_left, days, days)
}

/**
 * The "as of …" footer.
 *
 * It is rendered **whenever** a snapshot exists, not only once it is old: the
 * widget cannot prove liveness, so the capture time is the one honest signal it
 * has. When the snapshot crosses [STALE_AFTER_MILLIS] the wording adds "Stale",
 * and after [OLD_AFTER_MILLIS] it tells the user to open the app.
 *
 * The timestamp is local time in [zoneId], `dd/MM HH:mm` while the capture is in
 * the current year and `dd/MM/yyyy HH:mm` otherwise — a date without a year on
 * a January widget would be a lie about a December capture.
 */
fun asOfLabel(
    s: AppStrings,
    capturedAtMillis: Long,
    nowMillis: Long,
    zoneId: ZoneId,
): String {
    val captured = Instant.ofEpochMilli(capturedAtMillis).atZone(zoneId)
    val now = Instant.ofEpochMilli(nowMillis).atZone(zoneId)
    val pattern = if (captured.year == now.year) "dd/MM HH:mm" else "dd/MM/yyyy HH:mm"
    val stamp = DateTimeFormatter.ofPattern(pattern, Locale.ROOT).format(captured)
    return when (snapshotFreshness(capturedAtMillis, nowMillis)) {
        SnapshotFreshness.FRESH -> s.get(R.string.widget_as_of, stamp)
        SnapshotFreshness.STALE -> s.get(R.string.widget_stale_as_of, stamp)
        SnapshotFreshness.OLD -> s.get(R.string.widget_old_as_of, stamp)
    }
}

/**
 * Turns a snapshot into what the widget paints.
 *
 * * no snapshot -> [WidgetState.NO_SNAPSHOT] and copy that tells the user to
 *   open the app once;
 * * snapshot, but nothing upcoming -> [WidgetState.EMPTY] plus the capture time,
 *   so an empty widget is still distinguishable from an unrefreshed one;
 * * rows -> the next [WIDGET_MAX_ROWS] by day count, with [WidgetContent.moreCount]
 *   for the rest.
 *
 * Rows whose `endDate` has passed since the capture are dropped: the snapshot is
 * a cache, and the widget must not show "3 days left" for a warranty that ended
 * last week. The footer then carries the honesty — the list is as old as the
 * capture says it is.
 *
 * [nowMillis] is the only clock input; [zoneId] defaults to the device zone but
 * is explicit so the JVM tests can pin a fixed day boundary.
 */
fun widgetContent(
    s: AppStrings,
    snapshot: DeadlineSnapshot?,
    nowMillis: Long,
    zoneId: ZoneId = ZoneId.systemDefault(),
): WidgetContent {
    if (snapshot == null) {
        return WidgetContent(
            state = WidgetState.NO_SNAPSHOT,
            emptyTitle = s.get(R.string.widget_no_data_title),
            emptyBody = s.get(R.string.widget_no_data_body),
        )
    }

    val now = Instant.ofEpochMilli(nowMillis).atZone(zoneId)
    val today = now.toLocalDate()
    val footer = asOfLabel(s, snapshot.capturedAtMillis, nowMillis, zoneId)
    val freshness = snapshotFreshness(snapshot.capturedAtMillis, nowMillis)

    val upcoming = snapshot.entries
        .mapNotNull { entry ->
            val days = daysRemaining(entry.endDate, today) ?: return@mapNotNull null
            if (days < 0) return@mapNotNull null
            entry to days
        }
        .sortedWith(compareBy({ it.second }, { it.first.deviceName.lowercase(Locale.ROOT) }))

    if (upcoming.isEmpty()) {
        return WidgetContent(
            state = WidgetState.EMPTY,
            emptyTitle = s.get(R.string.widget_empty_title),
            emptyBody = s.get(R.string.widget_empty_body),
            footer = footer,
            freshness = freshness,
        )
    }

    val rows = upcoming.take(WIDGET_MAX_ROWS).map { (entry, days) ->
        WidgetRow(
            deviceName = entry.deviceName.ifBlank { s.get(R.string.widget_unnamed_device) },
            daysLabel = daysLabel(s, days),
        )
    }

    // The untrimmed count is the server's, minus the cached rows that expired
    // since capture. That keeps "+N more" honest even though only ten rows are
    // on disk. `totalCount` defaults to 0 on a hand-written/older snapshot, in
    // which case the cached size is the best available bound.
    val expiredCached = snapshot.entries.size - upcoming.size
    val knownTotal = snapshot.totalCount.takeIf { it >= snapshot.entries.size }
        ?: snapshot.entries.size
    val upcomingTotal = (knownTotal - expiredCached).coerceAtLeast(upcoming.size)
    val moreCount = (upcomingTotal - rows.size).coerceAtLeast(0)

    return WidgetContent(
        state = WidgetState.ROWS,
        rows = rows,
        moreCount = moreCount,
        footer = footer,
        freshness = freshness,
    )
}
