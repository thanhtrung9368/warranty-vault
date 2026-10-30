import Foundation
import XCTest
@testable import WarrlyKit

/// The pure claim rules: the open/closed partition the one-open-per-device rule
/// is built on, the BROKEN dead-end selector, cost formatting, and the mapping
/// of the 409 that a second open claim earns.
///
/// The 409 case is the reason this file exists at all: `limit_reached` is not a
/// generic failure, it is "there is a claim open already, go to that one".
final class ClaimRulesTests: XCTestCase {

    override func tearDown() {
        L.language = nil
        super.tearDown()
    }

    private func makeClaim(id: String = "claim_1",
                           status: ClaimStatus = .OPEN,
                           openedAt: String = "2026-03-02T00:00:00Z",
                           expectedReturnAt: String? = nil,
                           closedAt: String? = nil,
                           ticketNumber: String? = nil,
                           serviceCenter: String? = nil,
                           cost: Int? = nil,
                           coveredByWarranty: Bool? = nil,
                           issue: String = "Màn hình bị sọc") -> Claim {
        Claim(id: id,
              deviceId: "dev_1",
              warrantyId: nil,
              status: status,
              openedAt: openedAt,
              expectedReturnAt: expectedReturnAt,
              closedAt: closedAt,
              ticketNumber: ticketNumber,
              serviceCenter: serviceCenter,
              diagnosis: nil,
              outcome: nil,
              issue: issue,
              cost: cost,
              coveredByWarranty: coveredByWarranty)
    }

    private func envelope(_ json: String) throws -> APIErrorEnvelope {
        try APIClient.decoder.decode(APIErrorEnvelope.self, from: Data(json.utf8))
    }

    // MARK: - Open vs closed

    func testTheTwoInProgressStatusesAreOpenAndTheOtherThreeAreClosed() {
        XCTAssertEqual(ClaimRules.lifecycle(.OPEN), .open)
        XCTAssertEqual(ClaimRules.lifecycle(.IN_REPAIR), .open)
        XCTAssertEqual(ClaimRules.lifecycle(.RESOLVED), .closed)
        XCTAssertEqual(ClaimRules.lifecycle(.REJECTED), .closed)
        XCTAssertEqual(ClaimRules.lifecycle(.CANCELLED), .closed)

        XCTAssertTrue(ClaimRules.isOpen(.OPEN))
        XCTAssertTrue(ClaimRules.isOpen(.IN_REPAIR))
        XCTAssertFalse(ClaimRules.isOpen(.RESOLVED))
        XCTAssertFalse(ClaimRules.isOpen(.REJECTED))
        XCTAssertFalse(ClaimRules.isOpen(.CANCELLED))

        XCTAssertTrue(ClaimRules.isClosed(.RESOLVED))
        XCTAssertTrue(ClaimRules.isClosed(.REJECTED))
        XCTAssertTrue(ClaimRules.isClosed(.CANCELLED))
        XCTAssertFalse(ClaimRules.isClosed(.OPEN))

        // The lifecycle is derived from the status alone, never from the
        // server-written `closedAt` (which is nil until the claim closes).
        XCTAssertTrue(ClaimRules.isOpen(makeClaim(status: .IN_REPAIR)))
        XCTAssertTrue(ClaimRules.isClosed(makeClaim(status: .RESOLVED, closedAt: nil)))
        XCTAssertTrue(ClaimRules.isOpen(makeClaim(status: .OPEN,
                                                  closedAt: "2026-03-03T00:00:00Z")),
                      "a stray closedAt does not close an OPEN claim")
    }

    // MARK: - One open claim per device

