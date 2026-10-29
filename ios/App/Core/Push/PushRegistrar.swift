import Foundation
#if canImport(UIKit)
import UIKit
#endif
import UserNotifications
import WarrlyKit

/// Coordinates APNs registration and posts the resulting device token to the
/// backend's `/api/v1/push/register` endpoint. The actual `application(_:
/// didRegister...)` callback lives on `AppDelegate` (UIApplicationDelegate
/// can't be a struct), which forwards into `handleDeviceToken`/`handleFailure`
/// here.
@MainActor
public final class PushRegistrar: ObservableObject {

    public enum Status: Equatable {
        case unknown
        case denied
        case requesting
        case registering
        case registered
        case failed(String)
    }

    @Published public private(set) var status: Status = .unknown

    public static let shared = PushRegistrar()

    /// Set by AuthStore so we can call the API as the current user.
    private var client: APIClient?

    /// Injected by `WarrlyApp`: `true` while a Google consent prompt (the UMP
    /// form or the ATT alert) is on screen.
    ///
    /// A notification prompt must never be stacked on those. This app has been
    /// rejected twice for exactly that kind of ordering mistake, so the check is
    /// live rather than assumed: `requestAndRegister` waits (bounded by the
    /// consent flow's own deadlines) for the screen to clear first.
    public var adsPromptActive: (@MainActor () -> Bool)?

    /// UserDefaults key for the once-ever rationale flag. Set when the rationale
    /// is **shown**, not when permission is granted: a user who dismisses it has
    /// answered, and asking again would be nagging.
    private static let primerOfferedKey = "wv.notificationPrimerOffered"

    private var primerOffered: Bool {
        get { UserDefaults.standard.bool(forKey: Self.primerOfferedKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.primerOfferedKey) }
    }

    private init() {}

    public func configure(client: APIClient) {
        self.client = client
    }

    // MARK: - The one-time rationale

    /// Whether the app should show its inline "bật nhắc nhở" explanation now.
    ///
    /// Called exactly once, right after the **first** successful device save —
    /// the moment the user has created something worth reminding about. Not at
    /// launch: the ads consent flow owns the launch prompts, and a reminder
    /// app that asks for notification permission before it has any reminders is
    /// asking for nothing.
    ///
    /// Returns `true` at most once per install: the flag is written here, when
    /// the rationale is offered, so a later device save never asks again. The
    /// Settings toggle remains the way to grant permission afterwards.
    public func offerPrimerAfterFirstSave() async -> Bool {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard NotificationPrimerRules.shouldOffer(
            permission: Self.permission(from: settings.authorizationStatus),
            alreadyOffered: primerOffered
        ) else { return false }
        primerOffered = true
        return true
    }

    private static func permission(from status: UNAuthorizationStatus) -> NotificationPermission {
        switch status {
        case .notDetermined: return .notDetermined
        case .denied: return .denied
        case .authorized, .provisional, .ephemeral: return .authorized
        // A status this build has never heard of is treated as decided. Never
        // prompt on an unknown system answer.
        @unknown default: return .denied
        }
    }

    // MARK: - Permission

    /// Prompt the user for notification permission (if not yet decided) and
    /// register on grant. Call this from a user-initiated toggle — or from the
    /// first-save rationale card, which is user-initiated by construction.
    public func requestAndRegister() async {
        // Do not put a third system prompt on top of UMP/ATT. Both ad phases
        // carry deadlines, so this wait is bounded; in practice the form save
        // happens long after the ads sequence has settled.
        await waitForAdsPromptsToClear()

        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()

        switch settings.authorizationStatus {
        case .denied:
            status = .denied
            return
        case .notDetermined:
            status = .requesting
            do {
                let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
                if !granted { status = .denied; return }
            } catch {
                status = .failed(error.localizedDescription)
                return
            }
        case .authorized, .provisional, .ephemeral:
            break
        @unknown default:
            break
        }

        await registerWithSystem()
    }

    /// Re-register silently if the user already granted permission previously.
    /// Never prompts. Safe to call on every authenticated launch.
    public func refreshIfAlreadyAuthorized() async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            await registerWithSystem()
        case .denied:
            status = .denied
        case .notDetermined:
            status = .unknown
        @unknown default:
            break
        }
    }

    private func registerWithSystem() async {
        status = .registering
#if canImport(UIKit)
        UIApplication.shared.registerForRemoteNotifications()
#else
        status = .failed(L.t("APNs chỉ hỗ trợ trên thiết bị iOS"))
#endif
    }

    /// Waits, bounded, for a Google consent prompt to leave the screen.
    ///
    /// Nothing is presented while one is up: the notification permission alert
    /// is a *third* system prompt, and stacking it on UMP's form or ATT is the
    /// class of bug this app has already paid for. `AdsController` bounds both
    /// phases with its own deadlines, so the wait cannot hang; the cap here is
    /// only a backstop for a stalled SDK.
    private func waitForAdsPromptsToClear() async {
        guard let adsPromptActive else { return }
        var waitedMilliseconds = 0
        while adsPromptActive() && waitedMilliseconds < 8_000 {
            try? await Task.sleep(nanoseconds: 200_000_000)
            waitedMilliseconds += 200
        }
    }

    /// Called by AppDelegate's didRegisterForRemoteNotificationsWithDeviceToken.
    public func handleDeviceToken(_ data: Data) {
        let token = data.map { String(format: "%02x", $0) }.joined()
        Task { await self.uploadToken(token) }
    }

    public func handleFailure(_ error: Error) {
        status = .failed(error.localizedDescription)
    }

    private func uploadToken(_ token: String) async {
        guard let client else {
            status = .failed(L.t("APIClient chưa sẵn sàng"))
            return
        }
        let ua: String?
#if canImport(UIKit)
        ua = "ios/\(UIDevice.current.systemVersion) \(UIDevice.current.model)"
#else
        ua = nil
#endif
        do {
            try await client.registerPush(NativePushInput(
                platform: .apns, token: token, userAgent: ua
            ))
            status = .registered
        } catch {
            status = .failed((error as? APIError)?.localizedDescription ?? error.localizedDescription)
        }
    }
}
