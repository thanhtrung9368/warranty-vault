package com.warrantyvault.app.network

import com.warrantyvault.app.testing.Fixtures
import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Contract tests for the REST DTOs in `Models.kt`.
 *
 * Two things matter here and both are cheap to break silently:
 *  1. the wire shape (kotlinx.serialization config lives in `ApiClient.json`,
 *     so the tests exercise the production [kotlinx.serialization.json.Json]),
 *  2. the Vietnamese display labels the enums expose to the UI.
 */
class ModelsSerializationTest {

    private val json = ApiClient.json

    // ---- Auth ----

    @Test
    fun authSuccess_decodesTokenExpiryAndUserDefaults() {
        val raw = """
            {
              "accessToken": "tok-abc",
              "expiresAt": "2025-01-31T10:00:00Z",
              "user": {"id": "u1", "email": "an@example.com", "name": "Nguyễn An", "aiOptIn": true}
            }
        """.trimIndent()

        val res = json.decodeFromString(AuthSuccess.serializer(), raw)

        assertEquals("tok-abc", res.accessToken)
        assertEquals("2025-01-31T10:00:00Z", res.expiresAt)
        assertEquals("u1", res.user.id)
        assertEquals("Nguyễn An", res.user.name)
        assertTrue(res.user.aiOptIn)

        val minimal = json.decodeFromString(User.serializer(), """{"id":"u1","email":"an@example.com"}""")
        assertNull("name is optional on the wire", minimal.name)
        assertFalse("AI OCR opt-in defaults to OFF", minimal.aiOptIn)
    }

    @Test
    fun loginInput_encodesPlatformDefaultAndOmitsNullDeviceLabel() {
        val encoded = json.encodeToString(
            LoginInput.serializer(),
            LoginInput(email = "an@example.com", password = "s3cret"),
        )

        assertTrue("platform default must reach the server: $encoded", encoded.contains("\"platform\":\"android\""))
        assertFalse("explicitNulls = false must drop nulls: $encoded", encoded.contains("deviceLabel"))
    }

    // ---- Devices / warranties ----

    @Test
    fun device_decodesNestedWarrantyAndReminder() {
        val raw = """
            {
              "id": "dev-1",
              "name": "iPhone 15 Pro",
              "category": "PHONE",
              "purchaseDate": "2024-03-01",
              "status": "EXPIRED",
              "warranties": [
                {
                  "id": "war-1",
                  "deviceId": "dev-1",
                  "type": "THIRD_PARTY",
                  "startDate": "2024-03-01",
                  "endDate": "2026-03-01",
                  "months": 24,
                  "reminders": [
                    {"id": "rem-1", "warrantyId": "war-1", "isDismissed": true}
                  ]
                }
              ]
            }
        """.trimIndent()

        val device = json.decodeFromString(Device.serializer(), raw)

        assertEquals(DeviceStatus.EXPIRED, device.status)
        assertEquals(1, device.warranties.size)
        val warranty = device.warranties.single()
        assertEquals(WarrantyType.THIRD_PARTY, warranty.type)
        assertEquals(24, warranty.months)
        assertTrue("reminder dismissal bubbles up to the warranty", warranty.isDismissed)
    }

    @Test
    fun device_toleratesMissingOptionalsAndUnknownFields() {
        val sparse = json.decodeFromString(
            Device.serializer(),
            """{"id":"dev-1","name":"Chuột","category":"ACCESSORY","purchaseDate":"2024-05-05"}""",
        )

        assertEquals(DeviceStatus.ACTIVE, sparse.status)
        assertEquals(0, sparse.purchasePrice)
        assertNull(sparse.brand)
        assertNull(sparse.userId)
        assertTrue(sparse.warranties.isEmpty())

        // The server may add fields before the app is updated.
        val withExtras = json.decodeFromString(
            Device.serializer(),
            """
                {
                  "id": "dev-1",
                  "name": "Chuột",
                  "category": "ACCESSORY",
                  "purchaseDate": "2024-05-05",
                  "somethingTheServerAddedLater": {"nested": true},
                  "extraArray": [1, 2, 3]
                }
            """.trimIndent(),
        )
        assertEquals("dev-1", withExtras.id)
        assertEquals("Chuột", withExtras.name)
    }

