import Foundation
import SwiftUI
import WarrantyVaultKit

@MainActor
public final class RemindersStore: ObservableObject {
    public enum LoadState: Equatable {
        case idle, loading, loaded, error(String)
    }

    @Published public private(set) var entries: [UpcomingReminder] = []
    @Published public private(set) var state: LoadState = .idle

    /// Horizon for upcoming reminders. Mirrors the web's 90-day fetch so the
    /// 30/60/90-day buckets in the view all populate.
    public let windowDays: Int = 90

    private let client: APIClient
    public init(client: APIClient) { self.client = client }

    public func load() async {
        state = .loading
        do {
            let reminders = try await client.listUpcomingReminders(withinDays: windowDays)
            entries = reminders
            state = .loaded
        } catch let err as APIError {
            state = .error(err.localizedDescription)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    public func dismiss(warrantyId: String) async throws {
        try await client.dismissReminder(warrantyId: warrantyId)
        entries.removeAll { $0.id == warrantyId }
    }

    /// Un-dismisses a reminder (used by the "Hoàn tác" undo affordance) and
    /// reloads so the row reappears in its bucket.
    public func restore(warrantyId: String) async throws {
        try await client.restoreReminder(warrantyId: warrantyId)
        await load()
    }
}

public extension UpcomingReminder {
    var daysRemaining: Int {
        Calendar.current.dateComponents([.day], from: Date(), to: endDate).day ?? 0
    }
}
