package com.warrly.network

import com.warrly.insurance.insurancePackRequest
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import retrofit2.HttpException

/**
 * End-to-end checks over a real OkHttp/Retrofit stack against MockWebServer:
 * URL building, the bearer-token interceptor, request body encoding and the
 * error path that `Errors.kt` later formats.
 */
class ApiClientNetworkTest {

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun api(
        token: String? = "tok-123",
        baseUrl: String = server.url("/").toString(),
    ): ApiService = ApiClient.build(baseUrl) { token }

    private fun enqueueJson(body: String, code: Int = 200) {
        server.enqueue(
            MockResponse()
                .setResponseCode(code)
                .addHeader("Content-Type", "application/json")
                .setBody(body),
        )
    }

    @Test
    fun me_sendsBearerTokenAndDecodesTheUser() = runBlocking {
        enqueueJson("""{"user":{"id":"u1","email":"an@example.com","name":"Nguyễn An","aiOptIn":true}}""")

        val me = api().me()

        assertEquals("u1", me.user.id)
        assertEquals("Nguyễn An", me.user.name)
        assertTrue(me.user.aiOptIn)

        val recorded = server.takeRequest()
        assertEquals("GET", recorded.method)
        assertEquals("/api/v1/auth/me", recorded.path)
        assertEquals("Bearer tok-123", recorded.getHeader("Authorization"))

        // No token (or a blank one) must not send an empty Authorization header.
        enqueueJson("""{"user":{"id":"u1","email":"an@example.com"}}""")
        api(token = null).me()
        assertNull(server.takeRequest().getHeader("Authorization"))

        enqueueJson("""{"user":{"id":"u1","email":"an@example.com"}}""")
        api(token = "   ").me()
        assertNull(server.takeRequest().getHeader("Authorization"))
    }

    @Test
    fun postBody_isJsonEncodedAndBaseUrlWithoutTrailingSlashStillWorks() = runBlocking {
        enqueueJson("""{"accessToken":"tok","expiresAt":"2025-01-01T00:00:00Z","user":{"id":"u1","email":"an@example.com"}}""")

        // No trailing slash: ApiClient must add it before Retrofit sees the URL.
        val service = api(baseUrl = server.url("/").toString().removeSuffix("/"))
        service.login(LoginInput(email = "an@example.com", password = "s3cret"))

        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals("/api/v1/auth/login", recorded.path)
        assertTrue(
            "unexpected content type: ${recorded.getHeader("Content-Type")}",
            recorded.getHeader("Content-Type")!!.startsWith("application/json"),
        )

        val body = recorded.body.readUtf8()
        assertTrue("email must be sent: $body", body.contains("\"email\":\"an@example.com\""))
        assertTrue("platform default must be sent: $body", body.contains("\"platform\":\"android\""))
        assertTrue("null deviceLabel must be dropped: $body", !body.contains("deviceLabel"))
    }

    @Test
    fun queryParameters_areForwardedAndRemindersDefaultToThirtyDays() = runBlocking {
        enqueueJson("""{"devices":[]}""")
        api().listDevices(q = "mac", category = "LAPTOP", status = "ACTIVE", sort = "name", dir = "asc")
        assertEquals(
            "/api/v1/devices?q=mac&category=LAPTOP&status=ACTIVE&sort=name&dir=asc",
            server.takeRequest().path,
        )

        enqueueJson("""{"reminders":[]}""")
        api().listUpcomingReminders()
        assertEquals("/api/v1/reminders?withinDays=30", server.takeRequest().path)

        enqueueJson("""{"reminders":[]}""")
        api().listUpcomingReminders(withinDays = 7)
        assertEquals("/api/v1/reminders?withinDays=7", server.takeRequest().path)

        // `includeDismissed` is only on the wire when the caller opts in; the
        // default read above stayed exactly `?withinDays=30`.
        enqueueJson("""{"reminders":[]}""")
        api().listUpcomingReminders(withinDays = 365, includeDismissed = true)
        assertEquals(
            "/api/v1/reminders?withinDays=365&includeDismissed=true",
            server.takeRequest().path,
        )
    }

