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
///     end (max `endDate` over the device's warranties) is still in the future.
///
/// Everything here is synchronous and side-effect free so it can be unit
/// tested without a backend.
public enum StatsRollup {

    public enum SpendKind: String, Sendable, Equatable {
        case device
        case warranty
    }

    /// One money movement: a device purchase or a warranty package.
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

    // MARK: - Entries

    /// Flattens devices + their warranty packages into a single spend ledger.
    ///
    /// Warranty rows with a nil or non-positive `cost` are skipped, matching
    /// `buildSpendEntries()` on the web.
    public static func buildEntries(
        devices: [Device],
        warrantiesByDevice: [String: [Warranty]]
    ) -> [SpendEntry] {
        var entries: [SpendEntry] = []
        for device in devices {
            entries.append(SpendEntry(amount: device.purchasePrice,
                                      date: device.purchaseDate,
                                      category: device.category,
                                      kind: .device))
            for warranty in warrantiesByDevice[device.id] ?? [] {
                guard let cost = warranty.cost, cost > 0 else { continue }
                entries.append(SpendEntry(amount: cost,
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

    /// The `limit` most expensive devices by purchase price (warranties
    /// excluded), matching the web's "Top 5 thiết bị đắt nhất".
    public static func topDevices(_ devices: [Device], limit: Int = 5) -> [Device] {
        guard limit > 0 else { return [] }
        return devices
            .sorted { $0.purchasePrice > $1.purchasePrice }
            .prefix(limit)
            .map { $0 }
    }

    /// Devices still under warranty: status ACTIVE **and** an effective
    /// warranty end in the future.
    public static func activeAssetValue(_ devices: [Device], now: Date = Date()) -> AssetValue {
        var total = 0
        var count = 0
        for device in devices {
            guard device.status == .ACTIVE,
                  let end = device.effectiveWarrantyEnd,
                  end > now else { continue }
            total += device.purchasePrice
            count += 1
        }
        return AssetValue(total: total, count: count)
    }

    /// Effective warranty end for a device from its full warranty list — the
    /// max `endDate`, or nil when the device has no packages. Mirrors
    /// `effectiveWarrantyEnd()` in `website/src/lib/warranty.ts` and
    /// `api/internal/services/devices.go`, for the one case the list endpoint
    /// doesn't already answer: a device just created/edited locally.
    public static func effectiveWarrantyEnd(_ warranties: [Warranty]) -> Date? {
        warranties.map(\.endDate).max()
    }
}
