import Foundation
import XCTest
@testable import WarrlyKit

/// The widget extension cannot be unit-tested here, so every decision it makes
/// from the snapshot is covered here: the snapshot shape and store, the two
/// feeds it is built from, the day arithmetic, the bilingual labels, the empty
/// state and the staleness boundary.
final class DeadlineWidgetTests: XCTestCase {

    private let calendar = SurfaceFixtures.calendar()

    // MARK: - Snapshot store

    func testSnapshotRoundTripsThroughTheAppGroupStore() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("warrly-snapshot-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }

        let snapshot = DeadlineSnapshot(
            capturedAt: SurfaceFixtures.date("2026-10-19T09:41:00Z"),
            windowDays: 90,
            deadlines: [
                SnapshotDeadline(
                    warrantyId: "war_1",
                    deviceId: "dev_1",
                    deviceName: "iPhone 15",
                    deviceCategory: "PHONE",
                    warrantyType: "STANDARD",
                    provider: "Apple",
                    endDate: SurfaceFixtures.date("2026-10-22T00:00:00Z")
                ),
            ],
            devices: [
                SnapshotDevice(
                    id: "dev_1",
                    name: "iPhone 15",
                    category: "PHONE",
                    brand: "Apple",
                    model: "A3090",
                    status: "ACTIVE",
                    effectiveWarrantyEnd: SurfaceFixtures.date("2026-10-22T00:00:00Z")
                ),
            ]
        )

        let store = DeadlineSnapshotStore(rootURL: root)
        XCTAssertNil(store.read(), "a fresh store is empty, not an error")
        try store.write(snapshot)
        XCTAssertEqual(store.read(), snapshot)

        store.clear()
        XCTAssertNil(store.read())
    }

    func testCorruptSnapshotReadsAsNeverCaptured() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("warrly-snapshot-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }

        let store = DeadlineSnapshotStore(rootURL: root)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data("not a snapshot".utf8).write(to: store.fileURL)
        XCTAssertNil(store.read())
    }

    // MARK: - Builder

    func testBuilderSortsDeadlinesAndDropsDuplicateWarrantyIds() {
        let snapshot = DeadlineSnapshotBuilder.build(
            devices: [SurfaceFixtures.device()],
            reminders: [
                SurfaceFixtures.reminder(id: "war_late", endDate: "2026-10-25T00:00:00Z"),
                SurfaceFixtures.reminder(id: "war_soon", endDate: "2026-10-20T00:00:00Z"),
                SurfaceFixtures.reminder(id: "war_soon", endDate: "2026-10-20T00:00:00Z"),
            ],
            capturedAt: SurfaceFixtures.date("2026-10-19T09:41:00Z")
        )

        XCTAssertEqual(snapshot.deadlines.map(\.warrantyId), ["war_soon", "war_late"])
    }

    func testBuilderCapsTheStoredListButKeepsTheSoonest() {
        let reminders = (1...20).map { day in
            SurfaceFixtures.reminder(
                id: "war_\(day)",
                endDate: String(format: "2026-11-%02dT00:00:00Z", day)
            )
        }
        let snapshot = DeadlineSnapshotBuilder.build(
            devices: [],
            reminders: reminders.reversed(),
            capturedAt: SurfaceFixtures.date("2026-10-19T09:41:00Z")
        )

        XCTAssertEqual(snapshot.deadlines.count, DeadlineSnapshotBuilder.maxDeadlines)
        XCTAssertEqual(snapshot.deadlines.first?.warrantyId, "war_1")
    }

    func testBuilderSkipsDismissedRemindersAndCopiesOnlyVisibleDeviceFields() throws {
        let device = SurfaceFixtures.device(
            id: "dev_7",
            name: "Máy giặt",
            brand: "LG",
            model: "FC1409",
            serial: "SN-WASH",
            category: "WASHING",
            status: "ACTIVE",
            effectiveEnd: "2027-01-01T00:00:00Z"
        )
        let snapshot = DeadlineSnapshotBuilder.build(
            devices: [device],
            reminders: [
                SurfaceFixtures.reminder(
                    id: "war_hidden",
                    deviceId: "dev_7",
                    deviceName: "Máy giặt",
                    endDate: "2026-10-20T00:00:00Z",
                    isDismissed: true
                ),
                SurfaceFixtures.reminder(
                    id: "war_visible",
                    deviceId: "dev_7",
                    deviceName: "Máy giặt",
                    endDate: "2026-10-21T00:00:00Z"
                ),
            ],
            capturedAt: SurfaceFixtures.date("2026-10-19T09:41:00Z"),
            windowDays: 90
        )

        XCTAssertEqual(snapshot.windowDays, 90)
        XCTAssertEqual(snapshot.deadlines.map(\.warrantyId), ["war_visible"])
        let row = try XCTUnwrap(snapshot.devices.first)
        XCTAssertEqual(row.id, "dev_7")
        XCTAssertEqual(row.name, "Máy giặt")
        XCTAssertEqual(row.brand, "LG")
        XCTAssertEqual(row.model, "FC1409")
        XCTAssertEqual(row.status, "ACTIVE")
        XCTAssertEqual(row.effectiveWarrantyEnd, SurfaceFixtures.date("2027-01-01T00:00:00Z"))
    }

