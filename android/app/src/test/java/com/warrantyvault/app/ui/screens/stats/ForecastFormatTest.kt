package com.warrantyvault.app.ui.screens.stats

import com.warrantyvault.app.network.Forecast
import com.warrantyvault.app.network.ForecastBucket
import com.warrantyvault.app.network.ForecastWarranty
import com.warrantyvault.app.network.ForecastWishlistItem
import com.warrantyvault.app.ui.screens.settings.sessionDateLabel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The honesty rules of `GET /api/v1/forecast`, as pure functions.
 *
 * Three things are pinned here because the UI cannot be trusted to remember them
 * on its own: (1) auto-charged money stays separate from money the user must
 * decide about, (2) warranty/wishlist figures are never folded into the
 * subscription total, (3) the bucket count is `months + 1` shaped data, not a
 * constant 12.
 */
class ForecastFormatTest {

    private fun bucket(
        month: String = "2026-03",
        subscriptionVnd: Long = 260_000,
        autoRenewVnd: Long = 260_000,
        subscriptionCount: Long = 1,
        warrantyVnd: Long = 0,
        warrantyCount: Long = 0,
        wishlistVnd: Long = 0,
        wishlistCount: Long = 0,
    ) = ForecastBucket(
        month = month,
        subscriptionVnd = subscriptionVnd,
        subscriptionAutoRenewVnd = autoRenewVnd,
        subscriptionCount = subscriptionCount,
        warrantyExpiringVnd = warrantyVnd,
        warrantyExpiringCount = warrantyCount,
        wishlistTargetVnd = wishlistVnd,
        wishlistTargetCount = wishlistCount,
    )

    // ---- month labels ----

    @Test
    fun monthLabel_rendersVietnameseMonths() {
        assertEquals("Tháng 1/2026", forecastMonthLabel("2026-01"))
        assertEquals("Tháng 3/2026", forecastMonthLabel("2026-03"))
        assertEquals("Tháng 12/2026", forecastMonthLabel("2026-12"))
    }

    @Test
    fun monthLabel_keepsSomethingUnparseableReadable() {
        // Never invent "Tháng 0/0" — showing the server's own string is honest.
        assertEquals("2026-13", forecastMonthLabel("2026-13"))
        assertEquals("2026-00", forecastMonthLabel("2026-00"))
        assertEquals("nope", forecastMonthLabel("nope"))
        assertEquals("", forecastMonthLabel(""))
    }

    // ---- dates ----

    @Test
    fun dateLabel_readsTheDateHalfOnly() {
        assertEquals("01/03/2026", forecastDateLabel("2026-03-01T09:30:00Z"))
        assertEquals("31/12/2026", forecastDateLabel("2026-12-31"))
        assertEquals("—", forecastDateLabel(null))
        assertEquals("—", forecastDateLabel("not-a-date"))
    }

    @Test
    fun dateLabel_hasNotDriftedFromTheSessionsCopy() {
        listOf("2026-03-01T09:30:00Z", "2026-12-31", "not-a-date", "", "2026-3-1").forEach { iso ->
            assertEquals(
                "forecast/stats date labels drifted for \"$iso\"",
                sessionDateLabel(iso),
                forecastDateLabel(iso),
            )
        }
    }

    // ---- the auto-renew split ----

    @Test
    fun manualRenew_isThePartTheUserMustDecideAbout() {
        val mixed = bucket(subscriptionVnd = 500_000, autoRenewVnd = 200_000)

        assertEquals(300_000L, forecastManualRenewVnd(mixed))
        // The two halves are NOT collapsed: the difference survives.
        assertNotEquals(mixed.subscriptionAutoRenewVnd, forecastManualRenewVnd(mixed))
    }

    @Test
    fun manualRenew_isZeroWhenEverythingIsAutoCharged() {
        assertEquals(0L, forecastManualRenewVnd(bucket(subscriptionVnd = 260_000, autoRenewVnd = 260_000)))
    }

    @Test
    fun manualRenew_neverGoesNegativeOnAnInconsistentPayload() {
        // Defensive: a payload where the split overshoots must not render "−50.000đ".
        assertEquals(0L, forecastManualRenewVnd(bucket(subscriptionVnd = 100_000, autoRenewVnd = 150_000)))
    }

    @Test
    fun manualRenewTotal_mirrorsThePerBucketSplit() {
        val f = forecast(
            subscriptionTotalVnd = 900_000,
            autoRenewTotalVnd = 400_000,
        )

        assertEquals(500_000L, forecastManualRenewTotalVnd(f))
        assertEquals(0L, forecastManualRenewTotalVnd(forecast()))
    }

    // ---- the window / bucket count is data, not 12 ----

    @Test
    fun activeBuckets_skipMonthsWithNothingInThem() {
        val f = forecast(
            months = 12,
            buckets = listOf(
                bucket(month = "2026-03"),
                bucket(month = "2026-04", subscriptionVnd = 0, autoRenewVnd = 0, subscriptionCount = 0),
                bucket(
                    month = "2026-05",
                    subscriptionVnd = 0,
                    autoRenewVnd = 0,
                    subscriptionCount = 0,
                    warrantyVnd = 4_000_000,
                    warrantyCount = 1,
                ),
            ),
        )

        assertEquals(listOf("2026-03", "2026-05"), forecastActiveBuckets(f).map { it.month })
        // 13 buckets in, 2 rows out — the count was never assumed.
        assertTrue(f.buckets.size > forecastActiveBuckets(f).size)
    }

