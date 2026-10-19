import Foundation
import XCTest
@testable import WarrlyKit

final class WarrantyExpiryRulesTests: XCTestCase {

    private let calendar = SurfaceFixtures.calendar()
    private let now = SurfaceFixtures.date("2026-10-19T09:41:00Z")

    // MARK: - Live

    func testLiveAnswerUsesTheLatestWarrantyEnd() {
        let answer = WarrantyExpiryRules.answer(
            deviceName: "iPhone 15",
            source: .live([
                SurfaceFixtures.warranty(id: "war_short", endDate: "2026-10-22T00:00:00Z"),
                SurfaceFixtures.warranty(id: "war_long", endDate: "2026-11-01T00:00:00Z"),
            ]),
            now: now,
            language: .en,
            calendar: calendar
        )

        XCTAssertFalse(answer.isFromCache)
        XCTAssertEqual(answer.endDate, SurfaceFixtures.date("2026-11-01T00:00:00Z"))
        XCTAssertTrue(answer.text.contains("iPhone 15"))
        XCTAssertTrue(answer.text.contains("13 days left"))
        XCTAssertTrue(answer.text.contains(
            WarrantyExpiryRules.dateText(
                for: SurfaceFixtures.date("2026-11-01T00:00:00Z"),
                language: .en,
                calendar: calendar
            )
        ))
    }

    func testLiveAnswerWithNoWarrantySaysSoInsteadOfInventingADate() {
        let answer = WarrantyExpiryRules.answer(
            deviceName: "iPhone 15",
            source: .live([]),
            now: now,
            language: .en,
            calendar: calendar
        )
        XCTAssertNil(answer.endDate)
        XCTAssertFalse(answer.isFromCache)
        XCTAssertEqual(answer.text, "No warranty recorded for iPhone 15.")
    }

    func testLiveAnswerIsBilingual() {
        let answer = WarrantyExpiryRules.answer(
            deviceName: "iPhone 15",
            source: .live([SurfaceFixtures.warranty(endDate: "2026-10-22T00:00:00Z")]),
            now: now,
            language: .vi,
            calendar: calendar
        )
        XCTAssertTrue(answer.text.contains("Còn 3 ngày"))
        XCTAssertTrue(answer.text.contains("iPhone 15"))
    }

    // MARK: - Cache

    func testCacheAnswerSaysItIsOnDeviceDataAndWhenItWasCaptured() {
        let captured = SurfaceFixtures.date("2026-10-19T01:41:00Z")
        let answer = WarrantyExpiryRules.answer(
            deviceName: "iPhone 15",
            source: .cache(
                endDate: SurfaceFixtures.date("2026-10-22T00:00:00Z"),
                capturedAt: captured
            ),
            now: now,
            language: .en,
            calendar: calendar
        )

        XCTAssertTrue(answer.isFromCache)
        XCTAssertEqual(answer.endDate, SurfaceFixtures.date("2026-10-22T00:00:00Z"))
        XCTAssertTrue(answer.text.contains("From on-device data (01:41)"), answer.text)
        XCTAssertTrue(answer.text.contains("3 days left"))
    }

    func testCacheAnswerIsBilingual() {
        let captured = SurfaceFixtures.date("2026-10-19T01:41:00Z")
        let answer = WarrantyExpiryRules.answer(
            deviceName: "iPhone 15",
            source: .cache(
                endDate: SurfaceFixtures.date("2026-10-22T00:00:00Z"),
                capturedAt: captured
            ),
            now: now,
            language: .vi,
            calendar: calendar
        )
        XCTAssertTrue(answer.text.contains("Theo dữ liệu lưu trên máy (01:41)"), answer.text)
        XCTAssertTrue(answer.text.contains("Còn 3 ngày"))
    }

    // MARK: - Unavailable

    func testUnavailableAnswerTellsTheUserHowToRecover() {
        let answer = WarrantyExpiryRules.answer(
            deviceName: "iPhone 15",
            source: .unavailable,
            now: now,
            language: .en,
            calendar: calendar
        )
        XCTAssertNil(answer.endDate)
        XCTAssertEqual(
            answer.text,
            "Couldn't read warranty data. Open Warrly and try again."
        )
    }

    // MARK: - Next deadline

    func testNextDeadlineAnswerReadsTheSnapshotWithItsAsOfLine() {
        let snapshot = DeadlineSnapshot(
            capturedAt: SurfaceFixtures.date("2026-10-19T01:41:00Z"),
            windowDays: 90,
            deadlines: [
                SnapshotDeadline(
                    warrantyId: "war_1",
                    deviceId: "dev_1",
                    deviceName: "iPhone 15",
                    deviceCategory: "PHONE",
                    warrantyType: "STANDARD",
                    provider: nil,
                    endDate: SurfaceFixtures.date("2026-10-20T00:00:00Z")
                ),
            ],
            devices: []
        )

        let text = WarrantyExpiryRules.nextDeadlineAnswer(
            snapshot: snapshot,
            now: now,
            language: .en,
            calendar: calendar
        )
        XCTAssertTrue(text.contains("iPhone 15"), text)
        XCTAssertTrue(text.contains("Expires tomorrow"), text)
        XCTAssertTrue(text.contains("As of 01:41"), text)
    }

    func testNextDeadlineAnswerWithoutSnapshotExplainsHowToSetItUp() {
        XCTAssertEqual(
            WarrantyExpiryRules.nextDeadlineAnswer(
                snapshot: nil, now: now, language: .en, calendar: calendar
            ),
            "Open the app once to sync your deadlines."
        )
    }

    func testNextDeadlineAnswerForAnEmptySnapshotSaysNothingIsDue() {
        let snapshot = DeadlineSnapshot(
            capturedAt: now,
            windowDays: 90,
            deadlines: [],
            devices: []
        )
        XCTAssertEqual(
            WarrantyExpiryRules.nextDeadlineAnswer(
                snapshot: snapshot, now: now, language: .en, calendar: calendar
            ),
            "No reminders in the next 90 days."
        )
    }

    func testDateTextKeepsTheDayInTheCallersZone() {
        let end = SurfaceFixtures.date("2026-10-22T00:00:00Z")

        XCTAssertEqual(
            WarrantyExpiryRules.dateText(for: end, language: .en, calendar: calendar),
            "Oct 22, 2026"
        )

        var saigon = Calendar(identifier: .gregorian)
        saigon.timeZone = TimeZone(identifier: "Asia/Ho_Chi_Minh")!
        // 2026-10-22T00:00Z is 07:00 on 22 October in Saigon, still the 22nd.
        XCTAssertTrue(
            WarrantyExpiryRules.dateText(for: end, language: .vi, calendar: saigon)
                .contains("22")
        )
    }
}