    func testOpenClaimIsTheOldestOpenOne() {
        let newest = makeClaim(id: "new", status: .OPEN, openedAt: "2026-03-05T00:00:00Z")
        let oldest = makeClaim(id: "old", status: .IN_REPAIR, openedAt: "2026-03-01T00:00:00Z")
        let closed = makeClaim(id: "done", status: .RESOLVED, openedAt: "2026-02-01T00:00:00Z")

        let claims = [newest, closed, oldest]
        XCTAssertEqual(ClaimRules.openClaims(in: claims).map(\.id), ["old", "new"])
        XCTAssertTrue(ClaimRules.hasOpenClaim(in: claims))
        XCTAssertEqual(ClaimRules.openClaim(in: claims)?.id, "old")

        XCTAssertEqual(ClaimRules.openClaim(in: [closed])?.id, nil)
        XCTAssertFalse(ClaimRules.hasOpenClaim(in: [closed]))
        XCTAssertFalse(ClaimRules.hasOpenClaim(in: []))
    }

    func testDisplayOrderPutsTheOpenClaimFirstAndNewestFirstWithinAGroup() {
        let oldClosed = makeClaim(id: "c_old", status: .RESOLVED,
                                  openedAt: "2025-01-01T00:00:00Z")
        let newClosed = makeClaim(id: "c_new", status: .CANCELLED,
                                  openedAt: "2026-01-01T00:00:00Z")
        let open = makeClaim(id: "c_open", status: .IN_REPAIR,
                             openedAt: "2025-06-01T00:00:00Z")

        let sorted = ClaimRules.sortedForDisplay([oldClosed, newClosed, open])
        XCTAssertEqual(sorted.map(\.id), ["c_open", "c_new", "c_old"])
    }

    func testSortIsStableForClaimsOpenedAtTheSameMoment() {
        let sameA = makeClaim(id: "a", status: .IN_REPAIR, openedAt: "2026-03-02")
        let sameB = makeClaim(id: "b", status: .IN_REPAIR, openedAt: "2026-03-02")
        XCTAssertEqual(ClaimRules.sortedForDisplay([sameB, sameA]).map(\.id), ["a", "b"])
    }

    func testCrossDeviceOrderIsStrictlyNewestFirstWithOpenAndClosedMixed() {
        // The per-device section pins open rows to the top; the cross-device
        // list must not: a repair closed yesterday outranks one still open from
        // last year when the user is asking "what have I had repaired lately?".
        let oldOpen = makeClaim(id: "old_open", status: .IN_REPAIR,
                                openedAt: "2025-01-01T00:00:00Z")
        let newClosed = makeClaim(id: "new_closed", status: .RESOLVED,
                                  openedAt: "2026-03-01T00:00:00Z",
                                  closedAt: "2026-03-05T00:00:00Z")
        let middle = makeClaim(id: "middle", status: .CANCELLED,
                               openedAt: "2025-12-01T00:00:00Z")

        let sorted = ClaimRules.sortedNewestFirst([oldOpen, newClosed, middle])
        XCTAssertEqual(sorted.map(\.id), ["new_closed", "middle", "old_open"])

        // Same instant → id is the stable tie-break, and an unreadable
        // `openedAt` sorts last rather than jumping to the top.
        let sameA = makeClaim(id: "a", openedAt: "2026-03-02")
        let sameB = makeClaim(id: "b", openedAt: "2026-03-02")
        let unreadable = makeClaim(id: "z", openedAt: "")
        XCTAssertEqual(
            ClaimRules.sortedNewestFirst([unreadable, sameB, sameA]).map(\.id),
            ["a", "b", "z"]
        )
    }

    // MARK: - The BROKEN dead end

    func testBrokenWithNoOpenClaimNeedsTheNudge() {
        XCTAssertTrue(ClaimRules.needsRepairNudge(status: .BROKEN, claims: []))
        XCTAssertTrue(ClaimRules.needsRepairNudge(
            status: .BROKEN,
            claims: [makeClaim(status: .RESOLVED, closedAt: "2026-03-03T00:00:00Z"),
                     makeClaim(id: "c2", status: .REJECTED)]
        ))
    }

