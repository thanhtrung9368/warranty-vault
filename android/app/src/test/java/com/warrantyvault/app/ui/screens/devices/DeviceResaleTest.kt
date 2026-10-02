package com.warrantyvault.app.ui.screens.devices

import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.Device
import com.warrantyvault.app.network.DeviceInput
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Resale (`soldAt` / `soldPrice`, roadmap #12) — the pure half of the feature:
 * wire-format parsing, the form ↔ request mapping and the Vietnamese
 * profit/loss copy. The server owns the pair rule and the 80-byte-style caps,
 * so nothing here pre-empts a `fieldErrors` message.
 */
class DeviceResaleTest {

    private val json = ApiClient.json

    // ---- soldAt: naive-UTC timestamp, exactly like purchaseDate ----

    /**
     * `"2026-03-01T00:00:00"` has no `Z` and no offset: it is a naive UTC wall
     * clock, not an instant. Parsing it as an instant in a +07:00 zone would
     * shift the calendar day (23:30Z → 06:30 next day in Vietnam), so the helper
     * — like `purchaseDate.take(10)` in AddDeviceSheet/WarrantyEditSheet — only
     * ever keeps the first 10 characters.
     */
    @Test
    fun soldDateInput_keepsTheCalendarDateAndNeverShiftsByAnOffset() {
        assertEquals("2026-03-01", soldDateInput("2026-03-01T00:00:00"))
        assertEquals("2026-03-01", soldDateInput("2026-03-01T06:30:00"))
        assertEquals("2026-03-01", soldDateInput("2026-03-01T23:30:00"))
        assertEquals("2026-03-01", soldDateInput("2026-03-01T00:00:00.000"))
        assertEquals("2026-03-01", soldDateInput("2026-03-01"))
    }

    @Test
    fun soldDateInput_treatsMissingAndBlankAsNoDate() {
        assertEquals("", soldDateInput(null))
        assertEquals("", soldDateInput(""))
        assertEquals("", soldDateInput("   "))
    }

    // ---- form → request ----

    @Test
    fun soldDateRequest_blanksToNullAndPassesTheTypedDateThrough() {
        assertNull("blank means chưa bán", soldDateRequest(""))
        assertNull(soldDateRequest("   "))
        assertEquals("2026-03-01", soldDateRequest("2026-03-01"))
        assertEquals("2026-03-01", soldDateRequest("  2026-03-01  "))
    }

    @Test
    fun soldPriceRequest_keepsZeroAndBlanksToNull() {
        assertNull("blank is 'chưa bán', not 0đ", soldPriceRequest(""))
        assertNull(soldPriceRequest("   "))
        assertEquals(0, soldPriceRequest("0"))
        assertEquals(7_500_000, soldPriceRequest("7500000"))
        assertNull("a non-numeric value degrades to absent", soldPriceRequest("abc"))
    }

    /**
     * A half-filled sale is forwarded as-is — one non-null half and one null —
     * so the server's `fieldErrors.soldAt` / `fieldErrors.soldPrice` copy is what
     * the user reads. The client must not "helpfully" invent the missing half.
     */
    @Test
    fun halfFilledSale_isForwardedAsIsForTheServerToReject() {
        // Date typed, price left blank → soldPrice stays null (server: "Thiếu giá bán").
        assertEquals("2026-03-01", soldDateRequest("2026-03-01"))
        assertNull(soldPriceRequest(""))

        // Price typed, date left blank → soldAt stays null (server: "Thiếu ngày bán").
        assertEquals(7_500_000, soldPriceRequest("7500000"))
        assertNull(soldDateRequest(""))

        // Both blank → both null, which the server reads as "clear the sale".
        assertNull(soldDateRequest("  "))
        assertNull(soldPriceRequest("  "))
    }

    // ---- profit / loss ----

    @Test
    fun saleProfit_isSoldPriceMinusPurchasePrice() {
        assertEquals(5_000_000, saleProfit(soldPrice = 35_000_000, purchasePrice = 30_000_000))
        assertEquals(-5_000_000, saleProfit(soldPrice = 25_000_000, purchasePrice = 30_000_000))
        assertEquals(0, saleProfit(soldPrice = 30_000_000, purchasePrice = 30_000_000))
        // A give-away (0đ) is a real, recorded loss of the whole purchase price.
        assertEquals(-30_000_000, saleProfit(soldPrice = 0, purchasePrice = 30_000_000))
    }

    @Test
    fun saleProfit_isNullUntilASaleIsRecorded() {
        assertNull("not sold ⇒ no profit/loss to show", saleProfit(soldPrice = null, purchasePrice = 30_000_000))
    }

    @Test
    fun saleProfitLabel_isVietnameseAndUsesTheSharedVndFormatter() {
        assertEquals("Lãi 5.000.000đ", saleProfitLabel(5_000_000))
        assertEquals("Lỗ 5.000.000đ", saleProfitLabel(-5_000_000))
        assertEquals("Hoà vốn", saleProfitLabel(0))
    }

    @Test
    fun hasSaleRecord_isTrueForEitherHalfOfThePair() {
        assertFalse(hasSaleRecord(soldAt = null, soldPrice = null))
        assertFalse(hasSaleRecord(soldAt = "  ", soldPrice = null))
        assertTrue(hasSaleRecord(soldAt = "2026-03-01T00:00:00", soldPrice = 25_000_000))
        assertTrue("a price alone still renders the sale", hasSaleRecord(soldAt = null, soldPrice = 0))
        assertTrue(hasSaleRecord(soldAt = "2026-03-01", soldPrice = null))
    }

    // ---- wire shapes ----

    @Test
    fun deviceInput_omitsTheSalePairWhenNotSold() {
        val encoded = json.encodeToString(
            DeviceInput.serializer(),
            DeviceInput(name = "iPhone", category = "PHONE", purchaseDate = "2024-03-01"),
        )

        assertFalse("no sale ⇒ both keys absent: $encoded", encoded.contains("soldAt"))
        assertFalse(encoded.contains("soldPrice"))
    }

    @Test
    fun deviceInput_sendsZeroAsARealSalePrice() {
        val encoded = json.encodeToString(
            DeviceInput.serializer(),
            DeviceInput(
                name = "iPhone",
                category = "PHONE",
                purchaseDate = "2024-03-01",
                soldAt = "2026-03-01",
                soldPrice = 0,
            ),
        )

        assertTrue("0đ is a give-away, not 'absent': $encoded", encoded.contains("\"soldPrice\":0"))
        assertTrue(encoded.contains("\"soldAt\":\"2026-03-01\""))
    }

    @Test
    fun device_decodesTheNaiveSoldTimestampAndKeepsNulls() {
        val sold = json.decodeFromString(
            Device.serializer(),
            """
                {
                  "id": "dev-1", "name": "iPhone", "category": "PHONE",
                  "purchaseDate": "2024-03-01", "purchasePrice": 30000000,
                  "status": "SOLD",
                  "soldAt": "2026-03-01T00:00:00", "soldPrice": 25000000
                }
            """.trimIndent(),
        )
        assertEquals("2026-03-01T00:00:00", sold.soldAt)
        assertEquals(25_000_000, sold.soldPrice)
        assertEquals("2026-03-01", soldDateInput(sold.soldAt))

        val unsold = json.decodeFromString(
            Device.serializer(),
            """{"id":"dev-2","name":"Chuột","category":"ACCESSORY","purchaseDate":"2024-05-05","soldAt":null,"soldPrice":null}""",
        )
        assertNull(unsold.soldAt)
        assertNull(unsold.soldPrice)
        assertFalse(hasSaleRecord(unsold.soldAt, unsold.soldPrice))
    }
}