    @Test
    fun widenedReminderFeed_decodesTheExtraHiddenRowsAndTheirDeviceStatus() = runBlocking {
        enqueueJson(
            """
            {
              "reminders": [
                {
                  "id": "war-visible",
                  "deviceId": "dev-1",
                  "device": {"id": "dev-1", "name": "iPhone 15", "category": "PHONE", "status": "ACTIVE"},
                  "type": "STANDARD",
                  "startDate": "2024-01-01T00:00:00",
                  "endDate": "2026-11-01T00:00:00",
                  "months": 24
                },
                {
                  "id": "war-hidden",
                  "deviceId": "dev-2",
                  "device": {"id": "dev-2", "name": "Galaxy Tab S9", "category": "TABLET", "status": "SOLD"},
                  "type": "STANDARD",
                  "provider": "Samsung Care",
                  "startDate": "2022-01-01T00:00:00",
                  "endDate": "2024-01-01T00:00:00",
                  "months": 24,
                  "isDismissed": true
                }
              ]
            }
            """.trimIndent(),
        )

        val res = api().listUpcomingReminders(withinDays = 365, includeDismissed = true)

        assertEquals(
            "/api/v1/reminders?withinDays=365&includeDismissed=true",
            server.takeRequest().path,
        )
        assertEquals(2, res.reminders.size)
        // Absent `isDismissed` means visible; present-and-true is the hidden row
        // the default feed would have dropped.
        assertFalse(res.reminders[0].isDismissed)
        assertEquals(DeviceStatus.ACTIVE, res.reminders[0].device.status)
        assertTrue(res.reminders[1].isDismissed)
        assertEquals(DeviceStatus.SOLD, res.reminders[1].device.status)
        assertEquals("Samsung Care", res.reminders[1].provider)
    }

    @Test
    fun search_forwardsTheKeywordAndThePerGroupLimit() = runBlocking {
        enqueueJson(
            """
            {
              "query": "samsung",
              "devices": [
                {
                  "id": "d1",
                  "userId": "u1",
                  "name": "Galaxy S24",
                  "category": "PHONE",
                  "purchaseDate": "2024-03-01T00:00:00",
                  "purchasePrice": 0,
                  "status": "ACTIVE"
                }
              ],
              "subscriptions": [],
              "wishlist": []
            }
            """.trimIndent(),
        )

        val res = api().search(q = "samsung", limit = 20)

        assertEquals("samsung", res.query)
        assertEquals("Galaxy S24", res.devices.single().name)
        assertTrue(res.subscriptions.isEmpty())
        assertEquals("/api/v1/search?q=samsung&limit=20", server.takeRequest().path)

        // No keyword → the parameters are omitted entirely (never `q=`): the
        // client shows its own "gõ gì đó" state instead of asking the server
        // for an empty result set.
        enqueueJson("""{"query":"","devices":[],"subscriptions":[],"wishlist":[]}""")
        api().search()
        assertEquals("/api/v1/search", server.takeRequest().path)
    }

    @Test
    fun errorResponse_surfacesAsHttpExceptionCarryingTheVietnameseMessage() {
        enqueueJson("""{"error":"unauthorized","message":"Phiên đăng nhập đã hết hạn"}""", code = 401)

        val thrown = assertThrows(HttpException::class.java) {
            runBlocking { api().me() }
        }

        assertEquals(401, thrown.code())
        assertTrue(thrown.isUnauthorized)
        assertEquals("Phiên đăng nhập đã hết hạn", thrown.toUserMessage(ApiClient.json))
    }

    // ---- device sessions (GET/DELETE /api/v1/auth/sessions) ----

    @Test
    fun listSessions_hitsTheAuthSessionsPathAndReadsTheNullableLabel() = runBlocking {
        enqueueJson(
            """
                {
                  "sessions": [
                    {"id": "sess-1", "deviceLabel": null, "platform": "android", "current": true,
                     "lastSeenAt": "2026-03-01T09:30:00Z", "createdAt": "2026-02-01T09:30:00Z",
                     "expiresAt": "2026-04-01T09:30:00Z"}
                  ]
                }
            """.trimIndent(),
        )

        val res = api().listSessions()

        assertNull(res.sessions.single().deviceLabel)
        assertTrue(res.sessions.single().current)

        val recorded = server.takeRequest()
        assertEquals("GET", recorded.method)
        assertEquals("/api/v1/auth/sessions", recorded.path)
        assertEquals("Bearer tok-123", recorded.getHeader("Authorization"))
    }

