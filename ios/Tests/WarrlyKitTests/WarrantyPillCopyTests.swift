import Foundation
import XCTest
@testable import WarrlyKit

// The negative-pill copy. The field report: a fridge whose warranty ended
// 2025-03-10 showed a grey **"588d left"** chip in the English UI — 588 days
// *overdue* rendered as 588 days of cover left.
//
// The arithmetic and the `d < 0` branch were right; the English catalog entry
// for `"Hết %dd"` was a copy of the positive key's translation (`"%dd left"`).
// These tests pin the copy in both languages, so a translation can never flip
// the sign again without a red suite.

final class WarrantyPillCopyTests: KitTestCase {

    // MARK: - The expired case

    func testExpiredPillSaysExpiredInEnglish() {
        L.withLanguage(.en) {
            XCTAssertEqual(WarrantyPillCopy.label(daysLeft: -588), "Expired 588d")
            XCTAssertEqual(WarrantyPillCopy.label(daysLeft: -1), "Expired 1d")
        }
    }

    func testExpiredPillSaysHetInVietnamese() {
        L.withLanguage(.vi) {
            XCTAssertEqual(WarrantyPillCopy.label(daysLeft: -588), "Hết 588d")
            XCTAssertEqual(WarrantyPillCopy.label(daysLeft: -1), "Hết 1d")
        }
    }

    func testAnExpiredPillNeverReadsAsDaysLeft() {
        L.withLanguage(.en) {
            for overdue in [-1, -30, -588, -1000] {
                let label = WarrantyPillCopy.label(daysLeft: overdue)
                XCTAssertFalse(label.contains("left"), label)
                XCTAssertTrue(label.hasPrefix("Expired"), label)
            }
        }
    }

    func testOppositeSignsNeverShareCopy() {
        L.withLanguage(.en) {
            for n in [1, 9, 30, 90] {
                XCTAssertNotEqual(
                    WarrantyPillCopy.label(daysLeft: n),
                    WarrantyPillCopy.label(daysLeft: -n),
                    "\(n) days left and \(n) days overdue must not render identically"
                )
            }
        }
    }

    // MARK: - Tone

    func testToneFollowsTheSign() {
        XCTAssertEqual(WarrantyPillCopy.status(daysLeft: -588), .expired)
        XCTAssertEqual(WarrantyPillCopy.status(daysLeft: -1), .expired)
        XCTAssertEqual(WarrantyPillCopy.status(daysLeft: 0), .danger)
        XCTAssertEqual(WarrantyPillCopy.status(daysLeft: 9), .danger)
        XCTAssertEqual(WarrantyPillCopy.status(daysLeft: 31), .warn)
        XCTAssertEqual(WarrantyPillCopy.status(daysLeft: 91), .safe)
        // Unknown is drawn like expired, not like "fine".
        XCTAssertEqual(WarrantyPillCopy.status(daysLeft: nil), .expired)
        XCTAssertEqual(WarrantyPillCopy.label(daysLeft: nil), "—")
    }

    // MARK: - The positive and today cases

    func testPositivePillStillReadsAsDaysLeft() {
        L.withLanguage(.en) {
            XCTAssertEqual(WarrantyPillCopy.label(daysLeft: 9), "9d left")
            XCTAssertEqual(WarrantyPillCopy.label(daysLeft: 0), "Ends today")
        }
        L.withLanguage(.vi) {
            XCTAssertEqual(WarrantyPillCopy.label(daysLeft: 9), "Còn 9d")
            XCTAssertEqual(WarrantyPillCopy.label(daysLeft: 0), "Hết hôm nay")
        }
    }

    /// The same reported warranty, end to end: the deadline's day count feeds
    /// the pill, and the expired one must not come out positive.
    func testTheReportedFixtureProducesAnExpiredChip() {
        var hcm = Calendar(identifier: .gregorian)
        hcm.timeZone = TimeZone(identifier: "Asia/Ho_Chi_Minh")!
        let now = hcm.date(from: DateComponents(
            year: 2026, month: 10, day: 19, hour: 14, minute: 10))!
        let fridgeEnd = hcm.date(from: DateComponents(
            year: 2025, month: 3, day: 10))!

        let days = CalendarDay.days(from: now, to: fridgeEnd, calendar: hcm)
        XCTAssertEqual(days, -588)
        XCTAssertEqual(WarrantyPillCopy.status(daysLeft: days), .expired)
        L.withLanguage(.vi) {
            XCTAssertEqual(WarrantyPillCopy.label(daysLeft: days), "Hết 588d")
        }
        L.withLanguage(.en) {
            XCTAssertEqual(WarrantyPillCopy.label(daysLeft: days), "Expired 588d")
        }
    }
}
