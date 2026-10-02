import Foundation
import XCTest
@testable import WarrantyVaultKit

/// The "Đã ẩn" rollup on the Nhắc nhở screen. Its rows now come from
/// `GET /api/v1/reminders?includeDismissed=true`, so these fixtures mirror the
/// openapi `ReminderWarranty` row (Warranty + `device` + top-level
/// `isDismissed`) and are decoded exactly the way `APIClient` does it.
final class DismissedRemindersTests: KitTestCase {

    private struct Feed: Decodable { let reminders: [UpcomingReminder] }

    /// Decodes a reminders payload the way the client does, so the fixtures
    /// also prove the wire shape still decodes.
    private func feed(_ reminders: String) throws -> [UpcomingReminder] {
        try APIClient.decoder.decode(
            Feed.self, from: Data(#"{"reminders":[\#(reminders)]}"#.utf8)
        ).reminders
    }

    private let mixedFeed = #"""
    {"id": "war_hidden_laptop", "deviceId": "dev_1",
     "device": {"id": "dev_1", "name": "MacBook Pro 14", "category": "LAPTOP",
                "status": "ACTIVE"},
     "type": "EXTENDED", "provider": "Apple Việt Nam",
     "startDate": "2025-03-12T00:00:00Z", "endDate": "2027-03-12T00:00:00Z",
     "months": 24, "isDismissed": true},
    {"id": "war_visible", "deviceId": "dev_1",
     "device": {"id": "dev_1", "name": "MacBook Pro 14", "category": "LAPTOP",
                "status": "ACTIVE"},
     "type": "STANDARD", "provider": null,
     "startDate": "2025-03-12T00:00:00Z", "endDate": "2026-03-12T00:00:00Z",
     "months": 12, "isDismissed": false},
    {"id": "war_hidden_fryer", "deviceId": "dev_2",
     "device": {"id": "dev_2", "name": "Nồi chiên", "category": "KITCHEN",
                "status": "BROKEN"},
     "type": "STANDARD", "provider": null,
     "startDate": "2024-11-02T00:00:00Z", "endDate": "2028-11-02T00:00:00Z",
     "months": 48, "isDismissed": true}
    """#

    // MARK: - Filtering + ordering

    func testKeepsOnlyDismissedRowsNewestEndDateFirst() throws {
        let dismissed = DismissedReminders.fromReminders(try feed(mixedFeed))

        XCTAssertEqual(dismissed.map(\.warrantyId), ["war_hidden_fryer", "war_hidden_laptop"],
                       "the visible row is skipped, newest end date first")
    }

    func testMapsEveryFieldTheRowRenders() throws {
        let dismissed = DismissedReminders.fromReminders(try feed(mixedFeed))
        let first = try XCTUnwrap(dismissed.first)

        XCTAssertEqual(first.id, "war_hidden_fryer", "id is the warranty id (restore keys on it)")
        XCTAssertEqual(first.deviceId, "dev_2")
        XCTAssertEqual(first.deviceName, "Nồi chiên")
        XCTAssertEqual(first.deviceCategory, "KITCHEN")
        XCTAssertEqual(first.deviceCategoryLabel, "Đồ nhà bếp")
        XCTAssertEqual(first.deviceStatus, .BROKEN, "status comes from the row's device ref")
        XCTAssertEqual(first.deviceStatus.label, "Hỏng", "the badge renders this label")
        XCTAssertEqual(first.warrantyType, .STANDARD)
        XCTAssertEqual(first.warrantyTypeLabel, "Tiêu chuẩn")
        XCTAssertNil(first.warrantyProvider)
        XCTAssertEqual(first.endDate, makeDate("2028-11-02T00:00:00Z",
                                               format: "yyyy-MM-dd'T'HH:mm:ssZZZZZ",
                                               timeZone: TimeZone(identifier: "UTC")))
    }

    func testMapsTheSecondRowIndependently() throws {
        let dismissed = DismissedReminders.fromReminders(try feed(mixedFeed))
        let laptop = try XCTUnwrap(dismissed.last)

        XCTAssertEqual(laptop.warrantyId, "war_hidden_laptop")
        XCTAssertEqual(laptop.deviceName, "MacBook Pro 14")
        XCTAssertEqual(laptop.deviceStatus, .ACTIVE)
        XCTAssertEqual(laptop.warrantyType, .EXTENDED)
        XCTAssertEqual(laptop.warrantyTypeLabel, "Mở rộng")
        XCTAssertEqual(laptop.warrantyProvider, "Apple Việt Nam")
    }

    // MARK: - Lenient decoding

    func testRowsWithoutTheFlagCountAsVisible() throws {
        // The field is opt-in on the wire: a plain upcoming feed (or a server
        // that predates `includeDismissed`) must never leak rows into "Đã ẩn".
        let plainFeed = #"""
        {"id": "w", "deviceId": "d",
         "device": {"id": "d", "name": "TV", "category": "TV"},
         "type": "STANDARD", "provider": null,
         "startDate": "2025-01-01T00:00:00Z", "endDate": "2026-01-01T00:00:00Z",
         "months": 12}
        """#

        XCTAssertTrue(DismissedReminders.fromReminders(try feed(plainFeed)).isEmpty)
    }

    func testMissingDeviceStatusDefaultsToActive() throws {
        // The common case: hidden on a device that is still in use, so the
        // status badge stays off the row.
        let hidden = #"""
        {"id": "w", "deviceId": "d",
         "device": {"id": "d", "name": "Máy lọc nước", "category": "HOME"},
         "type": "THIRD_PARTY", "provider": "FPT",
         "startDate": "2025-01-01T00:00:00Z", "endDate": "2027-01-01T00:00:00Z",
         "months": 24, "isDismissed": true}
        """#

        let entry = try XCTUnwrap(DismissedReminders.fromReminders(try feed(hidden)).first)
        XCTAssertEqual(entry.deviceStatus, .ACTIVE, "missing status defaults to ACTIVE")
    }

    func testHiddenRowsOnSoldOrLostDevicesStillAppear() throws {
        // Dismissed rows come back regardless of device status — a reminder
        // hidden on a device that was later sold must stay restorable.
        let rows = #"""
        {"id": "w_sold", "deviceId": "d1",
         "device": {"id": "d1", "name": "iPhone 13", "category": "PHONE", "status": "SOLD"},
         "type": "STANDARD", "provider": null,
         "startDate": "2024-01-01T00:00:00Z", "endDate": "2026-01-01T00:00:00Z",
         "months": 24, "isDismissed": true},
        {"id": "w_lost", "deviceId": "d2",
         "device": {"id": "d2", "name": "AirPods Pro", "category": "HEADPHONE", "status": "LOST"},
         "type": "STANDARD", "provider": null,
         "startDate": "2024-01-01T00:00:00Z", "endDate": "2025-01-01T00:00:00Z",
         "months": 12, "isDismissed": true}
        """#

        let dismissed = DismissedReminders.fromReminders(try feed(rows))
        XCTAssertEqual(dismissed.map(\.warrantyId), ["w_sold", "w_lost"])
        XCTAssertEqual(dismissed.map(\.deviceStatus), [.SOLD, .LOST])
        XCTAssertEqual(dismissed.map(\.deviceStatus.label), ["Đã bán", "Mất"])
    }

    func testUnknownCategoryFallsBackToTheCode() throws {
        let hidden = #"""
        {"id": "w", "deviceId": "d",
         "device": {"id": "d", "name": "Máy mới", "category": "DRONE", "status": "ACTIVE"},
         "type": "STANDARD", "provider": null,
         "startDate": "2025-01-01T00:00:00Z", "endDate": "2026-01-01T00:00:00Z",
         "months": 12, "isDismissed": true}
        """#

        let entry = try XCTUnwrap(DismissedReminders.fromReminders(try feed(hidden)).first)
        XCTAssertEqual(entry.deviceCategoryLabel, "DRONE", "unknown category falls back to the code")
    }

    func testNoRemindersYieldsAnEmptyList() throws {
        XCTAssertTrue(DismissedReminders.fromReminders(try feed("")).isEmpty)
    }

    // MARK: - Days remaining

    func testDaysRemainingCountsWholeDaysFromToday() {
        let entry = DismissedReminder(
            warrantyId: "w", deviceId: "d", deviceName: "TV", deviceCategory: "TV",
            deviceStatus: .ACTIVE, warrantyType: .STANDARD, warrantyProvider: nil,
            endDate: makeDate("2025-10-25T09:00:00Z", format: "yyyy-MM-dd'T'HH:mm:ssZZZZZ",
                              timeZone: TimeZone(identifier: "UTC"))
        )

        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let now = makeDate("2025-10-15T20:00:00Z", format: "yyyy-MM-dd'T'HH:mm:ssZZZZZ",
                           timeZone: TimeZone(identifier: "UTC"))

        XCTAssertEqual(entry.daysRemaining(from: now, calendar: cal), 10)
    }
}
