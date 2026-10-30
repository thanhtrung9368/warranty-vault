import Foundation
import XCTest
@testable import WarrlyKit

/// `StatsRollup.repairSpend` — the standalone "what repairs cost" line.
///
/// The two rules that matter: the line is driven by `Claim.cost` alone (not by
/// the purchase ledger), and it must not render when nobody recorded a cost.
/// `0` is a real recorded amount and therefore does count.
final class RepairSpendTests: KitTestCase {

    private let utc = TimeZone(identifier: "UTC")!

    private func instant(_ iso: String) -> Date {
        makeDate(iso, format: "yyyy-MM-dd'T'HH:mm:ssZZZZZ", timeZone: utc)
    }

    private func device(
        _ id: String,
        name: String? = nil,
        category: String = "PHONE",
        purchased: String = "2025-03-12T00:00:00Z",
        price: Int = 20_000_000,
        currency: String? = nil,
        purchasePriceVnd: Int? = nil
    ) throws -> Device {
        var extra = ""
        if let currency { extra += #","currency":"\#(currency)""# }
        if let purchasePriceVnd { extra += #","purchasePriceVnd":\#(purchasePriceVnd)"# }
        let json = """
        {"id":"\(id)","name":"\(name ?? id)","category":"\(category)",
         "purchaseDate":"\(purchased)","purchasePrice":\(price),
         "status":"ACTIVE"\(extra)}
        """
        return try APIClient.decoder.decode(Device.self, from: Data(json.utf8))
    }

    private func claim(
        id: String = "claim_1",
        deviceId: String = "dev_1",
        cost: Int? = nil
    ) -> Claim {
        Claim(id: id,
              deviceId: deviceId,
              warrantyId: nil,
              status: .RESOLVED,
              openedAt: "2026-03-01",
              expectedReturnAt: nil,
              closedAt: "2026-03-11",
              ticketNumber: nil,
              serviceCenter: nil,
              diagnosis: nil,
              outcome: nil,
              issue: "Màn hình bị sọc",
              cost: cost,
              coveredByWarranty: nil)
    }

    // MARK: - Presence

    func testNoClaimsMeansNoRepairLine() {
        let spend = StatsRollup.repairSpend(claims: [], devices: [])
        XCTAssertFalse(spend.hasAnyCost)
        XCTAssertEqual(spend.totalVnd, 0)
        XCTAssertEqual(spend.pricedClaimCount, 0)
        XCTAssertEqual(spend.deviceCount, 0)
        XCTAssertTrue(spend.comparisons.isEmpty)
        XCTAssertEqual(spend, .zero)
    }

    func testCostsNilEverywhereMeansTheLineDoesNotRender() {
        let spend = StatsRollup.repairSpend(
            claims: [claim(id: "a", cost: nil), claim(id: "b", cost: nil)],
            devices: []
        )
        XCTAssertFalse(spend.hasAnyCost)
        XCTAssertEqual(spend.totalVnd, 0)
        XCTAssertEqual(spend.pricedClaimCount, 0)
    }

    func testARecordedZeroIsAnAnswerAndStillCounts() {
        let spend = StatsRollup.repairSpend(
            claims: [claim(cost: 0)],
            devices: []
        )
        XCTAssertTrue(spend.hasAnyCost, "0 ₫ is a recorded free repair, not nil")
        XCTAssertEqual(spend.totalVnd, 0)
        XCTAssertEqual(spend.pricedClaimCount, 1)
        XCTAssertEqual(spend.deviceCount, 1)
    }

    // MARK: - Totals

    func testRepairMoneySumsAcrossClaimsAndCountsDistinctDevices() throws {
        let devices = [try device("dev_1"), try device("dev_2")]
        let claims = [
            claim(id: "a", deviceId: "dev_1", cost: 1_500_000),
            claim(id: "b", deviceId: "dev_1", cost: 0),
            claim(id: "c", deviceId: "dev_2", cost: 2_000_000),
            claim(id: "d", deviceId: "dev_2", cost: nil),
        ]

        let spend = StatsRollup.repairSpend(claims: claims, devices: devices)
        XCTAssertEqual(spend.totalVnd, 3_500_000)
        XCTAssertEqual(spend.pricedClaimCount, 3)
        XCTAssertEqual(spend.deviceCount, 2)
        XCTAssertFalse(spend.comparisons.isEmpty)
    }

    // MARK: - "Worth fixing" comparisons

    func testCheaperRepairIsWorthFixingAgainstThePurchasePrice() throws {
        let device = try device("dev_1", name: "iPhone 15", price: 20_000_000)
        let spend = StatsRollup.repairSpend(
            claims: [claim(cost: 5_000_000)],
            devices: [device]
        )

        let comparison = try XCTUnwrap(spend.comparisons.first)
        XCTAssertEqual(comparison.deviceName, "iPhone 15")
        XCTAssertEqual(comparison.costVnd, 5_000_000)
        XCTAssertEqual(comparison.purchasePriceVnd, 20_000_000)
        XCTAssertEqual(comparison.savingsVnd, 15_000_000)
        XCTAssertEqual(comparison.verdict, .worthFixing)
        L.withLanguage(.vi) {
            XCTAssertEqual(comparison.label, "Đáng sửa · rẻ hơn giá mua 15.000.000 ₫")
        }
    }

    func testARepairThatCostsMoreThanTheDeviceIsNotWorthIt() throws {
        let device = try device("dev_1", price: 10_000_000)
        let spend = StatsRollup.repairSpend(
            claims: [claim(cost: 12_000_000)],
            devices: [device]
        )

        let comparison = try XCTUnwrap(spend.comparisons.first)
        XCTAssertEqual(comparison.savingsVnd, -2_000_000)
        XCTAssertEqual(comparison.verdict, .notWorthFixing)
        L.withLanguage(.en) {
            XCTAssertEqual(comparison.label,
                           "Not worth repairing · the repair cost 2.000.000 ₫ more than the purchase")
        }
    }

    func testEqualAmountsBreakEven() throws {
        let device = try device("dev_1", price: 7_000_000)
        let spend = StatsRollup.repairSpend(
            claims: [claim(cost: 7_000_000)],
            devices: [device]
        )
        let comparison = try XCTUnwrap(spend.comparisons.first)
        XCTAssertEqual(comparison.verdict, .breakEven)
        XCTAssertEqual(comparison.savingsVnd, 0)
    }

    func testAForeignDeviceComparesThroughTheServersLockedVndValue() throws {
        let device = try device("dev_1", price: 999,
                                currency: "USD", purchasePriceVnd: 25_400_000)
        let spend = StatsRollup.repairSpend(
            claims: [claim(cost: 3_000_000)],
            devices: [device]
        )
        let comparison = try XCTUnwrap(spend.comparisons.first)
        XCTAssertEqual(comparison.purchasePriceVnd, 25_400_000)
        XCTAssertEqual(comparison.verdict, .worthFixing)
    }

    func testAForeignDeviceWithoutAVndValueIsCountedButNotCompared() throws {
        let device = try device("dev_1", price: 999, currency: "USD")
        let spend = StatsRollup.repairSpend(
            claims: [claim(cost: 3_000_000)],
            devices: [device]
        )
        XCTAssertEqual(spend.totalVnd, 3_000_000)
        XCTAssertEqual(spend.pricedClaimCount, 1)
        XCTAssertTrue(spend.comparisons.isEmpty,
                      "VND repair cost cannot be compared with a USD price")
    }

    func testAClaimWhoseDeviceIsNotInTheReadStillContributesMoney() {
        let spend = StatsRollup.repairSpend(
            claims: [claim(deviceId: "missing", cost: 900_000)],
            devices: []
        )
        XCTAssertEqual(spend.totalVnd, 900_000)
        XCTAssertEqual(spend.deviceCount, 1)
        XCTAssertTrue(spend.comparisons.isEmpty)
    }

    func testAZeroPurchasePriceIsAGiftAndIsNotCompared() throws {
        let device = try device("dev_1", price: 0)
        let spend = StatsRollup.repairSpend(
            claims: [claim(cost: 500_000)],
            devices: [device]
        )
        XCTAssertEqual(spend.totalVnd, 500_000)
        XCTAssertTrue(spend.comparisons.isEmpty)
    }

    func testComparisonsAreOrderedByRepairCostThenDeviceName() throws {
        let devices = [
            try device("dev_1", name: "Alpha", price: 20_000_000),
            try device("dev_2", name: "Beta", price: 20_000_000),
            try device("dev_3", name: "Gamma", price: 20_000_000),
        ]
        let spend = StatsRollup.repairSpend(
            claims: [
                claim(id: "small", deviceId: "dev_1", cost: 1_000_000),
                claim(id: "big", deviceId: "dev_2", cost: 8_000_000),
                claim(id: "big2", deviceId: "dev_3", cost: 8_000_000),
            ],
            devices: devices
        )
        XCTAssertEqual(spend.comparisons.map(\.claimId), ["big", "big2", "small"],
                       "equal amounts fall back to the stable device/id order")
        XCTAssertEqual(spend.comparisons.map(\.deviceName), ["Beta", "Gamma", "Alpha"])
    }
}
