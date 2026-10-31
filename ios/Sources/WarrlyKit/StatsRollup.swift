import Foundation

// MARK: - Stats rollups

/// Pure spend mathematics behind the Thống kê (stats) screen.
///
/// Mirrors the RSC helpers in `website/src/app/(app)/stats/page.tsx` so iOS
/// reports the same numbers as the web:
///
///   - a *spend entry* is a device purchase (`purchasePrice` dated
///     `purchaseDate`) or a warranty package (`cost` dated `startDate`);
///   - warranty money is attributed to the category of the device it covers;
///   - the 12-month bar chart buckets entries by calendar month;
///   - "tài sản còn bảo hành" counts ACTIVE devices whose effective warranty
///     end (the max `endDate` over the device's **whole-unit** rows) is still
///     in force — and the day it ends still counts as covered.
///
/// ## Every amount here is VND
///
/// Device prices may be in a foreign currency, so the ledger resolves each one
/// to dong before it is summed — see `buildEntries`. The source of truth is the
/// server's `purchasePriceVnd`; the client never re-rates a purchase from the
/// market. This is the one place iOS adds **device** money, which is why the
/// conversion decision lives here rather than in a view.
///
/// Everything here is synchronous and side-effect free so it can be unit
/// tested without a backend.
public enum StatsRollup {

    public enum SpendKind: String, Sendable, Equatable {
        case device
        case warranty
    }

    /// One money movement, already in **VND**.
    public struct SpendEntry: Sendable, Equatable {
        public let amount: Int
        public let date: Date
        public let category: String
        public let kind: SpendKind

        public init(amount: Int, date: Date, category: String, kind: SpendKind) {
            self.amount = amount
            self.date = date
            self.category = category
            self.kind = kind
        }
    }

    public struct SpendTotals: Sendable, Equatable {
        public let total: Int
        public let deviceCount: Int
        public let warrantyCount: Int

        public init(total: Int, deviceCount: Int, warrantyCount: Int) {
            self.total = total
            self.deviceCount = deviceCount
            self.warrantyCount = warrantyCount
        }

        public static let zero = SpendTotals(total: 0, deviceCount: 0, warrantyCount: 0)
    }

    /// One bar of the 12-month chart.
    public struct MonthlyBucket: Sendable, Equatable, Identifiable {
        public let year: Int
        public let month: Int
        public let total: Int

        public init(year: Int, month: Int, total: Int) {
            self.year = year
            self.month = month
            self.total = total
        }

        public var id: String { String(format: "%04d-%02d", year, month) }

        /// `MM/yy` — matches the web chart's `format(date, 'MM/yy')`.
        public var label: String { String(format: "%02d/%02d", month, year % 100) }
    }

    /// One slice / legend row of the "Phân bổ theo loại" chart.
    public struct CategoryTotal: Sendable, Equatable, Identifiable {
        public let category: String
        public let label: String
        /// Device purchases + warranty packages attributed to this category.
        public let total: Int
        /// Number of devices in this category (warranties do not add to it).
        public let count: Int

        public init(category: String, label: String, total: Int, count: Int) {
            self.category = category
            self.label = label
            self.total = total
            self.count = count
        }

        public var id: String { category }
    }

    public struct AssetValue: Sendable, Equatable {
        public let total: Int
        public let count: Int

        public init(total: Int, count: Int) {
            self.total = total
            self.count = count
        }

        public static let zero = AssetValue(total: 0, count: 0)
    }

    // MARK: - Repair spend (claims)

    /// Which side of "worth fixing" a repair landed on.
    ///
    /// The same three-way split as `SaleTone` (profit / loss / even), because
    /// the user is making the same kind of comparison the resale block makes —
    /// what the machine cost versus what was spent on it. The labels differ
    /// ("Lãi/Lỗ" is wrong for a repair), not the shape.
    public enum RepairVerdict: String, Sendable, Equatable {
        /// The repair cost less than the device's purchase price.
        case worthFixing
        /// The two amounts are equal.
        case breakEven
        /// The repair cost more than the device's purchase price.
        case notWorthFixing
    }

