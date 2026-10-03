import Foundation
import XCTest
@testable import WarrantyVaultKit

/// `GET /api/v1/forecast` — decoding, the `months` clamp, the bucket math, and
/// the caveats that keep reference money from being read as a bill.
final class ForecastTests: KitTestCase {

    // MARK: - Fixtures

    /// A realistic payload: the window is 3 months, so `buckets` has 4 entries
    /// (the current month is partial). One month is completely empty on purpose
    /// — the API sends zero-filled months and the UI must not treat them as
    /// "nothing to show".
    private static let fullJSON = #"""
    {
      "generatedAt": "2026-03-15T00:00:00Z",
      "windowStart": "2026-03-15T00:00:00Z",
      "windowEnd": "2026-06-15T00:00:00Z",
      "months": 3,
      "currency": "VND",
      "subscriptionTotalVnd": 1059000,
      "subscriptionAutoRenewTotalVnd": 708000,
      "subscriptionMonthlyAverageVnd": 353000,
      "subscriptionsCount": 3,
      "chargesCount": 5,
      "buckets": [
        {"month": "2026-03", "subscriptionVnd": 118000, "subscriptionAutoRenewVnd": 118000,
         "subscriptionCount": 1, "warrantyExpiringVnd": 0, "warrantyExpiringCount": 0,
         "wishlistTargetVnd": 0, "wishlistTargetCount": 0},
        {"month": "2026-04", "subscriptionVnd": 590000, "subscriptionAutoRenewVnd": 590000,
         "subscriptionCount": 2, "warrantyExpiringVnd": 1200000, "warrantyExpiringCount": 1,
         "wishlistTargetVnd": 5490000, "wishlistTargetCount": 1},
        {"month": "2026-05", "subscriptionVnd": 0, "subscriptionAutoRenewVnd": 0,
         "subscriptionCount": 0, "warrantyExpiringVnd": 0, "warrantyExpiringCount": 0,
         "wishlistTargetVnd": 0, "wishlistTargetCount": 0},
        {"month": "2026-06", "subscriptionVnd": 351000, "subscriptionAutoRenewVnd": 0,
         "subscriptionCount": 2, "warrantyExpiringVnd": 0, "warrantyExpiringCount": 0,
         "wishlistTargetVnd": 0, "wishlistTargetCount": 0}
      ],
      "upcomingWarranties": [
        {"id": "war_1", "deviceId": "dev_1", "deviceName": "MacBook Pro 14",
         "type": "STANDARD", "provider": "Apple Việt Nam",
         "endDate": "2026-04-02T00:00:00Z", "month": "2026-04", "months": 12,
         "costVnd": 1200000},
        {"id": "war_2", "deviceId": "dev_2", "deviceName": "Máy lọc nước",
         "type": "THIRD_PARTY", "provider": null,
         "endDate": "2026-04-20T00:00:00Z", "month": "2026-04", "months": 24,
         "costVnd": null}
      ],
      "upcomingWishlist": [
        {"id": "wish_1", "name": "AirPods Pro 2", "targetDate": "2026-04-30T00:00:00Z",
         "month": "2026-04", "priority": "WANT", "status": "WATCHING",
         "currentPriceVnd": 5490000}
      ],
      "note": "Chỉ các kỳ gia hạn subscription là khoản chắc chắn bị trừ. Tiền bảo hành hết hạn là giá gói cũ để bạn tham khảo khi để dành, còn giá wishlist là giá ghi nhận gần nhất — cả hai đều có thể phát sinh, không phải cam kết."
    }
    """#

    private func decodeForecast() throws -> Forecast {
        try APIClient.decoder.decode(Forecast.self, from: Data(Self.fullJSON.utf8))
    }

    // MARK: - Decoding

    func testDecodesEveryDocumentedField() throws {
        let forecast = try decodeForecast()

        XCTAssertEqual(forecast.months, 3)
        XCTAssertEqual(forecast.currency, "VND")
        XCTAssertEqual(forecast.subscriptionTotalVnd, 1_059_000)
        XCTAssertEqual(forecast.subscriptionAutoRenewTotalVnd, 708_000)
        XCTAssertEqual(forecast.subscriptionMonthlyAverageVnd, 353_000)
        XCTAssertEqual(forecast.subscriptionsCount, 3)
        XCTAssertEqual(forecast.chargesCount, 5)
        XCTAssertEqual(forecast.buckets.count, 4,
                       "3-month window → 4 calendar buckets, not 3 and not 12")
        XCTAssertEqual(forecast.upcomingWarranties.count, 2)
        XCTAssertEqual(forecast.upcomingWishlist.count, 1)
        XCTAssertTrue(forecast.note.contains("không phải cam kết"))

        let april = forecast.buckets[1]
        XCTAssertEqual(april.month, "2026-04")
        XCTAssertEqual(april.subscriptionCount, 2)
        XCTAssertEqual(april.warrantyExpiringVnd, 1_200_000)
        XCTAssertEqual(april.wishlistTargetCount, 1)

        let warranty = forecast.upcomingWarranties[0]
        XCTAssertEqual(warranty.deviceName, "MacBook Pro 14")
        XCTAssertEqual(warranty.type, .STANDARD)
        XCTAssertEqual(warranty.costVnd, 1_200_000)
        XCTAssertNil(forecast.upcomingWarranties[1].costVnd,
                     "null cost = no price recorded, which is not 0 ₫")

        let item = forecast.upcomingWishlist[0]
        XCTAssertEqual(item.priority, .WANT)
        XCTAssertEqual(item.status, .WATCHING)
        XCTAssertEqual(item.currentPriceVnd, 5_490_000)
    }

    func testBucketCountIsReadFromThePayloadNeverAssumed() throws {
        let forecast = try decodeForecast()
        XCTAssertEqual(forecast.buckets.count, forecast.months + 1)

        // Normally `months + 1`; exactly `months` when the call lands at 00:00 on
        // the 1st. The client renders whatever array arrives either way, so both
        // shapes must decode and roll up without a fixed 12 anywhere.
        for (months, bucketCount) in [(12, 13), (3, 3), (24, 25)] {
            let json = Self.forecastJSON(
                months: months,
                buckets: (1...bucketCount).map { Self.bucketJSON(month: Self.monthString($0)) }
            )
            let decoded = try APIClient.decoder.decode(Forecast.self, from: Data(json.utf8))
            XCTAssertEqual(decoded.buckets.count, bucketCount)
            XCTAssertEqual(decoded.months, months)
            XCTAssertEqual(ForecastRules.summary(decoded).bucketCount, bucketCount)
        }
    }

    // MARK: - months clamp

    func testMonthsClampKeepsRequestsInsideTheAcceptedRange() {
        XCTAssertEqual(ForecastRules.clampedMonths(12), 12)
        XCTAssertEqual(ForecastRules.clampedMonths(1), 1)
        XCTAssertEqual(ForecastRules.clampedMonths(24), 24)
        XCTAssertEqual(ForecastRules.clampedMonths(0), 1, "0 is a 400 server-side; clamp instead")
        XCTAssertEqual(ForecastRules.clampedMonths(-5), 1)
        XCTAssertEqual(ForecastRules.clampedMonths(25), 24)
        XCTAssertEqual(ForecastRules.clampedMonths(9_999), 24)
        XCTAssertEqual(ForecastRules.defaultMonths, 12)
        XCTAssertTrue(ForecastRules.monthOptions.allSatisfy {
            $0 >= ForecastRules.minMonths && $0 <= ForecastRules.maxMonths
        }, "every picker option must be a value the API accepts")
    }

    func testForecastBuildsTheClampedMonthsQuery() async throws {
        StubURLProtocol.install(.json(Self.fullJSON))
        let client = makeStubbedClient(token: "tok_abc")

        _ = try await client.forecast(months: 99)

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/v1/forecast")
        XCTAssertEqual(queryItems(of: request)["months"], "24",
                       "an out-of-range window is clamped before it can 400")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok_abc")
    }

    // MARK: - Summary: certain money vs reference money

    func testSummarySeparatesAutoRenewFromMoneyTheUserMustDecideAbout() throws {
        let summary = ForecastRules.summary(try decodeForecast())

        XCTAssertEqual(summary.autoRenewTotalVnd, 708_000)
        XCTAssertEqual(summary.subscriptionTotalVnd, 1_059_000)
        XCTAssertEqual(summary.manualRenewTotalVnd, 351_000,
                       "total − auto-renew = the renewals the user must act on")
        XCTAssertEqual(summary.autoRenewTotalVnd + summary.manualRenewTotalVnd,
                       summary.subscriptionTotalVnd)
        XCTAssertEqual(summary.monthlyAverageVnd, 353_000)
        XCTAssertEqual(summary.chargesCount, 5)
        XCTAssertEqual(summary.bucketCount, 4)
    }

    /// The honesty pin: warranty + wishlist money is a reference and must never
    /// leak into the numbers presented as certain spend.
    func testReferenceMoneyIsKeptOutOfTheGuaranteedTotal() throws {
        let summary = ForecastRules.summary(try decodeForecast())

        XCTAssertEqual(summary.warrantySavingsReferenceVnd, 1_200_000)
        XCTAssertEqual(summary.warrantyCount, 1)
        XCTAssertEqual(summary.wishlistReferenceVnd, 5_490_000)
        XCTAssertEqual(summary.wishlistCount, 1)
        XCTAssertEqual(summary.referenceOnlyTotalVnd, 6_690_000)

        XCTAssertEqual(summary.subscriptionTotalVnd, 1_059_000,
                       "the subscription total is the API's own field — unaffected by buckets")
        XCTAssertNotEqual(summary.subscriptionTotalVnd,
                          summary.subscriptionTotalVnd + summary.referenceOnlyTotalVnd)
        XCTAssertEqual(summary.autoRenewTotalVnd, 708_000,
                       "reference money never joins the auto-charge figure either")
    }

    /// A negative gap can only come from a server-side inconsistency; it must
    /// still never render as a negative amount.
    func testManualRenewIsClampedAtZero() {
        let bucket = Self.bucket(month: "2026-04", subscription: 100_000, autoRenew: 250_000)
        XCTAssertEqual(bucket.manualRenewVnd, 0)

        let summary = ForecastRules.summary(
            Self.minimalForecast(total: 100_000, autoRenew: 250_000)
        )
        XCTAssertEqual(summary.manualRenewTotalVnd, 0)
    }

    // MARK: - Buckets

    func testHasActivityIgnoresEmptyMonthsButKeepsAnyCount() {
        XCTAssertFalse(Self.bucket(month: "2026-05").hasActivity)
        XCTAssertTrue(Self.bucket(month: "2026-05", subscription: 1).hasActivity)
        XCTAssertTrue(Self.bucket(month: "2026-05", subscriptionCount: 1).hasActivity)
        XCTAssertTrue(Self.bucket(month: "2026-05", warrantyVnd: 1).hasActivity)
        XCTAssertTrue(Self.bucket(month: "2026-05", warrantyCount: 1).hasActivity)
        XCTAssertTrue(Self.bucket(month: "2026-05", wishlistVnd: 1).hasActivity)
        XCTAssertTrue(Self.bucket(month: "2026-05", wishlistCount: 1).hasActivity)
    }

    func testActiveBucketsDropTheZeroFilledMonthsAndKeepOrder() throws {
        let active = ForecastRules.activeBuckets(try decodeForecast().buckets)
        XCTAssertEqual(active.map(\.month), ["2026-03", "2026-04", "2026-06"])
    }

    /// A 24-month window comes back with up to 25 buckets — far more `MM/yy`
    /// labels than fit on a phone, so the axis thins out while the bars stay.
    func testChartLabelsThinOutWithoutChangingTheBucketCount() {
        let short = (1...13).map { Self.bucket(month: Self.monthString($0)) }
        let shortLabels = ForecastRules.chartLabels(short)
        XCTAssertEqual(shortLabels.count, 13, "one label slot per bucket, always")
        XCTAssertEqual(shortLabels.first, "01/26")
        XCTAssertTrue(shortLabels.allSatisfy { !$0.isEmpty }, "13 buckets still all fit")

        let long = (1...25).map { Self.bucket(month: Self.monthString($0)) }
        let longLabels = ForecastRules.chartLabels(long)
        XCTAssertEqual(longLabels.count, 25)
        XCTAssertEqual(longLabels.filter { !$0.isEmpty }.count, 13)
        XCTAssertEqual(longLabels[0], "01/26")
        XCTAssertEqual(longLabels[1], "", "thinned, not dropped")
        XCTAssertEqual(longLabels[24], "01/28")

        XCTAssertEqual(ForecastRules.chartLabels([]), [])
        XCTAssertEqual(ForecastRules.chartLabels(long, maxLabels: 30).filter { $0.isEmpty }.count, 0)
    }

    // MARK: - Month labels

    func testMonthLabelsAreVietnameseAndNeverCrashOnUnexpectedInput() {
        XCTAssertEqual(ForecastRules.monthLabel("2026-03"), "Tháng 3/2026")
        XCTAssertEqual(ForecastRules.monthLabel("2026-12"), "Tháng 12/2026")
        XCTAssertEqual(ForecastRules.shortMonthLabel("2026-03"), "03/26",
                       "same MM/yy shape as the historical chart")
        XCTAssertEqual(ForecastRules.shortMonthLabel("2027-11"), "11/27")
        XCTAssertEqual(ForecastRules.monthLabel("rác"), "rác",
                       "unparseable input is shown as-is instead of crashing")
        XCTAssertEqual(ForecastRules.monthLabel("2026-13"), "2026-13")
        XCTAssertEqual(ForecastRules.shortMonthLabel(""), "")
    }

    // MARK: - Caveat copy

    /// Wording pin, in the spirit of `services/backup_honesty_test.go`: the
    /// strings that describe reference money must say it is not a commitment.
    func testCaveatCopyNeverPromisesReferenceMoney() {
        XCTAssertTrue(ForecastCopy.warrantySavingsNote.contains("tham khảo"))
        XCTAssertTrue(ForecastCopy.warrantySavingsNote.contains("KHÔNG phải khoản chắc chắn phải trả"))
        XCTAssertTrue(ForecastCopy.wishlistNote.contains("không phải cam kết"))
        XCTAssertTrue(ForecastCopy.autoRenewNote.contains(ForecastCopy.autoRenewHeading),
                      "the split is explained using the same words as the headings")
        XCTAssertNotEqual(ForecastCopy.autoRenewHeading, ForecastCopy.manualRenewHeading)
        XCTAssertEqual(ForecastCopy.emptyWindow(months: 6), "Không có khoản nào sắp tới trong 6 tháng tới.")
    }

    // MARK: - Builders

    /// A minimal but complete payload (every required field present) with a
    /// caller-chosen window length and bucket list.
    private static func forecastJSON(months: Int, buckets: [String]) -> String {
        """
        {
          "generatedAt": "2026-03-15T00:00:00Z",
          "windowStart": "2026-03-15T00:00:00Z",
          "windowEnd": "2026-06-15T00:00:00Z",
          "months": \(months),
          "currency": "VND",
          "subscriptionTotalVnd": 0,
          "subscriptionAutoRenewTotalVnd": 0,
          "subscriptionMonthlyAverageVnd": 0,
          "subscriptionsCount": 0,
          "chargesCount": 0,
          "buckets": [\(buckets.joined(separator: ","))],
          "upcomingWarranties": [],
          "upcomingWishlist": [],
          "note": "note"
        }
        """
    }

    private static func bucketJSON(month: String) -> String {
        """
        {"month": "\(month)", "subscriptionVnd": 0, "subscriptionAutoRenewVnd": 0,
         "subscriptionCount": 0, "warrantyExpiringVnd": 0, "warrantyExpiringCount": 0,
         "wishlistTargetVnd": 0, "wishlistTargetCount": 0}
        """
    }

    /// `1 → "2026-01"`, `13 → "2027-01"` — always a real `YYYY-MM`.
    private static func monthString(_ index: Int) -> String {
        String(format: "%04d-%02d", 2026 + (index - 1) / 12, (index - 1) % 12 + 1)
    }

    private static func bucket(month: String,
                               subscription: Int = 0,
                               autoRenew: Int = 0,
                               subscriptionCount: Int = 0,
                               warrantyVnd: Int = 0,
                               warrantyCount: Int = 0,
                               wishlistVnd: Int = 0,
                               wishlistCount: Int = 0) -> ForecastBucket {
        ForecastBucket(month: month,
                       subscriptionVnd: subscription,
                       subscriptionAutoRenewVnd: autoRenew,
                       subscriptionCount: subscriptionCount,
                       warrantyExpiringVnd: warrantyVnd,
                       warrantyExpiringCount: warrantyCount,
                       wishlistTargetVnd: wishlistVnd,
                       wishlistTargetCount: wishlistCount)
    }

    private static func minimalForecast(total: Int, autoRenew: Int) -> Forecast {
        Forecast(generatedAt: Date(), windowStart: Date(), windowEnd: Date(),
                 months: 1, currency: "VND",
                 subscriptionTotalVnd: total,
                 subscriptionAutoRenewTotalVnd: autoRenew,
                 subscriptionMonthlyAverageVnd: 0,
                 subscriptionsCount: 0, chargesCount: 0,
                 buckets: [], upcomingWarranties: [], upcomingWishlist: [],
                 note: "")
    }
}
