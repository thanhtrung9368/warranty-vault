import Foundation

// MARK: - Spending forecast
//
// Mirrors `GET /api/v1/forecast` (openapi.yaml → Forecast / ForecastBucket /
// ForecastWarranty / ForecastWishlistItem).
//
// The forward-looking half of the stats screen: which subscription renewals get
// charged in the next `months` months, which warranty packages expire and which
// wishlist items hit their target date.
//
// The money model is deliberately NOT a single "you will spend X" number:
//   * `subscriptionAutoRenewVnd` — **will** be charged automatically;
//   * `subscriptionVnd − subscriptionAutoRenewVnd` — the user still has to
//     decide about these renewals;
//   * `warrantyExpiringVnd` — the *old package's* price, a reference for saving
//     up, not a commitment;
//   * `wishlistTargetVnd` — a last-recorded price, not a commitment.
// Adding the last two to the subscription total would be a lie, so
// `ForecastRules.summary` keeps them in separate fields and the screen prints
// them under their own headings.

public struct Forecast: Decodable, Sendable, Equatable {
    /// The `now` the calculation used; every other instant is relative to it.
    public let generatedAt: Date
    /// Inclusive window start (= `generatedAt`).
    public let windowStart: Date
    /// Exclusive window end: a charge landing exactly here belongs to no bucket.
    public let windowEnd: Date
    /// Window length in months (1–24), echoed back by the API.
    public let months: Int
    public let currency: String
    /// Sum of the renewal charges inside the window (int64 — never narrowed).
    public let subscriptionTotalVnd: Int
    /// The part of the above that is `autoRenew = true`.
    public let subscriptionAutoRenewTotalVnd: Int
    /// Canonical monthly conversion — equals `subscriptions.totalMonthlyVnd`
    /// from `GET /api/v1/stats`. Use it for a "~X/tháng" line, never to derive
    /// the window total.
    public let subscriptionMonthlyAverageVnd: Int
    /// Subscriptions contributing at least one charge in the window.
    public let subscriptionsCount: Int
    /// Number of charges (a QUARTERLY plan contributes up to 4).
    public let chargesCount: Int
    /// Calendar months the window touches: **normally `months + 1`** (the
    /// current month is partial, plus `months` full months), and exactly
    /// `months` when the call lands on the 1st at 00:00. Never assume a count.
    public let buckets: [ForecastBucket]
    public let upcomingWarranties: [ForecastWarranty]
    public let upcomingWishlist: [ForecastWishlistItem]
    /// Vietnamese explanation of the model, meant to be displayed verbatim.
    public let note: String
}

/// One calendar month (UTC) of the forecast window. Every field is a total, and
/// a month with nothing in it is still present with zeroes.
public struct ForecastBucket: Decodable, Sendable, Equatable, Identifiable {
    /// `YYYY-MM` (UTC).
    public let month: String
    /// Renewal charges falling in this month.
    public let subscriptionVnd: Int
    /// The part charged automatically (`autoRenew = true`).
    public let subscriptionAutoRenewVnd: Int
    /// Number of renewal charges in the month.
    public let subscriptionCount: Int
    /// Cost of warranty packages expiring this month — money that *may* be
    /// needed, not a scheduled payment.
    public let warrantyExpiringVnd: Int
    public let warrantyExpiringCount: Int
    /// Last-recorded price of wishlist items hitting their target date this
    /// month — also not a commitment.
    public let wishlistTargetVnd: Int
    public let wishlistTargetCount: Int

    public var id: String { month }

    /// The part of this month's renewals the user has to act on themselves.
    /// Clamped at 0 so a server-side inconsistency can never print a negative.
    public var manualRenewVnd: Int { max(0, subscriptionVnd - subscriptionAutoRenewVnd) }

    /// Whether anything at all falls in this month. The API returns empty
    /// months on purpose; the list view filters them out instead of printing
    /// thirteen rows of zeroes.
    public var hasActivity: Bool {
        subscriptionVnd > 0 || subscriptionCount > 0
            || warrantyExpiringVnd > 0 || warrantyExpiringCount > 0
            || wishlistTargetVnd > 0 || wishlistTargetCount > 0
    }
}

