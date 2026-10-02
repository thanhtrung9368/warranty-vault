import Foundation
import SwiftUI
import WarrantyVaultKit

@MainActor
public final class StatsStore: ObservableObject {
    public enum LoadState: Equatable {
        case idle, loading, loaded, error(String)
    }

    public struct Snapshot: Equatable {
        // Devices
        public var devicesByStatus: [DeviceStatus: Int] = [:]
        public var totalDevicesValue: Int = 0
        public var totalDevices: Int = 0
        // Subscriptions
        public var subsByStatus: [SubscriptionStatus: Int] = [:]
        public var totalSubs: Int = 0
        public var monthlyEquivalent: Int = 0
        public var activeSubs: Int = 0
        // Wishlist
        public var wishlistByStatus: [WishlistStatus: Int] = [:]
        public var totalWishlist: Int = 0
        public var watchingValue: Int = 0
        // Warranties expiring soon
        public var expiringIn7Days: Int = 0
        public var expiringIn30Days: Int = 0
        public var wishlistActive: Int = 0

        // MARK: Spend rollups (Thống kê)

        /// The raw ledger — kept so the view can recompute the per-year
        /// breakdown when the year picker changes, without another round trip.
        public var spendEntries: [StatsRollup.SpendEntry] = []
        public var monthlyBuckets: [StatsRollup.MonthlyBucket] = []
        public var categoryTotals: [StatsRollup.CategoryTotal] = []
        public var allTimeTotals: StatsRollup.SpendTotals = .zero
        public var assetValue: StatsRollup.AssetValue = .zero
        public var topDevices: [Device] = []
        public var years: [Int] = []
        /// False when at least one per-device warranty read failed, so the
        /// money totals below may be under-reported. Mirrors the web's amber
        /// "Không tải được gói bảo hành của một vài thiết bị" banner.
        public var warrantiesComplete: Bool = true
    }

    @Published public private(set) var snapshot = Snapshot()
    @Published public private(set) var state: LoadState = .idle

    private let client: APIClient
    public init(client: APIClient) { self.client = client }

    /// Spend totals for one calendar year, computed on demand from the loaded
    /// ledger (the web recomputes this per `?year=` render).
    public func yearTotals(_ year: Int) -> StatsRollup.SpendTotals {
        StatsRollup.totals(snapshot.spendEntries, year: year)
    }

    /// Money-only category breakdown for one year.
    public func yearCategoryTotals(_ year: Int) -> [StatsRollup.CategoryTotal] {
        let entries = snapshot.spendEntries.filter {
            Calendar.current.component(.year, from: $0.date) == year
        }
        return StatsRollup.byCategory(devices: [], entries: entries)
    }

    public func load() async {
        state = .loading
        do {
            async let statsTask = client.getStats()
            async let devicesTask = client.listDevices()

            let stats = try await statsTask
            let devices: [Device]
            do {
                devices = try await devicesTask
            } catch {
                devices = []
            }

            // Warranty packages are not part of the device list projection
            // (only `effectiveWarrantyEnd` is), and openapi has no bulk
            // warranty read, so fetch them per device — same as the web stats
            // page. Volumes are tiny (≤50 devices, ≤5 packages each).
            let (warrantiesByDevice, complete) = await loadWarranties(for: devices)

            var snap = Snapshot()
            let now = Date()

            // "Sắp hết" is about the device's *effective warranty end*
            // (max `endDate` across its packages), not about a warranty row —
            // this is how the web dashboard and stats page count it.
            let in7Days = now.addingTimeInterval(7 * 86_400)
            let in30Days = now.addingTimeInterval(30 * 86_400)
            for device in devices {
                guard device.status == .ACTIVE,
                      let end = device.effectiveWarrantyEnd,
                      end > now else { continue }
                if end <= in7Days { snap.expiringIn7Days += 1 }
                if end <= in30Days { snap.expiringIn30Days += 1 }
            }
            // Devices
            snap.totalDevices = stats.devices.total
            snap.totalDevicesValue = stats.devices.totalPurchasePrice
            for status in DeviceStatus.allCases {
                snap.devicesByStatus[status] = stats.devices.byStatus[status.rawValue] ?? 0
            }
            // Subscriptions
            snap.totalSubs = stats.subscriptions.total
            snap.monthlyEquivalent = stats.subscriptions.totalMonthlyVnd
            for status in SubscriptionStatus.allCases {
                snap.subsByStatus[status] = stats.subscriptions.byStatus[status.rawValue] ?? 0
            }
            snap.activeSubs = stats.subscriptions.byStatus[SubscriptionStatus.ACTIVE.rawValue] ?? 0
            // Wishlist
            snap.totalWishlist = stats.wishlist.total
            snap.watchingValue = stats.wishlist.totalCurrentPriceWatching
            for status in WishlistStatus.allCases {
                snap.wishlistByStatus[status] = stats.wishlist.byStatus[status.rawValue] ?? 0
            }
            snap.wishlistActive = (snap.wishlistByStatus[.WATCHING] ?? 0)
                + (snap.wishlistByStatus[.DECIDED] ?? 0)

            // Spend rollups for the charts.
            let entries = StatsRollup.buildEntries(devices: devices,
                                                   warrantiesByDevice: warrantiesByDevice)
            snap.spendEntries = entries
            snap.warrantiesComplete = complete
            snap.monthlyBuckets = StatsRollup.monthlyBuckets(entries, months: 12, now: now)
            snap.categoryTotals = StatsRollup.byCategory(devices: devices, entries: entries)
            snap.allTimeTotals = StatsRollup.totals(entries)
            snap.assetValue = StatsRollup.activeAssetValue(devices, now: now)
            snap.topDevices = StatsRollup.topDevices(devices, limit: 5)
            snap.years = StatsRollup.yearsWithData(devices: devices, now: now)

            snapshot = snap
            state = .loaded
        } catch let err as APIError {
            state = .error(err.localizedDescription)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    /// Fetches each device's warranty packages concurrently.
    /// - Returns: the packages keyed by device id, plus whether every read
    ///   succeeded (a partial read under-reports the money totals).
    private func loadWarranties(
        for devices: [Device]
    ) async -> (byDevice: [String: [Warranty]], complete: Bool) {
        guard !devices.isEmpty else { return ([:], true) }

        let results = await withTaskGroup(
            of: (String, [Warranty]?).self,
            returning: [(String, [Warranty]?)].self
        ) { group in
            for device in devices {
                group.addTask { [client] in
                    let detail = try? await client.getDevice(id: device.id)
                    return (device.id, detail?.warranties)
                }
            }
            var out: [(String, [Warranty]?)] = []
            for await result in group { out.append(result) }
            return out
        }

        var byDevice: [String: [Warranty]] = [:]
        var complete = true
        for (id, warranties) in results {
            if let warranties {
                byDevice[id] = warranties
            } else {
                complete = false
            }
        }
        return (byDevice, complete)
    }
}