    @Test
    fun revokeSession_isADeleteOnTheSessionIdAndDecodesCurrent() = runBlocking {
        enqueueJson(
            """
                {"ok": true, "current": true, "alreadyRevoked": false,
                 "message": "Đã thu hồi phiên đăng nhập. Đây là phiên bạn đang dùng — hãy đăng nhập lại."}
            """.trimIndent(),
        )

        val res = api().revokeSession("sess-1")

        assertTrue(res.current)
        assertTrue(!res.alreadyRevoked)

        val recorded = server.takeRequest()
        assertEquals("DELETE", recorded.method)
        assertEquals("/api/v1/auth/sessions/sess-1", recorded.path)
    }

    // ---- spending forecast (GET /api/v1/forecast) ----

    @Test
    fun forecast_sendsTheMonthsQueryAndDecodesTheSplit() = runBlocking {
        enqueueJson(
            """
                {
                  "months": 12,
                  "subscriptionTotalVnd": 3120000,
                  "subscriptionAutoRenewTotalVnd": 2000000,
                  "buckets": [
                    {"month": "2026-03", "subscriptionVnd": 260000, "subscriptionAutoRenewVnd": 200000,
                     "subscriptionCount": 1, "warrantyExpiringVnd": 0, "warrantyExpiringCount": 0,
                     "wishlistTargetVnd": 0, "wishlistTargetCount": 0}
                  ],
                  "note": "Chỉ tính các gói đang ACTIVE; gói LIFETIME không bao giờ bị trừ."
                }
            """.trimIndent(),
        )

        val f = api().getForecast(months = 12)

        assertEquals(3_120_000L, f.subscriptionTotalVnd)
        assertEquals(200_000L, f.buckets.single().subscriptionAutoRenewVnd)
        assertEquals(1, f.buckets.size)
        assertEquals("/api/v1/forecast?months=12", server.takeRequest().path)

        // No explicit window → the parameter is omitted and the server default
        // (12) applies; never a hardcoded client-side 12 sent as `months=12`.
        enqueueJson("""{"months": 12, "buckets": [], "note": ""}""")
        api().getForecast()
        assertEquals("/api/v1/forecast", server.takeRequest().path)
    }

    // ---- warnings on device save ----

    @Test
    fun createDevice_surfacesTheAdvisoryWarningsAlongsideTheCreatedDevice() = runBlocking {
        enqueueJson(
            """
                {
                  "device": {
                    "id": "dev-1", "name": "iPhone 15 Pro", "category": "PHONE",
                    "purchaseDate": "2024-03-01T00:00:00", "purchasePrice": 30000000,
                    "status": "ACTIVE", "serialNumber": "356938035643809"
                  },
                  "warnings": [
                    {"code": "IMEI_CHECKSUM", "field": "serialNumber",
                     "message": "15 số này không đúng checksum IMEI (Luhn) — có thể sai một chữ số."}
                  ]
                }
            """.trimIndent(),
            code = 201,
        )

        val res = api().createDevice(
            DeviceInput(name = "iPhone 15 Pro", category = "PHONE", purchaseDate = "2024-03-01"),
        )

        // Saved, not rejected — the warning rides along with the created row.
        assertEquals("dev-1", res.device.id)
        assertEquals("IMEI_CHECKSUM", res.warnings.single().code)

        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals("/api/v1/devices", recorded.path)
    }

    // ---- exchange/return window round trip (migration 0010) ----

