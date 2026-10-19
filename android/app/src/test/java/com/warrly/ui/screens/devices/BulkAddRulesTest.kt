package com.warrly.ui.screens.devices

import com.warrly.i18n.ResCatalog
import com.warrly.network.ApiClient
import com.warrly.network.BulkDeviceFailure
import com.warrly.network.BulkDeviceRequest
import com.warrly.network.BulkDeviceResponse
import com.warrly.network.DEFAULT_CURRENCY
import com.warrly.network.DeviceStatus
import com.warrly.testing.Fixtures
import com.warrly.testing.httpError
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The pure half of bulk device add.
 *
 * These pin the four contract facts the screen would otherwise be free to get
 * wrong: the row-to-[com.warrly.network.DeviceInput] mapping, the 50-row cap,
 * the reconciliation of `failed[].index` back to the submitted draft (including
 * the retry-only-what-failed behaviour), and the all-or-nothing 409
 * `limit_reached` branch.
 *
 * The screen itself is not tested: this module has no instrumentation tests and
 * no Robolectric, so nothing here proves layout or focus behaviour. It proves
 * the rules the screen is built on, in both languages through `ResCatalog`.
 */
class BulkAddRulesTest {

    private val vi = ResCatalog.vietnamese()
    private val en = ResCatalog.english()

    private fun draft(key: Int, name: String = "Device $key") = BulkDeviceDraft(
        key = key,
        name = name,
        category = "APPLIANCE",
        purchaseDate = "2026-10-19",
        purchasePrice = "1000000",
    )

    // ---- the row -----------------------------------------------------------

    @Test
    fun aFreshRowStartsWithTheGivenDayAndTheDefaultCategory() {
        val row = newBulkDraft(key = 3, today = "2026-10-19")

        assertEquals(3, row.key)
        assertEquals("2026-10-19", row.purchaseDate)
        assertEquals(DEFAULT_BULK_CATEGORY, row.category)
        assertEquals("", row.name)
        assertEquals("", row.purchasePrice)
        assertNull(row.requestIndex)
    }

    /**
     * The row keeps only the four collected fields; everything else is the
     * single-device create's default. In particular a bulk row can never send a
     * serial, a sale record or a warranty schedule by accident.
     */
    @Test
    fun aRowMapsOnlyTheFourCollectedFieldsOntoDeviceInput() {
        val input = BulkDeviceDraft(
            key = 1,
            name = "  Tủ lạnh  ",
            category = " FRIDGE ",
            purchaseDate = " 2026-09-01 ",
            purchasePrice = "12990000",
        ).toDeviceInput()

        assertEquals("Tủ lạnh", input.name)
        assertEquals("FRIDGE", input.category)
        assertEquals("2026-09-01", input.purchaseDate)
        assertEquals(12_990_000, input.purchasePrice)
        assertEquals(DEFAULT_CURRENCY, input.currency)
        assertEquals(DeviceStatus.ACTIVE, input.status)
        assertNull(input.brand)
        assertNull(input.model)
        assertNull(input.serialNumber)
        assertNull(input.soldAt)
        assertNull(input.soldPrice)
        assertNull(input.returnWindowDays)
        assertNull(input.receivedAt)
        assertNull(input.activatedAt)
        assertNull(input.extendedCoverBuyBy)
        assertNull(input.leadDays)
        assertNull(input.brandWarrantyStatus)
        assertNull(input.brandLookupUrl)
        assertEquals(0, input.warrantyMonths)
    }

    @Test
    fun anEmptyPriceIsTheContractsZeroAndBlankCategoryFallsBackToTheDefault() {
        val input = BulkDeviceDraft(
            key = 1,
            name = "Loa",
            category = "   ",
            purchaseDate = "2026-10-19",
            purchasePrice = "",
        ).toDeviceInput()

        assertEquals(0, input.purchasePrice)
        assertEquals(DEFAULT_BULK_CATEGORY, input.category)
    }

    /**
     * `ApiClient.json` has `explicitNulls = false`: the optional fields must be
     * absent from the JSON (Go decodes an absent key exactly like null), and the
     * body must be the frozen `{"devices":[…]}` envelope.
     */
    @Test
    fun theRequestBodyIsTheDevicesEnvelopeAndOmitsNullOptionals() {
        val raw = ApiClient.json.encodeToString(
            BulkDeviceRequest.serializer(),
            bulkDeviceRequest(listOf(draft(1, name = "Tivi"))),
        )

        assertTrue("frozen envelope: $raw", raw.startsWith("""{"devices":["""))
        assertFalse("explicit nulls must be dropped: $raw", raw.contains(":null"))
        assertFalse(raw.contains("\"brand\""))
        assertFalse(raw.contains("\"serialNumber\""))
        assertFalse(raw.contains("\"fxRate\""))
        assertFalse(raw.contains("\"soldAt\""))
        assertFalse(raw.contains("\"leadDays\""))
        assertTrue(raw.contains("\"name\":\"Tivi\""))
        assertTrue(raw.contains("\"purchasePrice\":1000000"))

        // And it round-trips into the same DTO the screen posts.
        val decoded = ApiClient.json.decodeFromString(BulkDeviceRequest.serializer(), raw)
        assertEquals(1, decoded.devices.size)
        assertEquals("Tivi", decoded.devices.single().name)
    }

