package com.warrly.network

import com.warrly.i18n.ResCatalog
import com.warrly.testing.Fixtures
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

    /** The two real resource tables, read off disk — see the label section below. */
    private val vi = ResCatalog.vietnamese()
    private val en = ResCatalog.english()

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

    // ---- Profile (PATCH /api/v1/auth/me) ----

    /**
     * `displayName` is a REQUIRED key that also happens to be the clear signal.
     * `ApiClient.json` sets `explicitNulls = false`, so a `String?` field would
     * have been dropped whenever the user cleared the name and the server would
     * answer 400 `Thiếu displayName` instead of clearing. `""` is what the UI
     * sends for "clear" and it must survive serialization verbatim.
     */
    @Test
    fun updateProfileInput_alwaysSendsDisplayNameAndNeverAnEmail() {
        val cleared = json.encodeToString(UpdateProfileInput.serializer(), UpdateProfileInput(""))
        assertTrue("the key is required by the server: $cleared", cleared.contains("\"displayName\""))
        assertEquals("""{"displayName":""}""", cleared)

        val named = json.encodeToString(
            UpdateProfileInput.serializer(),
            UpdateProfileInput("Nguyễn An"),
        )
        assertEquals("""{"displayName":"Nguyễn An"}""", named)

        // Email change is not part of the contract — sending email/newEmail is an
        // explicit 400, so the body must never grow one by accident.
        assertFalse(named.contains("email", ignoreCase = true))
    }

    /**
     * The tri-state `locale`, including the branch Android could not send before
     * the "Theo thiết bị" row existed.
     *
     * `ApiClient.json` sets `explicitNulls = false`, so a plain data class would
     * DROP a null `locale` and the server would answer 400 to the empty body
     * ("a body with neither key"). The custom serializer must therefore emit the
     * key with an explicit null — this is the whole point of it.
     */
    @Test
    fun updateLocaleInput_alwaysSendsTheKeyAndCanClearWithAnExplicitNull() {
        assertEquals(
            "clearing is an explicit null, not an omitted key",
            """{"locale":null}""",
            json.encodeToString(UpdateLocaleInput.serializer(), UpdateLocaleInput(null)),
        )
        assertEquals(
            """{"locale":"vi"}""",
            json.encodeToString(UpdateLocaleInput.serializer(), UpdateLocaleInput("vi")),
        )
        assertEquals(
            """{"locale":"en"}""",
            json.encodeToString(UpdateLocaleInput.serializer(), UpdateLocaleInput("en")),
        )

        // Round trip, because the serializer must at least be total.
        val decoded = json.decodeFromString(UpdateLocaleInput.serializer(), """{"locale":null}""")
        assertNull(decoded.locale)
        assertEquals(
            "vi",
            json.decodeFromString(UpdateLocaleInput.serializer(), """{"locale":"vi"}""").locale,
        )
    }

    @Test
    fun updateProfileResponse_decodesTheFreshUserAndMessage() {
        val raw = """
            {
              "user": {"id": "u1", "email": "an@example.com", "name": "Nguyễn An", "aiOptIn": false},
              "message": "Đã cập nhật hồ sơ"
            }
        """.trimIndent()

        val res = json.decodeFromString(UpdateProfileResponse.serializer(), raw)

        assertEquals("Nguyễn An", res.user.name)
        assertEquals("Đã cập nhật hồ sơ", res.message)
    }

    /**
     * The profile card falls back to the email; a cleared (`null`) name must not
     * render as an empty line.
     */
    @Test
    fun user_displayLabel_fallsBackToTheEmailWhenTheNameIsUnset() {
        val named = User(id = "u1", email = "an@example.com", name = "Nguyễn An")
        assertEquals("Nguyễn An", named.displayLabel)

        val cleared = User(id = "u1", email = "an@example.com", name = null)
        assertEquals("an@example.com", cleared.displayLabel)

        val blank = User(id = "u1", email = "an@example.com", name = "   ")
        assertEquals("an@example.com", blank.displayLabel)
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
    fun deviceAndSubscription_leadDaysDefaultToTheOldFixedScheduleWhenOmitted() {
        // A server that predates the field omits `leadDays`. The UI must show the
        // schedule the cron was actually using ([30, 7]), never an empty one, or
        // the detail card would claim the device has no reminders.
        val device = json.decodeFromString(
            Device.serializer(),
            """{"id":"dev-1","name":"Chuột","category":"ACCESSORY","purchaseDate":"2024-05-05"}""",
        )
        assertEquals(DEFAULT_LEAD_DAYS, device.leadDays)

        val subscription = json.decodeFromString(
            Subscription.serializer(),
            """{"id":"sub-1","name":"Netflix","startedAt":"2024-05-05"}""",
        )
        assertEquals(DEFAULT_LEAD_DAYS, subscription.leadDays)

        // A supporting server returns the schedule already sorted descending.
        val custom = json.decodeFromString(
            Device.serializer(),
            """
                {
                  "id": "dev-1", "name": "Chuột", "category": "ACCESSORY",
                  "purchaseDate": "2024-05-05", "leadDays": [60, 14, 0]
                }
            """.trimIndent(),
        )
        assertEquals(listOf(60, 14, 0), custom.leadDays)
    }

    @Test
    fun leadDaysIsSentWhenChosenAndOmittedWhenUnset() {
        val chosen = json.encodeToString(
            DeviceInput.serializer(),
            DeviceInput(
                name = "iPhone",
                category = "PHONE",
                purchaseDate = "2024-03-01",
                leadDays = listOf(14, 3),
            ),
        )
        assertTrue("the chosen schedule must reach the wire: $chosen", chosen.contains("\"leadDays\":[14,3]"))

        // null must DROP the key: on update that means "leave the stored
        // schedule alone", and on create the server applies [30, 7].
        val untouched = json.encodeToString(
            DeviceInput.serializer(),
            DeviceInput(name = "iPhone", category = "PHONE", purchaseDate = "2024-03-01"),
        )
        assertFalse(
            "an untouched schedule must not be turned into a default overwrite: $untouched",
            untouched.contains("leadDays"),
        )

        val subscription = json.encodeToString(
            SubscriptionInput.serializer(),
            SubscriptionInput(name = "Netflix", startedAt = "2024-03-01", leadDays = listOf(30)),
        )
        assertTrue(
            "subscriptions carry the same field: $subscription",
            subscription.contains("\"leadDays\":[30]"),
        )
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

    // ---- Warranty contract terms -----------------------------------------

    /**
     * The nine optional contract-term fields decode onto the warranty DTO.
     * `claimsUsed` is the one non-nullable field and its contract default is 0,
     * so an older server that omits it still decodes to a sensible number.
     */
    @Test
    fun warranty_decodesContractTermsAndDefaultsClaimsUsedToZero() {
        val full = json.decodeFromString(
            Warranty.serializer(),
            """
                {
                  "id": "war-1",
                  "deviceId": "dev-1",
                  "type": "EXTENDED",
                  "startDate": "2024-03-01",
                  "endDate": "2026-03-01",
                  "months": 24,
                  "component": "Pin",
                  "scope": "Pin chai và cổng sạc",
                  "cap": 5000000,
                  "deductible": 500000,
                  "exclusions": "Rơi vỡ, vào nước",
                  "region": "Việt Nam",
                  "transferable": false,
                  "claimsAllowed": 3,
                  "claimsUsed": 2
                }
            """.trimIndent(),
        )

        assertEquals("Pin", full.component)
        assertEquals("Pin chai và cổng sạc", full.scope)
        assertEquals(5_000_000, full.cap)
        assertEquals(500_000, full.deductible)
        assertEquals("Rơi vỡ, vào nước", full.exclusions)
        assertEquals("Việt Nam", full.region)
        assertEquals(false, full.transferable)
        assertEquals(3, full.claimsAllowed)
        assertEquals(2, full.claimsUsed)
        assertEquals(
            full,
            json.decodeFromString(
                Warranty.serializer(),
                json.encodeToString(Warranty.serializer(), full),
            ),
        )

        // A plan written before these fields existed: every term is absent and
        // `claimsUsed` falls back to the contract default.
        val sparse = json.decodeFromString(
            Warranty.serializer(),
            """{"id":"war-1","deviceId":"dev-1","startDate":"2024-03-01","endDate":"2026-03-01"}""",
        )
        assertNull(sparse.component)
        assertNull(sparse.scope)
        assertNull(sparse.cap)
        assertNull(sparse.deductible)
        assertNull(sparse.exclusions)
        assertNull(sparse.region)
        assertNull(sparse.transferable)
        assertNull("null is UNBOUNDED, never 0 claims", sparse.claimsAllowed)
        assertEquals(0, sparse.claimsUsed)
    }

    /**
     * Create/update send every recorded term. `0` must survive as `0` (a real
     * cap/deductible/limit), and `transferable = false` must be sent rather than
     * dropped as falsy.
     */
    @Test
    fun warrantyInput_encodesContractTermsIncludingRealZerosAndFalse() {
        val input = WarrantyInput(
            type = WarrantyType.EXTENDED,
            startDate = "2024-03-01",
            months = 24,
            component = "Pin",
            scope = "Pin chai",
            cap = 0,
            deductible = 0,
            exclusions = "Rơi vỡ",
            region = "Việt Nam",
            transferable = false,
            claimsAllowed = 3,
            claimsUsed = 2,
        )

        val encoded = json.encodeToString(WarrantyInput.serializer(), input)

        assertTrue("component must reach the server: $encoded", encoded.contains("\"component\":\"Pin\""))
        assertTrue(encoded.contains("\"scope\":\"Pin chai\""))
        assertTrue("a 0 cap is not 'unset': $encoded", encoded.contains("\"cap\":0"))
        assertTrue("a 0 deductible is not 'unset': $encoded", encoded.contains("\"deductible\":0"))
        assertTrue(encoded.contains("\"exclusions\":\"Rơi vỡ\""))
        assertTrue(encoded.contains("\"region\":\"Việt Nam\""))
        assertTrue("false is a value, not a missing key: $encoded", encoded.contains("\"transferable\":false"))
        assertTrue(encoded.contains("\"claimsAllowed\":3"))
        assertTrue(encoded.contains("\"claimsUsed\":2"))

        assertEquals(input, json.decodeFromString(WarrantyInput.serializer(), encoded))
    }

    /**
     * The note that matters for update: `ApiClient.json` has
     * `explicitNulls = false`, so an untouched term is an ABSENT key, never
     * `"component":null`. `claimsUsed` is the exception — it is non-nullable and
     * always encoded, including its default 0.
     */
    @Test
    fun warrantyInput_dropsNullContractTermsButAlwaysSendsClaimsUsed() {
        val untouched = json.encodeToString(
            WarrantyInput.serializer(),
            WarrantyInput(startDate = "2024-03-01", months = 12),
        )

        for (key in listOf(
            "component",
            "scope",
            "cap",
            "deductible",
            "exclusions",
            "region",
            "transferable",
            "claimsAllowed",
        )) {
            assertFalse("$key is null and must be dropped: $untouched", untouched.contains("\"$key\""))
        }
        assertTrue(
            "claimsUsed is non-nullable and always sent: $untouched",
            untouched.contains("\"claimsUsed\":0"),
        )
    }

    // ---- Display labels: resource-backed, pinned in BOTH languages --------
    //
    // These used to assert `DeviceStatus.ACTIVE.label` — a hardcoded Vietnamese
    // literal on the enum, which is why an English-mode device row still read
    // "Đang dùng". The enums now carry `@StringRes labelRes` and the copy lives
    // in `res/values/` + `res/values-vi/`, so the pin moved onto the resource
    // table itself (`ResCatalog` reads the XML off disk).
    //
    // The Vietnamese expectations are byte-for-byte the literals that were here
    // before — this change added an English column and was not allowed to touch
    // a Vietnamese character. The English ones are copied from the Go catalog
    // (`api/internal/i18n/catalog.go`) and the web dictionary
    // (`website/src/lib/i18n/messages/`): the words the other two clients
    // already print for the same enum member. Pinning both languages here is the
    // point — an English label nobody asserts is the bug this file hunts.

    @Test
    fun deviceStatusAndWarrantyType_labelsAreExactInBothLanguages() {
        assertLabel(DeviceStatus.ACTIVE.labelRes, "Đang dùng", "In use")
        assertLabel(DeviceStatus.EXPIRED.labelRes, "Hết bảo hành", "Out of warranty")
        assertLabel(DeviceStatus.SOLD.labelRes, "Đã bán", "Sold")
        assertLabel(DeviceStatus.BROKEN.labelRes, "Hỏng", "Broken")
        assertLabel(DeviceStatus.LOST.labelRes, "Mất", "Lost")

        assertLabel(WarrantyType.STANDARD.labelRes, "Tiêu chuẩn", "Standard")
        assertLabel(WarrantyType.EXTENDED.labelRes, "Mở rộng", "Extended")
        assertLabel(WarrantyType.THIRD_PARTY.labelRes, "Bên thứ ba", "Third party")
    }

    @Test
    fun subscriptionStatusAndBillingCycle_labelsAreExactInBothLanguages() {
        assertLabel(SubscriptionStatus.ACTIVE.labelRes, "Đang hoạt động", "Active")
        assertLabel(SubscriptionStatus.PAUSED.labelRes, "Tạm dừng", "Paused")
        assertLabel(SubscriptionStatus.CANCELED.labelRes, "Đã huỷ", "Cancelled")
        assertLabel(SubscriptionStatus.EXPIRED.labelRes, "Hết hạn", "Expired")

        assertLabel(BillingCycle.MONTHLY.labelRes, "Hàng tháng", "Monthly")
        assertLabel(BillingCycle.QUARTERLY.labelRes, "Hàng quý", "Quarterly")
        assertLabel(BillingCycle.YEARLY.labelRes, "Hàng năm", "Yearly")
        assertLabel(BillingCycle.LIFETIME.labelRes, "Lifetime / Trọn đời", "Lifetime")
        assertLabel(BillingCycle.CUSTOM.labelRes, "Tuỳ chỉnh", "Custom")
    }

    @Test
    fun wishlist_labelsAreExactInBothLanguages() {
        assertLabel(WishlistPriority.MUST.labelRes, "Phải mua", "Must buy")
        assertLabel(WishlistPriority.WANT.labelRes, "Muốn", "Want")
        assertLabel(WishlistPriority.MAYBE.labelRes, "Cân nhắc", "Considering")

        assertLabel(WishlistStatus.WATCHING.labelRes, "Đang theo dõi", "Being tracked")
        assertLabel(WishlistStatus.DECIDED.labelRes, "Quyết mua", "Decided")
        assertLabel(WishlistStatus.SKIPPED.labelRes, "Bỏ qua", "Skipped")
        assertLabel(WishlistStatus.PURCHASED.labelRes, "Đã mua", "Purchased")
    }

    /**
     * Every enum member resolves in **both** catalogs. `StringResourceParityTest`
     * proves the two files have the same keys; this proves the Kotlin side
     * actually points at them — a member left without a `labelRes`, or a
     * `labelRes` pointing at a key that only one language declares, fails here
     * instead of rendering the other language mid-screen.
     */
    @Test
    fun everyEnumLabelResolvesInBothLanguages() {
        val ids = DeviceStatus.entries.map { it.labelRes } +
            WarrantyType.entries.map { it.labelRes } +
            SubscriptionStatus.entries.map { it.labelRes } +
            BillingCycle.entries.map { it.labelRes } +
            WishlistPriority.entries.map { it.labelRes } +
            WishlistStatus.entries.map { it.labelRes } +
            PhoneSource.entries.map { it.labelRes }

        assertEquals("one resource per enum member, and no duplicate ids", ids.size, ids.toSet().size)
        for (id in ids) {
            val vi = vi.get(id)
            val en = en.get(id)
            assertTrue("Vietnamese label for id $id is blank", vi.isNotBlank())
            assertTrue("English label for id $id is blank", en.isNotBlank())
        }
    }

    /** One enum member: the same Vietnamese bytes as before, plus its English. */
    private fun assertLabel(id: Int, vietnamese: String, english: String) {
        assertEquals("Vietnamese moved — it is the original, not the translation", vietnamese, vi.get(id))
        assertEquals("English wording must match the Go catalog / web dictionary", english, en.get(id))
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
        // The default feed writes neither field: the flag is absent (so it must
        // decode as visible) and `device.status` is absent on a server that
        // predates it (falling back to ACTIVE, like web/iOS).
        assertFalse(reminder.isDismissed)
        assertEquals(DeviceStatus.ACTIVE, reminder.device.status)

        // The widened feed (`includeDismissed=true`) adds the hidden rows and
        // their device status — the two fields the "Đã ẩn" list renders.
        val hidden = json.decodeFromString(
            UpcomingReminder.serializer(),
            """
                {
                  "id": "war-2", "deviceId": "dev-2",
                  "device": {"id": "dev-2", "name": "Galaxy Tab", "category": "TABLET", "status": "SOLD"},
                  "type": "STANDARD", "startDate": "2022-01-01", "endDate": "2023-01-01", "months": 12,
                  "isDismissed": true
                }
            """.trimIndent(),
        )
        assertTrue(hidden.isDismissed)
        assertEquals(DeviceStatus.SOLD, hidden.device.status)
    }

    // ---- Attachments (PATCH /api/v1/attachments/{id}) ----

    /**
     * Same required-key trap as the profile PATCH: `description` must always be
     * on the wire, including when the user clears it, so the clear value is `""`
     * rather than a null that `explicitNulls = false` would silently drop.
     */
    @Test
    fun attachmentDescriptionInput_alwaysSendsTheDescriptionKey() {
        val cleared = json.encodeToString(
            AttachmentDescriptionInput.serializer(),
            AttachmentDescriptionInput(""),
        )
        assertEquals("""{"description":""}""", cleared)

        val set = json.encodeToString(
            AttachmentDescriptionInput.serializer(),
            AttachmentDescriptionInput("Hoá đơn FPT Shop"),
        )
        assertEquals("""{"description":"Hoá đơn FPT Shop"}""", set)

        // File metadata is not mutable through this endpoint.
        assertFalse(set.contains("fileName"))
        assertFalse(set.contains("fileType"))
    }

    @Test
    fun attachmentResponse_decodesTheUpdatedMeta() {
        val raw = """
            {
              "attachment": {
                "id": "att-1", "fileName": "hoa-don.pdf", "fileType": "application/pdf",
                "fileSize": 2048, "description": "Hoá đơn FPT Shop",
                "uploadedAt": "2025-01-02T03:04:05"
              }
            }
        """.trimIndent()

        val res = json.decodeFromString(AttachmentResponse.serializer(), raw)

        assertEquals("att-1", res.attachment.id)
        assertEquals("Hoá đơn FPT Shop", res.attachment.description)
        assertEquals(2048L, res.attachment.fileSize)

        val cleared = json.decodeFromString(
            AttachmentResponse.serializer(),
            """{"attachment":{"id":"att-1","fileName":"a.pdf","fileType":"application/pdf","fileSize":1,"description":null}}""",
        )
        assertNull(cleared.attachment.description)
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
     * a fabricated 0 ₫.
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
