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

    /// The system's notification answer as last read, or `nil` before the app
    /// has read it.
    ///
    /// `status` is the *registration* lifecycle (requesting → registering →
    /// registered/failed); this is the system's own answer, which a failed
    /// upload cannot change. The two are deliberately separate: a device can be
    /// authorised yet not registered (the POST failed), and a device can be
    /// denied after it was registered (the user changed it in iOS Settings
    /// while the app was in the background).
    ///
    /// `nil` means "not read yet", never "not determined". Every screen that
    /// makes a claim about reminders waits for a real answer, so no surface can
    /// say notifications are off before iOS has actually been asked.
    @Published public private(set) var permission: NotificationPermission?

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

    /// UserDefaults key for the once-ever rationale flag. Written when the
    /// rationale is **answered** — "Để sau" or "Bật thông báo" — not when it is
    /// shown. A card the user never answered (the app was killed, or they
    /// swiped back) is therefore offered again on the next device save instead
    /// of being consumed silently.
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
    /// Called after every successful device create, but answers `true` only
    /// while the rationale is still owed — the moment the user owns something
    /// worth reminding about. Not at launch: the ads consent flow owns the
    /// launch prompts, and a reminder app that asks for notification permission
    /// before it has any reminders is asking for nothing.
    ///
    /// Returns `true` at most once per *answered* offer: an offer that was shown
    /// but never answered (the app was killed while the card was open) is not
    /// recorded here, so a later device save can offer it again. Declining is an
    /// answer and is recorded by `markPrimerAnswered()`, which is why a decline
    /// never asks again.
    public func offerPrimerAfterFirstSave() async -> Bool {
        let current = await readAuthorization()
        guard NotificationPrimerRules.shouldOffer(
            permission: current,
            alreadyOffered: primerOffered
        ) else { return false }
        return true
    }

    /// Records that the user answered the rationale.
    ///
    /// Called from both answers — "Bật thông báo" and "Để sau" — so the offer is
    /// consumed only once it has actually been answered. Merely showing it must
    /// not set the flag: that is what made an unanswered card disappear forever
    /// when the app was killed.
    public func markPrimerAnswered() {
        primerOffered = true
    }

    /// Reads the system answer and stores it. The single entry point for every
    /// read, so `permission` cannot drift from `UNAuthorizationStatus` at one
    /// call site while another keeps a stale copy.
    @discardableResult
    private func readAuthorization() async -> NotificationPermission {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        let current = Self.permission(from: settings.authorizationStatus)
        permission = current
        return current
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

        switch await readAuthorization() {
        case .denied:
            status = .denied
            return
        case .notDetermined:
            status = .requesting
            do {
                let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
                // The prompt's return value is the answer; re-reading here would
                // race the system's own write. If the call threw, `permission`
                // stays at the `.notDetermined` read above and the retry row
                // will ask again.
                permission = granted ? .authorized : .denied
                if !granted { status = .denied; return }
            } catch {
                status = .failed(error.localizedDescription)
                return
            }
        case .authorized:
            break
        }

        await registerWithSystem()
    }

    /// Re-read the system answer without prompting. When permission is on but
    /// this install has no successful registration yet — the user just granted
    /// it in iOS Settings, or the last attempt failed — it registers again. An
    /// already-registered device is left alone: this runs whenever Settings is
    /// opened or the app returns to the foreground, and re-uploading the token
    /// each time would be noise.
    public func refreshPermission() async {
        switch await readAuthorization() {
        case .authorized:
            switch status {
            case .registered, .registering, .requesting:
                break
            case .unknown, .denied, .failed:
                await registerWithSystem()
            }
        case .denied:
            status = .denied
        case .notDetermined:
            status = .unknown
        }
    }

    /// Re-register silently if the user already granted permission previously.
    /// Never prompts. Safe to call on every authenticated launch.
    public func refreshIfAlreadyAuthorized() async {
        switch await readAuthorization() {
        case .authorized:
            await registerWithSystem()
        case .denied:
            status = .denied
        case .notDetermined:
            status = .unknown
        }
    }

    // MARK: - Getting back to the system

    /// Opens this app's page in iOS Settings.
    ///
    /// The only way back for a `.denied` notification decision: the system
    /// prompt is offered once and `requestAuthorization` never shows it again.
    /// This is the same `openSettingsURLString` path the camera permission uses
    /// in `DeviceFormView`; before this, the Settings row named the destination
    /// but called `requestAndRegister`, which returns immediately when denied —
    /// so the one advertised recovery did nothing at all.
    public func openSystemSettings() {
#if canImport(UIKit)
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
#endif
    }

    /// A quiet, honest sentence for a screen that is showing a deadline, or
    /// `nil` when reminders can reach the user.
    ///
    /// Deliberately not an error: the warranty data is still correct and the
    /// deadline is still shown. It states the delivery fact the countdown
    /// cannot state itself. `.authorized` returns `nil` even when registration
    /// failed — an old token may still be delivering, so the app cannot claim
    /// it cannot reach the user.
    public var reminderReachabilityNote: String? {
        switch permission {
        case .denied:
            return L.t("Thông báo đang tắt nên Warrly không thể nhắc bạn trước khi hết hạn. Bật lại trong Cài đặt iOS.")
        case .notDetermined:
            return L.t("Chưa bật thông báo nên Warrly chưa thể nhắc bạn trước khi hết hạn. Bật trong Cài đặt.")
        case .authorized, .none:
            return nil
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
