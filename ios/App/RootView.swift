import CoreSpotlight
import SwiftUI
import WarrlyKit

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
    @EnvironmentObject var router: AppRouter
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
                // An App Intent can queue a device while the app is suspended;
                // pick it up on every activation, authenticated or not (the id
                // waits in the router until the devices screen exists).
                router.restorePendingFromSharedDefaults()
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
        .onOpenURL { url in
            router.open(url)
        }
        .onContinueUserActivity(CSSearchableItemActionType) { activity in
            // A Spotlight hit carries the item's unique identifier, not a URL.
            // The prefix is what makes it ours; the rest is the device id.
            guard let identifier = activity.userInfo?[CSSearchableItemActivityIdentifier]
                    as? String,
                  let deviceId = DeviceSpotlightRules.deviceId(fromIdentifier: identifier)
            else { return }
            router.openDevice(id: deviceId)
        }
        .task {
            // Cold launch from a Spotlight hit or an App Intent: the id may
            // already be in the App Group before this view exists.
            router.restorePendingFromSharedDefaults()
        }
        .onChange(of: auth.status) { _, status in
            guard case .unauthenticated = status else { return }
            // Signing out (or bootstrap discovering a dead token) must drop
            // every out-of-app surface, including a destination queued before
            // the app knew who was signed in.
            appLock.clearLock()
            router.clear()
            // A widget and a Spotlight index are readable outside the app.
            // Neither may keep the previous account's device names.
            Task { await DeadlineSurface.shared.clear() }
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
            MainTabView(client: auth.client)
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

                Text(L.t("Warrly đang khoá"))
                    .wvFont(.title2Emphasis)
                    .foregroundStyle(WVColor.label)

                Text(L.t("Mở khoá bằng %@ hoặc mã mở khoá của thiết bị để xem dữ liệu bảo hành.",
                         appLock.availability.biometry.label))
                    .wvFont(.subheadline)
                    .foregroundStyle(WVColor.label3)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, WVSpacing.gutter)

                if appLock.isAuthenticating {
                    ProgressView()
                        .padding(.top, 10)
                } else {
                    WVButton(L.t("Mở khoá"), icon: "faceid", fullWidth: false) {
                        Task { await appLock.unlock() }
                    }
                    .padding(.top, 10)
                }

                if let error = appLock.lastError {
                    Text(error)
                        .wvFont(.subheadline)
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
                    Text(L.t("Đăng xuất"))
                        .wvFont(.calloutEmphasis)
                        .foregroundStyle(WVColor.tint)
                }
                .padding(.top, 6)

                Text(L.t("Nếu không mở khoá được, hãy đăng xuất rồi đăng nhập lại bằng email và mật khẩu."))
                    .wvFont(.footnote)
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
    let client: APIClient

    /// The account's inbox, shared by the "Thêm" tab badge, the inbox screen and
    /// the Devices capture flow. Filing/deleting an item mutates this one
    /// object, so no tab is left showing a stale count.
    @StateObject private var inboxStore: InboxStore

    @State private var selection: Int = MainTabView.initialTab
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var router: AppRouter
    /// AdMob consent + banner state. Started from this shell, not from app
    /// launch: the prompts belong to the signed-in experience (the banner's only
    /// surface needs a device list), and ATT cannot prompt before a scene exists.
    @EnvironmentObject private var ads: AdsController

    init(client: APIClient) {
        self.client = client
        _inboxStore = StateObject(wrappedValue: InboxStore(client: client))
    }

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
                DashboardView(client: client)
            }
            .tabItem { Label(L.t("Tổng quan"), systemImage: "house.fill") }
            .tag(0)

            NavigationStack {
                DevicesScreen(client: client)
            }
            .tabItem { Label(L.t("Thiết bị"), systemImage: "shippingbox.fill") }
            .tag(1)

            NavigationStack {
                SubscriptionsScreen(client: client)
            }
            .tabItem { Label(L.t("Đăng ký"), systemImage: "arrow.triangle.2.circlepath") }
            .tag(2)

            NavigationStack {
                WishlistScreen(client: client)
            }
            .tabItem { Label("Wishlist", systemImage: "heart.fill") }
            .tag(3)

            NavigationStack {
                MoreScreen(client: client)
            }
            .tabItem { Label(L.t("Thêm"), systemImage: "ellipsis") }
            // Server inbox plus files still in the Share Extension queue: a
            // shared receipt that has not uploaded yet is still waiting for the
            // user, and a failed drain must not make the badge claim "0".
            .badge(inboxStore.count + inboxStore.pendingSharedCount)
            .tag(4)
        }
        .tint(WVColor.tint)
        .environmentObject(inboxStore)
        // One launch read feeds every badge. The inbox screen refreshes it on
        // appear and after every filing.
        //
        // The Share Extension cannot assume the app is running, so it leaves
        // files in the App Group queue; this is the first point where the app
        // has an authenticated client, and therefore the first point where they
        // can be uploaded (device-less, straight into the inbox).
        .task {
            // A pending destination from Spotlight / a URL / an App Intent /
            // a tapped push wins over the default tab; the target screen
            // consumes the id once it can push.
            router.restorePendingFromSharedDefaults()
            if router.pendingDeviceId != nil {
                selection = 1
            } else if router.pendingSubscriptionId != nil {
                selection = 2
            } else if router.pendingWishlistId != nil {
                selection = 3
            }
            DeadlineSurface.shared.beginSession()
            // First authenticated surface fill: the widget and Spotlight have
            // no data until this runs at least once. Start it alongside the
            // inbox drain so a large shared receipt cannot delay the widget.
            Task { await DeadlineSurface.shared.refresh(client: client) }
            // Ads: UMP → ATT → MobileAds.start. Fires once per signed-in
            // session; every later call only advances a phase that is already
            // half-way through (and a prompt that was missed is retried on the
            // next foreground, which is the fix for Apple reject 2.1).
            ads.start()
            await inboxStore.importSharedFiles()
            await inboxStore.load()
        }
        // Coming back to the foreground is the other retry point: the user may
        // have shared a file while the app sat in the background, and the
        // deadlines may have changed on another device.
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            router.restorePendingFromSharedDefaults()
            if router.pendingDeviceId != nil {
                selection = 1
            } else if router.pendingSubscriptionId != nil {
                selection = 2
            } else if router.pendingWishlistId != nil {
                selection = 3
            }
            DeadlineSurface.shared.beginSession()
            // ATT is retried on EVERY foreground rather than once per install:
            // if the prompt was swallowed by a background transition, or the
            // SDK started on the tracking deadline, this is what recovers it.
            ads.start()
            Task {
                await inboxStore.importSharedFiles()
                await inboxStore.load()
            }
            Task {
                await DeadlineSurface.shared.refresh(client: client)
            }
        }
        .onChange(of: router.pendingDeviceId) { _, id in
            // The app may already be showing this tab; switching is enough for
            // DevicesScreen's own onChange/task to push the detail view.
            if id != nil { selection = 1 }
        }
        .onChange(of: router.pendingSubscriptionId) { _, id in
            // Same rule for a subscription-renewal notification: bring the
            // "Đăng ký" tab forward and let its screen push the detail.
            if id != nil { selection = 2 }
        }
        .onChange(of: router.pendingWishlistId) { _, id in
            // And for a wishlist target-date / check-in notification: bring the
            // "Wishlist" tab forward and let its screen push the detail.
            if id != nil { selection = 3 }
        }
    }
}
