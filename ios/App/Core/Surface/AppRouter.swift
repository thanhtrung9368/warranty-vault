import Foundation
import SwiftUI
import WarrlyKit

/// One place that turns "open this device" requests into navigation.
///
/// Four entry points feed it: a Spotlight result tap (an `NSUserActivity`), a
/// `warrly://device/<id>` URL, the "Open device" App Intent (which writes the
/// id into the App Group because Siri may run before the UI exists), and a
/// **tapped push notification** (whose payload carries `url: /devices/<id>` or
/// `/subscriptions/<id>`).
///
/// The id is kept until the destination tab has loaded enough to push the real
/// screen. Consuming it earlier would drop the request on a cold launch.
@MainActor
final class AppRouter: ObservableObject {
    @Published private(set) var pendingDeviceId: String?
    /// A subscription a push asked for. Consumed by `SubscriptionsScreen`,
    /// which switches the tab before pushing — same cold-launch rule as above.
    @Published private(set) var pendingSubscriptionId: String?

    private var observer: NSObjectProtocol?
    private var pushObserver: NSObjectProtocol?

    init() {
        observer = NotificationCenter.default.addObserver(
            forName: WarrlyDeepLink.pendingDeviceNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let id = note.object as? String else { return }
            Task { @MainActor in self?.openDevice(id: id) }
        }

        // A tapped reminder. `PushDestination` already decided whether the
        // payload names a screen; an unknown or missing `url` never reaches
        // this closure, so a tap that the server did not route opens nothing
        // rather than the last-used tab.
        pushObserver = NotificationCenter.default.addObserver(
            forName: WarrlyPush.destinationNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let destination = note.userInfo?[WarrlyPush.destinationUserInfoKey]
                    as? PushDestination else { return }
            Task { @MainActor in
                switch destination {
                case .device(let id): self?.openDevice(id: id)
                case .subscription(let id): self?.openSubscription(id: id)
                }
            }
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        if let pushObserver { NotificationCenter.default.removeObserver(pushObserver) }
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

    func openSubscription(id: String) {
        pendingSubscriptionId = id
    }

    /// Picks up the id an App Intent queued in the App Group. Called on every
    /// activation: Siri can run while the app is suspended.
    func restorePendingFromSharedDefaults() {
#if DEBUG
        // Screenshot-QA hook: `WV_QA_DEVICE_ID` opens a device on launch
        // without a tap. The App Group route cannot be used for this on an
        // unsigned simulator build (`CODE_SIGNING_ALLOWED=NO` strips the
        // entitlement), and `simctl openurl` asks for a confirmation that
        // cannot be tapped headlessly. Never compiled into Release.
        if let qa = ProcessInfo.processInfo.environment["WV_QA_DEVICE_ID"], !qa.isEmpty {
            openDevice(id: qa)
            return
        }
        // The subscription counterpart, for the same reason: a detail screen
        // that has to be reached by tapping cannot be photographed headlessly.
        if let qa = ProcessInfo.processInfo.environment["WV_QA_SUBSCRIPTION_ID"], !qa.isEmpty {
            openSubscription(id: qa)
        }
#endif
        if let id = WarrlyIntentBridge.consumePendingDevice() {
            openDevice(id: id)
        }
    }

    /// Hands the id to the devices screen exactly once.
    func consume() -> String? {
        defer { pendingDeviceId = nil }
        return pendingDeviceId
    }

    /// Hands the subscription id to the subscriptions screen exactly once.
    func consumeSubscription() -> String? {
        defer { pendingSubscriptionId = nil }
        return pendingSubscriptionId
    }

    /// Sign-out hygiene. Also clears the App Group queue so a queued intent
    /// cannot open a device after the account changed.
    func clear() {
        pendingDeviceId = nil
        pendingSubscriptionId = nil
        WarrlyIntentBridge.clearPendingDevice()
    }
}
