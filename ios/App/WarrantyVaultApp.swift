import SwiftUI

@main
struct WarrantyVaultApp: App {
    @StateObject private var auth: AuthStore
    @StateObject private var push = PushRegistrar.shared
    @StateObject private var theme = ThemeStore()
    @StateObject private var catalog: CatalogStore

    init() {
        let authStore = AuthStore(baseURL: AppConfig.baseURL)
        _auth = StateObject(wrappedValue: authStore)
        _catalog = StateObject(wrappedValue: CatalogStore(client: authStore.client))
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
                .preferredColorScheme(theme.preference.colorScheme)
                .task(id: authIdentity) {
                    // Wire APIClient into the push registrar whenever the
                    // authenticated identity changes. Don't auto-prompt for
                    // permission here — Settings has the explicit toggle.
                    push.configure(client: auth.client)
                    if case .authenticated = auth.status {
                        // Eagerly preload the catalog and re-register push if
                        // the user already granted permission previously.
                        await catalog.loadIfNeeded()
                        await push.refreshIfAlreadyAuthorized()
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
    /// Where the Next.js backend lives.
    /// - Simulator: localhost works because the simulator shares the host's loopback.
    /// - Real device on the same Wi-Fi: replace with your Mac's LAN IP, e.g.
    ///   "http://192.168.1.17:3000". Run `npm run dev -- -H 0.0.0.0` on the
    ///   Mac so it binds outside loopback.
    /// - Production: set to https://yourdomain.com (must be HTTPS for ATS).
    static let baseURL: URL = {
        if let envURL = ProcessInfo.processInfo.environment["WV_BASE_URL"],
           let url = URL(string: envURL) {
            return url
        }
        return URL(string: "http://localhost:3000")!
    }()
}
