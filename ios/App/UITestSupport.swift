import Foundation
import WarrlyKit

// MARK: - UI-test launch support

/// Everything the app does differently when the `WarrlyUITests` bundle launched
/// it. The gate is a single launch argument, `-ui-testing`, which a shipped
/// build never has: TestFlight and App Store launches get the production
/// behaviour because none of this is active without that argument.
///
/// The app target owns this, not WarrlyKit: the extensions share the library and
/// must never grow a test-only launch path.
enum UITestSupport {

    /// Passed by `WarrlyUITests` through `XCUIApplication.launchArguments`
    /// (and documented in `ios/UITests/README.md`).
    static let launchArgument = "-ui-testing"

    /// True only for the process the test runner launched.
    static var isEnabled: Bool {
        ProcessInfo.processInfo.arguments.contains(launchArgument)
    }

    /// `WV_API_BASE_URL` for the UI-test mock server, or `nil` on a normal
    /// launch. The caller (`AppConfig.baseURL`) hands this to
    /// `BaseURLResolver.resolve(uiTestingValue:)`; the key is never read
    /// outside a UI-test launch.
    static var baseURLOverride: String? {
        guard isEnabled else { return nil }
        let raw = ProcessInfo.processInfo.environment[
            BaseURLResolver.uiTestingEnvironmentKey
        ]?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (raw?.isEmpty == false) ? raw : nil
    }

    /// Clears the state a previous launch (or a previous test run) persisted, so
    /// every run starts from the same place: the login screen, the account's
    /// language unset, the app lock off and no leftover ads consent.
    ///
    /// Must run **before** any store is constructed. `WarrlyApp` calls it from
    /// its first stored property; Swift initialises stored properties in
    /// declaration order, so `AuthStore`, `AppLockStore`, `LocalizationStore`
    /// and `AdsController` all read the cleaned defaults.
    ///
    /// A UI-test run is allowed to point at a throwaway mock and to be
    /// repeatable; it is never allowed to see the previous run's session or
    /// the production account's persisted state.
    @discardableResult
    static func resetIfNeeded() -> Bool {
        guard isEnabled else { return false }

        // The bearer token is the session. Clearing it is what makes the smoke
        // test land on the login screen instead of being signed straight in by
        // the token the last run stored.
        KeychainStore().clear()

        // One domain removal covers every persisted preference: the remembered
        // login email, the language choice (`wv.selectedLanguage`), the app
        // lock switch, the ads-consent answer and the Premium ad-free flag.
        if let bundleID = Bundle.main.bundleIdentifier {
            UserDefaults.standard.removePersistentDomain(forName: bundleID)
        }

        // The App Group is shared with the widget and the Share Extension. A
        // pending Control Center capture flag left by a manual run would
        // otherwise surface on top of the first test.
        if let shared = UserDefaults(suiteName: SharedInbox.appGroupIdentifier) {
            shared.removePersistentDomain(forName: SharedInbox.appGroupIdentifier)
        }
        // Files shared into Warrly before the run would otherwise be uploaded
        // to the mock on the first signed-in screen. They belong to a person,
        // not to the test, so a test launch starts with an empty queue.
        if let inbox = SharedInboxStore() {
            for item in inbox.pendingItems() {
                inbox.remove(item)
            }
        }
        return true
    }
}
