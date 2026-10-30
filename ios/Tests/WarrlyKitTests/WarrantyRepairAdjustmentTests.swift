import Foundation
import XCTest
@testable import WarrlyKit

/// The display-only repair extension: Luật 19/2023, Điều 30.2.c.
///
/// The rule under test is deliberately narrow — only a **terminal** claim with
/// a server-written `closedAt` and two readable days contributes — because this
/// number is added to a date the user may quote to a retailer. The four cases
/// the brief names are pinned here, plus the boundaries that decide whether a
/// row contributes at all.
final class WarrantyRepairAdjustmentTests: XCTestCase {

    /// Vietnam time, matching how the server anchors the offset-less wire days
    /// this fixture uses. Pinned so the test does not depend on the machine zone.
    private let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Ho_Chi_Minh")!
        cal.locale = Locale(identifier: "en_US_POSIX")
        return cal
    }()

    private func day(_ string: String) -> Date {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = calendar.timeZone
        return f.date(from: string)!
    }

    private func claim(
        id: String = "claim_1",
        deviceId: String = "dev_1",
        status: ClaimStatus = .RESOLVED,
        openedAt: String = "2026-03-01",
        closedAt: String? = "2026-03-11",
        cost: Int? = nil
    ) -> Claim {
        Claim(id: id,
              deviceId: deviceId,
              warrantyId: nil,
              status: status,
              openedAt: openedAt,
              expectedReturnAt: nil,
              closedAt: closedAt,
              ticketNumber: nil,
              serviceCenter: nil,
              diagnosis: nil,
              outcome: nil,
              issue: "Màn hình bị sọc",
              cost: cost,
              coveredByWarranty: nil)
    }

    // MARK: - The four required cases

    func testNoClaimsLeavesTheEndDateUnchanged() {
        let result = WarrantyRepairAdjustment.adjust(
            rawEnd: day("2026-10-01"),
            claims: [],
            calendar: calendar
        )

        XCTAssertEqual(result.days, 0)
        XCTAssertEqual(result.claimCount, 0)
        XCTAssertFalse(result.hasExtension)
        XCTAssertEqual(result.rawEnd, day("2026-10-01"))
        XCTAssertEqual(result.adjustedEnd, day("2026-10-01"))
    }

    func testOneClosedClaimAddsItsWholeDays() {
        // 1 March → 11 March is ten whole calendar days.
        let result = WarrantyRepairAdjustment.adjust(
            rawEnd: day("2026-10-01"),
            claims: [claim(openedAt: "2026-03-01", closedAt: "2026-03-11")],
            calendar: calendar
        )

        XCTAssertEqual(result.days, 10)
        XCTAssertEqual(result.claimCount, 1)
        XCTAssertTrue(result.hasExtension)
        XCTAssertEqual(result.adjustedEnd, day("2026-10-11"))
    }

    func testAnOpenClaimIsExcludedEvenWhenItCarriesAClosedAt() {
        // The status is the source of truth (`ClaimRules`), not the timestamp:
        // a stray closedAt on an OPEN row must not extend a warranty.
        let open = claim(status: .OPEN, openedAt: "2026-03-01",
                         closedAt: "2026-03-20")
        let inRepair = claim(id: "claim_2", status: .IN_REPAIR,
                             openedAt: "2026-04-01", closedAt: "2026-04-20")

        XCTAssertNil(WarrantyRepairAdjustment.repairDays(for: open, calendar: calendar))
        XCTAssertNil(WarrantyRepairAdjustment.repairDays(for: inRepair, calendar: calendar))

        let result = WarrantyRepairAdjustment.adjust(
            rawEnd: day("2026-10-01"),
            claims: [open, inRepair],
            calendar: calendar
        )
        XCTAssertEqual(result.days, 0)
        XCTAssertEqual(result.adjustedEnd, day("2026-10-01"))
    }

    func testAClosedClaimWithNoClosedAtIsExcluded() {
        let missingStamp = claim(status: .RESOLVED, openedAt: "2026-03-01",
                                 closedAt: nil)

        XCTAssertNil(WarrantyRepairAdjustment.repairDays(for: missingStamp,
                                                         calendar: calendar))
        let result = WarrantyRepairAdjustment.adjust(
            rawEnd: day("2026-10-01"),
            claims: [missingStamp],
            calendar: calendar
        )
        XCTAssertEqual(result.days, 0)
        XCTAssertEqual(result.adjustedEnd, day("2026-10-01"))
    }

    // MARK: - Summing and boundaries

    func testEveryClosedClaimSumsAndCountsOnce() {
        let claims = [
            claim(id: "a", openedAt: "2026-01-01", closedAt: "2026-01-06"), // 5
            claim(id: "b", status: .REJECTED,
                  openedAt: "2026-02-01", closedAt: "2026-02-04"),          // 3
            claim(id: "c", status: .CANCELLED,
                  openedAt: "2026-03-01", closedAt: "2026-03-02"),          // 1
            claim(id: "d", status: .OPEN,
                  openedAt: "2026-04-01", closedAt: "2026-04-30"),          // excluded
            claim(id: "e", status: .RESOLVED,
                  openedAt: "2026-05-01", closedAt: nil),                   // excluded
        ]

        XCTAssertEqual(WarrantyRepairAdjustment.extensionDays(claims: claims,
                                                              calendar: calendar), 9)
        XCTAssertEqual(WarrantyRepairAdjustment.contributingClaimCount(claims: claims,
                                                                       calendar: calendar), 3)

        let result = WarrantyRepairAdjustment.adjust(
            rawEnd: day("2026-12-01"),
            claims: claims,
            calendar: calendar
        )
        XCTAssertEqual(result.days, 9)
        XCTAssertEqual(result.adjustedEnd, day("2026-12-10"))
        XCTAssertTrue(result.hasExtension)
        XCTAssertEqual(result.rawEnd, day("2026-12-01"),
                       "the stored end date is never rewritten")
    }

    func testASameDayRepairAddsNoWholeDay() {
        let sameDay = claim(openedAt: "2026-03-01", closedAt: "2026-03-01")
        XCTAssertEqual(WarrantyRepairAdjustment.repairDays(for: sameDay,
                                                           calendar: calendar), 0)
        XCTAssertFalse(WarrantyRepairAdjustment.adjust(
            rawEnd: day("2026-10-01"),
            claims: [sameDay],
            calendar: calendar
        ).hasExtension)
    }

    func testAClosedBeforeOpenedIntervalAddsNothingInsteadOfShrinkingTheWarranty() {
        let broken = claim(openedAt: "2026-03-11", closedAt: "2026-03-01")
        XCTAssertEqual(WarrantyRepairAdjustment.repairDays(for: broken,
                                                           calendar: calendar), 0)
    }

    func testAnUnreadableWireDayIsExcludedRatherThanGuessed() {
        let broken = claim(openedAt: "not-a-date", closedAt: "2026-03-11")
        XCTAssertNil(WarrantyRepairAdjustment.repairDays(for: broken,
                                                         calendar: calendar))
    }

    func testWireTimestampsContributeTheirCalendarDay() {
        // `openedAt` / `closedAt` are instants on the wire, but this app reads
        // their **leading day** (the same rule `ClaimRules.dayLabel` uses for
        // display): 01/03 → 11/03 is ten calendar days. Reading them as
        // instants in the caller's zone would make the same claim contribute a
        // different number of days on a different phone.
        let withTimes = claim(openedAt: "2026-03-01T23:30:00Z",
                              closedAt: "2026-03-11T01:00:00Z")
        XCTAssertEqual(WarrantyRepairAdjustment.repairDays(for: withTimes,
                                                           calendar: calendar), 10)
    }

    // MARK: - Copy

    func testTheLegalNoteSaysItIsALegalRightAndNotARetailerAgreement() {
        L.withLanguage(.vi) {
            XCTAssertTrue(WarrantyRepairAdjustment.legalNote.contains("Luật 19/2023"))
            XCTAssertTrue(WarrantyRepairAdjustment.legalNote.contains("không phải thoả thuận"))
        }
        L.withLanguage(.en) {
            XCTAssertTrue(WarrantyRepairAdjustment.legalNote.contains("Law 19/2023"))
            XCTAssertTrue(WarrantyRepairAdjustment.legalNote.contains("not an agreement"))
        }
    }

    func testAddedDaysLabelInflectsInEnglishAndStaysSingularInVietnamese() {
        L.withLanguage(.en) {
            XCTAssertEqual(WarrantyRepairAdjustment.addedDaysLabel(1),
                           "1 repair day added to the warranty end.")
            XCTAssertEqual(WarrantyRepairAdjustment.addedDaysLabel(10),
                           "10 repair days added to the warranty end.")
        }
        L.withLanguage(.vi) {
            XCTAssertEqual(WarrantyRepairAdjustment.addedDaysLabel(10),
                           "Đã cộng 10 ngày sửa chữa vào hạn bảo hành.")
        }
    }
}
