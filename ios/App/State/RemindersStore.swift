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

    /// Threshold for "expiring soon". Mirrors the web's 30-day window.
    public let windowDays: Int = 30

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
}

public extension UpcomingReminder {
    var daysRemaining: Int {
        Calendar.current.dateComponents([.day], from: Date(), to: endDate).day ?? 0
    }
}
