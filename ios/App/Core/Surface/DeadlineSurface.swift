import Foundation
import WarrlyKit
import WidgetKit

/// Fills the App Group surfaces the app owns: the widget snapshot and the
/// Spotlight index.
///
/// The widget cannot call the API, so this is the only writer. It runs whenever
/// the app is foregrounded and after every mutation that can change a deadline
/// (device create/edit/delete, warranty create/edit/delete, reminder
/// dismiss/restore, backup import). A snapshot that only refreshed on launch
/// would show a device the user deleted minutes ago as if it were live.
@MainActor
final class DeadlineSurface {
    static let shared = DeadlineSurface()

    private var isRefreshing = false
    private var rerun = false

    /// Session gate. `refresh` is also called by fire-and-forget tasks from the
    /// stores; one of those can still be in flight when the user signs out. A
    /// snapshot written after `clear()` would put the previous account's device
    /// names back into the widget and Spotlight, so every write re-checks both
    /// these values after each `await`.
    private var sessionActive = false
    private var generation = 0

    private init() {}

    /// Marks the start of an authenticated surface. The caller is the tab shell
    /// (or a login), not the sign-out path.
    func beginSession() {
        sessionActive = true
        generation += 1
    }

    /// Coalesces overlapping requests. If a mutation lands while a refresh is
    /// in flight, the next pass runs immediately afterwards instead of being
    /// dropped — that is the case where a just-created device would otherwise
    /// be missing from the widget until the next foreground.
    func refresh(client: APIClient) async {
        guard sessionActive else { return }

        if isRefreshing {
            rerun = true
            return
        }

        isRefreshing = true
        defer { isRefreshing = false }

        repeat {
            rerun = false
            guard sessionActive else { return }
            let runGeneration = generation
            await performRefresh(client: client, generation: runGeneration)
        } while rerun
    }

    /// Fire-and-forget entry point for the stores. They have already finished
    /// their own write; making the user wait for two extra reads would slow
    /// every save down for a surface they are not looking at.
    static func refreshSoon(client: APIClient) {
        Task { await DeadlineSurface.shared.refresh(client: client) }
    }

    /// Removes everything personal from the out-of-app surfaces. Called on
    /// sign-out, account deletion and whenever bootstrap discovers the stored
    /// token is dead — the next account on this phone must not inherit the
    /// previous one's device names in Spotlight or a widget.
    func clear() async {
        // Flip the gate before the first await: a refresh already suspended on
        // the network sees this and abandons its write.
        sessionActive = false
        generation += 1
        DeadlineSnapshotStore()?.clear()
        await DeviceSpotlightIndexer.clear()
        WarrlyIntentBridge.clearPendingDevice()
        WidgetCenter.shared.reloadTimelines(ofKind: WarrlySurface.widgetKind)
    }

    // MARK: Private

    private func performRefresh(client: APIClient, generation runGeneration: Int) async {
        // Independent reads. A reminders failure must not stop Spotlight from
        // being corrected, and a devices failure must not make the widget
        // pretend the old snapshot is new.
        async let devicesTask = client.listDevices()
        async let remindersTask = client.listUpcomingReminders(
            withinDays: DeadlineSnapshotBuilder.windowDays
        )
        let devices = try? await devicesTask
        let reminders = try? await remindersTask

        guard sessionActive, generation == runGeneration else { return }

        if let devices {
            await DeviceSpotlightIndexer.reindex(devices: devices)
        }

        guard sessionActive, generation == runGeneration else {
            // A sign-out can land while the index write above is in flight. The
            // sign-out's own clear may have run before those items were added,
            // so repeat it once here — otherwise the previous account's device
            // names could survive in Spotlight until the next launch.
            if !sessionActive {
                await DeviceSpotlightIndexer.clear()
            }
            return
        }

        guard let devices, let reminders,
              let store = DeadlineSnapshotStore() else { return }

        let snapshot = DeadlineSnapshotBuilder.build(
            devices: devices,
            reminders: reminders,
            capturedAt: Date()
        )
        do {
            try store.write(snapshot)
            WidgetCenter.shared.reloadTimelines(ofKind: WarrlySurface.widgetKind)
        } catch {
            // Leave the previous file untouched. The widget will render it with
            // its "as of" stamp, which is the honest failure mode.
        }
    }
}
