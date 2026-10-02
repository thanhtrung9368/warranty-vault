import Foundation
import SwiftUI
import WarrantyVaultKit

@MainActor
public final class RemindersStore: ObservableObject {
    public enum LoadState: Equatable {
        case idle, loading, loaded, error(String)
    }

    @Published public private(set) var entries: [UpcomingReminder] = []
    /// Warranties the user has hidden. The plain upcoming feed excludes them,
    /// so they come from the same endpoint asked with `includeDismissed=true`
    /// — see `DismissedReminders`.
    @Published public private(set) var dismissed: [DismissedReminder] = []
    /// True when the hidden-rows read failed, so the "Đã ẩn" list can say so
    /// instead of implying there is nothing hidden.
    @Published public private(set) var dismissedUnavailable = false
    @Published public private(set) var state: LoadState = .idle

    /// Horizon for upcoming reminders. Mirrors the web's 90-day fetch so the
    /// 30/60/90-day buckets in the view all populate.
    public let windowDays: Int = 90

    /// Horizon for the hidden rows: the widest lookahead the endpoint accepts
    /// (`withinDays` max 365). "Đã ẩn" is a history, not a countdown — asking
    /// for the full window keeps a reminder hidden long ago from falling off
    /// the list just because its end date left the upcoming horizon.
    private let dismissedWindowDays: Int = 365

    private let client: APIClient
    public init(client: APIClient) { self.client = client }

    public func load() async {
        state = .loading

        // Two independent reads — run them together. Capturing `client` (an
        // actor) rather than `self` keeps the child tasks off the main actor.
        // Both go to the light reminders endpoint now; the hidden rows used to
        // cost a second, much heavier read of the whole account export.
        let client = self.client
        let window = windowDays
        let dismissedWindow = dismissedWindowDays
        async let remindersTask = client.listUpcomingReminders(withinDays: window)
        async let dismissedTask = client.listUpcomingReminders(withinDays: dismissedWindow,
                                                              includeDismissed: true)

        do {
            entries = try await remindersTask
            state = .loaded
        } catch let err as APIError {
            state = .error(err.localizedDescription)
        } catch {
            state = .error(error.localizedDescription)
        }

        apply(dismissed: try? await dismissedTask)
    }

    // MARK: - Dismiss / restore

    /// Hides a reminder and moves it into the "Đã ẩn" list so the user can
    /// undo straight away — no reload needed.
    public func dismiss(_ entry: UpcomingReminder) async throws {
        try await client.dismissReminder(warrantyId: entry.id)
        entries.removeAll { $0.id == entry.id }
        let mirrored = DismissedReminder(
            warrantyId: entry.id,
            deviceId: entry.deviceId,
            deviceName: entry.device.name,
            deviceCategory: entry.device.category,
            // The upcoming feed only returns warranties on ACTIVE devices
            // (openapi: `GET /api/v1/reminders`).
            deviceStatus: .ACTIVE,
            warrantyType: entry.type,
            warrantyProvider: entry.provider,
            endDate: entry.endDate
        )
        if !dismissed.contains(where: { $0.warrantyId == mirrored.warrantyId }) {
            dismissed.append(mirrored)
            dismissed.sort { $0.endDate > $1.endDate }
        }
    }

    /// Un-dismisses a reminder ("Hoàn tác" / the "Đã ẩn" restore button): the
    /// row reappears in its bucket and leaves the hidden list.
    public func restore(warrantyId: String) async throws {
        try await client.restoreReminder(warrantyId: warrantyId)
        dismissed.removeAll { $0.warrantyId == warrantyId }
        await reloadUpcoming()
    }

    // MARK: - Helpers

    private func reloadUpcoming() async {
        do {
            entries = try await client.listUpcomingReminders(withinDays: windowDays)
            state = .loaded
        } catch let err as APIError {
            state = .error(err.localizedDescription)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    private func apply(dismissed rows: [UpcomingReminder]?) {
        guard let rows else {
            dismissed = []
            dismissedUnavailable = true
            return
        }
        dismissed = DismissedReminders.fromReminders(rows)
        dismissedUnavailable = false
    }
}

public extension UpcomingReminder {
    var daysRemaining: Int {
        Calendar.current.dateComponents([.day], from: Date(), to: endDate).day ?? 0
    }
}
