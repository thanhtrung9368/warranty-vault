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
        // Wishlist
        public var wishlistByStatus: [WishlistStatus: Int] = [:]
        public var totalWishlist: Int = 0
        public var watchingValue: Int = 0
        // Warranties expiring soon
        public var expiringIn7Days: Int = 0
        public var expiringIn30Days: Int = 0
        public var wishlistActive: Int = 0
    }

    @Published public private(set) var snapshot = Snapshot()
    @Published public private(set) var state: LoadState = .idle

    private let client: APIClient
    public init(client: APIClient) { self.client = client }

    public func load() async {
        state = .loading
        do {
            async let statsTask = client.getStats()
            async let remindersTask = client.listUpcomingReminders(withinDays: 30)
            let stats = try await statsTask
            let reminders: [UpcomingReminder]
            do {
                reminders = try await remindersTask
            } catch {
                reminders = []
            }

            var snap = Snapshot()
            // Warranties bucketed by days remaining (>=0).
            for r in reminders {
                let days = r.daysRemaining
                guard days >= 0 else { continue }
                if days <= 7 { snap.expiringIn7Days += 1 }
                if days <= 30 { snap.expiringIn30Days += 1 }
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
            // Wishlist
            snap.totalWishlist = stats.wishlist.total
            snap.watchingValue = stats.wishlist.totalCurrentPriceWatching
            for status in WishlistStatus.allCases {
                snap.wishlistByStatus[status] = stats.wishlist.byStatus[status.rawValue] ?? 0
            }
            snap.wishlistActive = (snap.wishlistByStatus[.WATCHING] ?? 0)
                + (snap.wishlistByStatus[.DECIDED] ?? 0)

            snapshot = snap
            state = .loaded
        } catch let err as APIError {
            state = .error(err.localizedDescription)
        } catch {
            state = .error(error.localizedDescription)
        }
    }
}
