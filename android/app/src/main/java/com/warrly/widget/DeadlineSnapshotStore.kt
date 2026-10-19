package com.warrly.widget

import android.content.Context
import androidx.core.content.edit

/**
 * The widget snapshot on disk.
 *
 * ## SharedPreferences, not DataStore or a file
 *
 * DataStore is not a dependency of this app, and adding it for one small object
 * (two strings plus one timestamp per row, bounded at ten rows) would be a new
 * runtime + coroutine-flow dependency for a value read by an `AppWidgetProvider`
 * on the main thread. A private `SharedPreferences` file is atomic on write,
 * already the pattern for the other non-secret preferences (`LanguageStore`,
 * `ThemeStore`), and reads synchronously in microseconds — which is exactly what
 * an `onUpdate` broadcast wants. The JSON lives under one key, so a schema bump
 * is a one-key migration rather than a file-layout problem.
 *
 * This class is deliberately tiny and untested: it is `SharedPreferences` plus
 * `kotlinx.serialization`, both already exercised elsewhere. The part that
 * matters — what the document means and how it is rendered — is in
 * `DeadlineSnapshot.kt` / `DeadlineWidgetRules.kt` and is JVM-tested.
 */
object DeadlineSnapshotStore {

    private const val PREFS_NAME = "wv_deadline_widget"
    private const val KEY_SNAPSHOT = "deadline_snapshot"

    /**
     * Reads the last capture, or `null` when nothing has been captured (fresh
     * install, signed out, cleared) or the stored document is unreadable.
     *
     * A corrupt/older/future document is treated as "no snapshot" rather than
     * throwing inside a broadcast receiver: the widget then shows the
     * open-the-app state, which is truthful and recoverable. An unknown future
     * version is refused for the same reason — rendering a document whose fields
     * changed meaning is worse than an empty state.
     */
    fun read(context: Context): DeadlineSnapshot? {
        val raw = prefs(context).getString(KEY_SNAPSHOT, null) ?: return null
        val snapshot = runCatching {
            SnapshotJson.decodeFromString(DeadlineSnapshot.serializer(), raw)
        }.getOrNull() ?: return null
        return snapshot.takeIf { it.version == DEADLINE_SNAPSHOT_VERSION }
    }

    /**
     * Replaces the capture.
     *
     * `apply()` (not `commit`) is used because the caller is already on
     * `App.ioScope`: the in-memory value is visible to the widget repaint that
     * follows immediately, and the disk flush does not block the background
     * thread waiting on the filesystem.
     */
    fun write(context: Context, snapshot: DeadlineSnapshot) {
        prefs(context).edit {
            putString(KEY_SNAPSHOT, SnapshotJson.encodeToString(DeadlineSnapshot.serializer(), snapshot))
        }
    }

    /** Drops the capture — sign-out, or a session that no longer validates. */
    fun clear(context: Context) {
        prefs(context).edit { remove(KEY_SNAPSHOT) }
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