/// A warranty package expiring inside the window.
public struct ForecastWarranty: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let deviceId: String
    public let deviceName: String
    public let type: WarrantyType
    public let provider: String?
    public let endDate: Date
    /// Bucket this row was counted into.
    public let month: String
    public let months: Int
    /// The package's price, for saving-up reference. `null` = no price recorded
    /// (which is not the same as 0 ₫). Never a charge.
    public let costVnd: Int?
}

/// A wishlist item reaching its target date inside the window.
public struct ForecastWishlistItem: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let targetDate: Date
    public let month: String
    public let priority: WishlistPriority
    public let status: WishlistStatus
    /// Last recorded price. `null` = never priced.
    public let currentPriceVnd: Int?
}

// MARK: - Pure rules

public enum ForecastRules {

    public static let defaultMonths = 12
    public static let minMonths = 1
    public static let maxMonths = 24

    /// Window lengths offered by the picker. All inside 1–24.
    public static let monthOptions = [6, 12, 24]

    /// Clamps a requested window into the API's accepted 1–24.
    ///
    /// `months` outside the range is a **400** server-side (`fieldErrors.months`,
    /// never a silent default), so the client clamps before building the
    /// request — the same approach `SearchQueryRules.clampedLimit` takes with
    /// `limit`. A non-picker caller that asks for `0` gets `1`, not an error.
    public static func clampedMonths(_ raw: Int) -> Int {
        min(max(raw, minMonths), maxMonths)
    }

    /// A label for the picker: `6 → "6 tháng"`.
    public static func monthsLabel(_ months: Int) -> String { L.p("%d tháng", months) }

    /// The bucket sums a screen shows, with the guaranteed and the
    /// discretionary money kept apart.
    public struct Summary: Sendable, Equatable {
        /// Money that **will** leave the account automatically.
        public let autoRenewTotalVnd: Int
        /// Money the user must decide about (total − auto-renew).
        public let manualRenewTotalVnd: Int
        /// Everything charged in the window (auto + manual), straight from the
        /// API's own total — never recomputed from buckets.
        public let subscriptionTotalVnd: Int
        /// Canonical monthly conversion, for the "~X/tháng" line.
        public let monthlyAverageVnd: Int
        public let subscriptionsCount: Int
        public let chargesCount: Int
        /// Warranty packages expiring in the window, summed from the buckets —
        /// a savings *reference*, deliberately not part of any total above.
        public let warrantySavingsReferenceVnd: Int
        public let warrantyCount: Int
        /// Wishlist targets in the window, summed from the buckets — also a
        /// reference only.
        public let wishlistReferenceVnd: Int
        public let wishlistCount: Int
        /// How many buckets the API actually sent (`months + 1`, normally).
        public let bucketCount: Int

        /// Everything in the window that is not a certain charge.
        public var referenceOnlyTotalVnd: Int {
            warrantySavingsReferenceVnd + wishlistReferenceVnd
        }
    }

    /// Rolls a forecast up for display. Reference figures come from the buckets
    /// because the API sends no window-level total for them; the subscription
    /// figures come from the payload's own totals so a bucket edge case can
    /// never change what the user is told they will be charged.
    public static func summary(_ forecast: Forecast) -> Summary {
        var warrantyVnd = 0, warrantyCount = 0
        var wishlistVnd = 0, wishlistCount = 0
        for bucket in forecast.buckets {
            warrantyVnd += bucket.warrantyExpiringVnd
            warrantyCount += bucket.warrantyExpiringCount
            wishlistVnd += bucket.wishlistTargetVnd
            wishlistCount += bucket.wishlistTargetCount
        }
        return Summary(
            autoRenewTotalVnd: forecast.subscriptionAutoRenewTotalVnd,
            manualRenewTotalVnd: max(0, forecast.subscriptionTotalVnd
                                        - forecast.subscriptionAutoRenewTotalVnd),
            subscriptionTotalVnd: forecast.subscriptionTotalVnd,
            monthlyAverageVnd: forecast.subscriptionMonthlyAverageVnd,
            subscriptionsCount: forecast.subscriptionsCount,
            chargesCount: forecast.chargesCount,
            warrantySavingsReferenceVnd: warrantyVnd,
            warrantyCount: warrantyCount,
            wishlistReferenceVnd: wishlistVnd,
            wishlistCount: wishlistCount,
            bucketCount: forecast.buckets.count
        )
    }

