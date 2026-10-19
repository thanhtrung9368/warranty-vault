package com.warrly.ui.screens.devices

import androidx.compose.runtime.Composable
import com.warrly.i18n.Money
import com.warrly.i18n.appLocale
import com.warrly.network.DEFAULT_CURRENCY
import com.warrly.network.Device
import java.util.Currency
import java.util.Locale
import kotlin.math.roundToLong

/**
 * Multi-currency devices — the pure half.
 *
 * ## The contract in one paragraph
 *
 * `Device.purchasePrice`, `Device.soldPrice` and every `Warranty.cost` on that
 * device are denominated in `Device.currency` (ISO 4217, default `VND`).
 * `Device.fxRate` is the VND-per-one-unit rate **locked at entry**; it is `null`
 * for every VND device, and for a legacy foreign row that never recorded one.
 * Every device read also carries server-computed `purchasePriceVnd` /
 * `soldPriceVnd`.
 *
 * ## The totals decision (one sentence, then the rules)
 *
 * **Every number that adds up across devices is VND and comes from the server.**
 * The client formats native prices for display and never converts them to build a
 * total.
 *
 *  * Per device: [devicePurchasePriceVnd] / [deviceSaleProfitVnd] use the
 *    server's `*Vnd` fields. The only fallback is the VND identity
 *    (`purchasePrice` for a VND device), which is not a conversion. A non-VND
 *    device whose server value is missing returns `null` rather than `amount ×
 *    fxRate` — a guessed total is worse than no total.
 *  * App totals: `GET /api/v1/stats` already converts each row at its own locked
 *    rate (`DeviceStats.totalPurchasePrice`, `totalWarrantyCost`,
 *    `totalSpend`), so the stats screen keeps printing those with the dong
 *    formatter. Nothing on Android recomputes a device total from the list.
 *  * The form's live preview ([priceVnd]) is the one deliberate multiplication:
 *    it shows the user what the server will store **before** saving, and its
 *    result is never added to anything.
 *
 * The FX endpoint (`GET /api/v1/fx/rates?base=USD`) only fills the rate field.
 * [rateToVnd] reads `rates["VND"]` (quote units per one unit of base) and returns
 * `null` when it cannot, which the sheet reports as "type it yourself" — it never
 * invents a rate.
 */

/**
 * The currencies the picker offers, in display order. VND first because it is
 * the default and the overwhelming majority.
 *
 * This is exactly the ISO enum the frozen contract accepts on write
 * (`openapi.yaml` `Device.currency` / `DeviceInput.currency`), so a currency the
 * user can pick is a currency the server will store. [normalizeCurrency] is
 * deliberately looser (any ISO 4217 code) and [currencyOptions] keeps a code the
 * server returned even if it is not listed here — a future server adding a
 * currency must not make this build silently relabel an existing device as VND.
 */
internal val DEVICE_CURRENCIES: List<String> = listOf(
    DEFAULT_CURRENCY,
    "USD",
    "EUR",
    "GBP",
    "CHF",
    "JPY",
    "KRW",
    "CNY",
    "TWD",
    "HKD",
    "SGD",
    "THB",
    "MYR",
    "IDR",
    "PHP",
    "INR",
    "AUD",
    "NZD",
    "CAD",
    "SEK",
    "NOK",
    "DKK",
    "PLN",
    "CZK",
    "RUB",
    "TRY",
    "AED",
    "BRL",
    "MXN",
    "ZAR",
)

/**
 * `null` / blank / an unknown code degrades to the contract default `VND`; a
 * known ISO 4217 code is upper-cased (`"usd"` → `"USD"`). This is the same
 * normalisation the wire default applies, so a server that omits `currency`
 * behaves exactly like one that sent `"VND"`.
 */
internal fun normalizeCurrency(raw: String?): String {
    val code = raw?.trim()?.uppercase(Locale.ROOT).orEmpty()
    if (code.isEmpty()) return DEFAULT_CURRENCY
    return runCatching { Currency.getInstance(code).currencyCode }
        .getOrDefault(DEFAULT_CURRENCY)
}

/**
 * Picker entries. A device saved by a newer server with a currency this build
 * does not list (say `ISK`) still shows and can be kept — the selected code is
 * appended instead of silently snapping the picker to VND and re-labelling the
 * price on the next save.
 */
internal fun currencyOptions(selected: String?): List<String> {
    val code = normalizeCurrency(selected)
    return if (code in DEVICE_CURRENCIES) DEVICE_CURRENCIES else DEVICE_CURRENCIES + code
}

/**
 * Form text → `Device.fxRate`. Blank, non-numeric, zero and out-of-`Int` are all
 * `null`; a rate is strictly positive by contract.
 */
