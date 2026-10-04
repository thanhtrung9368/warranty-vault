package com.warrantyvault.app.i18n

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/**
 * A string lookup, decoupled from [Context].
 *
 * ## Why this interface exists at all
 *
 * Half of this app's copy is not a label inside a composable — it is the output
 * of a *pure formatter*: `actionDuePill()` builds `"Còn 3 ngày"`, `warrantyState()`
 * builds `"Đã hết 2 ngày"`, `auditMoneyLine()` builds `"Tăng 20.000 ₫ (+10%)"`.
 * Those functions are deliberately pure so the JVM tests can pin their exact
 * wording, and 448 of them used to be pinned by hardcoded Vietnamese literals
 * inside the function body.
 *
 * A hardcoded literal is invisible to the resource system, so in English mode
 * those sentences stayed Vietnamese while every label around them switched —
 * the exact mixed-language screen `docs/I18N_PLAN.md` §2.4 is about. But a
 * `Context` cannot be passed to a pure function: there is no Context in a JVM
 * unit test, and resolving `R.string.x` needs one.
 *
 * So the formatter takes **this** instead. Production passes
 * [Context.appStrings]; a test passes a catalog read straight off
 * `res/values-vi/strings*.xml` (`CatalogAppStrings` in the test source set).
 * The formatter stays a pure function of (strings, data) → sentence, the
 * resource table is the single source of every word, and the test can still
 * assert `assertEquals("Còn 3 ngày", …)` — byte for byte, in either language.
 *
 * ## Why not pass the resolved strings as parameters
 *
 * Because a sentence with five substitutions would need five parameters at
 * every call site, and the call sites are composables that do not know the
 * strings. `object`-style resolution (`s.get(R.string.x)`) keeps the formatter's
 * signature about the *data* it formats, which is what the test is about.
 *
 * ## Why not `Resources` directly
 *
 * `Resources` is an Android class: a plain JVM test cannot instantiate one
 * without Robolectric, which this module deliberately does not depend on.
 */
interface AppStrings {

    /**
     * The language these strings are in, so a *number* can follow the same
     * language as the sentence around it — `1.000.000 ₫` against `₫1,000,000`
     * (see [Money]). A string table cannot express that, but the two always
     * travel together, and a test catalog (`ResCatalog`) knows its own language
     * from the folder it was read out of.
     */
    val locale: java.util.Locale

    /** `getString(id)` when [args] is empty, `getString(id, *args)` otherwise. */
    fun get(id: Int, vararg args: Any): String

    /**
     * `getQuantityString(id, quantity, *args)`.
     *
     * Note the deliberate `*args`: Android's two-argument
     * `getQuantityString(id, quantity)` does **not** run `String.format`, so a
     * plural whose template carries `%1$d` would render the placeholder. Callers
     * pass the count on through [args].
     */
    fun quantity(id: Int, quantity: Int, vararg args: Any): String
}

/** The production [AppStrings]: whatever locale the [Context] was wrapped with. */
class AndroidAppStrings(private val context: Context) : AppStrings {

    override val locale: java.util.Locale
        get() = context.resources.configuration.locales[0]

    override fun get(id: Int, vararg args: Any): String =
        if (args.isEmpty()) context.getString(id) else context.getString(id, *args)

    override fun quantity(id: Int, quantity: Int, vararg args: Any): String =
        context.resources.getQuantityString(id, quantity, *args)
}

/**
 * The catalog as seen by `context`, which `MainActivity.attachBaseContext` has
 * already wrapped in the user's [AppLanguage] — so this is the one call that
 * makes a formatter speak the selected language.
 */
fun Context.appStrings(): AppStrings = AndroidAppStrings(this)

/**
 * The same thing inside a composable. [remember]ed on the [Context] so a
 * recomposition does not allocate a new wrapper, and so a language switch (which
 * recreates the Activity, and therefore the Context) is picked up.
 */
@Composable
fun appStrings(): AppStrings {
    val context = LocalContext.current
    return remember(context) { context.appStrings() }
}
