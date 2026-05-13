import SwiftUI

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

struct MainTabView: View {
    @EnvironmentObject var auth: AuthStore

    var body: some View {
        TabView {
            DevicesListView(client: auth.client)
                .tabItem { Label("Thiết bị", systemImage: "square.stack.3d.up.fill") }

            RemindersView(client: auth.client)
                .tabItem { Label("Nhắc", systemImage: "bell.badge.fill") }

            SubscriptionsListView(client: auth.client)
                .tabItem { Label("Đăng ký", systemImage: "creditcard.fill") }

            WishlistListView(client: auth.client)
                .tabItem { Label("Thèm", systemImage: "heart.fill") }

            StatsView(client: auth.client)
                .tabItem { Label("Thống kê", systemImage: "chart.bar.fill") }

            SettingsView(client: auth.client)
                .tabItem { Label("Cài đặt", systemImage: "gearshape.fill") }
        }
        .tint(WV.Tokens.primary)
    }
}