    /**
     * The trap this pins: `PATCH /api/v1/devices/{id}` replaces the whole device,
     * so a body without `returnWindowDays`/`receivedAt` CLEARS a window recorded
     * by another client. The sheet loads the stored value and sends it back; this
     * asserts the keys really reach the wire with the loaded values.
     */
    @Test
    fun updateDevice_sendsTheReturnWindowBackSoAnEditCannotEraseIt() = runBlocking {
        enqueueJson(
            """
                {
                  "device": {
                    "id": "dev-1", "name": "iPhone 15 Pro", "category": "PHONE",
                    "purchaseDate": "2026-03-01T00:00:00", "purchasePrice": 30000000,
                    "status": "ACTIVE", "returnWindowDays": 30, "receivedAt": "2026-03-02T00:00:00"
                  },
                  "warnings": []
                }
            """.trimIndent(),
        )

        api().updateDevice(
            "dev-1",
            DeviceInput(
                name = "iPhone 15 Pro",
                category = "PHONE",
                purchaseDate = "2026-03-01",
                returnWindowDays = 30,
                receivedAt = "2026-03-02",
            ),
        )

        val recorded = server.takeRequest()
        assertEquals("PATCH", recorded.method)
        assertEquals("/api/v1/devices/dev-1", recorded.path)
        val body = recorded.body.readUtf8()
        assertTrue("window length must be sent: $body", body.contains("\"returnWindowDays\":30"))
        assertTrue("delivery date must be sent: $body", body.contains("\"receivedAt\":\"2026-03-02\""))

        // `0` is "cửa hàng không cho đổi trả" — a real value that must not be
        // dropped the way a null is.
        enqueueJson("""{"device":{"id":"dev-1","name":"x","category":"PHONE","purchaseDate":"2026-03-01"}}""")
        api().updateDevice(
            "dev-1",
            DeviceInput(
                name = "x",
                category = "PHONE",
                purchaseDate = "2026-03-01",
                returnWindowDays = 0,
            ),
        )
        val zeroBody = server.takeRequest().body.readUtf8()
        assertTrue("0 is not absent: $zeroBody", zeroBody.contains("\"returnWindowDays\":0"))
    }

    // ---- reminder lead days (Device.leadDays / Subscription.leadDays) ----

    /**
     * The device sheet must send the schedule the user picked, not lean on the
     * server default: on an edit, omitting the key means "unchanged", so a
     * missing pass-through would silently keep the old 30/7 schedule forever.
     */
    @Test
    fun createDevice_sendsTheChosenReminderSchedule() = runBlocking {
        enqueueJson(
            """
                {
                  "device": {
                    "id": "dev-1", "name": "Máy lọc nước", "category": "APPLIANCE",
                    "purchaseDate": "2026-03-01", "leadDays": [14, 3]
                  },
                  "warnings": []
                }
            """.trimIndent(),
            code = 201,
        )

        val res = api().createDevice(
            DeviceInput(
                name = "Máy lọc nước",
                category = "APPLIANCE",
                purchaseDate = "2026-03-01",
                leadDays = listOf(14, 3),
            ),
        )

        assertEquals(listOf(14, 3), res.device.leadDays)
        val body = server.takeRequest().body.readUtf8()
        assertTrue("the chosen schedule must be in the body: $body", body.contains("\"leadDays\":[14,3]"))
    }

    @Test
    fun updateSubscription_sendsTheChosenReminderSchedule() = runBlocking {
        enqueueJson(
            """
                {
                  "subscription": {
                    "id": "sub-1", "name": "Netflix", "startedAt": "2026-03-01",
                    "leadDays": [60, 7]
                  }
                }
            """.trimIndent(),
        )

        val res = api().updateSubscription(
            "sub-1",
            SubscriptionInput(
                name = "Netflix",
                startedAt = "2026-03-01",
                leadDays = listOf(60, 7),
            ),
        )

        assertEquals(listOf(60, 7), res.subscription.leadDays)
        val recorded = server.takeRequest()
        assertEquals("PATCH", recorded.method)
        assertEquals("/api/v1/subscriptions/sub-1", recorded.path)
        val body = recorded.body.readUtf8()
        assertTrue("the chosen schedule must be in the body: $body", body.contains("\"leadDays\":[60,7]"))
    }

    // ---- "Việc cần xử lý" (GET /api/v1/actions) ----