    // ---- what gets sent ----------------------------------------------------

    /**
     * A row the user added and never filled is not a device they meant to add.
     * "Filled" means a name or a price: a row where only the pre-filled date (or
     * the category) was touched is still an untouched row. A row with *any*
     * actual content IS sent even if incomplete: the server validates it and
     * returns the per-row errors this feature is built to show.
     */
    @Test
    fun onlyUntouchedRowsAreDropped() {
        val blank = newBulkDraft(key = 1, today = "2026-10-19")
        val priceOnly = newBulkDraft(key = 2, today = "2026-10-19").copy(purchasePrice = "500000")
        val nameOnly = newBulkDraft(key = 3, today = "2026-10-19").copy(name = "Nồi cơm")
        val dateOnly = newBulkDraft(key = 4, today = "2026-10-19").copy(purchaseDate = "2026-09-30")

        assertEquals(
            listOf(2, 3),
            bulkDraftsToSubmit(listOf(blank, priceOnly, nameOnly, dateOnly)).map { it.key },
        )
        assertFalse(canSubmitBulk(listOf(blank)))
        assertTrue(canSubmitBulk(listOf(priceOnly)))
    }

    @Test
    fun theRowCapIsTheContractsFifty() {
        assertEquals(50, MAX_BULK_DEVICES)
        val full = (1..MAX_BULK_DEVICES).map { newBulkDraft(it, "2026-10-19") }
        assertFalse(canAddBulkRow(full))
        assertTrue(canAddBulkRow(full.dropLast(1)))
    }

    // ---- editing -----------------------------------------------------------

    /**
     * Editing a field clears **only** that field's server error, and the
     * row-level sentence too (it described the old values). The other errors
     * stay: fixing the name must not hide the bad price.
     */
    @Test
    fun editingClearsThatFieldsErrorOnly() {
        val row = draft(1).copy(
            fieldErrors = mapOf(
                "name" to listOf("Tên không được để trống"),
                "purchasePrice" to listOf("Giá không hợp lệ"),
            ),
            message = "Dòng không hợp lệ",
        )

        val edited = row.withField(BulkDeviceField.NAME, "Tivi")

        assertEquals("Tivi", edited.name)
        assertEquals(emptyList<String>(), edited.fieldErrorsFor(BulkDeviceField.NAME))
        assertEquals(listOf("Giá không hợp lệ"), edited.fieldErrorsFor(BulkDeviceField.PRICE))
        assertNull(edited.message)
    }

    @Test
    fun thePriceInputKeepsDigitsOnlyAndOtherFieldErrorsStayVisible() {
        val row = draft(1)
        assertEquals("123", row.withField(BulkDeviceField.PRICE, "1a2b3").purchasePrice)

        val withUnknown = row.copy(
            fieldErrors = mapOf(
                "name" to listOf("name detail"),
                "currency" to listOf("currency detail"),
                "fxRate" to listOf("rate detail"),
            ),
        )
        assertEquals(listOf("name detail"), withUnknown.fieldErrorsFor(BulkDeviceField.NAME))
        assertEquals(listOf("currency detail", "rate detail"), withUnknown.otherFieldErrors())
    }

    // ---- reconciliation ----------------------------------------------------

