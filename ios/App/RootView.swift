import SwiftUI

/// Auth gate. Mirrors the prototype: an authenticated user lands on the
/// 5-tab shell; otherwise the login flow.
struct RootView: View {
    @EnvironmentObject var auth: AuthStore

    var body: some View {
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
