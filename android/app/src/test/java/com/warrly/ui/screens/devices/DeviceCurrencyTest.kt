package com.warrly.ui.screens.devices

import com.warrly.network.DEFAULT_CURRENCY
import com.warrly.network.DeviceStats
import com.warrly.testing.Fixtures
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Multi-currency devices — the pure half.
 *
 * Nothing here renders: this module has no instrumentation tests and no
 * Robolectric, so the sheet and the detail card are not exercised. What is
 * pinned is everything that would be a *bug* rather than a styling choice:
 *
 *  1. formatting a foreign price never falls back to the dong shape,
 *  2. a non-VND device cannot be submitted without a positive rate,
 *  3. VND never carries a rate (the contract's pair rule),
 *  4. totals use the server's `*Vnd` values and never a client-side
 *     `price × fxRate`, even when the rate happens to be present,
 *  5. profit/loss in dong uses the locked conversions on both sides.
 *
 * The tests read the same `Money` implementation the screens use; there is no
 * second formatter to drift.
 */
class DeviceCurrencyTest {

    private val vi = Locale("vi", "VN")
    private val en = Locale.US

    // ---- formatting ----------------------------------------------------

    /**
     * The VND branch is byte-for-byte the old formatter. Multi-currency must not
     * move the pinned `1.000.000 ₫` / `₫1,000,000` shapes; it delegates to
     * `Money.of` rather than reimplementing them.
     */
    @Test
    fun vndFormattingIsUnchanged() {
        assertEquals("1.000.000 ₫", formatDeviceMoney(1_000_000, "VND", vi))
        assertEquals("₫1,000,000", formatDeviceMoney(1_000_000, "VND", en))
        assertEquals("0 ₫", formatDeviceMoney(0, DEFAULT_CURRENCY, vi))
        assertEquals("-₫5,000", formatDeviceMoney(-5_000, "VND", en))
        assertEquals(
            "blank currency is the contract default, not an error",
            "₫1,000",
            formatDeviceMoney(1_000, "", en),
        )
    }

    /**
     * A USD price prints with a dollar sign, never with `₫`. The Vietnamese
     * shape keeps the app's "digits then symbol" convention (`999 US$`), English
     * keeps "symbol then digits" (`$999`). No decimals: prices are integers.
     */
    @Test
    fun foreignPricesUseTheirOwnSymbol() {
        assertEquals("$999", formatDeviceMoney(999, "USD", en))
        assertEquals("999 US$", formatDeviceMoney(999, "USD", vi))
        assertEquals("€1,299", formatDeviceMoney(1_299, "EUR", en))
        assertEquals("-€5", formatDeviceMoney(-5, "EUR", en))
        // A textual ISO symbol needs a space, or it reads as a currency prefix
        // glued to the number ("CHF1,234").
        assertEquals("CHF 1,234", formatDeviceMoney(1_234, "CHF", en))
        assertEquals("1.234 CHF", formatDeviceMoney(1_234, "CHF", vi))
        assertFalse(
            "a foreign amount must never borrow the dong symbol",
            formatDeviceMoney(999, "USD", en).contains("₫"),
        )
        // Case/whitespace in a stored code must not change the symbol.
        assertEquals("$999", formatDeviceMoney(999, " usd ", en))
    }

    // ---- normalisation / picker ---------------------------------------

    @Test
    fun normalizeCurrencyDefaultsToVndAndValidatesIsoCodes() {
        assertEquals("VND", normalizeCurrency(null))
        assertEquals("VND", normalizeCurrency(""))
        assertEquals("VND", normalizeCurrency("   "))
        assertEquals("USD", normalizeCurrency("usd"))
        assertEquals("USD", normalizeCurrency(" Usd "))
        assertEquals("VND", normalizeCurrency("ZZZ"))
        assertEquals("VND", normalizeCurrency("12"))
        assertEquals("EUR", normalizeCurrency("EUR"))
    }

    /**
     * A device saved by a newer server with a code this build does not list must
     * stay selectable. Snapping the picker to VND would silently relabel its
     * price as dong on the next save.
     */
    @Test
    fun currencyOptionsKeepAnUnlistedSelectedCode() {
        val standard = currencyOptions("VND")
        assertEquals("VND", standard.first())
        assertTrue("USD", standard.contains("USD"))
        assertTrue("PLN", currencyOptions("PLN").contains("PLN"))
        assertTrue(
            "a valid ISO code outside the contract's write enum is still kept selectable",
            currencyOptions("ISK").contains("ISK"),
        )
        assertEquals("no duplicate", 1, currencyOptions("USD").count { it == "USD" })
    }

    // ---- the rate-required rule ---------------------------------------

    @Test
    fun parseFxRateAcceptsOnlyPositiveIntegers() {
        assertNull(parseFxRate(null))
        assertNull(parseFxRate(""))
        assertNull(parseFxRate("   "))
        assertNull("0 is not a rate", parseFxRate("0"))
        assertNull("negative", parseFxRate("-5"))
        assertNull("not a number", parseFxRate("abc"))
        assertNull("decimal", parseFxRate("25470.5"))
        assertNull("out of Int", parseFxRate("99999999999"))
        assertEquals(25_470, parseFxRate("25470"))
        assertEquals(25_470, parseFxRate(" 25470 "))
    }

    @Test
    fun fxRateIsRequiredOnlyForANonVndCurrency() {
        assertFalse("VND never needs a rate", fxRateRequired("VND", ""))
        assertFalse("even junk in the hidden field is ignored", fxRateRequired("VND", "abc"))
        assertTrue("USD blank", fxRateRequired("USD", ""))
        assertTrue("USD zero", fxRateRequired("USD", "0"))
        assertTrue("USD junk", fxRateRequired("USD", "abc"))
        assertFalse("USD positive", fxRateRequired("USD", "25470"))
        assertFalse("lower-case code", fxRateRequired("usd", "25470"))
        assertFalse(
            "an invalid ISO code normalises to VND, so no rate is demanded",
            fxRateRequired("ZZZ", ""),
        )
    }

    @Test
    fun fxRateForRequestIsNullForVndAndParsesOtherwise() {
        assertNull("VND ⇒ rate must be null", fxRateForRequest("VND", "25470"))
        assertNull("VND with junk", fxRateForRequest("VND", "abc"))
        assertNull("USD still invalid", fxRateForRequest("USD", ""))
        assertEquals(25_470, fxRateForRequest("USD", "25470"))
        assertEquals(25_470, fxRateForRequest("usd", " 25470 "))
    }

    // ---- FX response ---------------------------------------------------

    @Test
    fun rateToVndReadsTheVndQuote() {
        assertEquals(
            "rates are per one unit of base, so VND per USD is rates[\"VND\"]",
            25_470,
            rateToVnd("USD", mapOf("VND" to 25_470.4)),
        )
        assertEquals(25_471, rateToVnd("USD", mapOf("VND" to 25_470.5)))
        assertEquals("lower-case base", 25_470, rateToVnd("usd", mapOf("VND" to 25_470.0)))
        assertNull("no VND quote, no guess", rateToVnd("USD", mapOf("EUR" to 0.92)))
        assertNull("zero quote", rateToVnd("USD", mapOf("VND" to 0.0)))
        assertNull("negative quote", rateToVnd("USD", mapOf("VND" to -1.0)))
        assertNull("NaN", rateToVnd("USD", mapOf("VND" to Double.NaN)))
        assertNull("VND base has no fxRate", rateToVnd("VND", mapOf("VND" to 1.0)))
        assertNull("does not fit an Int", rateToVnd("USD", mapOf("VND" to 3_000_000_000.0)))
    }

    // ---- the server-computed VND values --------------------------------

    /**
     * The rule that matters most: a non-VND device's dong value comes from the
     * server. If it is missing, the answer is `null` even when `fxRate` is right
     * there — a local multiplication would be a total the server did not agree
     * with.
     */
    @Test
    fun purchasePriceVndComesFromTheServerNotFromMultiplication() {
        val usd = Fixtures.device(
            purchasePrice = 999,
            currency = "USD",
            fxRate = 25_000,
            purchasePriceVnd = 24_975_000,
        )
        assertEquals(24_975_000L, devicePurchasePriceVnd(usd))
        assertNotEquals(999L, devicePurchasePriceVnd(usd))

        val noServerValue = Fixtures.device(
            purchasePrice = 999,
            currency = "USD",
            fxRate = 25_000,
            purchasePriceVnd = null,
        )
        assertNull(
            "would have been 24.975.000 if the client multiplied — it must not",
            devicePurchasePriceVnd(noServerValue),
        )

        val vnd = Fixtures.device(purchasePrice = 30_000_000, purchasePriceVnd = null)
        assertEquals("VND identity fallback is not a conversion", 30_000_000L, devicePurchasePriceVnd(vnd))
    }

    @Test
    fun soldPriceVndIsNullUntilASaleIsRecorded() {
        val notSold = Fixtures.device(currency = "USD", soldPrice = null, soldPriceVnd = 24_000_000)
        assertNull(deviceSoldPriceVnd(notSold))

        val vndSold = Fixtures.device(soldPrice = 25_000_000)
        assertEquals(25_000_000L, deviceSoldPriceVnd(vndSold))

        val usdSold = Fixtures.device(
            currency = "USD",
            soldPrice = 900,
            soldPriceVnd = 22_500_000,
        )
        assertEquals(22_500_000L, deviceSoldPriceVnd(usdSold))
    }

    @Test
    fun saleProfitVndUsesLockedConversionsOnBothSides() {
        val vnd = Fixtures.device(purchasePrice = 30_000_000, soldPrice = 25_000_000)
        assertEquals(-5_000_000L, deviceSaleProfitVnd(vnd))

        val usd = Fixtures.device(
            purchasePrice = 999,
            currency = "USD",
            fxRate = 25_000,
            purchasePriceVnd = 24_975_000,
            soldPrice = 900,
            soldPriceVnd = 22_500_000,
        )
        assertEquals(
            "22.500.000 − 24.975.000, not 900 − 999 and not 999 × 25.000",
            -2_475_000L,
            deviceSaleProfitVnd(usd),
        )

        val noVndValues = Fixtures.device(
            purchasePrice = 999,
            currency = "USD",
            fxRate = 25_000,
            purchasePriceVnd = null,
            soldPrice = 900,
            soldPriceVnd = null,
        )
        assertNull("no mixing dollars and dong", deviceSaleProfitVnd(noVndValues))
        assertNull("no sale, no profit", deviceSaleProfitVnd(Fixtures.device(soldPrice = null)))
    }

    // ---- the form preview ----------------------------------------------

    @Test
    fun priceVndPreviewMultipliesOnceAndOnlyForThePreview() {
        assertEquals(25_444_530L, priceVnd(999, 25_470))
        assertEquals(0L, priceVnd(0, 25_470))
        assertNull("no rate, no preview", priceVnd(999, null))
        assertNull("zero rate", priceVnd(999, 0))
        assertNull("negative rate", priceVnd(999, -1))
        assertNull("negative price", priceVnd(-1, 25_470))
        assertEquals(
            "Int.MAX_VALUE² must not overflow: $Int",
            4_611_686_014_132_420_609L,
            priceVnd(Int.MAX_VALUE, Int.MAX_VALUE),
        )
    }

    // ---- totals decision -----------------------------------------------

    /**
     * The stats screen's two device tiles are exactly these server fields, and
     * `totalSpend` adds them because both are already VND. No device row's
     * native price is ever added here — that is the whole reason the server
     * sends `purchasePriceVnd`.
     */
    @Test
    fun deviceTotalsAreServerVndSums() {
        val stats = DeviceStats(
            total = 2,
            totalPurchasePrice = 24_975_000,
            totalWarrantyCost = 1_500_000,
        )
        assertEquals(24_975_000L, stats.totalPurchasePrice)
        assertEquals(26_475_000L, stats.totalSpend)

        // The USD row contributing to that 24.975.000 held a native 999. If the
        // client ever rebuilt the total from Device.purchasePrice it would print
        // 999 + whatever the VND device was worth.
        val usd = Fixtures.device(
            purchasePrice = 999,
            currency = "USD",
            fxRate = 25_000,
            purchasePriceVnd = 24_975_000,
        )
        assertEquals(24_975_000L, devicePurchasePriceVnd(usd))
    }
}