    /// Months that actually contain something, in the API's order.
    public static func activeBuckets(_ buckets: [ForecastBucket]) -> [ForecastBucket] {
        buckets.filter(\.hasActivity)
    }

    /// Axis labels for the forecast chart, one per bucket.
    ///
    /// A 24-month window returns up to 25 buckets, which is far more `MM/yy`
    /// labels than fit across a phone. Above `maxLabels` every `stride`-th
    /// bucket keeps its label and the rest get an empty string (the bars stay —
    /// only the axis thins out). The returned array always has exactly one entry
    /// per bucket so it can be zipped with the chart data.
    public static func chartLabels(_ buckets: [ForecastBucket], maxLabels: Int = 14) -> [String] {
        guard !buckets.isEmpty, maxLabels > 0 else { return buckets.map { _ in "" } }
        let stride = max(1, Int(ceil(Double(buckets.count) / Double(maxLabels))))
        return buckets.enumerated().map { index, bucket in
            index % stride == 0 ? shortMonthLabel(bucket.month) : ""
        }
    }

    /// `"2026-03"` → `"Tháng 3/2026"`. Anything that isn't `YYYY-MM` is returned
    /// unchanged, so a payload surprise prints as-is instead of crashing.
    public static func monthLabel(_ month: String) -> String {
        guard let parts = parseMonth(month) else { return month }
        return L.t("Tháng %d/%d", parts.month, parts.year)
    }

    /// `"2026-03"` → `"03/26"`, matching the `MM/yy` labels of the historical
    /// chart so past and future bars read the same way.
    public static func shortMonthLabel(_ month: String) -> String {
        guard let parts = parseMonth(month) else { return month }
        return String(format: "%02d/%02d", parts.month, parts.year % 100)
    }

    private static func parseMonth(_ month: String) -> (year: Int, month: Int)? {
        let parts = month.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count >= 2,
              let year = Int(parts[0]), let m = Int(parts[1]),
              (1...12).contains(m) else { return nil }
        return (year, m)
    }
}

// MARK: - Caveat copy

/// The sentences that keep the forecast honest. They live here (not inline in a
/// view) so the wording is unit-tested and can't quietly drift into promising
/// money the user never agreed to spend.
public enum ForecastCopy {

    /// Heading over the money that will be charged automatically.
    public static let autoRenewHeading = L.t("Sẽ tự động trừ")
    /// Heading over the renewals the user must decide about.
    public static let manualRenewHeading = L.t("Bạn phải tự gia hạn")
    /// Explanation of the split.
    public static let autoRenewNote =
        L.t("Chỉ phần “%@” là khoản chắc chắn bị trừ. Phần còn lại là các gói bạn phải tự gia hạn.",
                    autoRenewHeading)

    /// Warranty money is a savings reference, not a bill.
    public static let warrantySavingsNote =
        L.t("Giá gói bảo hành cũ — chỉ để tham khảo khi để dành tiền, KHÔNG phải khoản chắc chắn phải trả.")
    /// Wishlist money is a last-recorded price, not a bill.
    public static let wishlistNote =
        L.t("Giá ghi nhận gần nhất của món trong wishlist — không phải cam kết chi tiêu.")
    /// Printed when a package/item has no recorded price at all.
    public static let noPriceRecorded = L.t("Chưa ghi giá")
    /// Shown when no bucket in the window has anything in it.
    public static func emptyWindow(months: Int) -> String {
        L.p("Không có khoản nào sắp tới trong %d tháng tới.", months)
    }
}
