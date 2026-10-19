import Foundation
import XCTest
@testable import WarrlyKit

// The regression this file pins, from the field report:
//
//   iPhone 15 Pro, warranty ends 2026-10-28, today 2026-10-19.
//   Dashboard: "8d left"   Device list: "9d left"   Detail: "9d left".
//
// Nine is the correct answer: 19 → 28 October is nine calendar days. The
// dashboard's helper subtracted `Date()` from the end instant and truncated to
// whole 24-hour blocks, so at 14:10 it found 8 days and 9 hours and said 8.
//
// Every helper that answers "how many days" now delegates to `CalendarDay`.
// These tests feed the same fixture to each of them, at several times of day,
// and require the same number — so a future helper cannot quietly reintroduce
// an hour-anchored (or UTC-anchored) subtraction.

final class CalendarDayTests: KitTestCase {

    // MARK: - Fixtures

    /// The report's zone. The bug is visible at +07:00 and invisible at UTC,
    /// so the fixture is pinned rather than inherited from the machine.
    private var hcm: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Ho_Chi_Minh")!
        return calendar
    }

    /// A local wall-clock instant on `calendar`'s zone.
    private func local(_ year: Int, _ month: Int, _ day: Int,
                       _ hour: Int = 0, _ minute: Int = 0,
                       on calendar: Calendar) -> Date {
        calendar.date(from: DateComponents(
            year: year, month: month, day: day, hour: hour, minute: minute
        ))!
    }

    /// The reported warranty: ends on the calendar day 28 October 2026.
    private var reportedEnd: Date { local(2026, 10, 28, on: hcm) }

    /// The reported "now": 14:10 on 19 October 2026.
    private var reportedNow: Date { local(2026, 10, 19, 14, 10, on: hcm) }

    /// The fridge: warranty ended on the calendar day 10 March 2025.
    private var expiredEnd: Date { local(2025, 3, 10, on: hcm) }

    /// One reminder row for the fixture deadline. Decoded through the real
    /// decoder (a `Z` instant, so it is the same day in every zone).
    private func reminder(ending iso: String) -> UpcomingReminder {
        SurfaceFixtures.reminder(endDate: iso)
    }

    // MARK: - All helpers, one answer

    func testEveryDayHelperAgreesOnTheReportedWarranty() {
        // The `now` that used to produce 8: mid-afternoon, nowhere near midnight.
        XCTAssertEqual(CalendarDay.days(from: reportedNow, to: reportedEnd, calendar: hcm), 9,
                       "19 → 28 October is nine calendar days")
        XCTAssertEqual(DeviceReturnWindow.daysLeft(
            "2026-10-28T00:00:00", now: reportedNow, calendar: hcm), 9)
        XCTAssertEqual(WarrantyActivation.buyByDaysLeft(
            "2026-10-28", now: reportedNow, calendar: hcm), 9)
        XCTAssertEqual(DeadlineWidgetRules.daysRemaining(
            endDate: reportedEnd, now: reportedNow, calendar: hcm), 9)
        XCTAssertEqual(DismissedReminder(
            warrantyId: "war_iphone", deviceId: "dev_iphone",
            deviceName: "iPhone 15 Pro", deviceCategory: "PHONE",
            deviceStatus: .ACTIVE, warrantyType: .STANDARD, warrantyProvider: "Apple",
            endDate: reportedEnd
        ).daysRemaining(from: reportedNow, calendar: hcm), 9)
        XCTAssertEqual(reminder(ending: "2026-10-28T00:00:00Z")
            .daysRemaining(from: reportedNow, calendar: hcm), 9)
    }

    func testTheCountDoesNotDependOnTheTimeOfDay() {
        // The old dashboard helper said 8 from 14:10 but 9 at 00:01 — the
        // hour of the day must never change the answer.
        for hour in [0, 1, 12, 14, 23] {
            let now = local(2026, 10, 19, hour, hour == 23 ? 59 : 10, on: hcm)
            XCTAssertEqual(CalendarDay.days(from: now, to: reportedEnd, calendar: hcm), 9,
                           "hour \(hour)")
            XCTAssertEqual(DeviceReturnWindow.daysLeft(
                "2026-10-28T00:00:00", now: now, calendar: hcm), 9, "hour \(hour)")
            XCTAssertEqual(reminder(ending: "2026-10-28T00:00:00Z")
                .daysRemaining(from: now, calendar: hcm), 9, "hour \(hour)")
            XCTAssertEqual(DeadlineWidgetRules.daysRemaining(
                endDate: reportedEnd, now: now, calendar: hcm), 9, "hour \(hour)")
        }
    }

    func testHoursBetweenAreNotDays() {
        // 8 days and 9h50m of elapsed time, but nine calendar days. This is the
        // exact arithmetic that produced the "8d left" dashboard row.
        let now = reportedNow
        XCTAssertEqual(reportedEnd.timeIntervalSince(now) / 86_400, 8.41, accuracy: 0.01)
        XCTAssertEqual(CalendarDay.days(from: now, to: reportedEnd, calendar: hcm), 9)
    }

    func testSameDayIsZeroAndTomorrowIsOne() {
        let now = reportedNow
        XCTAssertEqual(CalendarDay.days(from: now, to: now, calendar: hcm), 0)
        XCTAssertEqual(CalendarDay.days(
            from: now, to: local(2026, 10, 20, 0, 1, on: hcm), calendar: hcm), 1,
            "59 minutes away, tomorrow is one day away")
        XCTAssertEqual(CalendarDay.days(
            from: now, to: local(2026, 10, 18, 23, 59, on: hcm), calendar: hcm), -1)
    }

    func testAnExpiredWarrantyIsNegativeEverywhere() {
        // The fridge: 2025-03-10 → 2026-10-19 is exactly 588 days in the past.
        XCTAssertEqual(CalendarDay.days(from: reportedNow, to: expiredEnd, calendar: hcm), -588)
        XCTAssertEqual(DeviceReturnWindow.daysLeft(
            "2025-03-10T00:00:00", now: reportedNow, calendar: hcm), -588)
        XCTAssertEqual(WarrantyActivation.buyByDaysLeft(
            "2025-03-10", now: reportedNow, calendar: hcm), -588)
        XCTAssertEqual(DeadlineWidgetRules.daysRemaining(
            endDate: expiredEnd, now: reportedNow, calendar: hcm), -588)
        XCTAssertEqual(DismissedReminder(
            warrantyId: "war_fridge", deviceId: "dev_fridge",
            deviceName: "Tủ lạnh Samsung Inverter", deviceCategory: "FRIDGE",
            deviceStatus: .ACTIVE, warrantyType: .STANDARD, warrantyProvider: "Samsung",
            endDate: expiredEnd
        ).daysRemaining(from: reportedNow, calendar: hcm), -588)
        XCTAssertEqual(reminder(ending: "2025-03-10T00:00:00Z")
            .daysRemaining(from: reportedNow, calendar: hcm), -588)
    }

    // MARK: - Zones and DST

    func testWireDaysAreCountedInTheCallersZone() {
        // A day-only wire value has no zone. Reading it in UTC makes it a day
        // earlier for every zone west of UTC, which is the off-by-one that used
        // to hit the return window. The answer must be 9 everywhere.
        for identifier in ["Pacific/Midway", "UTC", "Asia/Ho_Chi_Minh", "Pacific/Kiritimati"] {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: identifier)!
            let now = local(2026, 10, 19, 14, 10, on: calendar)
            XCTAssertEqual(CalendarDay.days(
                from: now, to: local(2026, 10, 28, on: calendar), calendar: calendar), 9,
                identifier)
            XCTAssertEqual(DeviceReturnWindow.daysLeft(
                "2026-10-28", now: now, calendar: calendar), 9, identifier)
        }
    }

    func testADSTDayIsStillOneDay() {
        var newYork = Calendar(identifier: .gregorian)
        newYork.timeZone = TimeZone(identifier: "America/New_York")!
        // 8 March 2026 is a 23-hour day in New York. Noon on the 7th to noon on
        // the 9th is 47 hours but two calendar days.
        let start = local(2026, 3, 7, 12, 0, on: newYork)
        let end = local(2026, 3, 9, 12, 0, on: newYork)
        XCTAssertEqual(CalendarDay.days(from: start, to: end, calendar: newYork), 2)
        XCTAssertEqual(DeadlineWidgetRules.daysRemaining(
            endDate: end, now: start, calendar: newYork), 2)
    }
}
