package com.warrantyvault.app.ui.screens.stats

import androidx.annotation.StringRes
import com.warrantyvault.app.R
import com.warrantyvault.app.i18n.AppStrings
import com.warrantyvault.app.network.Forecast
import com.warrantyvault.app.network.ForecastBucket
import com.warrantyvault.app.network.WarrantyType
import com.warrantyvault.app.network.WishlistPriority
import com.warrantyvault.app.network.WishlistStatus

/**
 * Pure logic behind the "Dự báo chi tiêu" card on the stats screen.
 *
 * Kept out of the composables because this is where the two honesty rules of
 * `GET /api/v1/forecast` are actually encoded, and both are cheap to break
 * silently:
 *
 *  1. `subscriptionAutoRenewVnd` is money that **will** be taken automatically;
 *     `subscriptionVnd - subscriptionAutoRenewVnd` is money the user still has to
 *     decide about. The two must never be collapsed into one headline number.
 *  2. `warrantyExpiringVnd` / `wishlistTargetVnd` are **possible** spends (the
 *     cost of the package that is ending, the last recorded price) — savings
 *     references, not commitments. They are never added into the subscription
 *     total and always carry their own "có thể phát sinh" wording.
 */

/**
 * `2026-03` → `Tháng 3/2026` (UTC bucket labels from the API). Anything that is
 * not a well-formed `YYYY-MM` month is returned untouched: showing the server's
 * own string beats inventing "Tháng 0/0".
 */
fun forecastMonthLabel(s: AppStrings, month: String): String {
    val parts = month.trim().split("-")
    if (parts.size != 2) return month
    val (year, rawMonth) = parts
    if (year.length != 4 || rawMonth.length != 2) return month
    if (!year.all { it.isDigit() } || !rawMonth.all { it.isDigit() }) return month
    val index = rawMonth.toIntOrNull() ?: return month
    if (index !in 1..12) return month
    return s.get(R.string.stats_forecast_month, index, year.toInt())
}

/**
 * `2026-03-01T09:30:00Z` → `01/03/2026`. Date half only, like every other
 * naive-UTC timestamp in this app. Mirrors `sessionDateLabel` in the settings
 * package (the money formatter is duplicated per screen package for the same
 * reason); `ForecastFormatTest` pins the two copies together. A missing or
 * malformed value renders an em dash instead of throwing on a list row.
 */
fun forecastDateLabel(iso: String?): String {
    val date = iso?.trim()?.take(10).orEmpty()
    val parts = date.split("-")
    if (parts.size != 3) return "—"
    val (year, month, day) = parts
    if (year.length != 4 || month.length != 2 || day.length != 2) return "—"
    if (parts.any { part -> part.any { !it.isDigit() } }) return "—"
    return "$day/$month/$year"
}

/**
 * Money the user must renew **by hand** in this month: everything scheduled
 * minus what is auto-charged. Clamped at 0 so a payload where the auto-renew
 * split is momentarily inconsistent can never render a negative amount.
 */
fun forecastManualRenewVnd(bucket: ForecastBucket): Long =
    (bucket.subscriptionVnd - bucket.subscriptionAutoRenewVnd).coerceAtLeast(0)

/** Same split, over the whole window. */
fun forecastManualRenewTotalVnd(forecast: Forecast): Long =
    (forecast.subscriptionTotalVnd - forecast.subscriptionAutoRenewTotalVnd).coerceAtLeast(0)

/**
 * A bucket with no charge, no expiring warranty and no wishlist milestone is a
 * real month in the payload (the API always emits every month the window
 * touches) but adds nothing to the screen — those get filtered out of the
 * month-by-month list rather than rendered as a row of zeroes.
 */
fun forecastBucketIsEmpty(bucket: ForecastBucket): Boolean =
    bucket.subscriptionCount <= 0 &&
        bucket.warrantyExpiringCount <= 0 &&
        bucket.wishlistTargetCount <= 0

/**
 * The buckets worth a row, in the server's own (chronological) order. Never
 * assumes `months + 1` rows: the count is a property of when the request ran,
 * not a constant.
 */
fun forecastActiveBuckets(forecast: Forecast): List<ForecastBucket> =
    forecast.buckets.filterNot { forecastBucketIsEmpty(it) }

/**
 * Width share (0f..1f) of one month's subscription bar, relative to the biggest
 * month in the window. The bucket count is data-driven, so `max` has to come
 * from the payload rather than a fixed 12.
 */
fun forecastBarFraction(value: Long, maxValue: Long): Float {
    if (maxValue <= 0L || value <= 0L) return 0f
    return (value.toFloat() / maxValue.toFloat()).coerceIn(0f, 1f)
}

/** Share of a month's subscription money that is auto-charged (0f when nothing is due). */
fun forecastAutoShare(bucket: ForecastBucket): Float =
    forecastBarFraction(bucket.subscriptionAutoRenewVnd, bucket.subscriptionVnd)

/**
 * The Vietnamese honesty line shown under the headline. Prefers the API's own
 * `note` (it knows exactly which model produced these numbers) and only falls
 * back when the field is missing/blank — an older server must not silently cost
 * the user the caveats.
 */
@StringRes
val FORECAST_NOTE_FALLBACK: Int = R.string.stats_forecast_note_fallback

fun forecastNoteText(s: AppStrings, forecast: Forecast): String =
    forecast.note.takeIf { it.isNotBlank() } ?: s.get(FORECAST_NOTE_FALLBACK)

/**
 * "12 tháng tới" — reads `months` from the payload instead of hardcoding 12, so
 * the header cannot disagree with the server window it describes.
 */
fun forecastWindowLabel(s: AppStrings, forecast: Forecast): String =
    if (forecast.months > 0) {
        s.quantity(R.plurals.stats_forecast_window, forecast.months, forecast.months)
    } else {
        s.get(R.string.stats_forecast_window_unknown)
    }

/**
 * Warranty-type code → the shared label (raw code when unknown). The three
 * `raw`-code helpers below mirror what an enum-typed payload would do, and the
 * label itself is the enum's `labelRes` — one resource per member, so the
 * forecast rows cannot drift from the device screens.
 */
fun forecastWarrantyTypeLabel(s: AppStrings, raw: String): String =
    WarrantyType.entries.firstOrNull { it.name == raw }?.let { s.get(it.labelRes) } ?: raw

/** Wishlist priority code → the shared label (raw code when unknown). */
fun forecastPriorityLabel(s: AppStrings, raw: String): String =
    WishlistPriority.entries.firstOrNull { it.name == raw }?.let { s.get(it.labelRes) } ?: raw

/** Wishlist status code → the shared label (raw code when unknown). */
fun forecastWishlistStatusLabel(s: AppStrings, raw: String): String =
    WishlistStatus.entries.firstOrNull { it.name == raw }?.let { s.get(it.labelRes) } ?: raw
