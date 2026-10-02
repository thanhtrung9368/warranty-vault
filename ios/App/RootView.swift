import SwiftUI
import WarrantyVaultKit

/// Auth gate. Mirrors the prototype: an authenticated user lands on the
/// 5-tab shell; otherwise the login flow.
///
/// Also the app-lock gate: when the "Face ID & Touch ID" switch is on, a
/// full-screen cover sits above whatever the gate produced until the user
/// authenticates. The cover is only rendered for an authenticated session —
/// there is nothing to protect on the login screen.
struct RootView: View {
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject var appLock: AppLockStore
    @Environment(\.scenePhase) private var scenePhase

    private var isAuthenticated: Bool {
        if case .authenticated = auth.status { return true }
        return false
    }

    var body: some View {
        ZStack {
            content
            if isAuthenticated && appLock.isLocked {
                AppLockScreen()
                    .transition(.opacity)
                    .zIndex(1)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                // Lock on the way out. `.background` only — `.inactive` also
                // fires for the app switcher, Control Center and system alerts,
                // and locking there would prompt Face ID mid-gesture.
                appLock.handleEnterBackground()
            case .active:
                // Capabilities can change while we're away (Face ID removed,
                // passcode deleted). Cheap, never prompts.
                if isAuthenticated {
                    Task { await appLock.handleForeground() }
                } else {
                    appLock.refreshAvailability()
                }
            default:
                break
            }
        }
        .onChange(of: isAuthenticated) { _, nowAuthenticated in
            // Signing out clears the session, so drop the lock with it; the next
            // launch re-locks from the stored preference.
            if !nowAuthenticated { appLock.clearLock() }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch auth.status {
        case .idle:
            ProgressView()
                .task { await auth.bootstrap() }
        case .unauthenticated:
            LoginView()
        case .authenticated:
            MainTabView()
        }
    }
}

// MARK: - App lock screen

/// Full-screen cover shown while the app lock is engaged.
///
/// Unlocking evaluates `.deviceOwnerAuthentication`, i.e. Face ID/Touch ID with
/// the device passcode as fallback, so a failed or unavailable sensor degrades
/// to the passcode instead of locking the user out. "Đăng xuất" is the escape
/// hatch of last resort: it clears the Keychain session, and the account can
/// always be reached again with email + password.
struct AppLockScreen: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var appLock: AppLockStore
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            WVColor.bg.ignoresSafeArea()

            VStack(spacing: 12) {
                Image(systemName: "lock.shield.fill")
                    .font(.system(size: 52))
                    .foregroundStyle(WVColor.tint)
                    .padding(.bottom, 4)

                Text("WarrantyVault đang khoá")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(WVColor.label)

                Text("Mở khoá bằng \(appLock.availability.biometry.label) hoặc mã mở khoá của thiết bị để xem dữ liệu bảo hành.")
                    .font(.system(size: 15))
                    .foregroundStyle(WVColor.label3)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, WVSpacing.gutter)

                if appLock.isAuthenticating {
                    ProgressView()
                        .padding(.top, 10)
                } else {
                    WVButton("Mở khoá", icon: "faceid", fullWidth: false) {
                        Task { await appLock.unlock() }
                    }
                    .padding(.top, 10)
                }

                if let error = appLock.lastError {
                    Text(error)
                        .font(.system(size: 14))
                        .foregroundStyle(WVColor.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, WVSpacing.gutter)
                }

                Button {
                    Task {
                        await auth.logout()
                        appLock.clearLock()
                    }
                } label: {
                    Text("Đăng xuất")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(WVColor.tint)
                }
                .padding(.top, 6)

                Text("Nếu không mở khoá được, hãy đăng xuất rồi đăng nhập lại bằng email và mật khẩu.")
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.label4)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, WVSpacing.gutter)
            }
            .padding(.vertical, 24)
        }
        .task {
            // Cold launch with the lock on: prompt as soon as the cover is up —
            // but only while the scene is interactive, never from the
            // background (where the system sheet has nowhere to appear).
            if scenePhase == .active {
                await appLock.unlock()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            // Coming back to the foreground while still locked re-prompts.
            // `unlock()` ignores calls while a prompt is already on screen.
            if phase == .active {
                Task { await appLock.unlock() }
            }
        }
    }
}

/// The five-tab shell from `project/ios/js/app.jsx`:
/// Tổng quan · Thiết bị · Đăng ký · Wishlist · Thêm.
///
/// Each tab owns its own `NavigationStack`; per-tab push navigation lives
/// inside the feature screens.
struct MainTabView: View {
    @EnvironmentObject var auth: AuthStore
    @State private var selection: Int = MainTabView.initialTab

    /// In DEBUG, `WV_QA_TAB` (0–4) picks the launch tab for screenshot QA.
    private static var initialTab: Int {
#if DEBUG
        if let raw = ProcessInfo.processInfo.environment["WV_QA_TAB"],
           let n = Int(raw), (0...4).contains(n) {
            return n
        }
#endif
        return 0
    }

    var body: some View {
        TabView(selection: $selection) {
            NavigationStack {
                DashboardView(client: auth.client)
            }
            .tabItem { Label("Tổng quan", systemImage: "house.fill") }
            .tag(0)

            NavigationStack {
                DevicesScreen(client: auth.client)
            }
            .tabItem { Label("Thiết bị", systemImage: "shippingbox.fill") }
            .tag(1)

            NavigationStack {
                SubscriptionsScreen(client: auth.client)
            }
            .tabItem { Label("Đăng ký", systemImage: "arrow.triangle.2.circlepath") }
            .tag(2)

            NavigationStack {
                WishlistScreen(client: auth.client)
            }
            .tabItem { Label("Wishlist", systemImage: "heart.fill") }
            .tag(3)

            NavigationStack {
                MoreScreen(client: auth.client)
            }
            .tabItem { Label("Thêm", systemImage: "ellipsis") }
            .tag(4)
        }
        .tint(WVColor.tint)
    }
}
