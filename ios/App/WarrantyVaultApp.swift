import SwiftUI
import WarrantyVaultKit

@main
struct WarrantyVaultApp: App {
    @StateObject private var auth: AuthStore
    @StateObject private var push = PushRegistrar.shared
    @StateObject private var theme = ThemeStore()
    @StateObject private var catalog: CatalogStore
    @StateObject private var toasts = WVToastCenter()
    /// Face ID / Touch ID app lock. Off unless the user turns it on in Hồ sơ.
    @StateObject private var appLock = AppLockStore()
    /// Which language the app renders in — and what `Accept-Language` carries.
    @StateObject private var localization: LocalizationStore

    init() {
        let authStore = AuthStore(baseURL: AppConfig.baseURL)
        _auth = StateObject(wrappedValue: authStore)
        _catalog = StateObject(wrappedValue: CatalogStore(client: authStore.client))
        _localization = StateObject(wrappedValue: LocalizationStore(client: authStore.client))
    }
#if canImport(UIKit)
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
#endif

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(auth)
                .environmentObject(push)
                .environmentObject(theme)
                .environmentObject(catalog)
                .environmentObject(toasts)
                .environmentObject(appLock)
                .environmentObject(localization)
                .wvToastHost(toasts)
                .preferredColorScheme(theme.preference.colorScheme)
                // `L.t(...)` is a plain function call, so SwiftUI cannot see
                // that a view depends on the selected language. Rebuilding the
                // tree on a switch is what makes every label follow — and it
                // also drops any half-filled form, which is the honest thing to
                // do when the copy under the user's cursor changes language.
                .id(localization.language)
                .task(id: authIdentity) {
                    // Wire APIClient into the push registrar whenever the
                    // authenticated identity changes. Don't auto-prompt for
                    // permission here — Settings has the explicit toggle.
                    push.configure(client: auth.client)
                    switch auth.status {
                    case .authenticated(let user):
                        // The account's stored language wins over the device's:
                        // it is the one the server uses for push and email.
                        localization.adopt(user: user)
                        // Eagerly preload the catalog and re-register push if
                        // the user already granted permission previously.
                        await catalog.loadIfNeeded()
                        await push.refreshIfAlreadyAuthorized()
                    case .unauthenticated:
                        // Never let the next account on this device inherit a
                        // language it did not choose.
                        localization.reset()
                    case .idle:
                        break
                    }
                }
        }
    }

    /// Stable identity for `.task(id:)` — only re-runs on auth status changes,
    /// not on every view update.
    private var authIdentity: String {
        switch auth.status {
        case .idle: return "idle"
        case .unauthenticated: return "anon"
        case .authenticated(let u): return u.id
        }
    }
}

enum AppConfig {
    /// Where the Go API backend lives (api/cmd/server, port 4000).
    /// Mobile clients hit Go directly — the Next.js website no longer serves
    /// /api/v1/*.
    /// - Simulator: localhost works because the simulator shares the host's loopback.
    /// - Real device on the same Wi-Fi: replace with your Mac's LAN IP, e.g.
    ///   "http://192.168.1.17:4000". Run `go run ./cmd/server` on the Mac.
    /// - Production: set to https://yourdomain.com (must be HTTPS for ATS).
    static let baseURL: URL = {
        if let envURL = ProcessInfo.processInfo.environment["WV_BASE_URL"],
           let url = URL(string: envURL) {
            return url
        }
        return URL(string: "http://localhost:4000")!
    }()
}