    @Test
    fun listActionItems_omitsTheSnoozedParameterByDefault() = runBlocking {
        enqueueJson(
            """
                {
                  "generatedAt": "2026-03-04T00:00:00Z",
                  "items": [
                    {"itemKey": "WARRANTY_EXPIRED:clx1", "kind": "WARRANTY_EXPIRED", "severity": "HIGH",
                     "title": "Bảo hành đã hết hạn", "detail": "…", "deviceId": "dev-1",
                     "warrantyId": "war-1", "dueDate": "2026-03-01T00:00:00"}
                  ],
                  "counts": {"total": 1, "high": 1, "medium": 0, "low": 0},
                  "snoozedCount": 2,
                  "note": "Danh sách này chỉ gồm những việc app TỰ SUY RA từ dữ liệu bạn đã nhập."
                }
            """.trimIndent(),
        )

        val queue = api().listActionItems()

        assertEquals(1, queue.counts.total)
        assertEquals(1, queue.counts.high)
        assertEquals(2, queue.snoozedCount)
        assertEquals("WARRANTY_EXPIRED:clx1", queue.items.single().itemKey)
        assertTrue(!queue.items.single().isSnoozed)
        // The default read must be the bare URL — never `?snoozed=false`.
        assertEquals("/api/v1/actions", server.takeRequest().path)

        enqueueJson(
            """{"items":[],"counts":{"total":0,"high":0,"medium":0,"low":0},"snoozedCount":0,"note":""}""",
        )
        api().listActionItems(snoozed = true)
        assertEquals("/api/v1/actions?snoozed=true", server.takeRequest().path)
    }

    /** Money on the queue is int64 — decoded as `Long`, never narrowed to `Int`. */
    @Test
    fun listActionItems_decodesInt64AmountsAndTheSnoozedFlag() = runBlocking {
        enqueueJson(
            """
                {
                  "items": [
                    {"itemKey": "SUBSCRIPTION_RENEWING_NO_CANCEL_URL:sub-1",
                     "kind": "SUBSCRIPTION_RENEWING_NO_CANCEL_URL", "severity": "MEDIUM",
                     "title": "Sắp bị trừ tiền nhưng chưa có link huỷ", "detail": "…",
                     "subscriptionId": "sub-1", "amountVnd": 4200000000,
                     "snoozedUntil": "2026-06-02T00:00:00Z"}
                  ],
                  "counts": {"total": 0, "high": 0, "medium": 0, "low": 0},
                  "snoozedCount": 1, "note": ""
                }
            """.trimIndent(),
        )

        val queue = api().listActionItems(snoozed = true)
        val item = queue.items.single()

        assertEquals(4_200_000_000L, item.amountVnd)
        assertEquals("sub-1", item.subscriptionId)
        assertTrue("a row with snoozedUntil is hoãn, not actionable", item.isSnoozed)
        // The flag added a row; `counts` still describes the actionable set, so a
        // badge built from it cannot be inflated by the snooze.
        assertEquals(1, queue.items.size)
        assertEquals(0, queue.counts.total)
        assertEquals(1, queue.snoozedCount)
    }

    /**
     * `itemKey` is `<KIND>:<entityId>`. The ':' must reach the server verbatim —
     * percent-encoding it would make the key unrecognisable there. Retrofit's
     * `@Path` uses OkHttp's path-segment encode set, which leaves ':' alone.
     */
    @Test
    fun snoozeActionItem_keepsTheColonInTheItemKeyAndSendsExplicitDays() = runBlocking {
        enqueueJson("""{"itemKey":"WARRANTY_EXPIRED:clx1234","snoozedUntil":"2026-06-02T00:00:00Z","days":90}""")

        val result = api().snoozeActionItem("WARRANTY_EXPIRED:clx1234", SnoozeInput(days = 90))

        assertEquals(90, result.days)
        assertEquals("2026-06-02T00:00:00Z", result.snoozedUntil)

        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals("/api/v1/actions/WARRANTY_EXPIRED:clx1234/snooze", recorded.path)
        val body = recorded.body.readUtf8()
        assertTrue(
            "days must be sent explicitly, never left to the server default: $body",
            body.contains("\"days\":90"),
        )
    }

