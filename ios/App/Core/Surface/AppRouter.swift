import Foundation
import SwiftUI
import WarrlyKit

/// One place that turns "open this device" / "capture a receipt" requests into
/// navigation.
///
/// Five entry points feed it: a Spotlight result tap (an `NSUserActivity`), a
/// `warrly://device/<id>` URL, the "Open device" App Intent (which writes the
/// id into the App Group because Siri may run before the UI exists), a
/// **tapped push notification** (whose payload carries `url: /devices/<id>`,
/// `/subscriptions/<id>` or `/wishlist/<id>`), and the Control Center control
/// (`warrly://capture` or the `wv.pendingCapture` App Group flag, written by
/// `CaptureReceiptIntent`).
///
/// The id/flag is kept until the destination screen — or `RootView`'s capture
/// sheet — can present it. Consuming it earlier would drop the request on a
/// cold launch.
@MainActor
final class AppRouter: ObservableObject {
    @Published private(set) var pendingDeviceId: String?
    /// A subscription a push asked for. Consumed by `SubscriptionsScreen`,
    /// which switches the tab before pushing — same cold-launch rule as above.
    @Published private(set) var pendingSubscriptionId: String?
    /// A wishlist item a target-date / check-in push asked for. Consumed by
    /// `WishlistScreen`, which switches the tab before pushing — same rule.
    @Published private(set) var pendingWishlistId: String?
    /// The Control Center control asked for receipt capture. Consumed by
    /// `RootView`, which presents `InboxCaptureSheet` only behind the
    /// authenticated gate AND below the App Lock cover.
    @Published private(set) var pendingCapture = false

    /// A resale handoff code from `warrly://handoff/<code>` (Warrly 2.0).
    ///
    /// Like the capture flag, it survives while the app is not ready: the code
    /// can arrive on a cold launch, before login, or while the App Lock cover is
    /// up. `DevicesScreen` presents the claim sheet only inside the
    /// authenticated tab tree, so the code waits here until it can.
    @Published private(set) var pendingHandoffCode: String?

    private var observer: NSObjectProtocol?
    private var pushObserver: NSObjectProtocol?
    private var captureObserver: NSObjectProtocol?

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
                case .wishlist(let id): self?.openWishlist(id: id)
                }
            }
        }

        // The control's intent may run in this process when the app is already
        // alive. The App Group flag is the durable path; this saves a scene
        // phase round trip in the common case.
        captureObserver = NotificationCenter.default.addObserver(
            forName: WarrlyDeepLink.pendingCaptureNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.openCapture() }
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        if let pushObserver { NotificationCenter.default.removeObserver(pushObserver) }
        if let captureObserver { NotificationCenter.default.removeObserver(captureObserver) }
    }

    /// Handles `warrly://device/<id>`, `warrly://capture` and
    /// `warrly://handoff/<code>`. Any other URL is ignored, not treated as a
    /// device id.
    func open(_ url: URL) {
        if WarrlyDeepLink.isCaptureURL(url) {
            openCapture()
            return
        }
        if let code = WarrlyDeepLink.handoffCode(from: url) {
            openHandoff(code: code)
            return
        }
        guard let id = WarrlyDeepLink.deviceId(from: url) else { return }
        openDevice(id: id)
    }

    func openDevice(id: String) {
        pendingDeviceId = id
    }

    func openSubscription(id: String) {
        pendingSubscriptionId = id
    }

    func openWishlist(id: String) {
        pendingWishlistId = id
    }

    /// `warrly://capture` or the App Group flag both land here.
    func openCapture() {
        pendingCapture = true
    }

    /// A claim link (`warrly://handoff/<code>`) asked for the claim sheet. The
    /// code is held until `DevicesScreen` is on screen and the user is signed
    /// in — a claim needs a bearer token, so consuming it before login would
    /// drop the request.
    func openHandoff(code: String) {
        pendingHandoffCode = code
    }

    /// Hands the code to the claim sheet exactly once.
    func consumeHandoff() -> String? {
        defer { pendingHandoffCode = nil }
        return pendingHandoffCode
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
        if WarrlyIntentBridge.consumePendingCapture() {
            openCapture()
        }
    }

    /// Hands the id to the devices screen exactly once.
    func consume() -> String? {
        defer { pendingDeviceId = nil }
        return pendingDeviceId
    }

    /// Hands the capture request to `RootView` exactly once.
    func consumeCapture() {
        pendingCapture = false
    }

    /// Hands the subscription id to the subscriptions screen exactly once.
    func consumeSubscription() -> String? {
        defer { pendingSubscriptionId = nil }
        return pendingSubscriptionId
    }

    /// Hands the wishlist id to the wishlist screen exactly once.
    func consumeWishlist() -> String? {
        defer { pendingWishlistId = nil }
        return pendingWishlistId
    }

    /// Sign-out hygiene. Also clears the App Group queues so a queued intent
    /// cannot open a device (or the capture sheet) after the account changed.
    func clear() {
        pendingDeviceId = nil
        pendingSubscriptionId = nil
        pendingWishlistId = nil
        pendingCapture = false
        pendingHandoffCode = nil
        WarrlyIntentBridge.clearPendingDevice()
        WarrlyIntentBridge.clearPendingCapture()
    }
}