    /// One claim's cost compared with the device it belongs to.
    ///
    /// Built only when both numbers exist **and** the purchase price is a real
    /// positive amount: a `0 ₫` device is a gift, and "the repair cost more
    /// than the purchase price" is arithmetic without meaning there. The claim
    /// total below still counts that repair; only the comparison is skipped.
    public struct RepairComparison: Sendable, Equatable, Identifiable {
        public let claimId: String
        public let deviceId: String
        public let deviceName: String
        public let category: String
        /// The claim's recorded cost, **VND** (openapi `Claim.cost`).
        public let costVnd: Int
        /// The device's purchase price resolved to VND. For a foreign device
        /// this is the server's locked `purchasePriceVnd`, never a market rate.
        public let purchasePriceVnd: Int

        public init(claimId: String,
                    deviceId: String,
                    deviceName: String,
                    category: String,
                    costVnd: Int,
                    purchasePriceVnd: Int) {
            self.claimId = claimId
            self.deviceId = deviceId
            self.deviceName = deviceName
            self.category = category
            self.costVnd = costVnd
            self.purchasePriceVnd = purchasePriceVnd
        }

        public var id: String { claimId }

        /// `purchasePriceVnd − costVnd`: what repairing saved versus replacing.
        /// Negative means the repair cost more than the device did.
        public var savingsVnd: Int { purchasePriceVnd - costVnd }

        public var verdict: RepairVerdict {
            if savingsVnd > 0 { return .worthFixing }
            if savingsVnd < 0 { return .notWorthFixing }
            return .breakEven
        }

        /// "Đáng sửa · rẻ hơn giá mua 2.000.000 ₫", "Không đáng sửa · sửa tốn hơn
        /// giá mua 500.000 ₫", or "Ngang giá mua". Money is VND on both sides —
        /// the comparison would be meaningless otherwise.
        public var label: String {
            switch verdict {
            case .worthFixing:
                return L.t("Đáng sửa · rẻ hơn giá mua %@",
                           VndFormat.string(Int64(savingsVnd)))
            case .notWorthFixing:
                return L.t("Không đáng sửa · sửa tốn hơn giá mua %@",
                           VndFormat.string(Int64(-savingsVnd)))
            case .breakEven:
                return L.t("Ngang giá mua")
            }
        }
    }

    /// What the user actually spent on repairs, kept **outside** the purchase
    /// ledger.
    ///
    /// A repair is money spent after the purchase, on a machine that already
    /// cost something — adding it to "Tổng chi mua sắm" would compare two
    /// different kinds of number and make the headline depend on whether a
    /// screen broke. So this is its own line, with its own count and its own
    /// "worth fixing" comparisons.
    public struct RepairSpend: Sendable, Equatable {
        /// Sum of every recorded claim cost, in VND. `0` is a real total (free
        /// or warranty-covered repairs), not "missing".
        public let totalVnd: Int
        /// Claims that carry a cost at all — including `0`.
        public let pricedClaimCount: Int
        /// Distinct devices with at least one priced claim.
        public let deviceCount: Int
        /// Claims whose cost can be compared with the device's purchase price.
        /// Sorted by cost descending, then device name, so the biggest repairs
        /// read first.
        public let comparisons: [RepairComparison]

        public init(totalVnd: Int,
                    pricedClaimCount: Int,
                    deviceCount: Int,
                    comparisons: [RepairComparison]) {
            self.totalVnd = totalVnd
            self.pricedClaimCount = pricedClaimCount
            self.deviceCount = deviceCount
            self.comparisons = comparisons
        }

        public static let zero = RepairSpend(totalVnd: 0, pricedClaimCount: 0,
                                             deviceCount: 0, comparisons: [])

        /// The section must not render at all when no claim carries a cost.
        /// `cost == 0` still counts: "this repair was free" is an answer.
        public var hasAnyCost: Bool { pricedClaimCount > 0 }
    }

