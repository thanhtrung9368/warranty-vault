package com.warrly.i18n

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalConfiguration
import com.warrly.network.DEFAULT_CURRENCY
import java.text.NumberFormat
import java.util.Currency
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

    /**
     * Money in **its own currency**, not necessarily dong.
     *
     * The multi-currency device feature made `purchasePrice`, `soldPrice` and
     * `Warranty.cost` native-currency numbers. Printing a `$999` phone with the
     * existing dong formatter was the bug this avoids. The VND branch delegates
     * to [of], so there is still exactly **one** implementation of the dong shape
     * — `formatVnd` was extended, not forked.
     *
     * Shape follows the same convention as dong: Vietnamese puts the symbol
     * after the grouped digits (`999 US$`), English puts it in front (`$999`),
     * and the minus sign goes outside the symbol in both. Decimals are never
     * printed: every price in the contract is an integer. The symbol comes from
     * `java.util.Currency`, so an ISO code the picker does not list still
     * formats; if the platform has no symbol it falls back to the code itself
     * (`CHF 1,234` in English, `1.234 CHF` in Vietnamese).
     *
     * This is display only. Totals must use the server-computed `*Vnd` fields;
     * never multiply by `Device.fxRate` to build one.
     */
    fun format(amount: Long, currency: String, locale: Locale): String {
        val code = currency.trim().uppercase(Locale.ROOT)
        // Empty and VND both mean the pre-multi-currency default. Delegating
        // keeps the pinned `1.000.000 ₫` / `₫1,000,000` bytes in one place.
        if (code.isEmpty() || code == DEFAULT_CURRENCY) return of(amount, locale)

        val symbol = runCatching { Currency.getInstance(code).getSymbol(locale) }
            .getOrDefault(code)
        val digits = NumberFormat.getNumberInstance(locale).format(if (amount < 0) -amount else amount)
        val sign = if (amount < 0) "-" else ""
        return if (locale.language.equals("vi", ignoreCase = true)) {
            "$sign$digits $symbol"
        } else if (symbol.lastOrNull()?.isLetter() == true) {
            // A textual symbol ("CHF") needs a space; "$"/"€" do not.
            "$sign$symbol $digits"
        } else {
            "$sign$symbol$digits"
        }
    }
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
