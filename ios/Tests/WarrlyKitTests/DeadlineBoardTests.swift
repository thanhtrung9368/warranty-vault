import Foundation
import XCTest
@testable import WarrlyKit

// The dashboard's ordering rule and its absolute-date copy.
//
// The defect this pins: the home screen showed four counts and a pill reading
// "Còn 9d". Neither could tell the user *when* the deadline was — the pill
// grows vaguer as the date recedes ("Còn 12d" → "Còn ~3th" → "2 năm") — so the
// one screen whose job is "what is the next date I could miss" could not name
// a date. `DeadlineBoard` puts the dated items in one order and
// `DeadlineCopy` prints the absolute date beside the day count.

final class DeadlineBoardTests: KitTestCase {

    // MARK: - Fixtures

    private let epoch = Date(timeIntervalSince1970: 1_800_000_000)

    private func date(_ days: Double) -> Date {
        epoch.addingTimeInterval(days * 86_400)
    }

    private func candidate(
        _ kind: DeadlineKind,
        _ id: String,
        _ title: String,
        days: Double
    ) -> DeadlineCandidate {
        DeadlineCandidate(
            kind: kind,
            entityId: id,
            title: title,
            date: date(days),
            days: Int(days)
        )
    }

    // MARK: - Ordering

    func testEarliestDateComesFirstWhateverTheSourceOrder() {
        let board = DeadlineBoard.ordered([
            candidate(.wishlist, "w1", "MacBook Air", days: 40),
            candidate(.subscription, "s1", "iCloud+ 2TB", days: 12),
            candidate(.warranty, "d1", "Apple Watch", days: 9),
        ])
        XCTAssertEqual(board.map(\.title), ["Apple Watch", "iCloud+ 2TB", "MacBook Air"])
    }

    func testAnOverdueDeadlineSortsBeforeEveryFutureOne() {
        // It is the date the user has already missed, so it is the most
        // actionable thing on the board — not a bug to filter out.
        let board = DeadlineBoard.ordered([
            candidate(.warranty, "d1", "Future warranty", days: 3),
            candidate(.subscription, "s1", "Overdue subscription", days: -120),
        ])
        XCTAssertEqual(board.first?.title, "Overdue subscription")
    }

    func testSameDayTiesBreakWarrantyThenSubscriptionThenWishlist() {
        let board = DeadlineBoard.ordered([
            candidate(.wishlist, "w1", "Wish", days: 10),
            candidate(.subscription, "s1", "Sub", days: 10),
            candidate(.warranty, "d1", "Warranty", days: 10),
        ])
        XCTAssertEqual(board.map(\.kind), [.warranty, .subscription, .wishlist])
    }

    func testSameDaySameKindIsStableByTitle() {
        let board = DeadlineBoard.ordered([
            candidate(.warranty, "d2", "Zebra", days: 10),
            candidate(.warranty, "d1", "Alpha", days: 10),
        ])
        XCTAssertEqual(board.map(\.title), ["Alpha", "Zebra"])
    }

    // MARK: - Deduplication

    func testSeveralWarrantyPackagesOnOneDeviceKeepTheNearestDate() {
        // A device can hold up to five warranty packages. The board names the
        // device; showing it three times because it has three packages would
        // let one device fill the whole list.
        let packages = [
            candidate(.warranty, "d1", "iPhone", days: 30),
            candidate(.warranty, "d1", "iPhone", days: 5),
            candidate(.warranty, "d1", "iPhone", days: 90),
        ]
        let board = DeadlineBoard.deduplicated(packages)
        XCTAssertEqual(board.count, 1)
        XCTAssertEqual(board.first?.days, 5)
    }

    // MARK: - Board split

    func testBoardIsOneNearestPlusThreeRows() {
        let board = DeadlineBoard.board((1...6).map {
            candidate(.warranty, "d\($0)", "Device \($0)", days: Double($0))
        })
        XCTAssertEqual(board.nearest?.title, "Device 1")
        XCTAssertEqual(board.rows.map(\.title), ["Device 2", "Device 3", "Device 4"])
        XCTAssertEqual(DeadlineBoard.rowCount, 3)
    }

