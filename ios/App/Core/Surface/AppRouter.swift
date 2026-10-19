import Foundation
import SwiftUI
import WarrlyKit

/// One place that turns "open this device" requests into navigation.
///
/// Three entry points feed it: a Spotlight result tap (an `NSUserActivity`), a
/// `warrly://device/<id>` URL, and the "Open device" App Intent (which writes
/// the id into the App Group because Siri may run before the UI exists).
///
/// The id is kept until `DevicesScreen` has loaded its list and can actually
/// push the detail screen. Consuming it earlier would drop the request on a
/// cold launch.
@MainActor
final class AppRouter: ObservableObject {
    @Published private(set) var pendingDeviceId: String?

    private var observer: NSObjectProtocol?

    init() {
        observer = NotificationCenter.default.addObserver(
            forName: WarrlyDeepLink.pendingDeviceNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let id = note.object as? String else { return }
            Task { @MainActor in self?.openDevice(id: id) }
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    /// Handles `warrly://device/<id>`. Any other URL is ignored, not treated as
    /// a device id.
    func open(_ url: URL) {
        guard let id = WarrlyDeepLink.deviceId(from: url) else { return }
        openDevice(id: id)
    }

    func openDevice(id: String) {
        pendingDeviceId = id
    }

    /// Picks up the id an App Intent queued in the App Group. Called on every
    /// activation: Siri can run while the app is suspended.
    func restorePendingFromSharedDefaults() {
        if let id = WarrlyIntentBridge.consumePendingDevice() {
            openDevice(id: id)
        }
    }

    /// Hands the id to the devices screen exactly once.
    func consume() -> String? {
        defer { pendingDeviceId = nil }
        return pendingDeviceId
    }

    /// Sign-out hygiene. Also clears the App Group queue so a queued intent
    /// cannot open a device after the account changed.
    func clear() {
        pendingDeviceId = nil
        WarrlyIntentBridge.clearPendingDevice()
    }
}
