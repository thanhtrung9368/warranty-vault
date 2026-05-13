#if canImport(UIKit)
import UIKit
import UserNotifications

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Show banners + sounds while the app is foreground.
        UNUserNotificationCenter.current().delegate = WVNotificationDelegate.shared
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in
            PushRegistrar.shared.handleDeviceToken(deviceToken)
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in
            PushRegistrar.shared.handleFailure(error)
        }
    }
}

/// Handles notification presentation while the app is foreground.
/// Default iOS behaviour suppresses banners in foreground; we want to show them
/// (warranty / subscription / wishlist alerts are time-sensitive).
final class WVNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = WVNotificationDelegate()

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .list])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        // No-op — default tap behaviour brings the app foreground.
        completionHandler()
    }
}
#endif