    func testBoardWithNothingDatedHasNoCard() {
        // nil is the "nothing on record" answer. A caller must only draw the
        // empty state after its reads answer — an empty array is not proof.
        let board = DeadlineBoard.board([])
        XCTAssertNil(board.nearest)
        XCTAssertEqual(board.rows, [])
    }

    func testBoardWithOneDeadlineHasNoRows() {
        let board = DeadlineBoard.board([candidate(.warranty, "d1", "Only", days: 2)])
        XCTAssertEqual(board.nearest?.title, "Only")
        XCTAssertTrue(board.rows.isEmpty)
    }

    // MARK: - Copy: the absolute date

    func testTheCardAlwaysPrintsTheAbsoluteDate() {
        L.withLanguage(.vi) {
            XCTAssertEqual(
                DeadlineCopy.label(kind: .warranty, dateText: "12/03/2027", days: 9),
                "Hết hạn 12/03/2027 · còn 9 ngày"
            )
        }
        L.withLanguage(.en) {
            XCTAssertEqual(
                DeadlineCopy.label(kind: .warranty, dateText: "12/03/2027", days: 9),
                "Expires 12/03/2027 · 9 days left"
            )
        }
    }

    func testEachKindKeepsItsOwnVerb() {
        L.withLanguage(.vi) {
            XCTAssertEqual(DeadlineCopy.dateLabel(kind: .warranty, dateText: "01/02/2027"),
                           "Hết hạn 01/02/2027")
            XCTAssertEqual(DeadlineCopy.dateLabel(kind: .subscription, dateText: "01/02/2027"),
                           "Gia hạn 01/02/2027")
            XCTAssertEqual(DeadlineCopy.dateLabel(kind: .wishlist, dateText: "01/02/2027"),
                           "Dự kiến mua 01/02/2027")
        }
    }

    func testTodayIsNotZeroDaysLeft() {
        L.withLanguage(.vi) {
            XCTAssertEqual(DeadlineCopy.dayPhrase(0), "hôm nay")
            XCTAssertFalse(DeadlineCopy.dayPhrase(0).contains("0"))
        }
        L.withLanguage(.en) {
            XCTAssertEqual(DeadlineCopy.dayPhrase(0), "today")
        }
    }

    func testOverdueNeverReadsAsTimeRemaining() {
        L.withLanguage(.en) {
            let overdue = DeadlineCopy.label(kind: .warranty, dateText: "01/02/2026", days: -9)
            XCTAssertFalse(overdue.contains("left"), overdue)
            XCTAssertTrue(overdue.contains("9 days overdue"), overdue)
        }
        L.withLanguage(.vi) {
            let overdue = DeadlineCopy.label(kind: .subscription, dateText: "01/02/2026", days: -9)
            XCTAssertFalse(overdue.contains("còn"), overdue)
            XCTAssertTrue(overdue.contains("quá hạn 9 ngày"), overdue)
        }
    }

    func testEnglishInflectsASingleDay() {
        L.withLanguage(.en) {
            XCTAssertEqual(DeadlineCopy.dayPhrase(1), "1 day left")
            XCTAssertEqual(DeadlineCopy.dayPhrase(2), "2 days left")
            XCTAssertEqual(DeadlineCopy.dayPhrase(-1), "1 day overdue")
        }
    }

    // MARK: - Kind labels

    func testKindLabelsUseTheAppsExistingVocabulary() {
        L.withLanguage(.vi) {
            XCTAssertEqual(DeadlineCopy.kindLabel(.warranty), "Bảo hành")
            XCTAssertEqual(DeadlineCopy.kindLabel(.subscription), "Gói đăng ký")
        }
        L.withLanguage(.en) {
            XCTAssertEqual(DeadlineCopy.kindLabel(.warranty), "Warranties")
            XCTAssertEqual(DeadlineCopy.kindLabel(.subscription), "Subscriptions")
            XCTAssertEqual(DeadlineCopy.kindLabel(.wishlist), "Wishlist")
        }
    }
}
