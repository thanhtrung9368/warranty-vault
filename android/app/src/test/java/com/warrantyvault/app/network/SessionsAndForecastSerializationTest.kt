package com.warrantyvault.app.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Contract tests for the two post-shipment reads: `GET /api/v1/auth/sessions`
 * and `GET /api/v1/forecast`.
 *
 * Two shapes are easy to get wrong and impossible to notice in the UI:
 * `SessionSummary.deviceLabel` is nullable by contract, and every forecast money
 * field is int64 — the sums overflow an `Int`, and kotlinx.serialization throws
 * on an out-of-range Int, which would blank the whole stats tab.
 */
class SessionsAndForecastSerializationTest {

    private val json = ApiClient.json

    // ---- sessions ----

    @Test
    fun sessions_decodeTheNullableLabelAndTheCurrentFlag() {
        val res = json.decodeFromString(
            SessionListResponse.serializer(),
            """
                {
                  "sessions": [
                    {
                      "id": "sess-1",
                      "deviceLabel": "Pixel 8",
                      "platform": "android",
                      "current": true,
                      "lastSeenAt": "2026-03-01T09:30:00Z",
                      "createdAt": "2026-02-01T09:30:00Z",
                      "expiresAt": "2026-04-01T09:30:00Z"
                    },
                    {
                      "id": "sess-2",
                      "deviceLabel": null,
                      "platform": null,
                      "current": false,
                      "lastSeenAt": "2026-03-01T08:00:00Z",
                      "createdAt": "2026-01-01T08:00:00Z",
                      "expiresAt": "2026-04-01T08:00:00Z"
                    }
                  ]
                }
            """.trimIndent(),
        )

        assertEquals(2, res.sessions.size)
        assertEquals("Pixel 8", res.sessions.first().deviceLabel)
        assertTrue(res.sessions.first().current)
        // A session created by an older client has no label — null, not "".
        assertNull(res.sessions.last().deviceLabel)
        assertNull(res.sessions.last().platform)
    }

    @Test
    fun sessions_envelope_isNeverNull() {
        assertTrue(json.decodeFromString(SessionListResponse.serializer(), "{}").sessions.isEmpty())
        assertTrue(json.decodeFromString(SessionListResponse.serializer(), """{"sessions":[]}""").sessions.isEmpty())
    }

    @Test
    fun revokeResult_decodesIdempotentSuccess() {
        // alreadyRevoked = true is a 200 success, not an error.
        val already = json.decodeFromString(
            SessionRevokeResult.serializer(),
            """
                {
                  "ok": true,
                  "current": false,
                  "alreadyRevoked": true,
                  "message": "Phiên đăng nhập này đã được thu hồi trước đó."
                }
            """.trimIndent(),
        )

        assertTrue(already.ok)
        assertTrue(already.alreadyRevoked)
        assertTrue(!already.current)
        assertEquals("Phiên đăng nhập này đã được thu hồi trước đó.", already.message)
    }

    @Test
    fun revokeResult_decodesRevokingTheSessionInYourHand() {
        val current = json.decodeFromString(
            SessionRevokeResult.serializer(),
            """
                {
                  "ok": true,
                  "current": true,
                  "alreadyRevoked": false,
                  "message": "Đã thu hồi phiên đăng nhập. Đây là phiên bạn đang dùng — hãy đăng nhập lại."
                }
            """.trimIndent(),
        )

        assertTrue(current.current)
        assertTrue(!current.alreadyRevoked)
        assertTrue(current.message.contains("đăng nhập lại"))
    }

    // ---- forecast ----

