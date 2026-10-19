package com.warrly.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * The outside-the-app entry contract: the extra's wire values, the
 * recreation rule, and the `shortcuts.xml` file that has to agree with both.
 *
 * `AppDestination` itself is trivial; the failure it prevents is not. A typo in
 * `shortcuts.xml` (`inboxx`, or a misspelled extra name) produces a shortcut
 * that opens the app on the Dashboard and silently ignores the request — there
 * is no compile error, and no device in this environment to notice. Reading the
 * resource here makes that typo a red test instead.
 */
class AppDestinationTest {

    private val androidNs = "http://schemas.android.com/apk/res/android"

    @Test
    fun wireValuesAreTheStableContract() {
        assertEquals("add_device", AppDestination.AddDevice.wire)
        assertEquals("inbox", AppDestination.Inbox.wire)
        assertEquals("reminders", AppDestination.Reminders.wire)
        assertEquals("com.warrly.extra.DESTINATION", AppDestination.EXTRA)
    }

    @Test
    fun parsingAcceptsKnownValuesAndIgnoresEverythingElse() {
        assertEquals(AppDestination.AddDevice, AppDestination.fromWire("add_device"))
        assertEquals(AppDestination.Inbox, AppDestination.fromWire("  inbox  "))
        assertNull(AppDestination.fromWire("inboxx"))
        assertNull(AppDestination.fromWire("ADD_DEVICE"))
        assertNull(AppDestination.fromWire(""))
        assertNull(AppDestination.fromWire(null))
    }

    @Test
    fun aRecreatedActivityDoesNotReplayTheLaunchDestination() {
        assertEquals(
            AppDestination.Inbox,
            AppDestination.fromSavedState("inbox", fromSavedState = false),
        )
        assertNull(
            "a rotation must not yank the user back to the inbox",
            AppDestination.fromSavedState("inbox", fromSavedState = true),
        )
    }

    @Test
    fun everyShortcutExtraMapsToAnAppDestination() {
        val shortcuts = shortcutsElement().children("shortcut")
        assertEquals(2, shortcuts.size)

        val destinations = shortcuts.flatMap { shortcut ->
            shortcut.children("intent").flatMap { intent ->
                intent.children("extra").map { extra ->
                    assertEquals(
                        "the extra key must match AppDestination.EXTRA",
                        AppDestination.EXTRA,
                        extra.attr("name"),
                    )
                    val wire = extra.attr("value")
                    assertNotNull(
                        "shortcuts.xml names destination `$wire`, which AppDestination does not know",
                        AppDestination.fromWire(wire),
                    )
                    AppDestination.fromWire(wire)!!
                }
            }
        }.toSet()

        assertEquals(
            setOf(AppDestination.AddDevice, AppDestination.Inbox),
            destinations,
        )
    }

    @Test
    fun shortcutsTargetTheExistingMainActivity() {
        shortcutsElement().children("shortcut").forEach { shortcut ->
            val intents = shortcut.children("intent")
            assertEquals(1, intents.size)
            val intent = intents.single()
            assertEquals("com.warrly.MainActivity", intent.attr("targetClass"))
            assertEquals("com.warrly", intent.attr("targetPackage"))
            assertEquals("android.intent.action.VIEW", intent.attr("action"))
        }
    }

    @Test
    fun shortcutIdsAreUniqueAndLabelsAreLocalizedResources() {
        val shortcuts = shortcutsElement().children("shortcut")
        val ids = shortcuts.map { it.attr("shortcutId") }
        assertEquals(ids.size, ids.toSet().size)
        assertEquals(setOf("add_device", "open_inbox"), ids.toSet())

        shortcuts.forEach { shortcut ->
            assertTrue(
                "short label must resolve per locale: ${shortcut.attr("shortcutShortLabel")}",
                shortcut.attr("shortcutShortLabel").startsWith("@string/"),
            )
            assertTrue(
                "long label must resolve per locale: ${shortcut.attr("shortcutLongLabel")}",
                shortcut.attr("shortcutLongLabel").startsWith("@string/"),
            )
            assertTrue(
                "icon must be a drawable resource: ${shortcut.attr("icon")}",
                shortcut.attr("icon").startsWith("@drawable/"),
            )
        }
    }

    // ---- reading the resource ----

    private fun shortcutsElement(): Element {
        val file = resourceFile("xml/shortcuts.xml")
        return DocumentBuilderFactory.newInstance()
            .apply { isNamespaceAware = true }
            .newDocumentBuilder()
            .parse(file)
            .documentElement
    }

    private fun resourceFile(relative: String): File {
        val direct = listOf(
            File("src/main/res/$relative"),
            File("app/src/main/res/$relative"),
            File("android/app/src/main/res/$relative"),
        )
        direct.firstOrNull { it.isFile }?.let { return it }

        var dir: File? = File(".").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "android/app/src/main/res/$relative")
            if (candidate.isFile) return candidate
            dir = dir.parentFile
        }
        throw AssertionError("res/$relative not found from ${File(".").absolutePath}")
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
