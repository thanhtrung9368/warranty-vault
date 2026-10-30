import Foundation
import XCTest
@testable import WarrlyKit

/// The warranty form's defaults and date maths.
///
/// The defect this pins: the form used to default `startDate = today` and
/// `months = 12` even when the device was bought a year earlier, producing an
/// end date more than a year late — the app claiming cover the user does not
/// have. The purchase date is now the default; today survives only as the
/// fallback for a device with no purchase information.
final class WarrantyFormRulesTests: XCTestCase {

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

    override func tearDown() {
        L.language = nil
        super.tearDown()
    }

    // MARK: - The start-date default

    func testThePurchaseDateWinsOverToday() {
        let start = WarrantyFormRules.defaultStartDate(
            purchaseDate: day("2025-02-01"),
            today: day("2026-10-30"),
            calendar: calendar
        )
        XCTAssertEqual(start, day("2025-02-01"))
    }

    func testTodayIsOnlyTheFallbackWhenThereIsNoPurchaseDate() {
        let start = WarrantyFormRules.defaultStartDate(
            purchaseDate: nil,
            today: day("2026-10-30"),
            calendar: calendar
        )
        XCTAssertEqual(start, day("2026-10-30"))
    }

    func testTheDefaultStartIsReducedToTheCalendarDay() {
        let noon = calendar.date(byAdding: .hour, value: 12, to: day("2025-02-01"))!
        let start = WarrantyFormRules.defaultStartDate(
            purchaseDate: noon,
            today: day("2026-10-30"),
            calendar: calendar
        )
        XCTAssertEqual(start, calendar.startOfDay(for: noon))
    }

    // MARK: - The computed end

    func testTwelveMonthsFromThePurchaseDateIsTheExpectedEnd() {
        XCTAssertEqual(
            WarrantyFormRules.endDate(startDate: day("2025-02-01"),
                                      months: 12,
                                      calendar: calendar),
            day("2026-02-01")
        )
    }

    func testEndOfMonthClampsLikeTheServersAddMonths() {
        // 31 January + 1 month is 28 February 2026 (not 3 March).
        XCTAssertEqual(
            WarrantyFormRules.endDate(startDate: day("2026-01-31"),
                                      months: 1,
                                      calendar: calendar),
            day("2026-02-28")
        )
    }

    func testANonPositiveMonthCountProducesNoEndDate() {
        XCTAssertNil(WarrantyFormRules.endDate(startDate: day("2026-01-01"),
                                               months: 0,
                                               calendar: calendar))
        XCTAssertNil(WarrantyFormRules.endDate(startDate: day("2026-01-01"),
                                               months: -3,
                                               calendar: calendar))
    }

    // MARK: - The purchase-date conflict

    func testTheSameCalendarDayIsNotAConflictEvenWhenTheTimesDiffer() {
        let purchase = day("2025-02-01")
        let start = calendar.date(byAdding: .hour, value: 18, to: purchase)!
        XCTAssertNil(WarrantyFormRules.conflict(startDate: start,
                                                purchaseDate: purchase,
                                                calendar: calendar))
    }

    func testAStartAfterThePurchaseIsReportedWithItsOffset() {
        let conflict = WarrantyFormRules.conflict(
            startDate: day("2025-03-01"),
            purchaseDate: day("2025-02-01"),
            calendar: calendar
        )
        XCTAssertEqual(conflict?.offsetDays, 28)
        XCTAssertTrue(conflict?.startsAfterPurchase == true)
        L.withLanguage(.vi) {
            XCTAssertEqual(conflict?.label, "Gói bắt đầu muộn hơn ngày mua thiết bị 28 ngày.")
        }
        L.withLanguage(.en) {
            XCTAssertEqual(conflict?.label, "This plan starts 28 days after the device purchase.")
        }
    }

    func testAStartBeforeThePurchaseIsReportedWithTheAbsoluteOffset() {
        let conflict = WarrantyFormRules.conflict(
            startDate: day("2025-01-01"),
            purchaseDate: day("2025-02-01"),
            calendar: calendar
        )
        XCTAssertEqual(conflict?.offsetDays, -31)
        XCTAssertFalse(conflict?.startsAfterPurchase == true)
        L.withLanguage(.en) {
            XCTAssertEqual(conflict?.label, "This plan starts 31 days before the device purchase.")
        }
    }

    func testNoPurchaseDateMeansNothingToDisclose() {
        XCTAssertNil(WarrantyFormRules.conflict(startDate: day("2025-01-01"),
                                                purchaseDate: nil,
                                                calendar: calendar))
    }
}
