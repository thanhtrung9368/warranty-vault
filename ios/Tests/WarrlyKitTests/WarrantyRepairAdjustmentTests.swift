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

    private let utc = TimeZone(identifier: "UTC")!

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

    // MARK: - Instants, not days (the field bug)

    /// `openedAt` / `closedAt` are RFC 3339 **instants** (`openapi.yaml`:
    /// "Là instant: RFC 3339 UTC kèm Z"), not calendar days. These four cases
    /// pin the two one-day errors that reading their UTC day produced, plus the
    /// zone dependency that makes the mistake a data bug rather than a rounding
    /// quirk.
    func testAClaimClosedAt0530ICTNoLongerComesOutOneDayShort() {
        // Closed 05:30 ICT on 11 March = 2026-03-10T22:30Z. The leading ten
        // bytes are `2026-03-10` — the **UTC** day — so the old arithmetic
        // counted 1 → 10 March = 9 days: one day short of what the user lived
        // through, in the direction this product must never be wrong in.
        let c = claim(openedAt: "2026-03-01T02:00:00Z",   // 09:00 ICT, 1 March
                      closedAt: "2026-03-10T22:30:00Z")   // 05:30 ICT, 11 March
        XCTAssertEqual(WarrantyRepairAdjustment.repairDays(for: c, calendar: calendar), 10)
    }

    func testAClaimOpenedAt0300ICTNoLongerOverstates() {
        // Opened 03:00 ICT on 1 March = 2026-02-28T20:00Z. The leading ten
        // bytes are `2026-02-28`, so the old arithmetic counted 28 February →
        // 11 March = 11 days: one more than the user was actually without the
        // machine.
        let c = claim(openedAt: "2026-02-28T20:00:00Z",    // 03:00 ICT, 1 March
                      closedAt: "2026-03-11T09:00:00Z")    // 16:00 ICT, 11 March
        XCTAssertEqual(WarrantyRepairAdjustment.repairDays(for: c, calendar: calendar), 10)
    }

    func testTheSameInstantsCountDifferentlyOnDifferentCalendars() {
        // Two hours apart on 1 March in Los Angeles (08:00 → 10:00 PST), but
        // 23:00 on 1 March → 01:00 on 2 March in Vietnam: no whole day lost
        // for one reader, one for the other. A UTC-day read says 0 for both.
        let c = claim(openedAt: "2026-03-01T16:00:00Z",
                      closedAt: "2026-03-01T18:00:00Z")

        var losAngeles = Calendar(identifier: .gregorian)
        losAngeles.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        losAngeles.locale = Locale(identifier: "en_US_POSIX")

        XCTAssertEqual(WarrantyRepairAdjustment.repairDays(for: c, calendar: losAngeles), 0)
        XCTAssertEqual(WarrantyRepairAdjustment.repairDays(for: c, calendar: calendar), 1)
    }

    func testAFractionalSecondInstantIsStillRead() {
        // Go marshals `time.Time` as RFC3339Nano, so microsecond precision
        // arrives as a fractional second. It must not make the claim
        // unreadable (that would silently drop a real repair day).
        let c = claim(openedAt: "2026-03-01T02:00:00.123456Z",
                      closedAt: "2026-03-11T01:00:00.5Z")
        XCTAssertEqual(WarrantyRepairAdjustment.repairDays(for: c, calendar: calendar), 10)
    }

    // MARK: - The claim card's day label

    func testClaimDayLabelsUseTheReadersCalendarNotTheUTCDay() {
        // Closed 05:30 ICT on 20 October = 2026-10-19T22:30Z. The card printed
        // "Đóng 19/10"; the web prints 20/10 because it reduces the instant to
        // the reader's day.
        XCTAssertEqual(ClaimRules.instantDayLabel("2026-10-19T22:30:00Z",
                                                  in: calendar.timeZone),
                       "20/10/2026")
        XCTAssertEqual(ClaimRules.instantDayLabel("2026-10-19T22:30:00Z",
                                                  in: utc),
                       "19/10/2026")

        // Offset-less values are calendar days: the day never moves with the
        // reader's zone (the `WireDay` rule, unchanged).
        XCTAssertEqual(ClaimRules.instantDayLabel("2026-10-19", in: utc), "19/10/2026")
        XCTAssertEqual(ClaimRules.instantDayLabel("2026-10-19",
                                                  in: calendar.timeZone),
                       "19/10/2026")
        XCTAssertNil(ClaimRules.instantDayLabel(nil, in: calendar.timeZone))
        XCTAssertNil(ClaimRules.instantDayLabel("not-a-date", in: calendar.timeZone))
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
