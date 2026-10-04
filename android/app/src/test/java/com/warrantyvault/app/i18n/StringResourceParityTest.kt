package com.warrantyvault.app.i18n

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * The guard rail for the English resources (`res/values…/strings*.xml`)
 * against the Vietnamese ones (`res/values-vi/…/strings*.xml`).
 *
 * ## Why this test exists at all
 *
 * Android's resource fallback is silent. If a key exists in `values/` but not in
 * `values-vi/`, a Vietnamese user does not see an error or an empty string — they
 * see the English sentence, in the middle of a Vietnamese screen. The same is
 * true in reverse. That is *exactly* the failure `docs/I18N_PLAN.md` is about, and
 * it is invisible to the compiler, to lint and to every UI test. So it is pinned
 * here, over the files themselves rather than over any Kotlin call site.
 *
 * Three properties are checked:
 *
 *  1. **Key parity.** The union of every `strings*.xml` under `values/` and every
 *     one under `values-vi/` must be the same key set. `<plurals>` count too —
 *     a plural that exists in only one language falls back just as silently.
 *  2. **Format-verb parity per key.** `%1$s`/`%2$d` must line up, position for
 *     position, with the other language's. A translation that drops a
 *     placeholder throws `MissingFormatArgumentException` at runtime — i.e. a
 *     crash on the screen that string belongs to, which no unit test of the
 *     string's *content* would catch. Bare `%s` and `%1$s` are normalised to the
 *     same thing so the two styles can be mixed across a file pair.
 *  3. **Plural-quantity parity.** `one`/`other` in English against `other` in
 *     Vietnamese is correct (Vietnamese does not inflect); have `one` in
 *     Vietnamese and nothing to render for `other` in English is not.
 *
 * ## Why the catalog is several files
 *
 * The split (`strings.xml`, `strings_devices.xml`, …) exists so several agents
 * could convert the ~900 keys in parallel with one writer per file; Android
 * merges them into one resource table, so the split is invisible to the code.
 * This test globs `strings*.xml`, so a new file is covered the moment it is
 * created — and a locale folder that gains a file with no counterpart fails
 * loudly.
 *
 * Pure JVM, no Robolectric: it reads the XML off disk. The Gradle unit-test
 * working directory is the module directory (`android/app`), with a walk up the
 * tree as a fallback so running the test from an IDE also works.
 */
class StringResourceParityTest {

    private data class Catalog(
        val byKey: Map<String, String>,
        val plurals: Map<String, Map<String, String>>,
        val files: List<String>,
    )

    private val english = read("values")
    private val vietnamese = read("values-vi")

    // ---- 0. The test is actually reading something ----

    /**
     * A parity test that silently reads nothing passes forever. This is the
     * guard: both folders must exist and both catalogs must be non-trivial.
     */
    @Test
    fun bothLanguageFoldersAreReadAndNonTrivial() {
        assertTrue(
            "no strings*.xml found under values/ — looked in ${resRoot()}",
            english.files.isNotEmpty(),
        )
        assertTrue(
            "no strings*.xml found under values-vi/ — looked in ${resRoot()}",
            vietnamese.files.isNotEmpty(),
        )
        assertTrue("English catalog looks empty: ${english.byKey.size} keys", english.byKey.size > 20)
        assertTrue(
            "Vietnamese catalog looks empty: ${vietnamese.byKey.size} keys",
            vietnamese.byKey.size > 20,
        )
    }

    // ---- 1. Key parity ----

    @Test
    fun everyStringKeyExistsInBothLanguages() {
        assertSameKeys(english.byKey.keys, vietnamese.byKey.keys, "string")
    }

    @Test
    fun everyPluralKeyExistsInBothLanguages() {
        assertSameKeys(english.plurals.keys, vietnamese.plurals.keys, "plurals")
    }

    private fun assertSameKeys(en: Set<String>, vi: Set<String>, what: String) {
        val missingInVietnamese = (en - vi).sorted()
        val missingInEnglish = (vi - en).sorted()
        assertEquals(
            "these <$what> keys exist in values/ but NOT in values-vi/, so a Vietnamese " +
                "screen would silently render the English text: $missingInVietnamese",
            emptyList<String>(),
            missingInVietnamese,
        )
        assertEquals(
            "these <$what> keys exist in values-vi/ but NOT in values/, so an English " +
                "screen would silently render the Vietnamese text: $missingInEnglish",
            emptyList<String>(),
            missingInEnglish,
        )
    }

    // ---- 2. Format-verb parity ----

    @Test
    fun stringFormatVerbsMatchAcrossLanguages() {
        val mismatched = english.byKey.keys.intersect(vietnamese.byKey.keys)
            .mapNotNull { key ->
                val en = verbsOf(english.byKey.getValue(key))
                val vi = verbsOf(vietnamese.byKey.getValue(key))
                if (en == vi) null else "$key: en=$en vi=$vi"
            }
            .sorted()
        assertEquals(
            "these keys interpolate DIFFERENT arguments in the two languages — one of them " +
                "will throw MissingFormatArgumentException at runtime: $mismatched",
            emptyList<String>(),
            mismatched,
        )
    }