    @Test
    fun forecast_decodesBucketsMilestonesAndTheNote() {
        val f = json.decodeFromString(
            Forecast.serializer(),
            """
                {
                  "generatedAt": "2026-03-01T00:00:00Z",
                  "windowStart": "2026-03-01T00:00:00Z",
                  "windowEnd": "2027-03-01T00:00:00Z",
                  "months": 12,
                  "currency": "VND",
                  "subscriptionTotalVnd": 3120000,
                  "subscriptionAutoRenewTotalVnd": 2000000,
                  "subscriptionMonthlyAverageVnd": 260000,
                  "subscriptionsCount": 2,
                  "chargesCount": 12,
                  "buckets": [
                    {
                      "month": "2026-03",
                      "subscriptionVnd": 260000,
                      "subscriptionAutoRenewVnd": 260000,
                      "subscriptionCount": 1,
                      "warrantyExpiringVnd": 0,
                      "warrantyExpiringCount": 0,
                      "wishlistTargetVnd": 0,
                      "wishlistTargetCount": 0
                    },
                    {
                      "month": "2026-04",
                      "subscriptionVnd": 500000,
                      "subscriptionAutoRenewVnd": 200000,
                      "subscriptionCount": 2,
                      "warrantyExpiringVnd": 4000000,
                      "warrantyExpiringCount": 1,
                      "wishlistTargetVnd": 12000000,
                      "wishlistTargetCount": 1
                    }
                  ],
                  "upcomingWarranties": [
                    {
                      "id": "w-1",
                      "deviceId": "dev-1",
                      "deviceName": "iPhone 15 Pro",
                      "type": "STANDARD",
                      "provider": null,
                      "endDate": "2026-04-10T00:00:00Z",
                      "month": "2026-04",
                      "months": 24,
                      "costVnd": 4000000
                    }
                  ],
                  "upcomingWishlist": [
                    {
                      "id": "wl-1",
                      "name": "Steam Deck",
                      "targetDate": "2026-04-20T00:00:00Z",
                      "month": "2026-04",
                      "priority": "WANT",
                      "status": "WATCHING",
                      "currentPriceVnd": 12000000
                    }
                  ],
                  "note": "Chỉ tính các gói đang ACTIVE; gói LIFETIME không bao giờ bị trừ."
                }
            """.trimIndent(),
        )

        assertEquals(2, f.buckets.size)
        // The auto-renew split is preserved per bucket, not collapsed.
        assertEquals(200_000L, f.buckets[1].subscriptionAutoRenewVnd)
        assertEquals(500_000L, f.buckets[1].subscriptionVnd)
        assertEquals(4_000_000L, f.buckets[1].warrantyExpiringVnd)
        assertEquals(12_000_000L, f.buckets[1].wishlistTargetVnd)
        assertEquals("2026-04", f.upcomingWarranties.single().month)
        assertEquals(4_000_000L, f.upcomingWarranties.single().costVnd)
        assertEquals(12_000_000L, f.upcomingWishlist.single().currentPriceVnd)
        assertTrue(f.note.contains("LIFETIME"))
    }

    @Test
    fun forecast_moneyFieldsSurviveInt64Sums() {
        // 2.5 tỷ per month × 12 months is far past Int.MAX_VALUE (2_147_483_647);
        // decoding these into an Int would throw and blank the screen.
        val f = json.decodeFromString(
            Forecast.serializer(),
            """
                {
                  "months": 12,
                  "subscriptionTotalVnd": 30000000000,
                  "subscriptionAutoRenewTotalVnd": 25000000000,
                  "subscriptionMonthlyAverageVnd": 2500000000,
                  "subscriptionsCount": 3,
                  "chargesCount": 12,
                  "buckets": [
                    {
                      "month": "2026-03",
                      "subscriptionVnd": 2500000000,
                      "subscriptionAutoRenewVnd": 2500000000,
                      "subscriptionCount": 1,
                      "warrantyExpiringVnd": 9000000000,
                      "warrantyExpiringCount": 1,
                      "wishlistTargetVnd": 15000000000,
                      "wishlistTargetCount": 2
                    }
                  ],
                  "note": ""
                }
            """.trimIndent(),
        )

        assertEquals(30_000_000_000L, f.subscriptionTotalVnd)
        assertEquals(15_000_000_000L, f.buckets.single().wishlistTargetVnd)
    }

    @Test
    fun forecast_toleratesAbsentOptionalFieldsAndUnknownCodes() {
        val f = json.decodeFromString(
            Forecast.serializer(),
            """
                {
                  "months": 3,
                  "buckets": [],
                  "upcomingWarranties": [
                    {"id": "w-1", "deviceName": "Máy lạ", "type": "SOMETHING_NEW", "costVnd": null}
                  ],
                  "upcomingWishlist": [
                    {"id": "wl-1", "name": "Món lạ", "priority": "SOMETHING_NEW", "status": "SOMETHING_NEW", "currentPriceVnd": null}
                  ],
                  "note": "Ghi chú"
                }
            """.trimIndent(),
        )

        assertTrue(f.buckets.isEmpty())
        assertTrue(f.upcomingWarranties.isNotEmpty())
        // Unknown enum members and "no price recorded" both survive decoding.
        assertEquals("SOMETHING_NEW", f.upcomingWarranties.single().type)
        assertNull(f.upcomingWarranties.single().costVnd)
        assertNull(f.upcomingWishlist.single().currentPriceVnd)
        assertEquals(0L, f.subscriptionTotalVnd)
    }
}
