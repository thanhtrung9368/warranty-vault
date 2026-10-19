import Foundation
import XCTest
@testable import WarrlyKit

/// The pure half of bulk add: row → request mapping, reconciliation of the
/// server's `created`/`failed` arrays onto the request rows, the 409 branch and
/// the quota arithmetic.
///
/// Nothing here touches the network. The endpoint's HTTP shape has its own
/// tests in `EndpointsTests`; these tests pin the decisions a view would
/// otherwise have to improvise.
final class BulkDeviceRulesTests: KitTestCase {

    private let utc = TimeZone(identifier: "UTC")!

    // MARK: - Helpers

    private func day(_ value: String) -> Date {
        makeDate(value, format: "yyyy-MM-dd", timeZone: utc)
    }

    private func row(_ name: String,
                     category: String = "OTHER",
                     date: String = "2025-04-02",
                     price: Int? = nil) -> BulkDeviceRow {
        BulkDeviceRow(name: name, category: category,
                      purchaseDate: day(date), purchasePrice: price)
    }

    private func deviceJSON(_ id: String, _ name: String) -> String {
        #"{"id":"\#(id)","name":"\#(name)","category":"OTHER","purchaseDate":"2025-01-01","purchasePrice":0,"status":"ACTIVE"}"#
    }

    private func decodeResult(_ json: String) throws -> BulkCreateDevicesResult {
        try APIClient.decoder.decode(BulkCreateDevicesResult.self, from: Data(json.utf8))
    }

    private func device(id: String, name: String, status: String = "ACTIVE") throws -> Device {
        let json = #"{"id":"\#(id)","name":"\#(name)","category":"OTHER","purchaseDate":"2025-01-01","purchasePrice":0,"status":"\#(status)"}"#
        return try APIClient.decoder.decode(Device.self, from: Data(json.utf8))
    }

    // MARK: - Row → request

    /// The row is deliberately not the whole `DeviceInput`: only the four
    /// minimum fields are filled, and everything else keeps the documented
    /// defaults. This is also where `nil` price becomes `0` (a real price).
    func testRowMapsToTheMinimumDeviceInput() {
        let mapped = BulkDeviceRules.makeInputs(
            [BulkDeviceRow(name: "  Tủ lạnh Toshiba  ",
                           category: "  FRIDGE  ",
                           purchaseDate: day("2025-04-02"),
                           purchasePrice: nil)],
            timeZone: utc
        )

        XCTAssertEqual(mapped.count, 1)
        let input = mapped[0]
        XCTAssertEqual(input.name, "Tủ lạnh Toshiba")
        XCTAssertEqual(input.category, "FRIDGE")
        XCTAssertEqual(input.purchaseDate, "2025-04-02")
        XCTAssertEqual(input.purchasePrice, 0)
        XCTAssertEqual(input.status, .ACTIVE)
        XCTAssertEqual(input.currency, CurrencyRules.vnd)
        XCTAssertNil(input.fxRate)
        XCTAssertEqual(input.warrantyMonths, 0)
        XCTAssertNil(input.brand)
        XCTAssertNil(input.model)
        XCTAssertNil(input.serialNumber)
        XCTAssertNil(input.purchasePlace)
        XCTAssertNil(input.notes)
        XCTAssertNil(input.leadDays, "the server applies its [30, 7] default")
    }

    func testEnteredPriceAndDateTimeZoneSurviveTheMapping() {
        let tokyo = TimeZone(identifier: "Asia/Tokyo")!
        let pickerDay = makeDate("2025-04-02", format: "yyyy-MM-dd", timeZone: tokyo)
        let mapped = BulkDeviceRules.makeInputs(
            [BulkDeviceRow(name: "Tivi", category: "TV",
                           purchaseDate: pickerDay, purchasePrice: 12_000_000)],
            timeZone: tokyo
        )

        XCTAssertEqual(mapped[0].purchaseDate, "2025-04-02",
                       "the day the picker drew is the day sent, not the UTC day before")
        XCTAssertEqual(mapped[0].purchasePrice, 12_000_000)
    }

    // MARK: - Building rows

    /// The chosen shape is a household batch: the date repeats, the categories
    /// do not. A new row inherits the date and starts at the safe category.
    func testNewRowInheritsThePreviousDateButNotItsCategory() {
        let previous = row("Tủ lạnh", category: "FRIDGE", date: "2025-04-02", price: 1)
        let next = BulkDeviceRules.newRow(following: previous, now: day("2025-04-09"))

        XCTAssertNotEqual(next.id, previous.id)
        XCTAssertEqual(next.purchaseDate, previous.purchaseDate)
        XCTAssertEqual(next.category, BulkDeviceRules.defaultCategory)
        XCTAssertEqual(next.name, "")
        XCTAssertNil(next.purchasePrice)

        let first = BulkDeviceRules.newRow(now: day("2025-04-09"))
        XCTAssertEqual(first.purchaseDate, day("2025-04-09"))
    }

