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
            counts: DeadlineSnapshotCounts(dueToday: 0, within7: 1, within30: 1),
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
        XCTAssertEqual(store.readOutcome(), .missing)
        try store.write(snapshot)
        XCTAssertEqual(store.read(), snapshot)
        XCTAssertEqual(store.read()?.version, 2)
        XCTAssertEqual(
            store.read()?.counts,
            DeadlineSnapshotCounts(dueToday: 0, within7: 1, within30: 1)
        )

        store.clear()
        XCTAssertNil(store.read())
        XCTAssertEqual(store.readOutcome(), .missing)
    }

    func testCorruptSnapshotReadsAsNeverCaptured() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("warrly-snapshot-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }

        let store = DeadlineSnapshotStore(rootURL: root)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data("not a snapshot".utf8).write(to: store.fileURL)
        XCTAssertNil(store.read())
        // The widget needs to tell "never captured" from "could not read on
        // this Lock Screen"; both are nil snapshots but only one may say
        // "open the app once".
        XCTAssertEqual(store.readOutcome(), .unreadable)
    }

    func testReadOutcomeDistinguishesMissingFromUnreadable() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("warrly-snapshot-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }

        let store = DeadlineSnapshotStore(rootURL: root)
        XCTAssertEqual(store.readOutcome(), .missing)

        let snapshot = DeadlineSnapshot(
            capturedAt: SurfaceFixtures.date("2026-10-19T09:41:00Z"),
            windowDays: 90,
            deadlines: [],
            counts: .zero,
            devices: []
        )
        let outcome = DeadlineSnapshotReadOutcome.snapshot(snapshot)
        try store.write(snapshot)
        XCTAssertEqual(store.readOutcome(), outcome)
    }

    func testVersionOneSnapshotWithoutCountsStillDecodes() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("warrly-snapshot-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }

        let capturedAt = SurfaceFixtures.date("2026-10-19T09:41:00Z")
        // A snapshot written by build 23: version 1, no `counts` key. The
        // widget must keep rendering it on iOS 17 after the update, and the
        // accessory derives its numbers from the stored rows until the app
        // writes a v2 snapshot.
        let v1 = DeadlineSnapshot(
            capturedAt: capturedAt,
            windowDays: 90,
            deadlines: [
                SnapshotDeadline(
                    warrantyId: "war_1",
                    deviceId: "dev_1",
                    deviceName: "iPhone 15",
                    deviceCategory: "PHONE",
                    warrantyType: "STANDARD",
                    provider: nil,
                    endDate: capturedAt.addingTimeInterval(2 * 24 * 60 * 60)
                ),
                SnapshotDeadline(
                    warrantyId: "war_2",
                    deviceId: "dev_2",
                    deviceName: "Máy giặt",
                    deviceCategory: "WASHING",
                    warrantyType: "EXTENDED",
                    provider: nil,
                    endDate: capturedAt.addingTimeInterval(9 * 24 * 60 * 60)
                ),
            ],
            devices: []
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        var object = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: encoder.encode(v1)) as? [String: Any]
        )
        XCTAssertNil(object["counts"], "v1 had no counts key")
        object["version"] = 1
        let data = try JSONSerialization.data(withJSONObject: object)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try data.write(to: DeadlineSnapshotStore(rootURL: root).fileURL)

        let store = DeadlineSnapshotStore(rootURL: root)
        guard case let .snapshot(decoded) = store.readOutcome() else {
            return XCTFail("a version-1 snapshot must still decode")
        }
        XCTAssertEqual(decoded.version, 1)
        XCTAssertNil(decoded.counts)

        let accessory = DeadlineAccessoryRules.presentation(
            outcome: store.readOutcome(),
            now: capturedAt,
            language: .en,
            calendar: calendar
        )
        XCTAssertEqual(accessory.state, .counts)
        XCTAssertEqual(accessory.stats.map(\.count), [0, 1, 2])
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

    // MARK: - Counts (Lock Screen)

    func testBuilderCountsDistinctDevicesBeforeTheTwelveRowCap() {
        // Fifteen distinct devices, all due tomorrow. The stored rows are capped
        // at 12, but the Lock Screen must say 15 — the count cannot be derived
        // from what the widget renders.
        let reminders = (1...15).map { index in
            SurfaceFixtures.reminder(
                id: "war_\(index)",
                deviceId: "dev_\(index)",
                deviceName: "Device \(index)",
                endDate: "2026-10-20T00:00:00Z"
            )
        }
        let snapshot = DeadlineSnapshotBuilder.build(
            devices: [],
            reminders: reminders,
            capturedAt: SurfaceFixtures.date("2026-10-19T09:41:00Z"),
            calendar: calendar
        )

        XCTAssertEqual(snapshot.version, 2)
        XCTAssertEqual(snapshot.deadlines.count, DeadlineSnapshotBuilder.maxDeadlines)
        XCTAssertEqual(snapshot.counts?.dueToday, 0)
        XCTAssertEqual(snapshot.counts?.within7, 15)
        XCTAssertEqual(snapshot.counts?.within30, 15)
    }

    func testCountsArePerDeviceAndSkipDismissedReminders() {
        let snapshot = DeadlineSnapshotBuilder.build(
            devices: [],
            reminders: [
                // Same device, two warranties: one device to the reader.
                SurfaceFixtures.reminder(
                    id: "war_a", deviceId: "dev_a",
                    endDate: "2026-10-22T00:00:00Z"
                ),
                SurfaceFixtures.reminder(
                    id: "war_b", deviceId: "dev_a",
                    endDate: "2026-10-29T00:00:00Z"
                ),
                // Hidden: the Lock Screen must count the same visible set the
                // home-screen widget shows.
                SurfaceFixtures.reminder(
                    id: "war_hidden", deviceId: "dev_b",
                    endDate: "2026-10-21T00:00:00Z",
                    isDismissed: true
                ),
            ],
            capturedAt: SurfaceFixtures.date("2026-10-19T09:41:00Z"),
            calendar: calendar
        )

        XCTAssertEqual(
            snapshot.counts,
            DeadlineSnapshotCounts(dueToday: 0, within7: 1, within30: 1)
        )
    }

    func testCountBucketsAnchorAtZeroSevenEightThirtyThirtyOne() {
        let now = SurfaceFixtures.date("2026-10-19T09:41:00Z")
        let day: TimeInterval = 24 * 60 * 60
        let deadlines = [0, 7, 8, 30, 31].map { offset in
            SnapshotDeadline(
                warrantyId: "war_\(offset)",
                deviceId: "dev_\(offset)",
                deviceName: "Device \(offset)",
                deviceCategory: "PHONE",
                warrantyType: "STANDARD",
                provider: nil,
                endDate: now.addingTimeInterval(TimeInterval(offset) * day)
            )
        }

        let counts = DeadlineSnapshotCounts.counting(
            deadlines: deadlines,
            now: now,
            calendar: calendar
        )
        XCTAssertEqual(counts.dueToday, 1, "day 0 is today")
        XCTAssertEqual(counts.within7, 2, "0 and 7 are inside a week; 8 is not")
        XCTAssertEqual(counts.within30, 4, "0, 7, 8 and 30 are inside 30; 31 is not")
    }

    func testAccessoryReadsCountsButNoDeviceName() {
        let device = SurfaceFixtures.device(id: "dev_secret", name: "iPhone 15 Pro Max")
        let snapshot = DeadlineSnapshotBuilder.build(
            devices: [device],
            reminders: [
                SurfaceFixtures.reminder(
                    id: "war_secret",
                    deviceId: "dev_secret",
                    deviceName: "iPhone 15 Pro Max",
                    endDate: "2026-10-20T00:00:00Z"
                ),
            ],
            capturedAt: SurfaceFixtures.date("2026-10-19T09:41:00Z"),
            calendar: calendar
        )
        let empty = DeadlineSnapshot(
            capturedAt: SurfaceFixtures.date("2026-10-19T09:41:00Z"),
            windowDays: 90,
            deadlines: [],
            devices: []
        )

        let outcomes: [DeadlineSnapshotReadOutcome] = [
            .missing, .unreadable, .snapshot(empty), .snapshot(snapshot),
        ]
        for outcome in outcomes {
            let accessory = DeadlineAccessoryRules.presentation(
                outcome: outcome,
                now: SurfaceFixtures.date("2026-10-19T10:00:00Z"),
                language: .en,
                calendar: calendar
            )
            let strings = [
                accessory.title,
                accessory.message,
                accessory.inlineText,
                accessory.accessibilityText,
                accessory.circularValue,
                accessory.circularLabel,
            ].compactMap { $0 } + accessory.stats.flatMap { [$0.title, $0.value] }

            XCTAssertFalse(strings.isEmpty)
            for string in strings {
                XCTAssertFalse(
                    string.contains("iPhone 15 Pro Max"),
                    "the Lock Screen rendered a device name: \(string)"
                )
            }
        }
    }

    func testAccessoryStatesAndCountCopy() {
        let now = SurfaceFixtures.date("2026-10-19T09:41:00Z")

        let notConfigured = DeadlineAccessoryRules.presentation(
            outcome: .missing, now: now, language: .en, calendar: calendar
        )
        XCTAssertEqual(notConfigured.state, .notConfigured)
        XCTAssertEqual(notConfigured.inlineText, "Open the app once to sync your deadlines.")
        XCTAssertNil(notConfigured.circularValue)

        let unreadable = DeadlineAccessoryRules.presentation(
            outcome: .unreadable, now: now, language: .en, calendar: calendar
        )
        XCTAssertEqual(unreadable.state, .unreadable)
        XCTAssertEqual(
            unreadable.message,
            "Couldn't read the saved data. Open Warrly to sync."
        )

        let empty = DeadlineSnapshot(
            capturedAt: now, windowDays: 90, deadlines: [], devices: []
        )
        let emptyAccessory = DeadlineAccessoryRules.presentation(
            outcome: .snapshot(empty), now: now, language: .en, calendar: calendar
        )
        XCTAssertEqual(emptyAccessory.state, .empty)
        XCTAssertEqual(emptyAccessory.inlineText, "No reminders in the next 90 days.")
        XCTAssertNil(emptyAccessory.circularValue)

        // A deadline 45 days out: inside the snapshot window, outside the
        // accessory's 30-day bucket. The copy names the window, it does not
        // print "0".
        let quiet = DeadlineSnapshot(
            capturedAt: now,
            windowDays: 90,
            deadlines: [
                SnapshotDeadline(
                    warrantyId: "war_far",
                    deviceId: "dev_far",
                    deviceName: "Máy giặt",
                    deviceCategory: "WASHING",
                    warrantyType: "STANDARD",
                    provider: nil,
                    endDate: now.addingTimeInterval(45 * 24 * 60 * 60)
                ),
            ],
            counts: .zero,
            devices: []
        )
        let quietAccessory = DeadlineAccessoryRules.presentation(
            outcome: .snapshot(quiet), now: now, language: .en, calendar: calendar
        )
        XCTAssertEqual(quietAccessory.state, .quiet)
        XCTAssertEqual(quietAccessory.inlineText, "No reminders in the next 30 days.")

        let live = DeadlineSnapshot(
            capturedAt: now,
            windowDays: 90,
            deadlines: [
                SnapshotDeadline(
                    warrantyId: "war_1",
                    deviceId: "dev_1",
                    deviceName: "iPhone 15",
                    deviceCategory: "PHONE",
                    warrantyType: "STANDARD",
                    provider: nil,
                    endDate: now
                ),
            ],
            counts: DeadlineSnapshotCounts(dueToday: 2, within7: 5, within30: 9),
            devices: []
        )
        let liveAccessory = DeadlineAccessoryRules.presentation(
            outcome: .snapshot(live), now: now, language: .en, calendar: calendar
        )
        XCTAssertEqual(liveAccessory.state, .counts)
        XCTAssertEqual(liveAccessory.stats.map(\.count), [2, 5, 9])
        XCTAssertEqual(liveAccessory.circularValue, "2")
        XCTAssertEqual(liveAccessory.circularLabel, "Today")
        XCTAssertEqual(liveAccessory.inlineText, "Today 2 · 7 days 5 · 30 days 9")
        XCTAssertNil(liveAccessory.message)
    }
}