    @Test
    fun device_malformedPayloads_throwInsteadOfSilentlyDegrading() {
        // Missing required `category`.
        assertThrows(SerializationException::class.java) {
            json.decodeFromString(
                Device.serializer(),
                """{"id":"dev-1","name":"Chuột","purchaseDate":"2024-05-05"}""",
            )
        }
        // Unknown enum member for a non-nullable enum field.
        assertThrows(SerializationException::class.java) {
            json.decodeFromString(
                Device.serializer(),
                """{"id":"dev-1","name":"Chuột","category":"ACCESSORY","purchaseDate":"2024-05-05","status":"BANANA"}""",
            )
        }
    }

    @Test
    fun devicesAndSubscriptions_roundTripThroughJson() {
        val device = Fixtures.device(warranties = listOf(Fixtures.warranty()))
        assertEquals(
            device,
            json.decodeFromString(Device.serializer(), json.encodeToString(Device.serializer(), device)),
        )

        val subscription = Fixtures.subscription().copy(
            billingCycle = BillingCycle.YEARLY,
            status = SubscriptionStatus.PAUSED,
            payments = listOf(
                Payment(id = "pay-1", subscriptionId = "sub-1", amount = 2_600_000, paidAt = "2024-01-01"),
            ),
        )
        val decoded = json.decodeFromString(
            Subscription.serializer(),
            json.encodeToString(Subscription.serializer(), subscription),
        )
        assertEquals(subscription, decoded)
        assertEquals(BillingCycle.YEARLY, decoded.billingCycle)
        assertEquals(SubscriptionStatus.PAUSED, decoded.status)
        assertEquals(1, decoded.payments.size)
    }

    @Test
    fun warranty_isDismissed_reflectsNestedReminders() {
        val base = Fixtures.warranty()

        assertFalse("no reminders means nothing was dismissed", base.isDismissed)
        assertFalse(
            base.copy(reminders = listOf(Reminder(id = "r1", warrantyId = "war-1", isDismissed = false))).isDismissed,
        )
        assertTrue(
            base.copy(
                reminders = listOf(
                    Reminder(id = "r1", warrantyId = "war-1", isDismissed = false),
                    Reminder(id = "r2", warrantyId = "war-1", isDismissed = true),
                ),
            ).isDismissed,
        )
    }

    // ---- Vietnamese display labels (must match website/src/lib/types.ts) ----

    @Test
    fun deviceStatusAndWarrantyType_labelsAreExactVietnamese() {
        assertEquals("Đang dùng", DeviceStatus.ACTIVE.label)
        assertEquals("Hết bảo hành", DeviceStatus.EXPIRED.label)
        assertEquals("Đã bán", DeviceStatus.SOLD.label)
        assertEquals("Hỏng", DeviceStatus.BROKEN.label)
        assertEquals("Mất", DeviceStatus.LOST.label)

        assertEquals("Tiêu chuẩn", WarrantyType.STANDARD.label)
        assertEquals("Mở rộng", WarrantyType.EXTENDED.label)
        assertEquals("Bên thứ ba", WarrantyType.THIRD_PARTY.label)
    }

    @Test
    fun subscriptionStatusAndBillingCycle_labelsAreExactVietnamese() {
        assertEquals("Đang hoạt động", SubscriptionStatus.ACTIVE.label)
        assertEquals("Tạm dừng", SubscriptionStatus.PAUSED.label)
        assertEquals("Đã huỷ", SubscriptionStatus.CANCELED.label)
        assertEquals("Hết hạn", SubscriptionStatus.EXPIRED.label)

        assertEquals("Hàng tháng", BillingCycle.MONTHLY.label)
        assertEquals("Hàng quý", BillingCycle.QUARTERLY.label)
        assertEquals("Hàng năm", BillingCycle.YEARLY.label)
        assertEquals("Lifetime / Trọn đời", BillingCycle.LIFETIME.label)
        assertEquals("Tuỳ chỉnh", BillingCycle.CUSTOM.label)
    }

    @Test
    fun wishlist_labelsAreExactVietnamese() {
        assertEquals("Phải mua", WishlistPriority.MUST.label)
        assertEquals("Muốn", WishlistPriority.WANT.label)
        assertEquals("Cân nhắc", WishlistPriority.MAYBE.label)

        assertEquals("Đang theo dõi", WishlistStatus.WATCHING.label)
        assertEquals("Quyết mua", WishlistStatus.DECIDED.label)
        assertEquals("Bỏ qua", WishlistStatus.SKIPPED.label)
        assertEquals("Đã mua", WishlistStatus.PURCHASED.label)
    }

