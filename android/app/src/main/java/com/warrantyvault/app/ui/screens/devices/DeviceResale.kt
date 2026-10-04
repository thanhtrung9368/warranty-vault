package com.warrantyvault.app.ui.screens.devices

import com.warrantyvault.app.R
import com.warrantyvault.app.i18n.AppStrings
import com.warrantyvault.app.i18n.money

/**
 * Device resale helpers — openapi `Device.soldAt` / `Device.soldPrice`
 * (roadmap #12 / migration 0006).
 *
 * `soldAt` is a naive UTC timestamp on the wire, exactly the same shape as
 * `purchaseDate`: `"2026-03-01T00:00:00"` — **no** `Z`, no offset. It therefore
 * must never reach an instant-based parser, which would shift the calendar day
 * by the device's UTC offset. Like `purchaseDate` in [AddDeviceSheet] and
 * [WarrantyEditSheet], both the form and the detail screen only ever keep the
 * date half (`take(10)`).
 */

/** Wire value → form value (`"2026-03-01T00:00:00"` → `"2026-03-01"`). */
internal fun soldDateInput(wire: String?): String = wire?.trim()?.take(10).orEmpty()

/** Form value → request value. Blank means "chưa bán" and drops the key. */
internal fun soldDateRequest(raw: String): String? = raw.trim().ifBlank { null }

/**
 * Form value → request value. Blank is `null` ("chưa bán") while `"0"` is a real
 * price — a give-away — and must be sent as `0`, not treated as absent. Anything
 * non-numeric degrades to `null` rather than throwing; the field is digit-only.
 */
internal fun soldPriceRequest(raw: String): Int? = raw.trim().ifBlank { null }?.toIntOrNull()

/**
 * True when a sale was recorded. The server enforces the pair rule, so both
 * halves normally arrive together; either one is enough to render the sale
 * section instead of hiding data a newer server sent.
 */
internal fun hasSaleRecord(soldAt: String?, soldPrice: Int?): Boolean =
    soldPrice != null || !soldAt.isNullOrBlank()

/**
 * Lãi/lỗ in VND: `soldPrice − purchasePrice`, or `null` when the device was not
 * sold (no price recorded).
 *
 * Both operands are non-negative int32 by contract — Go's `ValidateDeviceInput`
 * rejects a negative `purchasePrice` ("Giá mua không hợp lệ") and a negative
 * `soldPrice` ("Giá bán không hợp lệ") — so the difference cannot overflow `Int`.
 */
internal fun saleProfit(soldPrice: Int?, purchasePrice: Int): Int? =
    soldPrice?.let { it - purchasePrice }

/**
 * Profit/loss copy for the device detail card, built with the shared money
 * formatter: `"Lãi 5.000.000 ₫"`, `"Lỗ 2.000.000 ₫"`, or `"Hoà vốn"` when the sale
 * broke even — and the English equivalents when the app is in English.
 *
 * The three sentences live in `strings_devices.xml` rather than here, so the
 * card is no longer the one thing on the screen that ignores the language
 * setting.
 */
internal fun saleProfitLabel(s: AppStrings, profit: Int): String = when {
    profit > 0 -> s.get(R.string.dev_sale_profit, s.money(profit.toLong()))
    profit < 0 -> s.get(R.string.dev_sale_loss, s.money(-profit.toLong()))
    else -> s.get(R.string.dev_sale_breakeven)
}
