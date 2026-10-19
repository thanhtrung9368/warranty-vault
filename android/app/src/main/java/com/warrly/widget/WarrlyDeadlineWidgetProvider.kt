package com.warrly.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.os.Bundle
import android.util.Log

/**
 * The app's first widget provider.
 *
 * It draws the next warranty deadlines from the locally cached snapshot. It
 * performs **no network call**: the snapshot is written by the app when it is
 * foregrounded and after deadline-changing writes (see
 * `DeadlineSnapshotUpdater`), so `onUpdate` is only a preferences read plus a
 * `RemoteViews` build.
 *
 * ## Update period
 *
 * `res/xml/deadline_widget_info.xml` asks for a **six-hour** period
 * (`updatePeriodMillis = 21600000`). Reasoning:
 *
 *  * Android floors periodic widget updates at 30 minutes and batches them;
 *    it is not a free background job. A 30-minute period would be 48 wakeups a
 *    day to redraw a number that changes once a day at midnight.
 *  * The widget cannot become fresher than the snapshot anyway. The app pushes
 *    an immediate repaint when it captures a new snapshot, so the periodic
 *    update only exists to roll the day-count over and to let the "as of"
 *    footer age visibly.
 *  * Six hours bounds the visible day-count lag to a quarter of a day while
 *    costing four local repaints a day. Doze can stretch that; the footer
 *    always states the capture time, so a widget that slept is visibly a
 *    widget that slept rather than a confident lie.
 *
 * ## Security
 *
 * The receiver is `android:exported="false"`: the system can still deliver
 * `ACTION_APPWIDGET_UPDATE` explicitly, but no other app can invoke it. The
 * widget category is `home_screen` only (not keyguard) — see the privacy note in
 * the manifest.
 */
class WarrlyDeadlineWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        val snapshot = DeadlineSnapshotStore.read(context)
        appWidgetIds.forEach { id ->
            appWidgetManager.updateAppWidget(
                id,
                DeadlineWidgetRenderer.views(context, snapshot),
            )
        }
    }

    /**
     * A resize is not a data change, but the row count is fixed (at most
     * [WIDGET_MAX_ROWS]), so the only useful response is to repaint with the
     * current snapshot. Kept explicit rather than left to the default no-op so a
     * launcher that resizes does not end up with a stretched, stale bitmap.
     */
    override fun onAppWidgetOptionsChanged(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: Bundle,
    ) {
        appWidgetManager.updateAppWidget(
            appWidgetId,
            DeadlineWidgetRenderer.views(context, DeadlineSnapshotStore.read(context)),
        )
    }
}

/**
 * Repaints every placed widget from the stored snapshot.
 *
 * Called after the app writes a new capture (and after a sign-out clears it).
 * Finds the ids through the provider component, which is why adding/removing a
 * widget needs no registry of our own; zero placed widgets is a cheap no-op.
 * Safe to call from a background thread — `AppWidgetManager` marshals the
 * update, and [DeadlineSnapshotStore.read] is a small synchronous preferences
 * read.
 */
object DeadlineWidgetPublisher {

    fun updateAll(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        val ids = runCatching {
            manager.getAppWidgetIds(
                ComponentName(context, WarrlyDeadlineWidgetProvider::class.java),
            )
        }.getOrElse {
            // A missing provider is an installation/merge problem, not something
            // a background snapshot refresh should crash the app over.
            Log.w(TAG, "could not resolve widget ids", it)
            return
        }
        if (ids.isEmpty()) return

        val snapshot = DeadlineSnapshotStore.read(context)
        ids.forEach { id ->
            manager.updateAppWidget(id, DeadlineWidgetRenderer.views(context, snapshot))
        }
    }

    private const val TAG = "DeadlineWidget"
}