    @Test
    fun unsnoozeActionItem_isADeleteOnTheSameKeyedPath() = runBlocking {
        enqueueJson("""{"ok":true}""")

        api().unsnoozeActionItem("WISHLIST_TARGET_PASSED:wish-9")

        val recorded = server.takeRequest()
        assertEquals("DELETE", recorded.method)
        assertEquals("/api/v1/actions/WISHLIST_TARGET_PASSED:wish-9/snooze", recorded.path)
    }

    // ---- tự soát gói đăng ký (GET /api/v1/subscriptions/audit) ----

    @Test
    fun getSubscriptionAudit_decodesInt64MoneyTheThresholdsAndTheAdvisoryFlag() = runBlocking {
        enqueueJson(
            """
                {
                  "generatedAt": "2026-03-04T00:00:00Z",
                  "findings": [
                    {"findingKey": "QUIET_AUTO_RENEW:sub-1", "kind": "QUIET_AUTO_RENEW", "severity": "HIGH",
                     "title": "Gói tự trừ tiền đã lâu mà không thấy ghi nhận gì",
                     "detail": "«Netflix» đã tự động trừ 18 lần, tổng 4.680.000 ₫, lần đầu từ 01/09/2024.",
                     "subscriptionIds": ["sub-1"], "names": ["Netflix"],
                     "monthlyVnd": 260000, "chargedTotalVnd": 4680000, "chargeCount": 18,
                     "lastRecordedAt": "2026-02-01T00:00:00", "nextRenewalAt": "2026-03-10T00:00:00",
                     "daysUntilRenewal": 6}
                  ],
                  "counts": {"total": 1, "high": 1, "medium": 0, "low": 0},
                  "advisory": true,
                  "thresholds": {"quietMinAutoCharges": 3, "quietMinMonths": 6,
                                 "upcomingRenewalDays": 14, "priceRiseMinPercent": 5,
                                 "duplicateNormalized": true},
                  "note": "Đây là số liệu TỰ SOÁT từ những gì bạn đã ghi, không phải kết luận về việc bạn có dùng hay không."
                }
            """.trimIndent(),
        )

        val audit = api().getSubscriptionAudit()

        assertEquals("/api/v1/subscriptions/audit", server.takeRequest().path)
        assertTrue("the endpoint cancels nothing — it says so", audit.advisory)
        assertEquals(1, audit.counts.total)
        assertEquals(3, audit.thresholds?.quietMinAutoCharges)
        assertEquals(6, audit.thresholds?.quietMinMonths)
        val finding = audit.findings.single()
        assertEquals(4_680_000L, finding.chargedTotalVnd)
        assertEquals(18L, finding.chargeCount)
        assertEquals(260_000L, finding.monthlyVnd)
        // The claim about recording, not about usage — the server's own words.
        assertTrue(finding.title.contains("không thấy ghi nhận gì"))
        assertTrue(finding.detail.contains("tự động trừ"))
        assertTrue(audit.note.contains("không phải kết luận về việc bạn có dùng hay không"))
    }

    /** A rise smaller than the threshold arrives as `material: false`, not hidden. */
    @Test
    fun getSubscriptionAudit_keepsAnImmaterialRiseWithItsPercentages() = runBlocking {
        enqueueJson(
            """
                {
                  "findings": [
                    {"findingKey": "PRICE_INCREASED:sub-2", "kind": "PRICE_INCREASED", "severity": "MEDIUM",
                     "title": "Giá gói đã tăng", "detail": "…",
                     "subscriptionIds": ["sub-2"], "names": ["Spotify"], "monthlyVnd": 69000,
                     "previousAmountVnd": 59000, "amountVnd": 69000, "increaseVnd": 10000,
                     "increasePercent": 17, "material": false}
                  ],
                  "counts": {"total": 1, "high": 0, "medium": 1, "low": 0},
                  "advisory": true,
                  "thresholds": {"quietMinAutoCharges": 3, "quietMinMonths": 6,
                                 "upcomingRenewalDays": 14, "priceRiseMinPercent": 5,
                                 "duplicateNormalized": true},
                  "note": ""
                }
            """.trimIndent(),
        )

        val finding = api().getSubscriptionAudit().findings.single()

        assertEquals(false, finding.material)
        assertEquals(10_000L, finding.increaseVnd)
        assertEquals(17, finding.increasePercent)
    }