    /// Sums claims into the standalone repair line.
    ///
    /// ## What counts
    ///
    /// * `cost == nil` → the claim is ignored (not recorded).
    /// * `cost == 0` → counted, and contributes `0` to the total. A free repair
    ///   is a fact worth showing, not a missing value.
    /// * A claim whose device is not in `devices` still contributes money and
    ///   its claim count, but cannot be compared — the purchase price is not in
    ///   this read.
    ///
    /// ## Currency
    ///
    /// `Claim.cost` is documented as **VND** on the wire, while
    /// `Device.purchasePrice` is in the device's own currency. The comparison
    /// therefore uses `device.purchasePriceInVnd` (the server's locked VND
    /// value) and skips a foreign device whose VND value the read did not carry
    /// rather than comparing dong with dollars.
    public static func repairSpend(
        claims: [Claim],
        devices: [Device]
    ) -> RepairSpend {
        let devicesById = Dictionary(devices.map { ($0.id, $0) },
                                     uniquingKeysWith: { first, _ in first })

        var total = 0
        var priced = 0
        var deviceIds = Set<String>()
        var comparisons: [RepairComparison] = []

        for claim in claims {
            guard let rawCost = claim.cost else { continue }
            let cost = max(0, rawCost)
            priced += 1
            total += cost
            deviceIds.insert(claim.deviceId)

            guard let device = devicesById[claim.deviceId],
                  let purchase = device.purchasePriceInVnd,
                  purchase > 0 else { continue }

            comparisons.append(RepairComparison(
                claimId: claim.id,
                deviceId: device.id,
                deviceName: device.name,
                category: device.category,
                costVnd: cost,
                purchasePriceVnd: purchase
            ))
        }

        comparisons.sort { lhs, rhs in
            if lhs.costVnd != rhs.costVnd { return lhs.costVnd > rhs.costVnd }
            if lhs.deviceName != rhs.deviceName { return lhs.deviceName < rhs.deviceName }
            return lhs.claimId < rhs.claimId
        }

        return RepairSpend(totalVnd: total,
                           pricedClaimCount: priced,
                           deviceCount: deviceIds.count,
                           comparisons: comparisons)
    }

    // MARK: - Entries

    /// Flattens devices + their warranty packages into a single **VND** spend
    /// ledger.
    ///
    /// Warranty rows with a nil or non-positive `cost` are skipped, matching
    /// `buildSpendEntries()` on the web.
    ///
    /// ## Multi-currency
    ///
    /// A device's `purchasePrice` is in its own currency, so it must never be
    /// added raw: a $999 phone and a 25,000,000 ₫ phone would sum as 999 +
    /// 25,000,000. Each amount is resolved through the totals rule instead:
    ///
    ///   - the device uses the server's `purchasePriceVnd` (the contract's
    ///     computed value) and falls back to the native amount only when the
    ///     device is VND (already dong);
    ///   - each `Warranty.cost` is in the device's currency and the contract
    ///     does not pre-compute it, so it is multiplied by the device's
    ///     **locked** `fxRate` — the same rate the purchase was entered at, not
    ///     a market lookup, so a historical total cannot drift.
    ///
    /// An amount that cannot be resolved contributes `0` rather than its
    /// native number — the row and the device/package count stay in the
    /// ledger, but "$999" is never counted as 999 ₫. The current contract
    /// always sends `purchasePriceVnd` and requires a rate for non-VND, so this
    /// branch only matters for a stale cached payload.
    public static func buildEntries(
        devices: [Device],
        warrantiesByDevice: [String: [Warranty]]
    ) -> [SpendEntry] {
        var entries: [SpendEntry] = []
        for device in devices {
            entries.append(SpendEntry(
                amount: device.purchasePriceInVnd ?? 0,
                date: device.purchaseDate,
                category: device.category,
                kind: .device
            ))
            for warranty in warrantiesByDevice[device.id] ?? [] {
                guard let cost = warranty.cost, cost > 0 else { continue }
                let vnd = CurrencyRules.lockedVnd(cost,
                                                  currency: device.currency,
                                                  fxRate: device.fxRate)
                entries.append(SpendEntry(amount: vnd ?? 0,
                                          date: warranty.startDate,
                                          category: device.category,
                                          kind: .warranty))
            }
        }
        return entries
    }

    // MARK: - Monthly buckets (bar chart)

