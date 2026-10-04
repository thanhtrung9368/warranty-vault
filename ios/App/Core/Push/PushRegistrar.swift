import Foundation
#if canImport(UIKit)
import UIKit
#endif
import UserNotifications
import WarrantyVaultKit

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
    private init() {}

    public func configure(client: APIClient) {
        self.client = client
    }

    /// Prompt the user for notification permission (if not yet decided) and
    /// register on grant. Call this from a user-initiated toggle.
    public func requestAndRegister() async {
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