    /**
     * The central partial-success path: the response names index 1, which is the
     * SECOND submitted row. That row keeps its stable key (its number in the
     * form), gains its own field errors, and is the only draft the retry sends.
     */
    @Test
    fun aFailedIndexJoinsTheRightDraftAndCarriesItsOwnFieldErrors() {
        val submitted = listOf(draft(10, "Tủ lạnh"), draft(11, "Máy giặt"), draft(12, "Tivi"))
        val response = BulkDeviceResponse(
            created = listOf(Fixtures.device(id = "d1", name = "Tủ lạnh"), Fixtures.device(id = "d3", name = "Tivi")),
            failed = listOf(
                BulkDeviceFailure(
                    index = 1,
                    code = "validation_failed",
                    message = "Ngày mua không hợp lệ",
                    fieldErrors = mapOf("purchaseDate" to listOf("Ngày mua không hợp lệ")),
                ),
            ),
        )

        val result = reconcileBulkSubmit(submitted, response)

        assertEquals(2, result.created.size)
        assertEquals(0, result.unaccountedCount)
        assertFalse(result.allCreated)
        val failed = result.failed.single()
        assertEquals(11, failed.draft.key)
        assertEquals(1, failed.index)
        assertEquals(1, failed.draft.requestIndex)
        assertEquals("validation_failed", failed.code)
        assertEquals("Ngày mua không hợp lệ", failed.serverMessage)
        assertEquals(listOf("Ngày mua không hợp lệ"), failed.draft.fieldErrorsFor(BulkDeviceField.PURCHASE_DATE))
        assertEquals(listOf(11), result.failedDrafts.map { it.key })
    }

    /**
     * After a partial success the form contains only the failed rows, and the
     * retry is a NEW request array — so the server's next `index` is 0. The row
     * must still display/retain its original number, or "fix row 3" becomes
     * "fix row 1" after the successful rows disappear.
     */
    @Test
    fun aRetryKeepsTheOriginalRowNumberEvenThoughItsRequestIndexChanges() {
        val first = reconcileBulkSubmit(
            submitted = listOf(draft(10), draft(11), draft(12)),
            response = BulkDeviceResponse(
                created = listOf(Fixtures.device(id = "d1"), Fixtures.device(id = "d2")),
                failed = listOf(BulkDeviceFailure(index = 2, message = "bad")),
            ),
        )
        val retryDrafts = first.failedDrafts
        assertEquals(listOf(12), retryDrafts.map { it.key })

        val second = reconcileBulkSubmit(
            submitted = retryDrafts,
            response = BulkDeviceResponse(
                failed = listOf(BulkDeviceFailure(index = 0, message = "still bad")),
            ),
        )

        val stillFailed = second.failed.single()
        assertEquals(12, stillFailed.draft.key)
        assertEquals(2, stillFailed.draft.requestIndex)
        assertEquals(0, stillFailed.index)
    }

    @Test
    fun aCompleteSuccessHasNoFailedRows() {
        val result = reconcileBulkSubmit(
            submitted = listOf(draft(1), draft(2)),
            response = BulkDeviceResponse(
                created = listOf(Fixtures.device(id = "d1"), Fixtures.device(id = "d2")),
            ),
        )

        assertTrue(result.allCreated)
        assertTrue(result.failed.isEmpty())
        assertTrue(result.failedDrafts.isEmpty())
        assertEquals(0, result.unaccountedCount)
    }

    /**
     * An index outside the submitted array cannot belong to this request, and a
     * duplicate index is a server bug. Neither may crash the screen: valid
     * failures still render, and the unreported rows surface as unaccounted
     * rather than being silently called created or failed.
     */
    @Test
    fun outOfRangeAndDuplicateFailuresAreIgnoredDeterministically() {
        val submitted = listOf(draft(1), draft(2), draft(3))

        val outOfRange = reconcileBulkSubmit(
            submitted = submitted,
            response = BulkDeviceResponse(
                created = listOf(Fixtures.device(id = "d1")),
                failed = listOf(BulkDeviceFailure(index = 9), BulkDeviceFailure(index = -1)),
            ),
        )
        assertTrue(outOfRange.failed.isEmpty())
        assertEquals(2, outOfRange.unaccountedCount)

        val duplicate = reconcileBulkSubmit(
            submitted = submitted,
            response = BulkDeviceResponse(
                created = listOf(Fixtures.device(id = "d1"), Fixtures.device(id = "d2")),
                failed = listOf(
                    BulkDeviceFailure(index = 1, message = "first"),
                    BulkDeviceFailure(index = 1, message = "second"),
                ),
            ),
        )
        assertEquals(1, duplicate.failed.size)
        assertEquals("first", duplicate.failed.single().serverMessage)
        assertEquals(0, duplicate.unaccountedCount)
    }

    // ---- capacity ----------------------------------------------------------