    // ---- Subscriptions / wishlist ----

    @Test
    fun wishlistItem_appliesDefaultPriorityAndStatus() {
        val item = json.decodeFromString(WishlistItem.serializer(), """{"id":"w1","name":"Steam Deck"}""")

        assertEquals(WishlistPriority.WANT, item.priority)
        assertEquals(WishlistStatus.WATCHING, item.status)
        assertNull(item.currentPrice)
        assertTrue(item.prices.isEmpty())
    }

    // ---- AI draft / catalog ----

    @Test
    fun draftDevice_defaultsToEmptyDraftWithMediumConfidence() {
        val draft = json.decodeFromString(DraftDevice.serializer(), "{}")

        assertNull(draft.name)
        assertNull(draft.purchasePrice)
        assertEquals("medium", draft.confidence)
        assertTrue(draft.unmatched.isEmpty())

        val wrapped = json.decodeFromString(DraftDeviceResponse.serializer(), """{"draft":{"name":"iPhone"}}""")
        assertEquals("iPhone", wrapped.draft.name)
    }

    @Test
    fun catalog_decodesNestedOptionsAndDefaultsCategoryCodes() {
        val raw = """
            {
              "categories": [{"code": "PHONE", "name": "Điện thoại"}],
              "brands": [{"id": "b1", "name": "Apple"}],
              "stores": [{"id": "s1", "name": "CellphoneS", "type": "RETAIL"}],
              "warrantyProviders": [{"id": "p1", "name": "Apple Care"}]
            }
        """.trimIndent()

        val catalog = json.decodeFromString(Catalog.serializer(), raw)

        assertEquals("Điện thoại", catalog.categories.single().name)
        assertTrue("brands without categoryCodes apply to every category", catalog.brands.single().categoryCodes.isEmpty())
        assertEquals("RETAIL", catalog.stores.single().type)
        assertNull(catalog.warrantyProviders.single().phone)
    }

    // ---- Envelopes / collections ----

    @Test
    fun apiErrorEnvelope_decodesFieldErrors() {
        val raw = """
            {
              "error": "validation_failed",
              "message": "Dữ liệu không hợp lệ",
              "fieldErrors": {"email": ["Email đã được sử dụng"], "password": ["Mật khẩu quá ngắn"]}
            }
        """.trimIndent()

        val env = json.decodeFromString(ApiErrorEnvelope.serializer(), raw)

        assertEquals("validation_failed", env.error)
        assertEquals("Dữ liệu không hợp lệ", env.message)
        assertEquals(listOf("Email đã được sử dụng"), env.fieldErrors?.get("email"))
    }

    @Test
    fun listResponses_defaultToEmptyCollectionsAndKeepRawTypeStrings() {
        assertEquals(
            emptyList<PushSubscriptionMeta>(),
            json.decodeFromString(PushSubscriptionListResponse.serializer(), "{}").subscriptions,
        )
        assertEquals(
            emptyList<Attachment>(),
            json.decodeFromString(AttachmentListResponse.serializer(), "{}").attachments,
        )
        assertEquals(
            emptyList<UpcomingReminder>(),
            json.decodeFromString(RemindersResponse.serializer(), "{}").reminders,
        )

        val imported = json.decodeFromString(ImportResultResponse.serializer(), """{"result":{}}""")
        assertTrue(imported.ok)
        assertEquals(0, imported.result.imported)
        assertEquals(0, imported.result.skipped)
        assertEquals(0, imported.result.wishlistImported)

        // UpcomingReminder.type is a raw string (not the WarrantyType enum) so an
        // unknown server value must survive the round trip untouched.
        val reminder = json.decodeFromString(
            UpcomingReminder.serializer(),
            """
                {
                  "id": "war-1", "deviceId": "dev-1",
                  "device": {"id": "dev-1", "name": "iPhone", "category": "PHONE"},
                  "type": "SOMETHING_NEW", "startDate": "2024-01-01", "endDate": "2025-01-01", "months": 12
                }
            """.trimIndent(),
        )
        assertEquals("SOMETHING_NEW", reminder.type)
        assertEquals("iPhone", reminder.device.name)
    }

    // ---- Stats ----