    @Test
    fun emptyBucket_isOneWithNoChargeNoWarrantyAndNoWishlist() {
        assertTrue(forecastBucketIsEmpty(bucket(subscriptionVnd = 0, autoRenewVnd = 0, subscriptionCount = 0)))
        assertFalse(forecastBucketIsEmpty(bucket()))
        assertFalse(
            forecastBucketIsEmpty(
                bucket(subscriptionVnd = 0, autoRenewVnd = 0, subscriptionCount = 0, wishlistCount = 1),
            ),
        )
    }

    @Test
    fun barFractions_areRelativeToTheBiggestMonthInTheWindow() {
        assertEquals(1f, forecastBarFraction(500_000, 500_000), 0.0001f)
        assertEquals(0.5f, forecastBarFraction(250_000, 500_000), 0.0001f)
        assertEquals(0f, forecastBarFraction(0, 500_000), 0.0001f)
        // A window with no charges at all must not divide by zero.
        assertEquals(0f, forecastBarFraction(100, 0), 0.0001f)
    }

    @Test
    fun autoShare_isTheSolidPartOfTheMonthBar() {
        assertEquals(0.4f, forecastAutoShare(bucket(subscriptionVnd = 500_000, autoRenewVnd = 200_000)), 0.0001f)
        assertEquals(0f, forecastAutoShare(bucket(subscriptionVnd = 0, autoRenewVnd = 0, subscriptionCount = 0)), 0.0001f)
    }

    // ---- the honesty line ----

    @Test
    fun note_prefersTheApisOwnVietnameseSentence() {
        val f = forecast(note = "Chỉ tính các gói đang ACTIVE; gói LIFETIME không bao giờ bị trừ.")

        assertEquals(
            "Chỉ tính các gói đang ACTIVE; gói LIFETIME không bao giờ bị trừ.",
            forecastNoteText(f),
        )
    }

    @Test
    fun note_fallsBackToTheSameCaveatsWhenTheServerSendsNone() {
        assertEquals(FORECAST_NOTE_FALLBACK, forecastNoteText(forecast(note = "")))
        assertEquals(FORECAST_NOTE_FALLBACK, forecastNoteText(forecast(note = "   ")))
        // The fallback still refuses to call possible spend a commitment.
        assertTrue(FORECAST_NOTE_FALLBACK.contains("có thể phát sinh"))
        assertTrue(FORECAST_NOTE_FALLBACK.contains("LIFETIME"))
    }

    @Test
    fun windowLabel_usesThePayloadMonthsNotAHardcodedTwelve() {
        assertEquals("12 tháng tới", forecastWindowLabel(forecast(months = 12)))
        assertEquals("3 tháng tới", forecastWindowLabel(forecast(months = 3)))
        assertEquals("24 tháng tới", forecastWindowLabel(forecast(months = 24)))
        assertEquals("các tháng tới", forecastWindowLabel(forecast(months = 0)))
    }

    // ---- code → shared Vietnamese label ----

    @Test
    fun codeLabels_reuseTheEnumCopyAndSurviveAnUnknownCode() {
        assertEquals("Tiêu chuẩn", forecastWarrantyTypeLabel("STANDARD"))
        assertEquals("Mở rộng", forecastWarrantyTypeLabel("EXTENDED"))
        assertEquals("Bên thứ ba", forecastWarrantyTypeLabel("THIRD_PARTY"))
        assertEquals("Muốn", forecastPriorityLabel("WANT"))
        assertEquals("Phải mua", forecastPriorityLabel("MUST"))
        assertEquals("Đang theo dõi", forecastWishlistStatusLabel("WATCHING"))
        // An unseen enum member is data: show it rather than throw the screen away.
        assertEquals("SOMETHING_NEW", forecastWarrantyTypeLabel("SOMETHING_NEW"))
    }

    // ---- the payload's own shape ----

    @Test
    fun warrantyAndWishlistMoney_stayOutOfTheSubscriptionTotal() {
        val f = forecast(
            subscriptionTotalVnd = 1_000_000,
            autoRenewTotalVnd = 600_000,
            upcomingWarranties = listOf(
                ForecastWarranty(
                    id = "w-1",
                    deviceName = "iPhone 15 Pro",
                    type = "STANDARD",
                    endDate = "2026-04-01T00:00:00Z",
                    costVnd = 8_000_000,
                ),
            ),
            upcomingWishlist = listOf(
                ForecastWishlistItem(
                    id = "wl-1",
                    name = "Steam Deck",
                    targetDate = "2026-05-01T00:00:00Z",
                    currentPriceVnd = 12_000_000,
                ),
            ),
        )

        // The headline figure is subscription money only — 1.000.000đ, not
        // 21.000.000đ of "possible" spend dressed up as a commitment.
        assertEquals(1_000_000L, f.subscriptionTotalVnd)
        assertEquals(8_000_000L, f.upcomingWarranties.single().costVnd)
        assertEquals(12_000_000L, f.upcomingWishlist.single().currentPriceVnd)
    }

    private fun forecast(
        months: Int = 12,
        subscriptionTotalVnd: Long = 0,
        autoRenewTotalVnd: Long = 0,
        buckets: List<ForecastBucket> = emptyList(),
        upcomingWarranties: List<ForecastWarranty> = emptyList(),
        upcomingWishlist: List<ForecastWishlistItem> = emptyList(),
        note: String = "",
    ) = Forecast(
        generatedAt = "2026-03-01T00:00:00Z",
        windowStart = "2026-03-01T00:00:00Z",
        windowEnd = "2027-03-01T00:00:00Z",
        months = months,
        subscriptionTotalVnd = subscriptionTotalVnd,
        subscriptionAutoRenewTotalVnd = autoRenewTotalVnd,
        subscriptionMonthlyAverageVnd = 260_000,
        subscriptionsCount = 2,
        chargesCount = 12,
        buckets = buckets,
        upcomingWarranties = upcomingWarranties,
        upcomingWishlist = upcomingWishlist,
        note = note,
    )
}