    @Test
    fun quotaCountsActiveRowsAndUsesTheSmallerOfTheTwoCeilings() {
        val empty = bulkQuota(emptyList())
        assertEquals(50, empty.activeRemaining)
        assertEquals(500, empty.storageRemaining)
        assertEquals(50, empty.newDeviceRemaining)

        val sold = listOf(
            Fixtures.device(id = "s1", status = DeviceStatus.SOLD),
            Fixtures.device(id = "s2", status = DeviceStatus.SOLD),
        )
        val active = (1..48).map { Fixtures.device(id = "a$it", status = DeviceStatus.ACTIVE) }
        val normal = bulkQuota(active + sold)
        assertEquals("sold rows do not occupy the 50 active slots", 2, normal.activeRemaining)
        assertEquals("sold rows DO count toward the 500 stored rows", 450, normal.storageRemaining)
        assertEquals(2, normal.newDeviceRemaining)

        // The storage ceiling binds even though active slots remain.
        val manySold = (1..495).map { Fixtures.device(id = "s$it", status = DeviceStatus.SOLD) }
        val storageBound = bulkQuota(listOf(Fixtures.device(id = "a1")) + manySold)
        assertEquals(49, storageBound.activeRemaining)
        assertEquals(4, storageBound.storageRemaining)
        assertEquals(4, storageBound.newDeviceRemaining)

        // An account already above a ceiling (allowed after un-selling a device)
        // must read as zero, never a negative slot count.
        val over = bulkQuota((1..51).map { Fixtures.device(id = "d$it") })
        assertEquals(0, over.activeRemaining)
        assertEquals(0, over.newDeviceRemaining)
    }

    // ---- the 409 -----------------------------------------------------------

    @Test
    fun onlyA409WithTheLimitCodeIsTheAllOrNothingBranch() {
        assertEquals(BulkFailureKind.LIMIT_REACHED, bulkRequestFailure(409, "limit_reached"))
        assertEquals(
            "the contract's uppercase spelling works too",
            BulkFailureKind.LIMIT_REACHED,
            bulkRequestFailure(409, "LIMIT_REACHED"),
        )
        assertEquals(BulkFailureKind.OTHER, bulkRequestFailure(409, "conflict"))
        assertEquals(BulkFailureKind.OTHER, bulkRequestFailure(409, null))
        assertEquals(BulkFailureKind.OTHER, bulkRequestFailure(400, "limit_reached"))
        assertEquals(BulkFailureKind.OTHER, bulkRequestFailure(null, "limit_reached"))
    }

    @Test
    fun theRequestErrorReadsCodeMessageAndFieldsFromTheOneShotBody() {
        val limit = bulkRequestError(
            httpError(409, """{"error":"limit_reached","message":"Đã đạt giới hạn 50 thiết bị"}"""),
            ApiClient.json,
        )
        assertEquals(BulkFailureKind.LIMIT_REACHED, limit.kind)
        assertEquals("Đã đạt giới hạn 50 thiết bị", limit.serverMessage)
        assertEquals(409, limit.status)

        val tooMany = bulkRequestError(
            httpError(
                400,
                """{"error":"validation_failed","message":"Quá nhiều thiết bị","fieldErrors":{"devices":["Tối đa 50 thiết bị mỗi lần"]}}""",
            ),
            ApiClient.json,
        )
        assertEquals(BulkFailureKind.OTHER, tooMany.kind)
        assertEquals("Quá nhiều thiết bị", tooMany.serverMessage)
        assertEquals(listOf("Tối đa 50 thiết bị mỗi lần"), tooMany.deviceFieldErrors)

        val offline = bulkRequestError(IOException("offline"), ApiClient.json)
        assertEquals(BulkFailureKind.OTHER, offline.kind)
        assertNull(offline.serverMessage)
        assertNull(offline.status)
        assertTrue(offline.deviceFieldErrors.isEmpty())
    }

    // ---- the sentence ------------------------------------------------------

    /**
     * The 409 is different from a failed row, and the sentence has to carry the
     * number the account can still take. `null` means the list could not be
     * read; then the app says the limit was hit instead of inventing a count.
     */
    @Test
    fun theLimitSentenceSaysTheRemainingNumberInBothLanguages() {
        assertEquals(
            "Tài khoản còn nhận được 3 thiết bị mới.",
            bulkLimitRemainingMessage(vi, 3),
        )
        assertEquals(
            "Your account can still take 3 more new devices.",
            bulkLimitRemainingMessage(en, 3),
        )
        assertEquals(
            "Your account can still take 1 more new device.",
            bulkLimitRemainingMessage(en, 1),
        )
        assertEquals(
            "Tài khoản không còn suất cho thiết bị mới.",
            bulkLimitRemainingMessage(vi, 0),
        )
        assertEquals(
            "Your account has no slots left for a new device.",
            bulkLimitRemainingMessage(en, 0),
        )
        assertEquals(
            "Tài khoản đã chạm giới hạn thiết bị.",
            bulkLimitRemainingMessage(vi, null),
        )
        assertEquals(
            "Your account has hit the device limit.",
            bulkLimitRemainingMessage(en, null),
        )
    }
}
