package com.warrly.widget

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import com.warrly.MainActivity
import com.warrly.R
import com.warrly.i18n.AppStrings
import com.warrly.i18n.LanguageStore
import com.warrly.i18n.LocaleSupport
import com.warrly.i18n.appStrings
import com.warrly.navigation.AppDestination

/**
 * Turns a [DeadlineSnapshot] into the home-screen [RemoteViews].
 *
 * ## Why plain RemoteViews rather than Glance
 *
 * Glance is **not** a dependency of this module (checked `gradle/libs.versions.toml`
 * and `app/build.gradle.kts`), and it would be a large one for this surface: it
 * pulls the Compose runtime into every widget repaint and adds a composition
 * lifecycle that exists only to draw two text rows. Plain `RemoteViews` is
 * framework-only, has no new dependency, and is what `AppWidgetProvider` itself
 * is built around — the right size for a 4×2 glanceable list. It also keeps R8's
 * job boring: no Glance composables, no generated lambdas to keep.
 *
 * ## Localization
 *
 * The receiver process has no Activity, so `attachBaseContext` never runs for
 * it. The renderer therefore wraps the application context with the same
 * `LanguageStore` choice the UI uses and resolves every string through
 * `AppStrings`. Text is set programmatically (never left to the layout's static
 * `android:text`) so the widget follows the in-app language, not the launcher's
 * locale. The one exception is the layout's default title, which is only a
 * design-time/preview fallback and is overwritten here.
 */
object DeadlineWidgetRenderer {

    /**
     * Builds the RemoteViews for one paint.
     *
     * [nowMillis] is injectable only so a future screenshot/instrumentation test
     * could pin a day boundary; production always uses the device clock.
     */
    fun views(
        context: Context,
        snapshot: DeadlineSnapshot?,
        nowMillis: Long = System.currentTimeMillis(),
    ): RemoteViews {
        val localized = LocaleSupport.wrap(context, LanguageStore.current(context))
        val strings = localized.appStrings()
        val content = widgetContent(strings, snapshot, nowMillis)
        val views = RemoteViews(context.packageName, R.layout.warrly_deadline_widget)

        views.setTextViewText(R.id.widget_title, strings.get(R.string.widget_title))
        // The whole card is one tap target: open the app's Reminders screen,
        // which is the full version of this list.
        views.setContentDescription(R.id.widget_root, strings.get(R.string.widget_open))
        views.setOnClickPendingIntent(R.id.widget_root, openReminders(context))

        if (content.state == WidgetState.ROWS) {
            views.setViewVisibility(R.id.widget_rows, View.VISIBLE)
            views.setViewVisibility(R.id.widget_empty_title, View.GONE)
            views.setViewVisibility(R.id.widget_empty_body, View.GONE)
            bindRows(views, content.rows)
        } else {
            views.setViewVisibility(R.id.widget_rows, View.GONE)
            views.setViewVisibility(R.id.widget_empty_title, View.VISIBLE)
            views.setViewVisibility(R.id.widget_empty_body, View.VISIBLE)
            views.setTextViewText(R.id.widget_empty_title, content.emptyTitle.orEmpty())
            views.setTextViewText(R.id.widget_empty_body, content.emptyBody.orEmpty())
            // A stale empty state must not look like a live "nothing due".
            hideAllRows(views)
        }

        bindFooter(views, localized, strings, content)
        return views
    }

    private fun bindRows(views: RemoteViews, rows: List<WidgetRow>) {
        ROW_SLOTS.forEachIndexed { index, slot ->
            val row = rows.getOrNull(index)
            if (row == null) {
                views.setViewVisibility(slot.container, View.GONE)
            } else {
                views.setViewVisibility(slot.container, View.VISIBLE)
                views.setTextViewText(slot.name, row.deviceName)
                views.setTextViewText(slot.days, row.daysLabel)
            }
        }
    }

    private fun hideAllRows(views: RemoteViews) {
        ROW_SLOTS.forEach { views.setViewVisibility(it.container, View.GONE) }
    }

    private fun bindFooter(
        views: RemoteViews,
        localized: Context,
        strings: AppStrings,
        content: WidgetContent,
    ) {
        val footer = content.footer
        if (footer == null) {
            views.setViewVisibility(R.id.widget_footer, View.GONE)
        } else {
            views.setViewVisibility(R.id.widget_footer, View.VISIBLE)
            views.setTextViewText(R.id.widget_footer, footer)
            val colorRes = if (content.freshness == SnapshotFreshness.FRESH) {
                R.color.widget_muted
            } else {
                R.color.widget_stale
            }
            views.setTextColor(R.id.widget_footer, ContextCompat.getColor(localized, colorRes))
        }

        if (content.moreCount > 0) {
            views.setViewVisibility(R.id.widget_more, View.VISIBLE)
            views.setTextViewText(
                R.id.widget_more,
                strings.quantity(
                    R.plurals.widget_more_deadlines,
                    content.moreCount,
                    content.moreCount,
                ),
            )
        } else {
            views.setViewVisibility(R.id.widget_more, View.GONE)
        }
    }

    /**
     * Tapping the widget opens the app on the Reminders tab.
     *
     * `CLEAR_TOP | SINGLE_TOP` matches `MainActivity`'s `launchMode="singleTop"`:
     * an app already open is brought forward and receives the destination in
     * `onNewIntent` instead of a second Compose shell being stacked on top.
     * `FLAG_IMMUTABLE` is required on API 23+ and correct for a fixed intent.
     */
    private fun openReminders(context: Context): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(AppDestination.EXTRA, AppDestination.Reminders.wire)
        }
        return PendingIntent.getActivity(
            context,
            REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private const val REQUEST_CODE = 7_301

    /** The three view slots the layout provides, in drawing order. */
    private data class RowSlot(val container: Int, val name: Int, val days: Int)

    private val ROW_SLOTS = listOf(
        RowSlot(R.id.widget_row_1, R.id.widget_name_1, R.id.widget_days_1),
        RowSlot(R.id.widget_row_2, R.id.widget_name_2, R.id.widget_days_2),
    )
}