    /** `DUPLICATE` carries two ids and the signal that matched. */
    @Test
    fun getSubscriptionAudit_decodesBothIdsAndTheDuplicateReason() = runBlocking {
        enqueueJson(
            """
                {
                  "findings": [
                    {"findingKey": "DUPLICATE:sub-3+sub-4", "kind": "DUPLICATE", "severity": "LOW",
                     "title": "Hai gói trùng tên", "detail": "…",
                     "subscriptionIds": ["sub-3", "sub-4"], "names": ["iCloud+", "icloud +"],
                     "monthlyVnd": 40000, "reason": "SAME_NAME"}
                  ],
                  "counts": {"total": 1, "high": 0, "medium": 0, "low": 1},
                  "advisory": true, "note": ""
                }
            """.trimIndent(),
        )

        val finding = api().getSubscriptionAudit().findings.single()

        assertEquals(listOf("sub-3", "sub-4"), finding.subscriptionIds)
        assertEquals("SAME_NAME", finding.reason)
        assertEquals(0L, finding.chargedTotalVnd)
        // No thresholds in the payload must not throw — the rule line is omitted.
        assertEquals(null, finding.material)
    }

    /**
     * `GET /api/v1/fx/rates?base=USD` — the optional helper behind "Lấy tỷ giá".
     * The base goes in the query; the quote map is decoded as numbers (a whole
     * number must decode into `Double`, because a server may serialise 25470
     * rather than 25470.0).
     */
    @Test
    fun getFxRates_queriesTheBaseAndDecodesTheQuoteMap() = runBlocking {
        enqueueJson(
            """{"base":"USD","rates":{"VND":25470},"fetchedAt":"2026-10-19T00:00:00Z","stale":false}""",
        )

        val rates = api().getFxRates("USD")

        assertEquals("USD", rates.base)
        assertEquals(25_470.0, rates.rates.getValue("VND"), 0.0)
        assertEquals("2026-10-19T00:00:00Z", rates.fetchedAt)
        assertEquals(false, rates.stale)
        assertEquals("/api/v1/fx/rates?base=USD", server.takeRequest().path)
    }

    /**
     * `GET /api/v1/insurance-pack` — the authenticated binary download behind
     * Settings → Data → "Insurance schedule (Vietnamese)".
     *
     * Three things are pinned here that no unit test of the pure request rules
     * can prove: the bearer token is attached (the PDF endpoint is auth-gated),
     * the default request really is the bare path (both optional parameters
     * omitted), and the filtered request puts the comma-joined ids and the
     * `includeSold` flag on the wire in the contract's spelling. The body must
     * come back untouched — `@Streaming` returns the raw `ResponseBody`, not a
     * decoded JSON envelope.
     */
    @Test
    fun insurancePack_downloadsThePdfWithTheBearerTokenAndTheChosenFilters() = runBlocking {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .addHeader("Content-Type", "application/pdf")
                .setBody("%PDF-1.7\n% Warrly insurance pack\n"),
        )

        val defaultRequest = insurancePackRequest()
        val body = api().downloadInsurancePack(defaultRequest.deviceIds, defaultRequest.includeSold)

        assertEquals("%PDF-1.7\n% Warrly insurance pack\n", body.string())
        server.takeRequest().let { recorded ->
            assertEquals("GET", recorded.method)
            assertEquals("/api/v1/insurance-pack", recorded.path)
            assertEquals("Bearer tok-123", recorded.getHeader("Authorization"))
        }

        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .addHeader("Content-Type", "application/pdf")
                .setBody("%PDF-1.7\nfiltered\n"),
        )

        val filtered = insurancePackRequest(listOf("dev-1", "dev-2"), includeSold = true)
        api().downloadInsurancePack(filtered.deviceIds, filtered.includeSold).string()

        // Retrofit/OkHttp percent-encode the comma inside the single `deviceIds`
        // query value. Go's URL query parser decodes `%2C` back to `,`, so the
        // server receives the contract's comma-separated list; the wire spelling
        // of the separator is not part of the contract.
        assertEquals(
            "/api/v1/insurance-pack?deviceIds=dev-1%2Cdev-2&includeSold=true",
            server.takeRequest().path,
        )
    }
}
