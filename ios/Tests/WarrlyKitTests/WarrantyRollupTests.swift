import XCTest
@testable import WarrlyKit

// Pins the four dashboard warranty tiles. The fixture is the account this was
// reported on, with its real dates: one device 9 days from expiry, one that
// lapsed in 2025, one with no warranty at all. Before the fix the "Còn bảo hành"
// tile read 0 because it subtracted the soon-to-expire device from its own
// superset, while the row underneath said "Còn 9 ngày".
final class WarrantyRollupTests: XCTestCase {

    private let calendar = SurfaceFixtures.calendar()
    private var today: Date { SurfaceFixtures.date("2026-10-19T07:00:00Z") }

    private func rollup(_ devices: [Device]) -> WarrantyRollup {
        warrantyRollup(devices: devices, today: today, calendar: calendar)
    }

    private var seeded: [Device] {
        [
            SurfaceFixtures.device(id: "cmvetsggo0002r8uruzgp8hb2",
                                   name: "iPhone 15 Pro", status: "ACTIVE",
                                   effectiveEnd: "2026-10-28T00:00:00Z"),
            SurfaceFixtures.device(id: "dev_fridge", name: "Tủ lạnh", status: "ACTIVE",
                                   effectiveEnd: "2025-03-10T00:00:00Z"),
            SurfaceFixtures.device(id: "dev_wash", name: "Máy giặt", status: "BROKEN",
                                   effectiveEnd: nil),
        ]
    }

    func testTheSeededAccountCountsOneInWarrantyOneSoonAndOneExpired() {
        let r = rollup(seeded)
        XCTAssertEqual(r.total, 3)
        XCTAssertEqual(r.inWarranty, 1, "the 9-day iPhone is still covered")
        XCTAssertEqual(r.soon, 1)
        XCTAssertEqual(r.expired, 1, "the fridge lapsed in 2025")
    }

    func testSoonIsASubsetOfInWarranty() {
        let r = rollup(seeded)
        XCTAssertLessThanOrEqual(r.soon, r.inWarranty,
                                 "«Sắp hết» is an alert on a covered device, never a separate bucket")
        // The bug this replaced: subtracting the subset deleted the very device
        // the card below was pointing at.
        XCTAssertGreaterThan(r.inWarranty, r.inWarranty - r.soon)
    }

    func testAWarrantyEndingTodayIsStillInWarranty() {
        let r = rollup([SurfaceFixtures.device(status: "ACTIVE",
                                               effectiveEnd: "2026-10-19T00:00:00Z")])
        XCTAssertEqual(r.inWarranty, 1, "day 0 is covered, not lapsed")
        XCTAssertEqual(r.soon, 1)
        XCTAssertEqual(r.expired, 0, "a device is not expired on the day it expires")
    }

    func testTheDayAfterIsExpired() {
        let r = rollup([SurfaceFixtures.device(status: "ACTIVE",
                                               effectiveEnd: "2026-10-18T00:00:00Z")])
        XCTAssertEqual(r.inWarranty, 0)
        XCTAssertEqual(r.expired, 1)
        XCTAssertEqual(r.soon, 0)
    }

    func testTheSoonBoundaryIsInclusiveAtThirtyDays() {
        let at30 = rollup([SurfaceFixtures.device(status: "ACTIVE",
                                                  effectiveEnd: "2026-11-18T00:00:00Z")])
        XCTAssertEqual(at30.soon, 1, "30 days out is in the alert window")

        let at31 = rollup([SurfaceFixtures.device(status: "ACTIVE",
                                                  effectiveEnd: "2026-11-19T00:00:00Z")])
        XCTAssertEqual(at31.inWarranty, 1)
        XCTAssertEqual(at31.soon, 0, "31 days is covered but not soon")
    }

    func testNoWarrantyCountsTowardTotalOnly() {
        let r = rollup([SurfaceFixtures.device(status: "ACTIVE", effectiveEnd: nil)])
        XCTAssertEqual(r.total, 1)
        XCTAssertEqual(r.inWarranty, 0)
        XCTAssertEqual(r.soon, 0)
        XCTAssertEqual(r.expired, 0)
    }

    func testANonActiveDeviceIsNotInWarrantyButALapsedOneIsStillExpired() {
        let soldLive = rollup([SurfaceFixtures.device(status: "SOLD",
                                                      effectiveEnd: "2027-01-01T00:00:00Z")])
        XCTAssertEqual(soldLive.inWarranty, 0, "a sold device is not something you still have covered")
        XCTAssertEqual(soldLive.expired, 0)

        let soldLapsed = rollup([SurfaceFixtures.device(status: "SOLD",
                                                        effectiveEnd: "2025-01-01T00:00:00Z")])
        XCTAssertEqual(soldLapsed.expired, 1, "a warranty can lapse on a device that is already gone")
    }
}