    func testSnapshotDoesNotCarryTheSerialNumberIntoTheSharedContainer() throws {
        let device = SurfaceFixtures.device(serial: "SN-SECRET-123")
        let snapshot = DeadlineSnapshotBuilder.build(
            devices: [device],
            reminders: [],
            capturedAt: SurfaceFixtures.date("2026-10-19T09:41:00Z")
        )

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        let json = try XCTUnwrap(String(
            data: encoder.encode(snapshot),
            encoding: .utf8
        ))
        XCTAssertFalse(json.contains("SN-SECRET-123"), json)
        XCTAssertEqual(snapshot.devices.first?.name, "iPhone 15")
    }

    // MARK: - Days

    func testDaysRemainingIsMeasuredBetweenCalendarDaysNotHours() {
        let now = SurfaceFixtures.date("2026-10-19T23:30:00Z")
        XCTAssertEqual(
            DeadlineWidgetRules.daysRemaining(
                endDate: SurfaceFixtures.date("2026-10-20T00:30:00Z"),
                now: now,
                calendar: calendar
            ),
            1,
            "a deadline 59 minutes away tomorrow is one day away, not zero"
        )
        XCTAssertEqual(
            DeadlineWidgetRules.daysRemaining(
                endDate: SurfaceFixtures.date("2026-10-19T00:01:00Z"),
                now: now,
                calendar: calendar
            ),
            0
        )
        XCTAssertEqual(
            DeadlineWidgetRules.daysRemaining(
                endDate: SurfaceFixtures.date("2026-10-16T12:00:00Z"),
                now: now,
                calendar: calendar
            ),
            -3
        )
    }

    func testDaysRemainingSurvivesADSTBoundary() {
        var newYork = Calendar(identifier: .gregorian)
        newYork.timeZone = TimeZone(identifier: "America/New_York")!

        // Noon on 7 March 2026 to noon on 9 March is 47 hours but two calendar
        // days; a `timeInterval / 86_400` rule would say one.
        let days = DeadlineWidgetRules.daysRemaining(
            endDate: SurfaceFixtures.date("2026-03-09T16:00:00Z"),
            now: SurfaceFixtures.date("2026-03-07T17:00:00Z"),
            calendar: newYork
        )
        XCTAssertEqual(days, 2)
    }

    func testDaysLabelIsBilingualAndUsesTheExistingPlural() {
        XCTAssertEqual(DeadlineWidgetRules.daysLabel(days: 3, language: .en), "3 days left")
        XCTAssertEqual(DeadlineWidgetRules.daysLabel(days: 3, language: .vi), "Còn 3 ngày")
        XCTAssertEqual(DeadlineWidgetRules.daysLabel(days: 2, language: .en), "2 days left")
        XCTAssertEqual(DeadlineWidgetRules.daysLabel(days: 0, language: .en), "Expires today")
        XCTAssertEqual(DeadlineWidgetRules.daysLabel(days: 0, language: .vi), "Hết hạn hôm nay")
        XCTAssertEqual(DeadlineWidgetRules.daysLabel(days: 1, language: .en), "Expires tomorrow")
        XCTAssertEqual(DeadlineWidgetRules.daysLabel(days: 1, language: .vi), "Hết hạn ngày mai")
        XCTAssertEqual(DeadlineWidgetRules.daysLabel(days: -2, language: .en), "Expired 2 days ago")
        XCTAssertEqual(DeadlineWidgetRules.daysLabel(days: -2, language: .vi), "Đã hết hạn 2 ngày")
    }

    func testUrgencyBuckets() {
        XCTAssertEqual(DeadlineWidgetRules.urgency(days: -1), .expired)
        XCTAssertEqual(DeadlineWidgetRules.urgency(days: 0), .today)
        XCTAssertEqual(DeadlineWidgetRules.urgency(days: 7), .soon)
        XCTAssertEqual(DeadlineWidgetRules.urgency(days: 8), .later)
    }

    // MARK: - Staleness

    func testSnapshotIsFreshUntilSixHoursThenSaysAsOf() {
        let captured = SurfaceFixtures.date("2026-10-19T09:41:00Z")

        XCTAssertNil(DeadlineWidgetRules.asOfText(
            capturedAt: captured,
            now: SurfaceFixtures.date("2026-10-19T15:40:00Z"),
            language: .en,
            calendar: calendar
        ))
        XCTAssertEqual(
            DeadlineWidgetRules.asOfText(
                capturedAt: captured,
                now: SurfaceFixtures.date("2026-10-19T15:41:00Z"),
                language: .en,
                calendar: calendar
            ),
            "As of 09:41"
        )
        XCTAssertEqual(
            DeadlineWidgetRules.asOfText(
                capturedAt: captured,
                now: SurfaceFixtures.date("2026-10-19T15:41:00Z"),
                language: .vi,
                calendar: calendar
            ),
            "Tính đến 09:41"
        )
    }

