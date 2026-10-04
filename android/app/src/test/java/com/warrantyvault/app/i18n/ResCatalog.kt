package com.warrantyvault.app.i18n

import com.warrantyvault.app.R
import org.w3c.dom.Element
import java.io.File
import java.util.Locale
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Reads one language's `res/values/strings*.xml` (or `res/values-vi/…`) off disk
 * and exposes it as an [AppStrings], so a **pure formatter can be tested in
 * either language without Robolectric**.
 *
 * ## What problem this solves
 *
 * `StringResourceParityTest` proves the two catalogs have the same keys and the
 * same format verbs. It cannot prove that a formatter *uses* them: a formatter
 * that dropped a placeholder, picked the wrong key, or was simply never
 * converted still passes parity, because parity only ever looks at the XML.
 *
 * With this loader a test can do the real thing:
 *
 * ```kotlin
 * val vi = ResCatalog.vietnamese()
 * val en = ResCatalog.english()
 * assertEquals("Còn 3 ngày", vi.actionDuePill("2026-03-04", today)!!.label)
 * assertEquals("3 days left", en.actionDuePill("2026-03-04", today)!!.label)
 * ```
 *
 * The Vietnamese assertion is the *same string* the pre-i18n test asserted
 * against a hardcoded literal — so the conversion is provably byte-for-byte,
 * not "should be equivalent".
 *
 * ## How an `R` id becomes XML text
 *
 * The formatters call `R.string.some_key`, an `int`. The XML knows the key by
 * name. The two are joined through reflection on the generated `R` class: its
 * public static fields *are* the name → id table (`android.nonFinalResIds`
 * leaves them non-final, which reflection does not care about). If a key is
 * renamed in Kotlin but not in the XML, `R` stops compiling; if it is renamed in
 * the XML but not in Kotlin, the lookup below throws with the key name in the
 * message. Both directions fail loudly.
 *
 * ## Android escapes
 *
 * `aapt2` unescapes `\'`, `\"`, `\n` and `\\` when it builds the resource table,
 * but an XML parser hands them over raw. They are unescaped here so a test sees
 * the same bytes the user would. `%%` is deliberately left alone: that is
 * `String.format`'s business, and masking it would hide a missing verb.
 */
class ResCatalog internal constructor(
    private val values: Map<String, String>,
    private val folder: String,
) : AppStrings {

    /**
     * The folder *is* the language, so the locale follows it. A test that wants
     * the `en` money shape must read the `values/` catalog, and vice versa —
     * there is no way to assert English words against Vietnamese grouping.
     */
    override val locale: Locale =
        if (folder.contains("vi")) Locale("vi", "VN") else Locale.US

    override fun get(id: Int, vararg args: Any): String {
        val name = nameOf(id) ?: throw AssertionError(
            "R.string id $id is not a field of R.string — the test is out of sync with the build.",
        )
        val raw = values[name] ?: throw AssertionError(
            "<string name=\"$name\"> is used by Kotlin but missing from ${folder}/ — " +
                "the English/Vietnamese pair has drifted.",
        )
        return format(raw, args)
    }

    override fun quantity(id: Int, quantity: Int, vararg args: Any): String {
        val name = pluralNameOf(id) ?: throw AssertionError(
            "R.plurals id $id is not a field of R.plurals — the test is out of sync with the build.",
        )
        // English selects `one` for a count of 1; Vietnamese only ever ships
        // `other`. Either way the lookup degrades to `other`, which both
        // languages are required to carry (StringResourceParityTest pins that).
        val wanted = if (quantity == 1) "one" else "other"
        val raw = values["$name/$wanted"] ?: values["$name/other"] ?: throw AssertionError(
            "<plurals name=\"$name\"> has no `other` in $folder/.",
        )
        return format(raw, args)
    }

    /**
     * Mirrors `Resources.getString`: `String.format` with the catalog's own
     * verbs. No args means the template is returned verbatim, exactly like
     * Android, so a `%` in a static sentence is not eaten.
     */
    private fun format(raw: String, args: Array<out Any>): String =
        if (args.isEmpty()) raw else String.format(Locale.ROOT, raw, *args)

    companion object {
        fun english(): ResCatalog = of("values")

        fun vietnamese(): ResCatalog = of("values-vi")

        /** An explicit catalog, so a test can pin the *failure* modes too. */
        internal fun forTesting(values: Map<String, String>, folder: String = "values"): ResCatalog =
            ResCatalog(values, folder)

        fun of(localeFolder: String): ResCatalog {
            val dir = File(resRoot(), localeFolder)
            check(dir.isDirectory) { "$dir is not a directory — cannot read the $localeFolder catalog" }
            val files = dir.listFiles { f -> f.isFile && f.name.startsWith("strings") && f.name.endsWith(".xml") }
                ?.sortedBy { it.name }
                .orEmpty()
            val out = mutableMapOf<String, String>()
            for (file in files) {
                val root = DocumentBuilderFactory.newInstance()
                    .newDocumentBuilder()
                    .parse(file)
                    .documentElement
                for (i in 0 until root.childNodes.length) {
                    val el = root.childNodes.item(i) as? Element ?: continue
                    val name = el.getAttribute("name")
                    when (el.tagName) {
                        "string" -> out[name] = unescape(el.textContent)
                        "plurals" -> for (j in 0 until el.childNodes.length) {
                            val item = el.childNodes.item(j) as? Element ?: continue
                            if (item.tagName != "item") continue
                            out["$name/${item.getAttribute("quantity")}"] = unescape(item.textContent)
                        }
                    }
                }
            }
            check(out.isNotEmpty()) { "read no strings from $dir" }
            return ResCatalog(out, localeFolder)
        }

        private fun unescape(raw: String): String {
            val sb = StringBuilder(raw.length)
            var i = 0
            while (i < raw.length) {
                val c = raw[i]
                if (c == '\\' && i + 1 < raw.length) {
                    when (val next = raw[i + 1]) {
                        '\'', '"', '\\' -> { sb.append(next); i += 2; continue }
                        'n' -> { sb.append('\n'); i += 2; continue }
                    }
                }
                sb.append(c)
                i++
            }
            return sb.toString()
        }

        // ---- R reflection ----

        private val stringIds: Map<Int, String> by lazy {
            R.string::class.java.fields.associate { it.getInt(null) to it.name }
        }

        private val pluralIds: Map<Int, String> by lazy {
            R.plurals::class.java.fields.associate { it.getInt(null) to it.name }
        }

        private fun nameOf(id: Int): String? = stringIds[id]

        private fun pluralNameOf(id: Int): String? = pluralIds[id]

        /**
         * Same search order as `StringResourceParityTest.resRoot()`: the Gradle
         * unit-test working directory is the module directory, with a walk up the
         * tree so an IDE run also works.
         */
        private fun resRoot(): File {
            val candidates = listOf(
                File("src/main/res"),
                File("app/src/main/res"),
                File("android/app/src/main/res"),
            )
            candidates.firstOrNull { File(it, "values").isDirectory }?.let { return it }
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
                    "ResCatalog needs the module directory as its working directory.",
            )
        }
    }
}
