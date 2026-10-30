import Foundation
import SwiftUI
import WarrlyKit

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

    /// Closed-repair days per device — the display-only legal extension
    /// (Luật 19/2023, Điều 30.2.c). Empty means "no device has a closed repair
    /// with both dates" **or** the claims read failed; either way no row is
    /// moved. The server's reminder feed keeps firing on the stored
    /// `endDate`; this map only changes what the app prints.
    @Published public private(set) var repairDaysByDevice: [String: Int] = [:]

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
        //
        // The claims read is a third, independent read: it exists solely for
        // the display-only repair extension. A failure must not blank the
        // reminders screen — `try?` keeps the feed and leaves the extension
        // empty, which is the honest "we don't know" state.
        let client = self.client
        let window = windowDays
        let dismissedWindow = dismissedWindowDays
        async let remindersTask = client.listUpcomingReminders(withinDays: window)
        async let dismissedTask = client.listUpcomingReminders(withinDays: dismissedWindow,
                                                              includeDismissed: true)
        async let claimsTask = client.listClaims()

        do {
            entries = try await remindersTask
            state = .loaded
        } catch let err as APIError {
            state = .error(err.localizedDescription)
        } catch {
            state = .error(error.localizedDescription)
        }

        apply(dismissed: try? await dismissedTask)
        apply(claims: try? await claimsTask)
    }

    // MARK: - Repair extension (display-only)

    /// Closed-repair days for one device. `0` when there is nothing to add.
    public func repairDays(forDeviceId deviceId: String) -> Int {
        repairDaysByDevice[deviceId] ?? 0
    }

    /// The legal end date for one reminder row: the server's `endDate` plus
    /// this device's closed-repair days. Pure display — nothing is written back.
    public func adjustedEnd(_ endDate: Date, deviceId: String) -> Date {
        WarrantyRepairAdjustment.add(days: repairDays(forDeviceId: deviceId), to: endDate)
    }

    /// True when at least one row on the feed was adjusted, so the screen can
    /// print the legal note exactly when it is relevant.
    public var hasRepairExtension: Bool {
        repairDaysByDevice.values.contains { $0 > 0 }
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
        // Hiding a reminder also hides that deadline from the widget, which
        // reads the same non-dismissed feed.
        DeadlineSurface.refreshSoon(client: client)
    }

    /// Un-dismisses a reminder ("Hoàn tác" / the "Đã ẩn" restore button): the
    /// row reappears in its bucket and leaves the hidden list.
    public func restore(warrantyId: String) async throws {
        try await client.restoreReminder(warrantyId: warrantyId)
        dismissed.removeAll { $0.warrantyId == warrantyId }
        await reloadUpcoming()
        DeadlineSurface.refreshSoon(client: client)
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

    /// Rebuilds the display-only extension map from the full claims read.
    ///
    /// `nil` (the read failed) clears it: an extension from a previous load is
    /// not a fact about the current payload, and a stale `+N days` is exactly
    /// the kind of confidently wrong number this screen must not show.
    private func apply(claims: [Claim]?) {
        guard let claims else {
            repairDaysByDevice = [:]
            return
        }
        let byDevice = Dictionary(grouping: claims, by: { $0.deviceId })
        repairDaysByDevice = byDevice.compactMapValues { deviceClaims in
            let days = WarrantyRepairAdjustment.extensionDays(claims: deviceClaims)
            return days > 0 ? days : nil
        }
    }
}