internal fun parseFxRate(raw: String?): Int? {
    val text = raw?.trim().orEmpty()
    if (text.isEmpty() || !text.all { it.isDigit() }) return null
    return text.toIntOrNull()?.takeIf { it > 0 }
}

/**
 * The rule the Save button enforces: a non-VND device needs a positive rate.
 * VND never needs one (and never sends one).
 */
internal fun fxRateRequired(currency: String?, rateText: String?): Boolean =
    normalizeCurrency(currency) != DEFAULT_CURRENCY && parseFxRate(rateText) == null

/**
 * Form state → `DeviceInput.fxRate`. `null` for VND regardless of what is left in
 * the (hidden) field, which is exactly the contract's "VND ⇒ rate must be null".
 */
internal fun fxRateForRequest(currency: String?, rateText: String?): Int? =
    if (normalizeCurrency(currency) == DEFAULT_CURRENCY) null else parseFxRate(rateText)

/**
 * The FX response → the integer rate to store, or `null` when the map cannot
 * answer. `rates` is quoted per one unit of `base`, so VND per USD is
 * `rates["VND"]`.
 *
 * Deliberately strict: there is no fallback to `rates[base]`. If a future server
 * changed the quote direction, `rates["VND"]` would be absent and this returns
 * `null` — the user types the rate — instead of storing a plausible-looking `1`.
 */
internal fun rateToVnd(base: String, rates: Map<String, Double>): Int? {
    val code = normalizeCurrency(base)
    // A VND device has fxRate = null; there is nothing to fetch.
    if (code == DEFAULT_CURRENCY) return null
    val quoted = rates[DEFAULT_CURRENCY] ?: return null
    if (!quoted.isFinite() || quoted < 1.0) return null
    val rounded = quoted.roundToLong()
    return rounded.takeIf { it in 1..Int.MAX_VALUE.toLong() }?.toInt()
}

/**
 * The form's preview of what the server will store: `price × rate` VND.
 *
 * This is the **only** client-side multiplication in the feature and the result
 * is never summed or persisted — the server returns the authoritative
 * `purchasePriceVnd` on read. Uses `Long` because `Int.MAX_VALUE × Int.MAX_VALUE`
 * overflows `Int` (and an out-of-range value in the form must not crash).
 * Returns `null` for a missing rate or a negative price.
 */
internal fun priceVnd(amount: Int, rate: Int?): Long? {
    val positiveRate = rate?.takeIf { it > 0 } ?: return null
    if (amount < 0) return null
    return amount.toLong() * positiveRate
}

/**
 * The VND value of [Device.purchasePrice], from the server.
 *
 * `null` means "this payload cannot tell you" (a non-VND device from a server
 * that predates `purchasePriceVnd`). The caller must hide or omit rather than
 * multiply by [Device.fxRate].
 */
internal fun devicePurchasePriceVnd(device: Device): Long? =
    device.purchasePriceVnd
        ?: if (normalizeCurrency(device.currency) == DEFAULT_CURRENCY) {
            // Identity for a VND device, not a conversion.
            device.purchasePrice.toLong()
        } else {
            null
        }

/** The VND value of [Device.soldPrice]; `null` when there is no recorded sale. */
internal fun deviceSoldPriceVnd(device: Device): Long? {
    val sold = device.soldPrice ?: return null
    return device.soldPriceVnd
        ?: if (normalizeCurrency(device.currency) == DEFAULT_CURRENCY) sold.toLong() else null
}

/**
 * Profit/loss in dong: `soldPriceVnd − purchasePriceVnd`, or `null` when either
 * side is unavailable.
 *
 * For a VND device this is the old `soldPrice − purchasePrice`. For a foreign
 * device it deliberately does **not** subtract the native numbers from a VND
 * value or from each other's converted values: the two server fields are already
 * at the same locked rate, so their difference is the honest dong figure.
 */
internal fun deviceSaleProfitVnd(device: Device): Long? {
    val sold = deviceSoldPriceVnd(device) ?: return null
    val bought = devicePurchasePriceVnd(device) ?: return null
    return sold - bought
}

/**
 * Money in the device's own currency, e.g. `$999` / `999 US$` (never `999 ₫`).
 * VND delegates to the same [Money] implementation every other screen uses, so
 * the pinned dong shapes do not move.
 */
internal fun formatDeviceMoney(amount: Long, currency: String?, locale: Locale): String =
    Money.format(amount, normalizeCurrency(currency), locale)

/** [formatDeviceMoney] for a composable, following the in-app language. */
@Composable
internal fun formatDeviceMoney(amount: Long, currency: String?): String =
    formatDeviceMoney(amount, currency, appLocale())

/** [formatDeviceMoney] for an `Int` price field. */
@Composable
internal fun formatDeviceMoney(amount: Int, currency: String?): String =
    formatDeviceMoney(amount.toLong(), currency)