    func testBrokenWithAnOpenClaimDoesNotNudge() {
        for status in [ClaimStatus.OPEN, .IN_REPAIR] {
            XCTAssertFalse(ClaimRules.needsRepairNudge(
                status: .BROKEN,
                claims: [makeClaim(status: status)]
            ), "\(status) counts as an open repair")
        }
    }

    func testOnlyBrokenNudgesAndTheDeviceOverloadAgrees() throws {
        for status in [DeviceStatus.ACTIVE, .EXPIRED, .SOLD, .LOST] {
            XCTAssertFalse(ClaimRules.needsRepairNudge(status: status, claims: []),
                           "\(status) must not nudge")
        }

        let broken = try APIClient.decoder.decode(Device.self, from: Data(#"""
        {"id": "dev_1", "name": "MacBook", "category": "LAPTOP",
         "purchaseDate": "2025-03-12", "purchasePrice": 100, "status": "BROKEN"}
        """#.utf8))
        XCTAssertTrue(ClaimRules.needsRepairNudge(device: broken, claims: []))
        XCTAssertFalse(ClaimRules.needsRepairNudge(
            device: broken, claims: [makeClaim(status: .OPEN)]
        ))
    }

    // MARK: - Money

    func testCostLabelKeepsZeroDistinctFromNotRecorded() {
        XCTAssertNil(ClaimRules.costLabel(nil))
        XCTAssertEqual(ClaimRules.costLabel(0), "0 ₫")
        XCTAssertEqual(ClaimRules.costLabel(500_000), "500.000 ₫")
        XCTAssertEqual(ClaimRules.costLabel(1_500_000), "1.500.000 ₫")
        XCTAssertEqual(ClaimRules.costLabel(4_294_967_296), "4.294.967.296 ₫")
    }

    // MARK: - Dates are calendar days

    func testDayLabelReadsTheDayOffTheWireWithoutShiftingIt() {
        XCTAssertEqual(ClaimRules.dayLabel("2026-03-02"), "02/03/2026")
        XCTAssertEqual(ClaimRules.dayLabel("2026-03-02T00:00:00Z"), "02/03/2026")
        // 23:30 UTC is already the 3rd in +07:00; a claim's day is the day the
        // server wrote, not a local instant to re-interpret.
        XCTAssertEqual(ClaimRules.dayLabel("2026-03-02T23:30:00Z"), "02/03/2026")
        XCTAssertNil(ClaimRules.dayLabel(nil))
        XCTAssertNil(ClaimRules.dayLabel(""))
        XCTAssertNil(ClaimRules.dayLabel("02/03/2026"))
    }

    func testDayDateAndDayStringRoundTripInAGivenZone() throws {
        for zone in ["UTC", "Asia/Ho_Chi_Minh", "America/Los_Angeles"] {
            let timeZone = try XCTUnwrap(TimeZone(identifier: zone))
            let date = try XCTUnwrap(ClaimRules.dayDate("2026-03-02", in: timeZone))
            XCTAssertEqual(ClaimRules.dayString(date, in: timeZone), "2026-03-02", zone)
        }
    }

    // MARK: - Validation

    func testIssueIsRequiredAndBlankIsNotNullAnAnswer() {
        XCTAssertEqual(ClaimRules.validationErrors(issue: "", cost: nil)["issue"]?.count, 1)
        XCTAssertEqual(ClaimRules.validationErrors(issue: "   \n", cost: nil)["issue"]?.count, 1)
        XCTAssertNil(ClaimRules.validationErrors(issue: "Sọc màn hình", cost: nil)["issue"])
        XCTAssertTrue(ClaimRules.isValid(issue: "Sọc màn hình", cost: nil))
    }

    func testCostMustNotBeNegativeButZeroIsAllowed() {
        XCTAssertNotNil(ClaimRules.validationErrors(issue: "Lỗi", cost: -1)["cost"])
        XCTAssertNil(ClaimRules.validationErrors(issue: "Lỗi", cost: 0)["cost"])
        XCTAssertNil(ClaimRules.validationErrors(issue: "Lỗi", cost: nil)["cost"])
        XCTAssertTrue(ClaimRules.isValid(issue: "Lỗi", cost: 0))
        XCTAssertFalse(ClaimRules.isValid(issue: "Lỗi", cost: -1))
    }

    // MARK: - The 409

    func testLimitReachedMapsToOpenClaimExistsInEitherCase() throws {
        // The real wire value is lowercase; the contract table spells the code
        // uppercase. Both are the same 409 and both deserve the same way out.
        for code in ["limit_reached", "LIMIT_REACHED", "Limit_Reached"] {
            let error = APIError.server(status: 409, envelope: try envelope(#"""
            {"error": "\#(code)", "message": "Thiết bị đã có lần sửa chữa đang mở"}
            """#))
            let failure = ClaimRules.saveFailure(error)
            XCTAssertEqual(failure, .openClaimExists, code)
            XCTAssertTrue(failure.isOpenClaimExists)
            XCTAssertEqual(failure.title, ClaimRules.openClaimTitle)
            XCTAssertEqual(failure.message, ClaimRules.openClaimExistsMessage)
        }
    }

    func testAnother409KeepsTheServersMessageAndDoesNotClaimAnOpenRepair() throws {
        let error = APIError.server(status: 409, envelope: try envelope(#"""
        {"error": "claim_conflict", "message": "Một lỗi khác"}
        """#))
        XCTAssertEqual(ClaimRules.saveFailure(error), .other("Một lỗi khác"))
        XCTAssertFalse(ClaimRules.saveFailure(error).isOpenClaimExists)
    }

    func testNotFoundAndTransportErrorsMapToTheirOwnCases() throws {
        let notFound = APIError.server(status: 404, envelope: try envelope(#"""
        {"error": "not_found", "message": "Không tìm thấy"}
        """#))
        XCTAssertEqual(ClaimRules.saveFailure(notFound), .claimNotFound)
        XCTAssertTrue(ClaimRules.saveFailure(notFound).isClaimNotFound)

        let transport = APIError.transport("Mất kết nối")
        XCTAssertEqual(ClaimRules.saveFailure(transport), .other("Mất kết nối"))
    }

    func testTheConflictCopyIsBilingualAndNamesTheWayOut() {
        L.withLanguage(.vi) {
            XCTAssertEqual(ClaimRules.openClaimTitle, "Thiết bị đã có lần sửa chữa đang mở")
            XCTAssertEqual(ClaimRules.openClaimActionTitle, "Xem lần đang mở")
            XCTAssertEqual(ClaimRules.openClaimExistsMessage,
                           "Mỗi thiết bị chỉ có một lần sửa chữa đang mở. Cập nhật lần đang mở thay vì tạo lần mới.")
            XCTAssertEqual(ClaimSaveFailure.claimNotFound.title, "Không tìm thấy lần sửa chữa")
            XCTAssertEqual(ClaimSaveFailure.other("x").title, "Không lưu được lần sửa chữa")
        }
        L.withLanguage(.en) {
            XCTAssertEqual(ClaimRules.openClaimTitle, "This device already has an open repair")
            XCTAssertEqual(ClaimRules.openClaimActionTitle, "View the open repair")
            XCTAssertEqual(ClaimRules.openClaimExistsMessage,
                           "A device can have only one open repair. Update the open one instead of creating a new one.")
            XCTAssertEqual(ClaimSaveFailure.claimNotFound.title, "Repair not found")
            XCTAssertEqual(ClaimSaveFailure.other("x").title, "Couldn't save the repair")
        }
    }

    // MARK: - Status labels

    func testStatusLabelsAreBilingual() {
        L.withLanguage(.vi) {
            XCTAssertEqual(ClaimStatus.OPEN.label, "Đang mở")
            XCTAssertEqual(ClaimStatus.IN_REPAIR.label, "Đang sửa chữa")
            XCTAssertEqual(ClaimStatus.RESOLVED.label, "Đã xử lý")
            XCTAssertEqual(ClaimStatus.REJECTED.label, "Bị từ chối")
            XCTAssertEqual(ClaimStatus.CANCELLED.label, "Đã huỷ")
        }
        L.withLanguage(.en) {
            XCTAssertEqual(ClaimStatus.OPEN.label, "Open")
            XCTAssertEqual(ClaimStatus.IN_REPAIR.label, "In repair")
            XCTAssertEqual(ClaimStatus.RESOLVED.label, "Resolved")
            XCTAssertEqual(ClaimStatus.REJECTED.label, "Rejected")
            XCTAssertEqual(ClaimStatus.CANCELLED.label, "Cancelled")
        }
    }

    // MARK: - ClaimInput encoding

    private func encode<T: Encodable>(_ value: T) throws -> [String: Any] {
        let data = try APIClient.encoder.encode(value)
        return try XCTUnwrap(
            try JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
    }

    func testClaimInputWritesEveryFieldAndNeverWritesClosedAt() throws {
        var input = ClaimInput(deviceId: "dev_1",
                               issue: "Màn hình bị sọc",
                               openedAt: "2026-03-02",
                               status: .IN_REPAIR,
                               warrantyId: "war_1")
        input.expectedReturnAt = "2026-03-10"
        input.ticketNumber = "BH-2026-0312"
        input.serviceCenter = "FPT Shop Quận 1"
        input.diagnosis = "Màn hình lỗi"
        input.outcome = "Đã thay màn hình"
        input.cost = 500_000
        input.coveredByWarranty = true

        let body = try encode(input)
        XCTAssertEqual(Set(body.keys), [
            "deviceId", "warrantyId", "status", "openedAt", "expectedReturnAt",
            "ticketNumber", "serviceCenter", "diagnosis", "outcome", "issue",
            "cost", "coveredByWarranty",
        ])
        XCTAssertNil(body["closedAt"], "closedAt is server-owned and never sent")
        XCTAssertEqual(body["deviceId"] as? String, "dev_1")
        XCTAssertEqual(body["issue"] as? String, "Màn hình bị sọc")
        XCTAssertEqual(body["openedAt"] as? String, "2026-03-02")
        XCTAssertEqual(body["status"] as? String, "IN_REPAIR")
        XCTAssertEqual(body["cost"] as? Int, 500_000)
        XCTAssertEqual(body["coveredByWarranty"] as? Bool, true)
    }

    func testClaimInputSendsExplicitNullsForClearedFields() throws {
        // The synthesized encoder would DROP these keys, which the server reads
        // as "unchanged" — exactly the wrong thing for a form that just cleared
        // them. They must travel as explicit JSON null.
        let input = ClaimInput(deviceId: "dev_1", issue: "Lỗi", openedAt: "2026-03-02")
        let body = try encode(input)

        for key in ["warrantyId", "expectedReturnAt", "ticketNumber", "serviceCenter",
                    "diagnosis", "outcome", "cost", "coveredByWarranty"] {
            XCTAssertTrue(body[key] is NSNull, "\(key) must be an explicit null")
        }
    }

    func testCoveredByWarrantyKeepsUnsetDistinctFromFalse() throws {
        var unset = ClaimInput(deviceId: "dev_1", issue: "Lỗi", openedAt: "2026-03-02")
        unset.coveredByWarranty = nil
        XCTAssertTrue(try encode(unset)["coveredByWarranty"] is NSNull)

        var paid = ClaimInput(deviceId: "dev_1", issue: "Lỗi", openedAt: "2026-03-02")
        paid.coveredByWarranty = false
        XCTAssertEqual(try encode(paid)["coveredByWarranty"] as? Bool, false)

        var covered = ClaimInput(deviceId: "dev_1", issue: "Lỗi", openedAt: "2026-03-02")
        covered.coveredByWarranty = true
        XCTAssertEqual(try encode(covered)["coveredByWarranty"] as? Bool, true)
    }

    // MARK: - Claim decoding

    func testClaimDecodesEveryFieldAndKeepsTheRawDays() throws {
        let claim = try APIClient.decoder.decode(Claim.self, from: Data(#"""
        {
          "id": "claim_1",
          "deviceId": "dev_1",
          "warrantyId": "war_1",
          "status": "IN_REPAIR",
          "openedAt": "2026-03-02T00:00:00Z",
          "expectedReturnAt": "2026-03-10",
          "closedAt": null,
          "ticketNumber": "BH-2026-0312",
          "serviceCenter": "FPT Shop Quận 1",
          "diagnosis": "Màn hình lỗi",
          "outcome": null,
          "issue": "Màn hình bị sọc",
          "cost": 500000,
          "coveredByWarranty": false
        }
        """#.utf8))

        XCTAssertEqual(claim.id, "claim_1")
        XCTAssertEqual(claim.deviceId, "dev_1")
        XCTAssertEqual(claim.warrantyId, "war_1")
        XCTAssertEqual(claim.status, .IN_REPAIR)
        XCTAssertEqual(claim.openedAt, "2026-03-02T00:00:00Z",
                       "the wire day is kept raw, never parsed into a Date")
        XCTAssertEqual(claim.expectedReturnAt, "2026-03-10")
        XCTAssertNil(claim.closedAt)
        XCTAssertEqual(claim.ticketNumber, "BH-2026-0312")
        XCTAssertEqual(claim.serviceCenter, "FPT Shop Quận 1")
        XCTAssertEqual(claim.diagnosis, "Màn hình lỗi")
        XCTAssertNil(claim.outcome)
        XCTAssertEqual(claim.issue, "Màn hình bị sọc")
        XCTAssertEqual(claim.cost, 500_000)
        XCTAssertEqual(claim.coveredByWarranty, false)
    }

    func testClaimDecodesWithNullableFieldsAbsentOrNull() throws {
        let claim = try APIClient.decoder.decode(Claim.self, from: Data(#"""
        {"id": "claim_2", "deviceId": "dev_1", "status": "OPEN",
         "openedAt": "2026-03-02", "issue": "Lỗi nguồn",
         "warrantyId": null, "expectedReturnAt": null, "closedAt": null,
         "ticketNumber": null, "serviceCenter": null, "diagnosis": null,
         "outcome": null, "cost": null, "coveredByWarranty": null}
        """#.utf8))
        XCTAssertNil(claim.warrantyId)
        XCTAssertNil(claim.expectedReturnAt)
        XCTAssertNil(claim.closedAt)
        XCTAssertNil(claim.ticketNumber)
        XCTAssertNil(claim.serviceCenter)
        XCTAssertNil(claim.diagnosis)
        XCTAssertNil(claim.outcome)
        XCTAssertNil(claim.cost)
        XCTAssertNil(claim.coveredByWarranty)
    }

    func testDeviceDetailCarriesClaimsAndAbsenceMeansNotReturned() throws {
        let detail = try APIClient.decoder.decode(DeviceDetailBody.self, from: Data(#"""
        {
          "id": "dev_1", "name": "MacBook", "category": "LAPTOP",
          "purchaseDate": "2025-03-12", "purchasePrice": 100, "status": "BROKEN",
          "claims": [
            {"id": "claim_1", "deviceId": "dev_1", "status": "OPEN",
             "openedAt": "2026-03-02", "issue": "Màn hình bị sọc"}
          ]
        }
        """#.utf8))
        XCTAssertEqual(detail.claims?.map(\.id), ["claim_1"])
        XCTAssertEqual(detail.claimsOrEmpty.count, 1)

        let older = try APIClient.decoder.decode(DeviceDetailBody.self, from: Data(#"""
        {"id": "dev_1", "name": "MacBook", "category": "LAPTOP",
         "purchaseDate": "2025-03-12", "purchasePrice": 100, "status": "BROKEN"}
        """#.utf8))
        XCTAssertNil(older.claims)
        XCTAssertEqual(older.claimsOrEmpty, [])
    }
}