    func testAppendingStopsAtTheContractRowCeiling() {
        var rows: [BulkDeviceRow] = []
        for index in 0..<BulkDeviceRules.maxRows {
            rows.append(row("Thiết bị \(index)"))
        }

        XCTAssertFalse(BulkDeviceRules.canAddRow(rows))
        XCTAssertEqual(BulkDeviceRules.appendingRow(to: rows).count,
                       BulkDeviceRules.maxRows)
        XCTAssertNil(BulkDeviceRules.rowCountError(BulkDeviceRules.maxRows))
        XCTAssertNotNil(BulkDeviceRules.rowCountError(BulkDeviceRules.maxRows + 1))
    }

    func testRemovingTheLastRowLeavesAUsableBlankRow() {
        let only = row("Tủ lạnh", category: "FRIDGE")
        let kept = BulkDeviceRules.removingRow(id: only.id, from: [only],
                                               now: day("2025-04-09"))

        XCTAssertEqual(kept.count, 1)
        XCTAssertNotEqual(kept[0].id, only.id)
        XCTAssertEqual(kept[0].name, "")
        XCTAssertEqual(kept[0].category, BulkDeviceRules.defaultCategory)
        XCTAssertEqual(kept[0].purchaseDate, day("2025-04-09"))
    }

    // MARK: - Local validation

    func testLocalErrorsUseTheWireFieldNames() {
        let invalid = BulkDeviceRow(name: "   ", category: "",
                                    purchaseDate: day("2025-04-02"),
                                    purchasePrice: -1)
        let errors = BulkDeviceRules.localErrors(for: invalid)

        XCTAssertEqual(errors["name"], [BulkDeviceCopy.nameRequired])
        XCTAssertEqual(errors["category"], [BulkDeviceCopy.categoryRequired])
        XCTAssertEqual(errors["purchasePrice"], [BulkDeviceCopy.priceInvalid])
        XCTAssertNil(errors["purchaseDate"], "a Date picker cannot produce an invalid day")

        let valid = row("Tivi", category: "TV", price: 0)
        XCTAssertTrue(BulkDeviceRules.localErrors(for: valid).isEmpty,
                      "0 is a real price, not a validation error")
    }

    // MARK: - Reconciliation

    /// The failures arrive out of order on purpose: the contract keys them by
    /// request `index`, not by their position in `failed`. The row that failed
    /// must keep the field errors of *its own* row.
    func testReconcileAttachesFailuresByRequestIndex() throws {
        let rows = (1...5).map { row("Dòng \($0)", date: "2025-04-0\($0)") }
        let result = try decodeResult("""
        {"created":[
            \(deviceJSON("dev_a", "Dòng 1")),
            \(deviceJSON("dev_c", "Dòng 3")),
            \(deviceJSON("dev_e", "Dòng 5"))
         ],
         "failed":[
            {"index":3,"code":"VALIDATION","message":"Dòng 4 sai",
             "fieldErrors":{"purchasePrice":["Giá mua không hợp lệ"]}},
            {"index":1,"code":"CATEGORY_INVALID","message":"Dòng 2 sai",
             "fieldErrors":{"category":["Loại không hợp lệ"]}}
         ]}
        """)

        let reconciliation = BulkDeviceRules.reconcile(rows: rows, result: result)

        XCTAssertEqual(reconciliation.outcomes.count, rows.count)
        XCTAssertEqual(reconciliation.failedRows.map(\.id), [rows[1].id, rows[3].id])
        XCTAssertEqual(reconciliation.retryRows.map(\.id), [rows[1].id, rows[3].id],
                       "retry keeps request order, and never contains a created row")
        XCTAssertEqual(reconciliation.createdDevices.map(\.id), ["dev_a", "dev_c", "dev_e"])
        XCTAssertEqual(reconciliation.createdCount, 3)
        XCTAssertEqual(reconciliation.unconfirmedRows, [])
        XCTAssertEqual(reconciliation.ignoredFailures, [])
        XCTAssertTrue(reconciliation.hasRetryRows)

        guard case let .created(first) = reconciliation.outcomes[0] else {
            return XCTFail("row 1 must be created")
        }
        XCTAssertEqual(first.id, "dev_a")

        guard case let .failed(second) = reconciliation.outcomes[1] else {
            return XCTFail("row 2 must be failed")
        }
        XCTAssertEqual(second.index, 1)
        XCTAssertEqual(second.fieldErrorsOrEmpty, ["category": ["Loại không hợp lệ"]])

        guard case let .created(third) = reconciliation.outcomes[2] else {
            return XCTFail("row 3 must be created")
        }
        XCTAssertEqual(third.id, "dev_c")

        guard case let .failed(fourth) = reconciliation.outcomes[3] else {
            return XCTFail("row 4 must be failed")
        }
        XCTAssertEqual(fourth.index, 3)
        XCTAssertEqual(fourth.fieldErrorsOrEmpty, ["purchasePrice": ["Giá mua không hợp lệ"]],
                       "row 4 must show row 4's error, not row 2's")

        guard case let .created(fifth) = reconciliation.outcomes[4] else {
            return XCTFail("row 5 must be created")
        }
        XCTAssertEqual(fifth.id, "dev_e")
    }