    @Test
    fun pluralFormatVerbsMatchPerQuantity() {
        val mismatched = mutableListOf<String>()
        for (key in english.plurals.keys.intersect(vietnamese.plurals.keys)) {
            val en = english.plurals.getValue(key)
            val vi = vietnamese.plurals.getValue(key)
            for (quantity in en.keys.intersect(vi.keys)) {
                val a = verbsOf(en.getValue(quantity))
                val b = verbsOf(vi.getValue(quantity))
                if (a != b) mismatched += "$key/$quantity: en=$a vi=$b"
            }
        }
        assertEquals(
            "plural forms interpolate different arguments in the two languages: ${mismatched.sorted()}",
            emptyList<String>(),
            mismatched.sorted(),
        )
    }

    @Test
    fun pluralQuantitiesCoverEveryLanguage() {
        val problems = mutableListOf<String>()
        for (key in english.plurals.keys.intersect(vietnamese.plurals.keys)) {
            val en = english.plurals.getValue(key)
            val vi = vietnamese.plurals.getValue(key)
            // `other` is the only quantity Android REQUIRES (and the only one
            // Vietnamese has at all); a catalog missing it crashes on the count
            // that does not match any other rule.
            if (!en.containsKey("other")) problems += "$key: English has no `other`"
            if (!vi.containsKey("other")) problems += "$key: Vietnamese has no `other`"
            if (!en.containsKey("one")) {
                problems += "$key: English has no `one` — a count of 1 would render \"1 days\" (docs/I18N_PLAN.md §4.6)"
            }
            val unexpected = (vi.keys - setOf("other", "one", "few", "many"))
            if (unexpected.isNotEmpty()) problems += "$key: Vietnamese has unknown quantities $unexpected"
        }
        assertEquals(emptyList<String>(), problems.sorted())
    }

    // ---- Reading ----

    /**
     * The format verbs of a string, as `position:conversion` pairs, so `%s` and
     * `%1$s` compare equal and argument ORDER differences are still caught.
     *
     * `%%` is a literal percent sign, never a verb — it is masked first so the
     * regex cannot match the `%s` inside `%%s`.
     */
    private fun verbsOf(value: String): List<String> {
        val masked = value.replace("%%", "\u0000")
        val out = mutableListOf<String>()
        var ordinal = 0
        for (match in VERB.findAll(masked)) {
            ordinal++
            val explicit = match.groupValues[1].takeIf { it.isNotEmpty() }?.toInt()
            out += "${explicit ?: ordinal}:${match.groupValues[2]}"
        }
        return out.sorted()
    }

    private fun read(folder: String): Catalog {
        val dir = File(resRoot(), folder)
        val files = dir.listFiles { f -> f.isFile && f.name.startsWith("strings") && f.name.endsWith(".xml") }
            ?.sortedBy { it.name }
            ?: emptyList()
        val byKey = mutableMapOf<String, String>()
        val plurals = mutableMapOf<String, MutableMap<String, String>>()
        val seen = mutableMapOf<String, String>()
        for (file in files) {
            val root = DocumentBuilderFactory.newInstance()
                .newDocumentBuilder()
                .parse(file)
                .documentElement
            // Indexed, not `for (node in root.childNodes)`: org.w3c.dom.NodeList
            // is not an Iterable and Kotlin resolves `iterator()` ambiguously.
            for (i in 0 until root.childNodes.length) {
                val el = root.childNodes.item(i) as? Element ?: continue
                val name = el.getAttribute("name")
                when (el.tagName) {
                    "string" -> {
                        // A duplicate <string name> in the SAME folder is a hard
                        // build error ("duplicate resources"), and a duplicate
                        // ACROSS the two languages is the bug this test hunts, so
                        // it is reported here with the file names rather than left
                        // to aapt2.
                        val previous = seen.put(name, file.name)
                        if (previous != null) {
                            throw AssertionError(
                                "<string name=\"$name\"> is declared twice in $folder/ " +
                                    "($previous and ${file.name}) — remove one.",
                            )
                        }
                        byKey[name] = el.textContent
                    }
                    "plurals" -> {
                        val bucket = plurals.getOrPut(name) { mutableMapOf() }
                        for (j in 0 until el.childNodes.length) {
                            val it2 = el.childNodes.item(j) as? Element ?: continue
                            if (it2.tagName != "item") continue
                            val quantity = it2.getAttribute("quantity")
                            if (bucket.put(quantity, it2.textContent) != null) {
                                throw AssertionError(
                                    "<plurals name=\"$name\"> declares quantity " +
                                        "\"$quantity\" twice in $folder/.",
                                )
                            }
                        }
                    }
                }
            }
        }
        return Catalog(byKey, plurals, files.map { "$folder/${it.name}" })
    }

    private fun resRoot(): File {
        val candidates = listOf(
            File("src/main/res"),
            File("app/src/main/res"),
            File("android/app/src/main/res"),
        )
        candidates.firstOrNull { File(it, "values").isDirectory }?.let { return it }
        // Walk up from the working directory as a last resort (IDE runs).
        var dir: File? = File(".").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "app/src/main/res")
            if (File(candidate, "values").isDirectory) return candidate
            val direct = File(dir, "src/main/res")
            if (File(direct, "values").isDirectory) return direct
            dir = dir.parentFile
        }
        throw AssertionError(
            "could not find res/values from ${File(".").absolutePath} — " +
                "StringResourceParityTest needs the module directory as its working directory.",
        )
    }

    private companion object {
        val VERB = Regex("""%(?:(\d+)\$)?([sdfxXeEgG])""")
    }
}