    /**
     * `devices.totalWarrantyCost` is a NEW field on `GET /api/v1/stats`
     * (docs/FEATURE_ROADMAP.md #3 — SUM(`Warranty.cost`) per user). The client
     * must bind it when present…
     */
    @Test
    fun userStats_decodesTheNewWarrantyCostField() {
        val raw = """
            {
              "devices": {"total": 2, "byStatus": {"ACTIVE": 2}, "totalPurchasePrice": 30000000, "totalWarrantyCost": 4500000},
              "subscriptions": {"total": 1, "byStatus": {"ACTIVE": 1}, "totalMonthlyVnd": 260000},
              "wishlist": {"total": 1, "byStatus": {"WATCHING": 1}, "totalCurrentPriceWatching": 12000000}
            }
        """.trimIndent()

        val stats = json.decodeFromString(UserStats.serializer(), raw)

        assertEquals(4_500_000L, stats.devices.totalWarrantyCost)
        assertEquals(30_000_000L, stats.devices.totalPurchasePrice)
        // Web `/stats` "Tổng chi mua sắm" = devices + warranty packages.
        assertEquals(34_500_000L, stats.devices.totalSpend)
    }

    /**
     * …and must NOT blow up on a server that has not shipped it yet: the field
     * decodes to null, and the UI hides the warranty tiles instead of printing
     * a fabricated 0đ.
     */
    @Test
    fun userStats_survivesAMissingWarrantyCostField() {
        val raw = """
            {
              "devices": {"total": 2, "byStatus": {"ACTIVE": 2}, "totalPurchasePrice": 30000000},
              "subscriptions": {"total": 0, "byStatus": {}, "totalMonthlyVnd": 0},
              "wishlist": {"total": 0, "byStatus": {}, "totalCurrentPriceWatching": 0}
            }
        """.trimIndent()

        val stats = json.decodeFromString(UserStats.serializer(), raw)

        assertNull(stats.devices.totalWarrantyCost)
        assertEquals(30_000_000L, stats.devices.totalSpend)
    }

    /**
     * Every money rollup in `UserStats` is an int64 SUM on the Go side (the
     * per-row values are int32, but up to 50 devices / 200 wishlist items are
     * added together). Decoding them as `Int` threw
     * `SerializationException: Expected value of type Int` and blanked the whole
     * stats tab the moment a user crossed ~2.1 tỷ VND.
     */
    @Test
    fun userStats_decodesMoneyRollupsThatOverflowInt() {
        val raw = """
            {
              "devices": {"total": 3, "byStatus": {}, "totalPurchasePrice": 3000000000, "totalWarrantyCost": 2500000000},
              "subscriptions": {"total": 2, "byStatus": {}, "totalMonthlyVnd": 2200000000},
              "wishlist": {"total": 4, "byStatus": {}, "totalCurrentPriceWatching": 9999999999}
            }
        """.trimIndent()

        val stats = json.decodeFromString(UserStats.serializer(), raw)

        assertEquals(3_000_000_000L, stats.devices.totalPurchasePrice)
        assertEquals(2_500_000_000L, stats.devices.totalWarrantyCost)
        assertEquals(5_500_000_000L, stats.devices.totalSpend)
        assertEquals(2_200_000_000L, stats.subscriptions.totalMonthlyVnd)
        assertEquals(9_999_999_999L, stats.wishlist.totalCurrentPriceWatching)
    }

    /**
     * The warranty slot is a guess in the exact *location* (top-level vs nested)
     * until openapi.yaml lands it. An unrecognised extra key must be ignored
     * silently — `ignoreUnknownKeys` — so a differently-shaped payload still
     * yields a usable snapshot instead of a decode error.
     */
    @Test
    fun userStats_ignoresAWarrantyCostShapedKeyItDoesNotKnow() {
        val raw = """
            {
              "devices": {"total": 1, "byStatus": {}, "totalPurchasePrice": 100},
              "subscriptions": {"total": 0, "byStatus": {}, "totalMonthlyVnd": 0},
              "wishlist": {"total": 0, "byStatus": {}, "totalCurrentPriceWatching": 0},
              "warranty": {"total": 3, "totalCost": 4500000}
            }
        """.trimIndent()

        val stats = json.decodeFromString(UserStats.serializer(), raw)

        assertNull(stats.devices.totalWarrantyCost)
        assertEquals(1, stats.devices.total)
    }
}
