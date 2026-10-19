package com.warrly.widget

import com.warrly.network.UpcomingReminder
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.time.LocalDate
import java.util.Locale

/**
 * The home-screen widget's cache of the reminders feed — the pure half.
 *
 * ## Why a snapshot and not a `GET /api/v1/reminders` inside the widget
 *
 * A widget update is not an app launch: `AppWidgetProvider.onUpdate` runs in a
 * broadcast-receiver budget with no UI, and an authenticated call also needs a
 * token read plus a 30 s timeout. On a bad connection the launcher would render
 * a spinner-or-nothing surface that is worse than a stale one. So the app writes
 * this small document whenever it is foregrounded and after any write that can
 * change a warranty date; the widget only ever reads local storage.
 *
 * `GET /api/v1/reminders?withinDays=365` is the source. It already returns the
 * warranty rows (`ReminderWarranty` → [UpcomingReminder]) with the device name
 * embedded, sorted by `endDate`, filtered to ACTIVE devices and to
 * `endDate >= today`. No API change is needed for this feature — that endpoint
 * was built for exactly this feed.
 *
 * ## What is deliberately NOT stored
 *
 * Only the fields the widget draws: device id, device name and the warranty end
 * date. Prices, serials, attachments, provider names and claim terms stay in the
 * app. A home-screen widget is visible to anyone holding the phone (see the
 * privacy note in `AndroidManifest.xml` and the report), so the snapshot keeps
 * the smallest payload that can still answer "what expires next?".
 *
 * `endDate` — not a precomputed "days left" — is stored on purpose. A day count
 * captured yesterday is wrong today; the renderer recomputes it from the date
 * every time the widget repaints. The capture time is stored separately and
 * always shown, so a stale list cannot masquerade as a live one.
 */
@Serializable
data class DeadlineEntry(
    /** The device id, so a future row tap can deep-link to the detail screen. */
    val deviceId: String,
    /** The user's own label for the device. Trimmed/blank-safe at render time. */
    val deviceName: String,
    /** `YYYY-MM-DD`, exactly as the reminders feed carries it. */
    val endDate: String,
)

/**
 * The persisted widget document.
 *
 * [totalCount] is the number of upcoming rows the server returned, which can be
 * larger than [entries] because the cache is deliberately bounded (see
 * [WIDGET_MAX_STORED_ENTRIES]). Keeping the count lets the widget say "+7 more"
 * without storing rows it will never draw, and without asking the network.
 */
@Serializable
data class DeadlineSnapshot(
    /** Bump when a field changes meaning; unknown versions are ignored by the store. */
    val version: Int = DEADLINE_SNAPSHOT_VERSION,
    /** Wall-clock capture time, epoch millis. This is what the "as of" line shows. */
    val capturedAtMillis: Long,
    /** The lookahead the rows were fetched with. Displayed in the empty state. */
    val horizonDays: Int = WIDGET_HORIZON_DAYS,
    /** Upcoming rows the server returned before the local trim. */
    val totalCount: Int = 0,
    /** The first [WIDGET_MAX_STORED_ENTRIES] rows, earliest expiry first. */
    val entries: List<DeadlineEntry> = emptyList(),
)

/**
 * The JSON configuration for the snapshot.
 *
 * Kept here rather than reusing `ApiClient.json` so the widget does not drag the
 * networking object into its parser, and so an old snapshot written by a newer
 * build (an extra key) still decodes after a downgrade. `encodeDefaults = true`
 * makes the document self-describing: every field, including the version, is on
 * disk even when the value is the default.
 */
internal val SnapshotJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}

/** How far ahead the widget asks for deadlines. The endpoint's documented max. */
const val WIDGET_HORIZON_DAYS: Int = 365

/**
 * How many rows are cached.
 *
 * The widget itself draws [WIDGET_MAX_ROWS] (four); the rest exist so a resize
 * or a small change in the dates does not force a refetch, and so the "+N more"
 * line can count deadlines that were never written to `SharedPreferences`.
 * Ten is a cache bound, not a UI bound — the reminders feed can carry up to
 * 2500 rows for an account at the device ceiling, and none of that belongs in
 * `SharedPreferences`.
 */
const val WIDGET_MAX_STORED_ENTRIES: Int = 10

/** The schema version understood by this build. */
const val DEADLINE_SNAPSHOT_VERSION: Int = 1

/**
 * Maps the reminders feed to the persisted document.
 *
 * Rules, all pure and pinned by `DeadlineWidgetRulesTest`:
 *  * dismissed rows are dropped even though the caller does not ask for them
 *    (`includeDismissed` is left off) — a hidden reminder must not reappear on
 *    the home screen;
 *  * an unparseable `endDate` is dropped rather than sorted as a bogus string;
 *  * rows sort by `endDate` ascending, then by name, so the cache is stable and
 *    the widget's "next" really is the next;
 *  * the stored list is capped, and [DeadlineSnapshot.totalCount] keeps the
 *    untrimmed count for the "+N more" line.
 */
fun deadlineSnapshot(
    reminders: List<UpcomingReminder>,
    capturedAtMillis: Long,
): DeadlineSnapshot {
    val entries = reminders.asSequence()
        .filterNot { it.isDismissed }
        .mapNotNull { reminder ->
            val endDate = parseEndDate(reminder.endDate) ?: return@mapNotNull null
            DeadlineEntry(
                deviceId = reminder.device.id,
                deviceName = reminder.device.name.trim(),
                endDate = endDate.toString(),
            )
        }
        .sortedWith(
            compareBy(
                { it.endDate },
                { it.deviceName.lowercase(Locale.ROOT) },
                { it.deviceId },
            ),
        )
        .toList()

    return DeadlineSnapshot(
        capturedAtMillis = capturedAtMillis,
        totalCount = entries.size,
        entries = entries.take(WIDGET_MAX_STORED_ENTRIES),
    )
}

/**
 * Parses the wire's `YYYY-MM-DD` (or a full `YYYY-MM-DDTHH:MM:SS…`) prefix.
 *
 * `LocalDate.parse` is strict: `2026-02-31` throws instead of silently rolling
 * over, and `2026-3-2` is rejected. The `take(10)` mirrors `vietnamDate`'s
 * convention: the API writes a calendar date, and the time half (if any) is
 * never part of the deadline.
 */
internal fun parseEndDate(wire: String?): LocalDate? {
    val date = wire?.trim()?.take(10) ?: return null
    if (date.length != 10) return null
    return runCatching { LocalDate.parse(date) }.getOrNull()
}