    func testReconcileIgnoresOutOfRangeAndDuplicateFailuresInsteadOfTrapping() throws {
        let rows = [row("Một"), row("Hai")]
        let result = try decodeResult("""
        {"created":[\(deviceJSON("dev_1", "Hai"))],
         "failed":[
            {"index":0,"code":"VALIDATION","message":"first wins","fieldErrors":{}},
            {"index":0,"code":"VALIDATION","message":"duplicate","fieldErrors":{}},
            {"index":99,"code":"VALIDATION","message":"out of range","fieldErrors":{}}
         ]}
        """)

        let reconciliation = BulkDeviceRules.reconcile(rows: rows, result: result)

        XCTAssertEqual(reconciliation.failedRows.map(\.id), [rows[0].id])
        XCTAssertEqual(reconciliation.ignoredFailures.map(\.index), [0, 99])
        XCTAssertEqual(reconciliation.ignoredFailures.first?.messageOrNil, "duplicate")
        guard case let .created(second) = reconciliation.outcomes[1] else {
            return XCTFail("the surviving row must be matched to the created device")
        }
        XCTAssertEqual(second.id, "dev_1")
    }

    /// Defensive case: the frozen contract always answers for every row, but if
    /// it does not, the row must stay visible and resendable rather than be
    /// silently treated as created (which would lose it) or hand-mapped to a
    /// created device (which could duplicate it on retry).
    func testReconcileKeepsUnansweredRowsAsUnconfirmed() throws {
        let rows = [row("Một"), row("Hai"), row("Ba")]
        let result = try decodeResult("""
        {"created":[\(deviceJSON("dev_1", "Một"))],
         "failed":[{"index":0,"code":"VALIDATION","message":"bad","fieldErrors":{}}]}
        """)

        let reconciliation = BulkDeviceRules.reconcile(rows: rows, result: result)

        XCTAssertEqual(reconciliation.failedRows.map(\.id), [rows[0].id])
        XCTAssertEqual(reconciliation.unconfirmedRows.map(\.id), [rows[2].id])
        XCTAssertEqual(reconciliation.retryRows.map(\.id), [rows[0].id, rows[2].id])
        guard case let .created(matched) = reconciliation.outcomes[1] else {
            return XCTFail("row 2 is the only non-failed row with a device left")
        }
        XCTAssertEqual(matched.id, "dev_1")
        guard case .unconfirmed = reconciliation.outcomes[2] else {
            return XCTFail("row 3 was never mentioned and must be unconfirmed")
        }
    }

    func testResultDecodingTreatsAbsentArraysAsEmpty() throws {
        let result = try decodeResult("{}")
        XCTAssertTrue(result.created.isEmpty,
                      "a successful HTTP response with a thin body must not become a decode failure")
        XCTAssertTrue(result.failed.isEmpty)
    }

    // MARK: - 409 / batch-level failures

    /// The 409 must not become row errors: nothing was created, so the drafts
    /// stay intact and only a batch-level card is shown. The server's sentence
    /// is preserved for display next to the locally computed capacity.
    func testLimitReachedIsTheWholeBatchBranchAndNotRowErrors() {
        let error = APIError.server(
            status: 409,
            envelope: APIErrorEnvelope(
                error: "LIMIT_REACHED",
                message: "Bạn đã đạt giới hạn thiết bị",
                fieldErrors: ["name": ["must not be used"]]
            )
        )

        let failure = BulkDeviceRules.submitFailure(error)

        XCTAssertTrue(failure.isLimitReached)
        XCTAssertEqual(failure.serverMessage, "Bạn đã đạt giới hạn thiết bị")
        XCTAssertEqual(failure.fieldErrors, [:],
                       "a whole-batch rejection has no per-row field errors")
    }

    func testRowCapRejectionKeepsItsFieldErrors() {
        let error = APIError.server(
            status: 400,
            envelope: APIErrorEnvelope(
                error: "VALIDATION",
                message: nil,
                fieldErrors: ["devices": ["Tối đa 50 thiết bị mỗi lần"]]
            )
        )

        let failure = BulkDeviceRules.submitFailure(error)

        guard case let .rejected(message, fieldErrors) = failure else {
            return XCTFail("a 400 must stay a batch rejection")
        }
        XCTAssertNil(message)
        XCTAssertEqual(fieldErrors["devices"], ["Tối đa 50 thiết bị mỗi lần"])
        XCTAssertFalse(failure.isLimitReached)
    }