    func testAsOfStampUsesTheLanguageDayMonthOrderPastMidnight() {
        let captured = SurfaceFixtures.date("2026-10-18T22:05:00Z")
        let now = SurfaceFixtures.date("2026-10-19T10:00:00Z")

        XCTAssertEqual(
            DeadlineWidgetRules.asOfText(
                capturedAt: captured, now: now, language: .vi, calendar: calendar
            ),
            "Tính đến 22:05 18/10"
        )
        XCTAssertEqual(
            DeadlineWidgetRules.asOfText(
                capturedAt: captured, now: now, language: .en, calendar: calendar
            ),
            "As of 22:05 10/18"
        )
    }

    func testSeverelyStaleSnapshotAddsTheRefreshHint() {
        let snapshot = DeadlineSnapshot(
            capturedAt: SurfaceFixtures.date("2026-10-16T10:00:00Z"),
            windowDays: 90,
            deadlines: [],
            devices: []
        )
        let presentation = DeadlineWidgetRules.presentation(
            snapshot: snapshot,
            now: SurfaceFixtures.date("2026-10-19T10:00:00Z"),
            limit: 3,
            language: .en,
            calendar: calendar
        )

        XCTAssertNotNil(presentation.asOfText)
        XCTAssertEqual(presentation.refreshHint, "Open Warrly to refresh")
    }

    // MARK: - Presentation

    func testMissingSnapshotIsNotConfiguredNotAnError() {
        let presentation = DeadlineWidgetRules.presentation(
            snapshot: nil,
            now: SurfaceFixtures.date("2026-10-19T09:41:00Z"),
            limit: 3,
            language: .en,
            calendar: calendar
        )

        XCTAssertEqual(presentation.state, DeadlineWidgetPresentation.State.notConfigured)
        XCTAssertEqual(presentation.title, "Expiring soon")
        XCTAssertEqual(presentation.message, "Open the app once to sync your deadlines.")
        XCTAssertNil(presentation.asOfText)
    }

    func testEmptySnapshotSaysNothingDueInTheWindow() {
        let snapshot = DeadlineSnapshot(
            capturedAt: SurfaceFixtures.date("2026-10-19T09:41:00Z"),
            windowDays: 90,
            deadlines: [],
            devices: []
        )
        let presentation = DeadlineWidgetRules.presentation(
            snapshot: snapshot,
            now: SurfaceFixtures.date("2026-10-19T10:00:00Z"),
            limit: 3,
            language: .en,
            calendar: calendar
        )

        XCTAssertEqual(presentation.state, DeadlineWidgetPresentation.State.empty)
        XCTAssertEqual(presentation.title, "Nothing due soon")
        XCTAssertEqual(presentation.message, "No reminders in the next 90 days.")
        XCTAssertNil(presentation.asOfText, "a fresh empty snapshot is a real answer")
    }

    func testAnOldEmptySnapshotStillConfessesItsAge() {
        let snapshot = DeadlineSnapshot(
            capturedAt: SurfaceFixtures.date("2026-10-19T01:00:00Z"),
            windowDays: 90,
            deadlines: [],
            devices: []
        )
        let presentation = DeadlineWidgetRules.presentation(
            snapshot: snapshot,
            now: SurfaceFixtures.date("2026-10-19T10:00:00Z"),
            limit: 3,
            language: .en,
            calendar: calendar
        )

        XCTAssertEqual(presentation.state, DeadlineWidgetPresentation.State.empty)
        XCTAssertEqual(presentation.asOfText, "As of 01:00")
    }

    func testPresentationLimitsRowsAndCarriesTheDeviceIdForDeepLinks() {
        let deadlines = (1...5).map { offset in
            SnapshotDeadline(
                warrantyId: "war_\(offset)",
                deviceId: "dev_\(offset)",
                deviceName: "Device \(offset)",
                deviceCategory: "PHONE",
                warrantyType: "STANDARD",
                provider: nil,
                endDate: SurfaceFixtures.date("2026-10-\(String(format: "%02d", 19 + offset))T00:00:00Z")
            )
        }
        let snapshot = DeadlineSnapshot(
            capturedAt: SurfaceFixtures.date("2026-10-19T09:00:00Z"),
            windowDays: 90,
            deadlines: deadlines,
            devices: []
        )
        let presentation = DeadlineWidgetRules.presentation(
            snapshot: snapshot,
            now: SurfaceFixtures.date("2026-10-19T09:41:00Z"),
            limit: 3,
            language: .en,
            calendar: calendar
        )

        XCTAssertEqual(presentation.rows.count, 3)
        XCTAssertEqual(presentation.rows.first?.deviceId, "dev_1")
        XCTAssertEqual(presentation.rows.first?.daysText, "Expires tomorrow")
    }
}
