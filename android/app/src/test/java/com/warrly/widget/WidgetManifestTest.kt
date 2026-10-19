package com.warrly.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * The OS-level half of the widget, pinned as XML.
 *
 * There is no emulator in this environment, so the widget has never been placed
 * on a home screen. The next best proof is that the pieces the launcher reads
 * are wired correctly: the receiver exists with the right action and metadata,
 * the provider info carries the sizing / period / preview, and the widget
 * category excludes the keyguard. A mistake in any of those is invisible to the
 * Kotlin compiler and would only show up as "the widget does not appear in the
 * picker" on a device.
 */
class WidgetManifestTest {

    private val androidNs = "http://schemas.android.com/apk/res/android"

    // ---- manifest wiring ----

    @Test
    fun theWidgetReceiverIsDeclaredAndNotExported() {
        val receiver = receiver(".widget.WarrlyDeadlineWidgetProvider")

        assertEquals(
            "the system delivers APPWIDGET_UPDATE explicitly; no other app should be able to",
            "false",
            receiver.attr("exported"),
        )
        assertEquals("@string/widget_name", receiver.attr("label"))

        val actions = receiver.children("intent-filter")
            .flatMap { it.children("action") }
            .map { it.attr("name") }
        assertTrue(
            "the receiver must listen for android.appwidget.action.APPWIDGET_UPDATE",
            "android.appwidget.action.APPWIDGET_UPDATE" in actions,
        )

        val providerMeta = receiver.children("meta-data")
            .firstOrNull { it.attr("name") == "android.appwidget.provider" }
        assertNotNull(
            "the provider metadata is what makes the receiver a widget at all",
            providerMeta,
        )
        assertEquals("@xml/deadline_widget_info", providerMeta!!.attr("resource"))
    }

    @Test
    fun mainActivityDeclaresTheShortcutsResource() {
        val activity = mainActivity()
        val metas = activity.children("meta-data")
            .filter { it.attr("name") == "android.app.shortcuts" }

        assertEquals("one shortcuts metadata, not two", 1, metas.size)
        assertEquals("@xml/shortcuts", metas.single().attr("resource"))
    }

    @Test
    fun thereIsExactlyOneWidgetProviderInTheAppManifest() {
        val receivers = manifest().getElementsByTagName("receiver")
        val widgetReceivers = (0 until receivers.length)
            .map { receivers.item(it) as Element }
            .filter { receiver ->
                receiver.children("intent-filter").any { filter ->
                    filter.children("action").any {
                        it.attr("name") == "android.appwidget.action.APPWIDGET_UPDATE"
                    }
                }
            }

        assertEquals("the first widget must not be declared twice", 1, widgetReceivers.size)
    }

    // ---- AppWidgetProviderInfo ----

    @Test
    fun providerInfoDeclaresSizingPeriodPreviewAndTheLayout() {
        val info = appWidgetInfo()

        assertEquals("@layout/warrly_deadline_widget", info.attr("initialLayout"))
        assertEquals("@drawable/widget_preview", info.attr("previewImage"))
        assertEquals("@string/widget_description", info.attr("description"))

        assertEquals("250dp", info.attr("minWidth"))
        assertEquals("110dp", info.attr("minHeight"))
        assertEquals("4", info.attr("targetCellWidth"))
        assertEquals("2", info.attr("targetCellHeight"))
    }

    @Test
    fun updatePeriodIsSixHours() {
        // Android floors widget updates at 30 minutes and batches them; the
        // widget cannot be fresher than the snapshot anyway. Six hours is four
        // local repaints a day — enough to roll a day count at midnight without
        // pretending a widget is a free background job. See the comment in
        // `WarrlyDeadlineWidgetProvider`.
        assertEquals("21600000", appWidgetInfo().attr("updatePeriodMillis"))
    }

    @Test
    fun theWidgetIsHomeScreenOnlyNotKeyguard() {
        val categories = appWidgetInfo().attr("widgetCategory")
            .split('|')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .toSet()

        assertEquals(
            "a deadline list with device names is not lock-screen content",
            setOf("home_screen"),
            categories,
        )
        assertFalse("keyguard must not be offered", "keyguard" in categories)
    }

    @Test
    fun thePreviewPngActuallyExists() {
        val preview = resourceFile("drawable-nodpi/widget_preview.png")
        assertTrue("preview file is missing: $preview", preview.isFile)
        assertTrue("preview file is empty", preview.length() > 1_000)
    }

    // ---- layout: the content must fill the card ----

