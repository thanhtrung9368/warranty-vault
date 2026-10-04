package com.warrantyvault.app.i18n

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalConfiguration
import java.text.NumberFormat
import java.util.Locale

/**
 * Vietnamese đồng in the selected language.
 *
 * ## Why this is not a `NumberFormat.getNumberInstance()` call any more
 *
 * Every screen used to carry its own copy of
 *
 * ```kotlin
 * NumberFormat.getNumberInstance(Locale("vi", "VN")).format(amount) + "đ"
 * ```
 *
 * — five copies, one per screen package (`devices`, `subscriptions`, `wishlist`,
 * `stats`, `dashboard`) plus two more in the formatters. Because the locale was
 * hardcoded, the amount stayed `1.000.000đ` in **both** languages: a reader in
 * English mode got Vietnamese digit grouping and a Vietnamese unit character in
 * the middle of an English sentence. That was the largest remaining
 * Vietnamese-flavoured surface in English mode.
 *
 * ## The three clients now agree, and Go is the one that is right
 *
 * There were three dialects for the same amount. `api/internal/i18n/format.go`
 * (`FormatMoney`) and `website/src/lib/format.ts` both print
 *
 * ```
 * vi → 1.200.000 ₫     (dot grouping, SPACE, ₫ U+20AB)
 * en → ₫1,200,000      (comma grouping, LEADING symbol)
 * ```
 *
 * while Android printed `1.200.000đ` — no space, `đ` U+0111 — a shape no other
 * client has ever produced. That third dialect predates the i18n work (it came
 * from the first Android commit) and this file used to reproduce it literally,
 * because `VietnameseFormatterTest` pinned the bytes. **The requirement changed,
 * not the implementation**: the repo's canonical money format is Go's, so
 * [vietnamese] now emits Go's Vietnamese and all three clients agree.
 *
 * That is the one place where moving a pinned assertion was the correct move,
 * and `VietnameseFormatterTest` says so in its own header. Every other test that
 * pinned `123.456đ` moved with it for the same reason; the amounts did not.
 *
 * The English half is unchanged: it already followed Go and the web exactly —
 * comma grouping, leading `₫`, minus sign outside the symbol.
 */
object Money {

    private const val SYMBOL = "₫"    // U+20AB — what Go and the web use

    private val VI = Locale("vi", "VN")
    private val EN = Locale.US

    /**
     * `1.000.000 ₫`, `-5.000 ₫` — the shape Go's `FormatMoney` emits for `vi`:
     * `vi-VN` digit grouping (dots), a space, then `₫`.
     */
    fun vietnamese(amount: Long): String =
        NumberFormat.getNumberInstance(VI).format(amount) + " " + SYMBOL

    /** `₫1,000,000`, `-₫5,000` — the shape Go's `FormatMoney` emits for `en`. */
    fun english(amount: Long): String {
        val digits = NumberFormat.getNumberInstance(EN).format(if (amount < 0) -amount else amount)
        return if (amount < 0) "-$SYMBOL$digits" else "$SYMBOL$digits"
    }

    /** [vietnamese] for a `vi` locale, [english] for everything else. */
    fun of(amount: Long, locale: Locale): String =
        if (locale.language.equals("vi", ignoreCase = true)) vietnamese(amount) else english(amount)
}

/**
 * The locale the UI is rendering in — the one `MainActivity.attachBaseContext`
 * resolved through [AppLanguage], *not* the phone's system locale. They differ
 * whenever the Settings switcher has been used, which is exactly when a number
 * format would otherwise give the answer away.
 */
@Composable
fun appLocale(): Locale = LocalConfiguration.current.locales[0]

/** `Money` for a formatter that was handed the [AppStrings] seam instead. */
fun AppStrings.money(amount: Long): String = Money.of(amount, locale)
