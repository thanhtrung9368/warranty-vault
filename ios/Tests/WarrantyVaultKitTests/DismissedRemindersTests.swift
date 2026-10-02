import Foundation
import XCTest
@testable import WarrantyVaultKit

/// The "Đã ẩn" rollup on the Nhắc nhở screen. The only documented read that
/// still carries dismissed `Reminder` rows is the backup export, so these
/// fixtures mirror `BackupV1` / `BackupDevice` from openapi.yaml.
final class DismissedRemindersTests: KitTestCase {

    private func backupJSON(devices: String) -> Data {
        Data(#"{"version":5,"exportedAt":"2025-10-15T00:00:00Z","subscriptions":[],"wishlist":[],"devices":[\#(devices)]}"#.utf8)
    }

    private let mixedDevices = #"""
    {
      "id": "dev_1", "name": "MacBook Pro 14", "category": "LAPTOP", "status": "ACTIVE",
      "purchaseDate": "2025-03-12T00:00:00Z", "purchasePrice": 49990000,
      "createdAt": "2025-03-12T00:00:00Z", "updatedAt": "2025-03-12T00:00:00Z",
      "attachments": [],
      "warranties": [
        {
          "id": "war_dismissed", "type": "EXTENDED", "provider": "Apple Việt Nam",
          "startDate": "2025-03-12T00:00:00Z", "endDate": "2027-03-12T00:00:00Z",
          "months": 24, "createdAt": "2025-03-12T00:00:00Z", "updatedAt": "2025-03-12T00:00:00Z",
          "reminders": [{"id": "rem_1", "isDismissed": true, "createdAt": "2025-09-01T00:00:00Z"}]
        },
        {
          "id": "war_active", "type": "STANDARD", "provider": null,
          "startDate": "2025-03-12T00:00:00Z", "endDate": "2026-03-12T00:00:00Z",
          "months": 12, "createdAt": "2025-03-12T00:00:00Z", "updatedAt": "2025-03-12T00:00:00Z",
          "reminders": [{"id": "rem_2", "isDismissed": false, "createdAt": "2025-09-01T00:00:00Z"}]
        },
        {
          "id": "war_none", "type": "THIRD_PARTY", "provider": "FPT",
          "startDate": "2024-01-01T00:00:00Z", "endDate": "2026-01-01T00:00:00Z",
          "months": 12, "createdAt": "2024-01-01T00:00:00Z", "updatedAt": "2024-01-01T00:00:00Z",
          "reminders": []
        }
      ]
    },
    {
      "id": "dev_2", "name": "Nồi chiên", "category": "KITCHEN", "status": "BROKEN",
      "purchaseDate": "2024-11-02T00:00:00Z", "purchasePrice": 2000000,
      "createdAt": "2024-11-02T00:00:00Z", "updatedAt": "2024-11-02T00:00:00Z",
      "attachments": [],
      "warranties": [
        {
          "id": "war_dismissed_2", "type": "STANDARD", "provider": null,
          "startDate": "2024-11-02T00:00:00Z", "endDate": "2028-11-02T00:00:00Z",
          "months": 48, "createdAt": "2024-11-02T00:00:00Z", "updatedAt": "2024-11-02T00:00:00Z",
          "reminders": [{"id": "rem_3", "isDismissed": true, "createdAt": "2025-09-01T00:00:00Z"}]
        }
      ]
    }
    """#

    // MARK: - Filtering + ordering

    func testFromBackupKeepsOnlyWarrantiesWithADismissedReminder() throws {
        let dismissed = try DismissedReminders.fromBackup(backupJSON(devices: mixedDevices))

        XCTAssertEqual(dismissed.map(\.warrantyId), ["war_dismissed_2", "war_dismissed"],
                       "newest warranty end date first, like the web rollup")
    }

    func testFromBackupMapsEveryDisplayField() throws {
        let dismissed = try DismissedReminders.fromBackup(backupJSON(devices: mixedDevices))
        let first = try XCTUnwrap(dismissed.first)

        XCTAssertEqual(first.id, "war_dismissed_2", "id is the warranty id (restore keys on it)")
        XCTAssertEqual(first.deviceId, "dev_2")
        XCTAssertEqual(first.deviceName, "Nồi chiên")
        XCTAssertEqual(first.deviceCategory, "KITCHEN")
        XCTAssertEqual(first.deviceCategoryLabel, "Đồ nhà bếp")
        XCTAssertEqual(first.deviceStatus, .BROKEN)
        XCTAssertEqual(first.warrantyType, .STANDARD)
        XCTAssertEqual(first.warrantyTypeLabel, "Tiêu chuẩn")
        XCTAssertNil(first.warrantyProvider)
        XCTAssertEqual(first.endDate, makeDate("2028-11-02T00:00:00Z",
                                               format: "yyyy-MM-dd'T'HH:mm:ssZZZZZ",
                                               timeZone: TimeZone(identifier: "UTC")))
    }

    func testFromBackupTreatsAMixOfDismissedAndActiveRemindersAsDismissed() throws {
        // Mirrors the web's `.some(r => r.isDismissed)` (not `every`).
        let device = #"""
        {"id": "d", "name": "TV", "category": "TV", "status": "ACTIVE",
         "purchaseDate": "2025-01-01T00:00:00Z", "purchasePrice": 1,
         "createdAt": "2025-01-01T00:00:00Z", "updatedAt": "2025-01-01T00:00:00Z",
         "attachments": [],
         "warranties": [{"id": "w", "type": "STANDARD", "provider": null,
           "startDate": "2025-01-01T00:00:00Z", "endDate": "2026-01-01T00:00:00Z",
           "months": 12, "createdAt": "2025-01-01T00:00:00Z", "updatedAt": "2025-01-01T00:00:00Z",
           "reminders": [{"id": "r1", "isDismissed": false, "createdAt": "2025-01-01T00:00:00Z"},
                         {"id": "r2", "isDismissed": true, "createdAt": "2025-01-01T00:00:00Z"}]}]}
        """#

        XCTAssertEqual(try DismissedReminders.fromBackup(backupJSON(devices: device)).count, 1)
    }

    // MARK: - Lenient decoding

    func testUnknownTypeAndMissingStatusDegradeGracefully() throws {
        let device = #"""
        {"id": "d", "name": "Máy mới", "category": "DRONE",
         "purchaseDate": "2025-01-01T00:00:00Z", "purchasePrice": 1,
         "createdAt": "2025-01-01T00:00:00Z", "updatedAt": "2025-01-01T00:00:00Z",
         "attachments": [],
         "warranties": [{"id": "w", "type": "LIFETIME_PLUS", "provider": null,
           "startDate": "2025-01-01T00:00:00Z", "endDate": "2026-01-01T00:00:00Z",
           "months": 12, "createdAt": "2025-01-01T00:00:00Z", "updatedAt": "2025-01-01T00:00:00Z",
           "reminders": [{"id": "r1", "isDismissed": true, "createdAt": "2025-01-01T00:00:00Z"}]}]}
        """#

        let entry = try XCTUnwrap(try DismissedReminders.fromBackup(backupJSON(devices: device)).first)
        XCTAssertNil(entry.warrantyType)
        XCTAssertEqual(entry.warrantyTypeLabel, "LIFETIME_PLUS", "raw value still renders")
        XCTAssertEqual(entry.deviceStatus, .ACTIVE, "missing status defaults to ACTIVE")
        XCTAssertEqual(entry.deviceCategoryLabel, "DRONE", "unknown category falls back to the code")
    }

    func testMissingWarrantiesOrRemindersArraysAreTreatedAsEmpty() throws {
        let device = #"""
        {"id": "d", "name": "Chưa có BH", "category": "OTHER", "status": "ACTIVE",
         "purchaseDate": "2025-01-01T00:00:00Z", "purchasePrice": 1,
         "createdAt": "2025-01-01T00:00:00Z", "updatedAt": "2025-01-01T00:00:00Z",
         "attachments": []}
        """#
        XCTAssertTrue(try DismissedReminders.fromBackup(backupJSON(devices: device)).isEmpty)
    }

    func testNoDevicesYieldsAnEmptyList() throws {
        XCTAssertTrue(try DismissedReminders.fromBackup(backupJSON(devices: "")).isEmpty)
    }

    func testMalformedPayloadThrowsWhileAMissingDevicesArrayIsJustEmpty() {
        XCTAssertThrowsError(try DismissedReminders.fromBackup(Data("not json".utf8)))
        // Matches the web rollup: `backup.devices ?? []`, no throw.
        XCTAssertTrue(try DismissedReminders.fromBackup(Data(#"{"ok":true}"#.utf8)).isEmpty)
    }

    // MARK: - Days remaining

    func testDaysRemainingCountsWholeDaysFromToday() {
        let entry = DismissedReminder(
            warrantyId: "w", deviceId: "d", deviceName: "TV", deviceCategory: "TV",
            deviceStatus: .ACTIVE, warrantyType: .STANDARD, warrantyTypeRaw: "STANDARD",
            warrantyProvider: nil,
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
