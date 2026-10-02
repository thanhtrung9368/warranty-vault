import Foundation
import XCTest
@testable import WarrantyVaultKit

/// Pure spend maths behind the Thống kê screen.
///
/// Every fixture date is an explicit UTC instant and the bucket calendar is
/// pinned to `Asia/Ho_Chi_Minh`, so these assertions hold in any machine time
/// zone (the API parser is deliberately lenient about offset-less strings).
final class StatsRollupTests: KitTestCase {

    // MARK: - Fixtures

    private let utc = TimeZone(identifier: "UTC")!

    /// Fixed calendar matching what the API assumes for offset-less timestamps.
    private let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Ho_Chi_Minh")!
        cal.locale = Locale(identifier: "en_US_POSIX")
        return cal
    }()

    private func instant(_ iso: String) -> Date {
        makeDate(iso, format: "yyyy-MM-dd'T'HH:mm:ssZZZZZ", timeZone: utc)
    }

    private func device(_ id: String,
                        category: String = "LAPTOP",
                        purchased: String,
                        price: Int,
                        status: String = "ACTIVE",
                        warrantyEnd: String? = nil,
                        attachmentCount: Int? = nil) throws -> Device {
        var extra = ""
        if let warrantyEnd { extra += #","effectiveWarrantyEnd":"\#(warrantyEnd)""# }
        if let attachmentCount { extra += #","attachmentCount":\#(attachmentCount)"# }
        let json = """
        {"id":"\(id)","name":"\(id)","category":"\(category)",
         "purchaseDate":"\(purchased)","purchasePrice":\(price),
         "status":"\(status)"\(extra)}
        """
        return try APIClient.decoder.decode(Device.self, from: Data(json.utf8))
    }

    private func warranty(_ id: String,
                          cost: Int?,
                          start: String,
                          end: String,
                          type: String = "STANDARD") throws -> Warranty {
        let costJSON = cost.map(String.init) ?? "null"
        let json = """
        {"id":"\(id)","deviceId":"dev","type":"\(type)","startDate":"\(start)",
         "endDate":"\(end)","months":12,"cost":\(costJSON)}
        """
        return try APIClient.decoder.decode(Warranty.self, from: Data(json.utf8))
    }

    private func entry(_ amount: Int, _ iso: String,
                       category: String = "LAPTOP",
                       kind: StatsRollup.SpendKind = .device) -> StatsRollup.SpendEntry {
        StatsRollup.SpendEntry(amount: amount, date: instant(iso),
                               category: category, kind: kind)
    }

    // MARK: - List-row projection

    func testDeviceListRowDecodesEffectiveWarrantyEndAndAttachmentCount() throws {
        let decoded = try device("dev_1", purchased: "2025-03-12T00:00:00Z", price: 100,
                                 warrantyEnd: "2027-03-12T00:00:00Z", attachmentCount: 2)

        XCTAssertEqual(decoded.attachmentCount, 2)
        XCTAssertEqual(decoded.effectiveWarrantyEnd, instant("2027-03-12T00:00:00Z"))

        // Both are list-only projections — create/update/detail omit them.
        let bare = try device("dev_2", purchased: "2025-03-12T00:00:00Z", price: 100)
        XCTAssertNil(bare.attachmentCount)
        XCTAssertNil(bare.effectiveWarrantyEnd)
    }

    // MARK: - buildEntries

    func testBuildEntriesEmitsADeviceRowPlusOnePerPricedWarranty() throws {
        let mac = try device("mac", category: "LAPTOP",
                             purchased: "2025-03-12T00:00:00Z", price: 49_990_000)
        let phone = try device("phone", category: "PHONE",
                               purchased: "2025-05-01T00:00:00Z", price: 20_000_000)
        let warranties: [String: [Warranty]] = [
            "mac": [
                try warranty("w1", cost: 5_000_000,
                             start: "2025-03-12T00:00:00Z", end: "2027-03-12T00:00:00Z"),
                try warranty("w2", cost: nil,
                             start: "2025-03-12T00:00:00Z", end: "2026-03-12T00:00:00Z"),
                try warranty("w3", cost: 0,
                             start: "2025-03-12T00:00:00Z", end: "2026-03-12T00:00:00Z"),
            ],
        ]

        let entries = StatsRollup.buildEntries(devices: [mac, phone], warrantiesByDevice: warranties)

        // nil / zero-cost packages are skipped, matching buildSpendEntries().
        XCTAssertEqual(entries.count, 3)
        XCTAssertEqual(entries.filter { $0.kind == .warranty }.count, 1)

        let warrantyEntry = try XCTUnwrap(entries.first { $0.kind == .warranty })
        XCTAssertEqual(warrantyEntry.amount, 5_000_000)
        XCTAssertEqual(warrantyEntry.category, "LAPTOP", "warranty money inherits the device category")
        XCTAssertEqual(warrantyEntry.date, instant("2025-03-12T00:00:00Z"),
                       "dated by startDate, not endDate")

        XCTAssertEqual(entries.first?.kind, .device)
        XCTAssertEqual(entries.first?.amount, 49_990_000)
    }

    // MARK: - Monthly buckets

    func testMonthlyBucketsReturnTwelveMonthsOldestFirstWhenEmpty() {
        let buckets = StatsRollup.monthlyBuckets([], months: 12,
                                                 now: instant("2025-10-15T00:00:00Z"),
                                                 calendar: calendar)

        XCTAssertEqual(buckets.count, 12)
        XCTAssertEqual(buckets.first?.label, "11/24")
        XCTAssertEqual(buckets.last?.label, "10/25")
        XCTAssertTrue(buckets.allSatisfy { $0.total == 0 })
        XCTAssertEqual(buckets.last?.year, 2025)
        XCTAssertEqual(buckets.last?.month, 10)
    }

    func testMonthlyBucketsPlaceDeviceAndWarrantySpendInTheirOwnMonths() throws {
        let mac = try device("mac", category: "LAPTOP",
                             purchased: "2025-10-02T00:00:00Z", price: 1_000)
        let warranties: [String: [Warranty]] = [
            "mac": [try warranty("w1", cost: 500,
                                 start: "2025-09-10T00:00:00Z", end: "2026-09-10T00:00:00Z")],
        ]
        let entries = StatsRollup.buildEntries(devices: [mac], warrantiesByDevice: warranties)

        let buckets = StatsRollup.monthlyBuckets(entries, months: 12,
                                                 now: instant("2025-10-15T00:00:00Z"),
                                                 calendar: calendar)
        let byLabel = Dictionary(uniqueKeysWithValues: buckets.map { ($0.label, $0.total) })

        XCTAssertEqual(byLabel["10/25"], 1_000)
        XCTAssertEqual(byLabel["09/25"], 500)
        XCTAssertEqual(byLabel["08/25"], 0)
        XCTAssertEqual(buckets.reduce(0) { $0 + $1.total }, 1_500)
    }

    func testMonthlyBucketsDropEntriesOutsideTheWindow() {
        // Oldest rendered month is 2024-11; the window ends with the current
        // month, so an entry dated in a later month has nowhere to land.
        let old = entry(9_999, "2024-01-05T00:00:00Z")
        let future = entry(7_777, "2026-01-05T00:00:00Z", kind: .warranty)

        let buckets = StatsRollup.monthlyBuckets([old, future], months: 12,
                                                 now: instant("2025-10-15T00:00:00Z"),
                                                 calendar: calendar)

        XCTAssertEqual(buckets.reduce(0) { $0 + $1.total }, 0)
    }

    func testMonthlyBucketsIncludeTheFirstInstantOfTheOldestMonth() {
        let firstOfOldest = entry(100, "2024-11-01T00:00:00Z", category: "TV")
        let lastOfPreviousMonth = entry(100, "2024-10-31T00:00:00Z", category: "TV")

        let buckets = StatsRollup.monthlyBuckets([firstOfOldest, lastOfPreviousMonth],
                                                 months: 12,
                                                 now: instant("2025-10-15T00:00:00Z"),
                                                 calendar: calendar)

        XCTAssertEqual(buckets.reduce(0) { $0 + $1.total }, 100)
        XCTAssertEqual(buckets.first?.label, "11/24")
        XCTAssertEqual(buckets.first?.total, 100)
    }

    func testMonthlyBucketsAcrossAYearBoundaryKeepChronologicalOrder() {
        let buckets = StatsRollup.monthlyBuckets([], months: 3,
                                                 now: instant("2025-01-20T00:00:00Z"),
                                                 calendar: calendar)
        XCTAssertEqual(buckets.map(\.label), ["11/24", "12/24", "01/25"])
    }

    func testMonthlyBucketsWithNonPositiveMonthCountIsEmpty() {
        XCTAssertTrue(StatsRollup.monthlyBuckets([], months: 0, now: Date(), calendar: calendar).isEmpty)
    }

    // MARK: - Totals

    func testYearlyAndAllTimeTotalsSplitDevicesFromWarranties() throws {
        let mac = try device("mac", purchased: "2024-06-01T00:00:00Z", price: 1_000)
        let phone = try device("phone", purchased: "2025-02-01T00:00:00Z", price: 2_000)
        let warranties: [String: [Warranty]] = [
            "phone": [try warranty("w1", cost: 300,
                                   start: "2025-02-01T00:00:00Z", end: "2026-02-01T00:00:00Z")],
        ]
        let entries = StatsRollup.buildEntries(devices: [mac, phone], warrantiesByDevice: warranties)

        let in2025 = StatsRollup.totals(entries, year: 2025, calendar: calendar)
        XCTAssertEqual(in2025.total, 2_300)
        XCTAssertEqual(in2025.deviceCount, 1)
        XCTAssertEqual(in2025.warrantyCount, 1)

        let in2024 = StatsRollup.totals(entries, year: 2024, calendar: calendar)
        XCTAssertEqual(in2024.total, 1_000)
        XCTAssertEqual(in2024.deviceCount, 1)
        XCTAssertEqual(in2024.warrantyCount, 0)

        let all = StatsRollup.totals(entries)
        XCTAssertEqual(all.total, 3_300)
        XCTAssertEqual(all.deviceCount, 2)
        XCTAssertEqual(all.warrantyCount, 1)

        XCTAssertEqual(StatsRollup.totals([]), .zero)
    }

    func testYearsWithDataAreDescendingAndAlwaysIncludeTheCurrentYear() throws {
        let devices = [
            try device("a", purchased: "2023-01-01T00:00:00Z", price: 1),
            try device("b", purchased: "2025-05-05T00:00:00Z", price: 1),
            try device("c", purchased: "2023-08-08T00:00:00Z", price: 1),
        ]
        XCTAssertEqual(StatsRollup.yearsWithData(devices: devices,
                                                 now: instant("2026-02-02T00:00:00Z"),
                                                 calendar: calendar),
                       [2026, 2025, 2023])
        XCTAssertEqual(StatsRollup.yearsWithData(devices: [],
                                                 now: instant("2026-02-02T00:00:00Z"),
                                                 calendar: calendar),
                       [2026])
    }

    // MARK: - Category rollup

    func testByCategoryAttributesWarrantyMoneyToTheDeviceCategoryAndCountsDevices() throws {
        let mac = try device("mac", category: "LAPTOP",
                             purchased: "2025-01-01T00:00:00Z", price: 1_000)
        let mac2 = try device("mac2", category: "LAPTOP",
                              purchased: "2025-01-02T00:00:00Z", price: 500)
        let phone = try device("phone", category: "PHONE",
                               purchased: "2025-01-03T00:00:00Z", price: 2_000)
        let warranties: [String: [Warranty]] = [
            "mac": [try warranty("w1", cost: 400,
                                 start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z")],
        ]
        let entries = StatsRollup.buildEntries(devices: [mac, mac2, phone],
                                               warrantiesByDevice: warranties)

        let rollup = StatsRollup.byCategory(devices: [mac, mac2, phone], entries: entries)
        let byCategory = Dictionary(uniqueKeysWithValues: rollup.map { ($0.category, $0) })

        XCTAssertEqual(byCategory["LAPTOP"]?.total, 1_900, "1000 + 500 + 400 warranty")
        XCTAssertEqual(byCategory["LAPTOP"]?.count, 2, "warranties never add to the device count")
        XCTAssertEqual(byCategory["LAPTOP"]?.label, "Laptop")
        XCTAssertEqual(byCategory["PHONE"]?.total, 2_000)
        XCTAssertEqual(byCategory["PHONE"]?.count, 1)
        XCTAssertEqual(rollup.count, 2)
    }

    func testByCategoryWithNoDevicesIsAMoneyOnlyRollup() throws {
        let mac = try device("mac", category: "LAPTOP",
                             purchased: "2025-01-01T00:00:00Z", price: 1_000)
        let warranty = try warranty("w1", cost: 400,
                                    start: "2025-06-01T00:00:00Z", end: "2026-06-01T00:00:00Z")
        let entries = StatsRollup.buildEntries(devices: [mac], warrantiesByDevice: ["mac": [warranty]])
            .filter { $0.kind == .warranty }

        let rollup = StatsRollup.byCategory(devices: [], entries: entries)

        XCTAssertEqual(rollup.count, 1)
        XCTAssertEqual(rollup.first?.total, 400)
        XCTAssertEqual(rollup.first?.count, 0, "the year breakdown passes no devices")
    }

    // MARK: - Asset value / leaderboard

    func testActiveAssetValueRequiresActiveStatusAndAFutureWarrantyEnd() throws {
        let end = "2026-06-01T00:00:00Z"
        let stillCovered = try device("a", purchased: "2024-01-01T00:00:00Z", price: 1_000,
                                      status: "ACTIVE", warrantyEnd: end)
        let sold = try device("b", purchased: "2024-01-01T00:00:00Z", price: 2_000,
                              status: "SOLD", warrantyEnd: end)
        let lapsed = try device("c", purchased: "2024-01-01T00:00:00Z", price: 4_000,
                                status: "ACTIVE", warrantyEnd: "2025-01-01T00:00:00Z")
        let noWarranty = try device("d", purchased: "2024-01-01T00:00:00Z", price: 8_000,
                                    status: "ACTIVE")

        let asset = StatsRollup.activeAssetValue([stillCovered, sold, lapsed, noWarranty],
                                                 now: instant("2025-06-01T00:00:00Z"))

        XCTAssertEqual(asset.count, 1)
        XCTAssertEqual(asset.total, 1_000)
        XCTAssertEqual(StatsRollup.activeAssetValue([], now: Date()), .zero)
    }

    func testTopDevicesSortByPurchasePriceAndRespectTheLimit() throws {
        let devices = [
            try device("cheap", purchased: "2025-01-01T00:00:00Z", price: 100),
            try device("pricey", purchased: "2025-01-01T00:00:00Z", price: 900),
            try device("mid", purchased: "2025-01-01T00:00:00Z", price: 500),
        ]

        XCTAssertEqual(StatsRollup.topDevices(devices, limit: 2).map(\.id), ["pricey", "mid"])
        XCTAssertEqual(StatsRollup.topDevices(devices).map(\.id), ["pricey", "mid", "cheap"])
        XCTAssertTrue(StatsRollup.topDevices(devices, limit: 0).isEmpty)
    }

    // MARK: - effectiveWarrantyEnd

    func testEffectiveWarrantyEndIsTheLatestEndDateAndNilWithoutPackages() throws {
        let warranties = [
            try warranty("w1", cost: 100,
                         start: "2024-01-01T00:00:00Z", end: "2025-01-01T00:00:00Z"),
            try warranty("w2", cost: 100,
                         start: "2024-06-01T00:00:00Z", end: "2027-01-01T00:00:00Z"),
            try warranty("w3", cost: 100,
                         start: "2024-06-01T00:00:00Z", end: "2026-01-01T00:00:00Z"),
        ]
        XCTAssertEqual(StatsRollup.effectiveWarrantyEnd(warranties), instant("2027-01-01T00:00:00Z"))
        XCTAssertNil(StatsRollup.effectiveWarrantyEnd([]))
    }
}