    @Test
    fun theRowSlotsFillTheHeightTheWidgetDeclares() {
        val layout = parse(resourceFile("layout/warrly_deadline_widget.xml"))

        val rows = requireNotNull(byId(layout, "@+id/widget_rows")) {
            "widget_rows container is missing"
        }
        assertEquals("the row area takes the card's free height", "0dp", rows.attr("layout_height"))
        assertEquals("the row area takes the card's free height", "1", rows.attr("layout_weight"))

        for (index in 1..WIDGET_MAX_ROWS) {
            val row = requireNotNull(byId(layout, "@+id/widget_row_$index")) {
                "widget_row_$index must exist for WIDGET_MAX_ROWS=$WIDGET_MAX_ROWS"
            }
            // A missing row slot was the original bug: the container had the
            // weight, the rows were wrap_content, and the leftover height became
            // a blank hole under the last row. A weighted 0dp child makes the
            // visible rows split the card, whether there is one of them or four.
            assertEquals("row $index must fill, not wrap", "0dp", row.attr("layout_height"))
            assertEquals("row $index must share the free height", "1", row.attr("layout_weight"))
            assertEquals(
                "row $index must centre its text in the height it owns",
                "center_vertical",
                row.attr("gravity"),
            )
        }

        // A fifth slot would be drawn with weight but never bound by
        // DeadlineWidgetRenderer.ROW_SLOTS, leaving an empty strip.
        assertNull(
            "no row slot beyond WIDGET_MAX_ROWS",
            byId(layout, "@+id/widget_row_${WIDGET_MAX_ROWS + 1}"),
        )

        // The "no other deadlines" filler is the fifth weighted child when it
        // is visible: it owns exactly one row's worth of height, so a one-row
        // account fills the card instead of leaving a hole.
        val note = requireNotNull(byId(layout, "@+id/widget_note")) {
            "widget_note filler is missing"
        }
        assertEquals("the note must fill one row slot", "0dp", note.attr("layout_height"))
        assertEquals("the note must fill one row slot", "1", note.attr("layout_weight"))
    }

    @Test
    fun theEmptyStateAlsoGetsTheFreeHeight() {
        val layout = parse(resourceFile("layout/warrly_deadline_widget.xml"))

        val empty = requireNotNull(byId(layout, "@+id/widget_empty")) {
            "widget_empty container is missing"
        }
        assertEquals("the empty state must not be stranded under the title", "0dp", empty.attr("layout_height"))
        assertEquals("the empty state must not be stranded under the title", "1", empty.attr("layout_weight"))
        assertEquals("center_vertical", empty.attr("gravity"))
    }

    // ---- reading resources ----

    private fun manifest(): Element = parse(resourceFile("../AndroidManifest.xml"))

    private fun mainActivity(): Element {
        val activities = manifest().getElementsByTagName("activity")
        for (i in 0 until activities.length) {
            val activity = activities.item(i) as? Element ?: continue
            if (activity.attr("name") == ".MainActivity") return activity
        }
        throw AssertionError("no .MainActivity in AndroidManifest.xml")
    }

    private fun receiver(name: String): Element {
        val receivers = manifest().getElementsByTagName("receiver")
        for (i in 0 until receivers.length) {
            val receiver = receivers.item(i) as? Element ?: continue
            if (receiver.attr("name") == name) return receiver
        }
        throw AssertionError("no <receiver android:name=\"$name\"> in AndroidManifest.xml")
    }

    private fun appWidgetInfo(): Element = parse(resourceFile("xml/deadline_widget_info.xml"))

    /** Depth-first lookup of an `android:id="@+id/…"` in a layout. */
    private fun byId(root: Element, id: String): Element? {
        if (root.attr("id") == id) return root
        for (i in 0 until root.childNodes.length) {
            val child = root.childNodes.item(i) as? Element ?: continue
            byId(child, id)?.let { return it }
        }
        return null
    }

    private fun parse(file: File): Element =
        DocumentBuilderFactory.newInstance()
            .apply { isNamespaceAware = true }
            .newDocumentBuilder()
            .parse(file)
            .documentElement

    private fun resourceFile(relative: String): File {
        val direct = listOf(
            File("src/main/res/$relative"),
            File("app/src/main/res/$relative"),
            File("android/app/src/main/res/$relative"),
            File("src/main/$relative"),
            File("app/src/main/$relative"),
            File("android/app/src/main/$relative"),
        )
        direct.firstOrNull { it.isFile }?.let { return it }

        var dir: File? = File(".").absoluteFile
        while (dir != null) {
            listOf(
                File(dir, "android/app/src/main/res/$relative"),
                File(dir, "android/app/src/main/$relative"),
            ).firstOrNull { it.isFile }?.let { return it }
            dir = dir.parentFile
        }
        throw AssertionError("$relative not found from ${File(".").absolutePath}")
    }

    private fun Element.children(tag: String): List<Element> {
        val out = mutableListOf<Element>()
        for (i in 0 until childNodes.length) {
            val el = childNodes.item(i) as? Element ?: continue
            if (el.tagName == tag) out += el
        }
        return out
    }

    private fun Element.attr(name: String): String = getAttributeNS(androidNs, name)
}