    /// The last `months` calendar months, oldest first, each with the money
    /// spent in it. Months with no spend report `0` so the chart keeps its
    /// shape. Entries dated after the current month are ignored, exactly like
    /// the web helper (they simply have no bucket to land in).
    public static func monthlyBuckets(
        _ entries: [SpendEntry],
        months: Int = 12,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> [MonthlyBucket] {
        guard months > 0 else { return [] }

        // Ordered list of the months we render, oldest → newest.
        var slots: [(year: Int, month: Int, start: Date)] = []
        for offset in stride(from: months - 1, through: 0, by: -1) {
            guard let shifted = calendar.date(byAdding: .month, value: -offset, to: now),
                  let interval = calendar.dateInterval(of: .month, for: shifted) else { continue }
            let comps = calendar.dateComponents([.year, .month], from: interval.start)
            guard let year = comps.year, let month = comps.month else { continue }
            slots.append((year, month, interval.start))
        }
        guard let firstSlot = slots.first else { return [] }

        var totals = [String: Int](minimumCapacity: slots.count)
        for slot in slots { totals[key(year: slot.year, month: slot.month)] = 0 }

        for entry in entries {
            guard entry.date >= firstSlot.start else { continue }
            let comps = calendar.dateComponents([.year, .month], from: entry.date)
            guard let year = comps.year, let month = comps.month else { continue }
            let k = key(year: year, month: month)
            guard totals[k] != nil else { continue }   // outside the window
            totals[k]! += entry.amount
        }

        return slots.map { slot in
            MonthlyBucket(year: slot.year,
                          month: slot.month,
                          total: totals[key(year: slot.year, month: slot.month)] ?? 0)
        }
    }

    private static func key(year: Int, month: Int) -> String {
        String(format: "%04d-%02d", year, month)
    }

    // MARK: - Category rollup (donut chart)

    /// Spend grouped by device category. Pass `devices: []` to get a
    /// money-only rollup for a single year, the way the stats page does.
    public static func byCategory(
        devices: [Device],
        entries: [SpendEntry]
    ) -> [CategoryTotal] {
        var order: [String] = []
        var totals: [String: Int] = [:]
        var counts: [String: Int] = [:]

        func touch(_ category: String) {
            if totals[category] == nil {
                totals[category] = 0
                counts[category] = 0
                order.append(category)
            }
        }

        for device in devices {
            touch(device.category)
            counts[device.category, default: 0] += 1
        }
        for entry in entries {
            touch(entry.category)
            totals[entry.category, default: 0] += entry.amount
        }

        return order.map { category in
            CategoryTotal(category: category,
                          label: CategoryLabels.label(for: category),
                          total: totals[category] ?? 0,
                          count: counts[category] ?? 0)
        }
    }

    // MARK: - Totals

    /// All-time spend across every entry.
    public static func totals(_ entries: [SpendEntry]) -> SpendTotals {
        reduce(entries)
    }

    /// Spend inside one calendar year.
    public static func totals(
        _ entries: [SpendEntry],
        year: Int,
        calendar: Calendar = .current
    ) -> SpendTotals {
        reduce(entries.filter { calendar.component(.year, from: $0.date) == year })
    }

    private static func reduce(_ entries: [SpendEntry]) -> SpendTotals {
        var total = 0
        var deviceCount = 0
        var warrantyCount = 0
        for entry in entries {
            total += entry.amount
            switch entry.kind {
            case .device:   deviceCount += 1
            case .warranty: warrantyCount += 1
            }
        }
        return SpendTotals(total: total, deviceCount: deviceCount, warrantyCount: warrantyCount)
    }

    /// Every calendar year that has at least one device purchase, plus the
    /// current year, newest first — the year picker's options.
    public static func yearsWithData(
        devices: [Device],
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> [Int] {
        var years = Set<Int>()
        for device in devices { years.insert(calendar.component(.year, from: device.purchaseDate)) }
        years.insert(calendar.component(.year, from: now))
        return years.sorted(by: >)
    }

    // MARK: - Leaderboards / asset value

    /// Devices ordered by their **VND** purchase value.
    ///
    /// The list screen's "Giá cao nhất / thấp nhất" sorts go through this, as
    /// does the Top 5. Sorting the raw `purchasePrice` is the same bug as
    /// summing it: a $999 phone would rank below a 1,000,000 ₫ laptop. A foreign
    /// device with no server VND value cannot be compared and sorts last in
    /// either direction; ties fall back to the name so the order is stable.
    public static func sortedByPurchaseValue(_ devices: [Device],
                                             descending: Bool = true) -> [Device] {
        devices.sorted { lhs, rhs in
            switch (lhs.purchasePriceInVnd, rhs.purchasePriceInVnd) {
            case let (left?, right?):
                if left != right { return descending ? left > right : left < right }
                return lhs.name.localizedCompare(rhs.name) == .orderedAscending
            case (_?, nil):  return true
            case (nil, _?):  return false
            case (nil, nil): return lhs.name.localizedCompare(rhs.name) == .orderedAscending
            }
        }
    }

    /// The `limit` most expensive devices by **VND** purchase value (warranties
    /// excluded), matching the web's "Top 5 thiết bị đắt nhất".
    ///
    /// Ranked on the server's `purchasePriceVnd`, not the raw `purchasePrice`:
    /// a $999 phone is more expensive than a 25,000,000 ₫ one, and sorting the
    /// native numbers would put it below a 1,000 ₫ cable. A foreign device with
    /// no server value sorts after every priced device (it cannot be compared),
    /// with the name as a deterministic tiebreaker.
    public static func topDevices(_ devices: [Device], limit: Int = 5) -> [Device] {
        guard limit > 0 else { return [] }
        return sortedByPurchaseValue(devices, descending: true)
            .prefix(limit)
            .map { $0 }
    }

    /// Devices still under warranty: status ACTIVE **and** an effective
    /// warranty end that has not passed, where the end **day itself still
    /// counts** — the same calendar-day rule as `WarrantyRollup`,
    /// `WarrantyPillCopy` ("Hết hôm nay") and the web card
    /// (`daysUntil(...) >= 0`).
    ///
    /// This used to compare the stored end (local midnight) with `now`, so from
    /// 00:00:01 on the final day the device left the count and its value left
    /// the total — a day early, on the one day the user might still be covered.
    /// The total is in VND, resolved per device through the same totals rule as
    /// the ledger.
    public static func activeAssetValue(_ devices: [Device],
                                        now: Date = Date(),
                                        calendar: Calendar = .current) -> AssetValue {
        var total = 0
        var count = 0
        for device in devices {
            guard device.status == .ACTIVE,
                  let end = device.effectiveWarrantyEnd,
                  CalendarDay.days(from: now, to: end, calendar: calendar) >= 0
            else { continue }
            total += device.purchasePriceInVnd ?? 0
            count += 1
        }
        return AssetValue(total: total, count: count)
    }

    /// The sum of every device's purchase value in VND — the stats hero's
    /// "Tổng giá trị thiết bị".
    ///
    /// The app used to read `GET /api/v1/stats → devices.totalPurchasePrice`,
    /// which the frozen multi-currency contract does not redefine; summing the
    /// per-device `purchasePriceVnd` the reads already carry is both
    /// currency-correct and independent of that endpoint's arithmetic.
    public static func totalPurchaseValue(_ devices: [Device]) -> Int {
        devices.reduce(0) { $0 + ($1.purchasePriceInVnd ?? 0) }
    }

    /// Effective warranty end for a device from its full warranty list — the
    /// latest `endDate` across **whole-unit** rows, or `nil` when no whole-unit
    /// row has one.
    ///
    /// A row with a non-blank `component` covers one part, not the device: a
    /// fridge's ten-year motor warranty must not become "the whole machine is
    /// covered until 2035". `openapi.yaml`'s `effectiveWarrantyEnd` names
    /// exactly that failure, and the server implements it in
    /// `api/internal/services/brand_warranty.go::wholeUnitWarrantyEnd`. A blank
    /// component is whole-unit — the service normalises `""` to NULL on write,
    /// but a hand-edited row must not be silently excluded.
    ///
    /// This is the **fallback** only: the list and detail reads already carry
    /// the server-computed value. It exists for a device created or edited
    /// locally, whose richer payload has not been re-read yet.
    public static func effectiveWarrantyEnd(_ warranties: [Warranty]) -> Date? {
        warranties
            .filter { ($0.component ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .map(\.endDate)
            .max()
    }
}
