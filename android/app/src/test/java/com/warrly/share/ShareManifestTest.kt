package com.warrly.share

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * The **OS-level** half of the share feature, pinned as XML.
 *
 * Everything else in `ShareTargetTest` proves what the code does once an intent
 * arrives. This file proves the intent can arrive at all: the chooser only
 * offers Warrly for the MIME types declared on `.MainActivity`, and no unit
 * test of Kotlin code can see that. Reading the manifest is the closest thing
 * to a share-sheet assertion this repo can run without an emulator.
 *
 * It also pins the honest scope of the feature:
 *
 *  * the text/plain data element is still there (the wishlist share must not
 *    disappear when the filter is widened);
 *  * the image wildcard and `application/pdf` are there (the inbox entry point);
 *  * `ACTION_SEND_MULTIPLE` is **not** advertised, because the code reads
 *    exactly one stream. If multi-select is ever implemented, this test is
 *    supposed to fail until the filter and the code are changed together.
 */
class ShareManifestTest {

    private val androidNs = "http://schemas.android.com/apk/res/android"

    private fun manifest(): Element {
        val file = manifestFile()
        return DocumentBuilderFactory.newInstance()
            .apply { isNamespaceAware = true }
            .newDocumentBuilder()
            .parse(file)
            .documentElement
    }

    private fun manifestFile(): File {
        val direct = listOf(
            File("src/main/AndroidManifest.xml"),
            File("app/src/main/AndroidManifest.xml"),
            File("android/app/src/main/AndroidManifest.xml"),
        )
        direct.firstOrNull { it.isFile }?.let { return it }

        var dir: File? = File(".").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "android/app/src/main/AndroidManifest.xml")
            if (candidate.isFile) return candidate
            dir = dir.parentFile
        }
        throw AssertionError("AndroidManifest.xml not found from ${File(".").absolutePath}")
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

    private fun mainActivity(): Element {
        val activities = manifest().getElementsByTagName("activity")
        for (i in 0 until activities.length) {
            val activity = activities.item(i) as? Element ?: continue
            if (activity.attr("name") == ".MainActivity") return activity
        }
        throw AssertionError("no .MainActivity in AndroidManifest.xml")
    }

    private fun shareFilter(): Element {
        val filters = mainActivity().children("intent-filter")
        return filters.firstOrNull { filter ->
            filter.children("action").any { it.attr("name") == ShareTarget.ACTION_SEND }
        } ?: throw AssertionError("MainActivity has no ACTION_SEND intent-filter")
    }

    @Test
    fun theShareFilterAcceptsTextImagesAndPdf() {
        val filter = shareFilter()

        val actions = filter.children("action").map { it.attr("name") }
        assertEquals(listOf(ShareTarget.ACTION_SEND), actions)

        val categories = filter.children("category").map { it.attr("name") }
        assertTrue(
            "a share intent-filter needs android.intent.category.DEFAULT",
            "android.intent.category.DEFAULT" in categories,
        )

        val mimeTypes = filter.children("data").map { it.attr("mimeType") }.toSet()
        assertEquals(
            "the chooser is what decides whether a photo/PDF can reach the app",
            setOf("text/plain", "image/*", "application/pdf"),
            mimeTypes,
        )
    }

    @Test
    fun multiSelectIsNotAdvertisedBecauseOnlyOneFileIsRead() {
        // The code holds one SharedFile and rejects >1 stream. An
        // ACTION_SEND_MULTIPLE filter would put the app in the chooser for a
        // multi-select share and then drop all but the first file — worse than
        // not offering it at all.
        val filters = mainActivity().children("intent-filter")
        val actions = filters.flatMap { it.children("action") }.map { it.attr("name") }
        assertFalse(
            "ACTION_SEND_MULTIPLE is declared but ShareTarget only supports one stream",
            ShareTarget.ACTION_SEND_MULTIPLE in actions,
        )
    }

    @Test
    fun theOutgoingTextShareStillResolvesToTheSameFilter() {
        // The handover-certificate share is ACTION_SEND + text/plain; the new
        // data elements must not have replaced it. Also guards against someone
        // adding a second SEND filter that splits the two behaviours.
        val filters = mainActivity().children("intent-filter").filter { filter ->
            filter.children("action").any { it.attr("name") == ShareTarget.ACTION_SEND }
        }
        assertEquals("one ACTION_SEND filter, not several", 1, filters.size)
        assertTrue(
            "text/plain must stay in the one SEND filter",
            filters.single().children("data").any { it.attr("mimeType") == "text/plain" },
        )
    }
}