    func testNonServerErrorsBecomeTheOtherBranch() {
        let failure = BulkDeviceRules.submitFailure(URLError(.notConnectedToInternet))
        guard case let .other(message) = failure else {
            return XCTFail("transport errors are not a quota conflict")
        }
        XCTAssertFalse(message.isEmpty)
        XCTAssertFalse(failure.isLimitReached)
    }

    // MARK: - Quota

    func testQuotaCapacityCountsActiveRowsAndRespectsBothCeilings() throws {
        let active = try (0..<48).map { try device(id: "a\($0)", name: "Active \($0)") }
        let sold = try (0..<2).map {
            try device(id: "s\($0)", name: "Sold \($0)", status: "SOLD")
        }
        let capacity = DeviceQuota.capacity(in: active + sold)

        XCTAssertEqual(DeviceQuota.activeCount(in: active + sold), 48)
        XCTAssertEqual(capacity.active, 48)
        XCTAssertEqual(capacity.total, 50)
        XCTAssertEqual(capacity.activeRemaining, 2)
        XCTAssertEqual(capacity.totalRemaining, 450)
        XCTAssertEqual(capacity.remaining, 2, "the active ceiling binds here")
        XCTAssertFalse(capacity.isFull)
    }

    /// Sold rows consume the 500-row total ceiling but not the 50-active one —
    /// taking the minimum of the two remainders is the only answer that is true
    /// for both.
    func testQuotaCapacityCanBeBoundByTheTotalCeiling() throws {
        let active = try (0..<10).map { try device(id: "a\($0)", name: "Active \($0)") }
        let sold = try (0..<490).map {
            try device(id: "s\($0)", name: "Sold \($0)", status: "SOLD")
        }
        let capacity = DeviceQuota.capacity(in: active + sold)

        XCTAssertEqual(capacity.active, 10)
        XCTAssertEqual(capacity.total, 500)
        XCTAssertEqual(capacity.activeRemaining, 40)
        XCTAssertEqual(capacity.totalRemaining, 0)
        XCTAssertEqual(capacity.remaining, 0, "sold rows still occupy the 500-row ceiling")
        XCTAssertTrue(capacity.isFull)
    }

    func testQuotaCapacityClampsAnAccountAlreadyOverTheLimitToZero() throws {
        let over = try (0..<60).map { try device(id: "a\($0)", name: "Active \($0)") }
        let capacity = DeviceQuota.capacity(in: over)

        XCTAssertEqual(capacity.activeRemaining, 0)
        XCTAssertEqual(capacity.remaining, 0)
        XCTAssertTrue(capacity.isFull)
    }

    // MARK: - Copy

    /// The two outcomes have to read differently: partial success says what was
    /// added, the 409 says nothing was. English is the product default, so the
    /// plural forms are pinned there too.
    func testBulkCopyDistinguishesQuotaRejectionFromPartialSuccess() {
        L.withLanguage(.en) {
            XCTAssertEqual(BulkDeviceCopy.created(1), "Added 1 device")
            XCTAssertEqual(BulkDeviceCopy.created(3), "Added 3 devices")
            XCTAssertEqual(BulkDeviceCopy.submit(1), "Add 1 device")
            XCTAssertEqual(BulkDeviceCopy.rowsToFix(2),
                           "2 rows need attention — fix them and resubmit")
            XCTAssertEqual(BulkDeviceCopy.limitTitle, "Nothing was created this time")
            XCTAssertEqual(BulkDeviceCopy.remaining(2),
                           "Your account can still take 2 devices.")
            XCTAssertEqual(BulkDeviceCopy.overflow(1),
                           "Remove at least 1 row, then resubmit.")
            XCTAssertEqual(BulkDeviceCopy.moreDevices(2), "… and 2 more devices")
            XCTAssertEqual(BulkDeviceCopy.rowTitle(3), "Device 3")
            XCTAssertEqual(BulkDeviceCopy.rowCount(3), "3/50 rows")
            XCTAssertEqual(BulkDeviceCopy.rowLimit, "Up to 50 rows per batch.")
            XCTAssertEqual(BulkDeviceCopy.rowLimitError,
                           "You can add at most 50 devices per batch.")
        }
        L.withLanguage(.vi) {
            XCTAssertEqual(BulkDeviceCopy.created(3), "Đã thêm 3 thiết bị")
            XCTAssertEqual(BulkDeviceCopy.limitTitle, "Lần gửi này không tạo thiết bị nào")
            XCTAssertEqual(BulkDeviceCopy.remaining(2),
                           "Tài khoản còn có thể thêm 2 thiết bị.")
        }
    }
}
