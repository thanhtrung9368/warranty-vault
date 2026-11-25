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

    /// Presented only when the Control Center control asked for capture AND
    /// this view can prove the two gates are open: an authenticated session
    /// (the upload needs a bearer token) and a down App Lock cover. The pending
    /// request stays in `router` while either gate is closed.
    @State private var showsCaptureSheet = false

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
        // The one place the window width is measured. Every screen and every
        // sheet below this view reads the resulting tier from the environment
        // (`WVWindowTier`), on the Duo's 382 pt cover panel and on its unfolded
        // 669 pt inner display alike. Measuring at the root rather than per
        // screen is what keeps the tiers consistent: a fold changes the window,
        // not the screen.
        .wvWindowTierReader()
        .sheet(isPresented: $showsCaptureSheet) {
            // `startWithCamera: true` is the whole point of the control: land
            // on the camera, not on a list of ways to pick a file. The sheet
            // still offers Photos/PDF, and explains a denied camera permission
            // with a way into Settings.
            InboxCaptureSheet(
                client: auth.client,
                onUploaded: { _ in
                    // The tab shell owns the inbox badge and is not this
                    // view's child, so announce the new row. Without this the
                    // count would stay stale until the next foreground.
                    NotificationCenter.default.post(name: .warrlyInboxChanged, object: nil)
                },
                startWithCamera: true
            )
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                // Lock on the way out. `.background` only — `.inactive` also
                // fires for the app switcher, Control Center and system alerts,
                // and locking there would prompt Face ID mid-gesture.
                appLock.handleEnterBackground()
            case .active:
                // An App Intent can queue a device (or the Control Center
                // control a capture) while the app is suspended; pick it up on
                // every activation, authenticated or not (the request waits in
                // the router until it can be presented).
                router.restorePendingFromSharedDefaults()
                presentPendingCaptureIfPossible()
                // Capabilities can change while we're away (Face ID removed,
                // passcode deleted). Cheap, never prompts.
                if isAuthenticated {
                    // Deliberately NOT an auto-prompt. `handleForeground` used to
                    // call `unlock()` here, which fires on every `.active` — and a
                    // cancelled Face ID sheet returns the app to `.active`, so
                    // cancelling re-opened the prompt immediately and the only way
                    // out was the password path. The cover still re-locks on
                    // backgrounding; it is now unlocked by a tap or by the `.task`
                    // that runs when the cover first appears.
                    appLock.handleForegroundWithoutPrompt()
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
            presentPendingCaptureIfPossible()
        }
        // The control can land while the app is already running, while the
        // session is still bootstrapping, or while the App Lock cover is up.
        // Each of those has its own trigger; the flag is only consumed once all
        // gates are open.
        .onChange(of: router.pendingCapture) { _, _ in
            presentPendingCaptureIfPossible()
        }
        .onChange(of: appLock.isLocked) { _, locked in
            if locked {
                // SwiftUI sheets sit above the lock cover, so a capture sheet
                // left open when the app backgrounds would be readable over the
                // lock screen. Close it as the cover comes up.
                showsCaptureSheet = false
            } else {
                presentPendingCaptureIfPossible()
            }
        }
        .onChange(of: auth.status) { _, status in
            if case .authenticated = status {
                presentPendingCaptureIfPossible()
                return
            }
            guard case .unauthenticated = status else { return }
            // Signing out (or bootstrap discovering a dead token) must drop
            // every out-of-app surface, including a destination queued before
            // the app knew who was signed in.
            appLock.clearLock()
            router.clear()
            showsCaptureSheet = false
            // A widget and a Spotlight index are readable outside the app.
            // Neither may keep the previous account's device names.
            Task { await DeadlineSurface.shared.clear() }
        }
    }

    /// Opens the capture sheet for a pending Control Center request **only**
    /// behind both gates: an authenticated session and a down App Lock cover.
    /// Consuming the flag here (not on dismissal) means a presentation cannot
    /// race a second trigger into two sheets.
    private func presentPendingCaptureIfPossible() {
        guard router.pendingCapture, isAuthenticated, !appLock.isLocked else { return }
        router.consumeCapture()
        showsCaptureSheet = true
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
/// The first action is the sensor: `.deviceOwnerAuthentication`, i.e. Face
/// ID/Touch ID with the device passcode as fallback, so a failed or unavailable
/// sensor degrades to the passcode. `Dùng mật khẩu` is the second action: it
/// reveals the **account** password field inline, and the answer comes from the
/// API — the app holds no hash and compares nothing locally. `Đăng xuất` is the
/// last resort below both: it clears the Keychain session, and the account can
/// always be reached again with email + password.
struct AppLockScreen: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var appLock: AppLockStore
    @Environment(\.scenePhase) private var scenePhase

    /// The password fallback stays closed until the user asks for it, so the
    /// screen still leads with the one-tap path.
    @State private var showsPasswordEntry = false
    /// Held in view state only. Never written to the Keychain, `UserDefaults` or
    /// a log; cleared on success, when the user goes back to the sensor, and
    /// when the app is suspended.
    @State private var password = ""
    @FocusState private var passwordFocused: Bool

    var body: some View {
        ZStack {
            WVColor.bg.ignoresSafeArea()

            GeometryReader { proxy in
                ScrollView {
                    VStack(spacing: WVSpacing.md) {
                        Image(systemName: "lock.shield.fill")
                            .font(.system(size: 52))
                            .foregroundStyle(WVColor.tint)
                            .padding(.bottom, WVSpacing.xs)

                        Text(L.t("Warrly đang khoá"))
                            .wvFont(.title2Emphasis)
                            .foregroundStyle(WVColor.label)

                        Text(L.t("Mở khoá bằng %@, mã mở khoá thiết bị, hoặc mật khẩu tài khoản để xem dữ liệu bảo hành.",
                                 appLock.availability.biometry.label))
                            .wvFont(.subheadline)
                            .foregroundStyle(WVColor.label3)
                            .multilineTextAlignment(.center)

                        unlockSection

                        signOut
                    }
                    .padding(.horizontal, WVSpacing.gutter)
                    .padding(.vertical, WVSpacing.xl)
                    .frame(maxWidth: 480)
                    .frame(minHeight: proxy.size.height)
                    .frame(maxWidth: .infinity)
                }
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .task { await promptOnAppear() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background {
                // A typed secret must not sit in memory while the app is
                // suspended; the field comes back empty.
                password = ""
            }
            // No auto-prompt on `.active` — see the note in RootView. A cancelled
            // sheet returns here, and re-opening it made the cover impossible to
            // dismiss except through the password path. `[Mở khoá]` is one tap.
        }
    }

    // MARK: Pieces

    @ViewBuilder
    private var unlockSection: some View {
        if showsPasswordEntry {
            passwordForm
        } else {
            sensorAction
        }
    }

    /// The one-tap path, plus the quieter way to the password field.
    private var sensorAction: some View {
        VStack(spacing: WVSpacing.md) {
            if appLock.isAuthenticating {
                ProgressView()
                    .padding(.vertical, WVSpacing.md)
            } else {
                WVButton(L.t("Mở khoá"), icon: "unlock", fullWidth: false) {
                    Task { await appLock.unlock() }
                }
            }

            if let error = appLock.lastError {
                Text(error)
                    .wvFont(.subheadline)
                    .foregroundStyle(WVColor.red)
                    .multilineTextAlignment(.center)
            }

            WVButton(L.t("Dùng mật khẩu"), kind: .secondary, fullWidth: false) {
                revealPasswordEntry()
            }
        }
        .padding(.top, WVSpacing.xs)
    }

    /// The inline password entry. Submitting hands the typed value to the auth
    /// store, which checks it against `POST /api/v1/auth/login`; nothing here
    /// decides on its own whether the password is right.
    private var passwordForm: some View {
        VStack(alignment: .leading, spacing: WVSpacing.md) {
            VStack(alignment: .leading, spacing: WVSpacing.sm) {
                Text(L.t("Mật khẩu tài khoản"))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)

                WVPasswordField(
                    placeholder: L.t("Mật khẩu"),
                    text: $password,
                    submitLabel: .go,
                    focus: $passwordFocused,
                    onSubmit: { Task { await submitPassword() } }
                )
                .wvFont(.body)
                .foregroundStyle(WVColor.label)
                .padding(.leading, WVSpacing.gutter)
                .padding(.vertical, WVSpacing.xs)
                .frame(minHeight: 52)
                .background(WVColor.bg2)
                .clipShape(RoundedRectangle(cornerRadius: WVRadius.list, style: .continuous))
            }

            if let error = appLock.passwordError {
                HStack(alignment: .top, spacing: WVSpacing.sm) {
                    WVIcon("alert", size: 13)
                    Text(error)
                        .wvFont(.footnote)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(WVColor.red)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            WVButton(appLock.isVerifyingPassword ? L.t("Đang kiểm tra…") : L.t("Mở khoá"),
                     kind: .primary, minHeight: 52) {
                Task { await submitPassword() }
            }
            .disabled(appLock.isVerifyingPassword || password.isEmpty)

            WVButton(useSensorTitle, kind: .secondary, fullWidth: false) {
                goBackToSensor()
            }
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .padding(.top, WVSpacing.xs)
    }

    /// The escape hatch of last resort, and deliberately the quietest thing on
    /// the screen: plain `label3` text, no tint, below both unlock paths.
    private var signOut: some View {
        Button {
            Task {
                await auth.logout()
                appLock.clearLock()
            }
        } label: {
            Text(L.t("Đăng xuất"))
                .wvFont(.callout)
                .foregroundStyle(WVColor.label3)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.top, WVSpacing.xs)
    }

    /// The way back to the sensor. When the sensor is gone entirely (removed
    /// after the lock was enabled) the same prompt is the device passcode, and
    /// that is what the label names.
    private var useSensorTitle: String {
        let kind = appLock.availability.biometry
        return kind == .none ? L.t("Dùng mã mở khoá") : L.t("Dùng %@", kind.label)
    }

    // MARK: Actions

    private func revealPasswordEntry(focus: Bool = true) {
        password = ""
        showsPasswordEntry = true
        guard focus else { return }
        // The field is inserted in this update; put the caret in it on the next
        // run-loop (the same reason `WVPasswordField` re-focuses after its
        // reveal).
        DispatchQueue.main.async { passwordFocused = true }
    }

    private func goBackToSensor() {
        password = ""
        passwordFocused = false
        showsPasswordEntry = false
        Task { await appLock.unlock() }
    }

    private func submitPassword() async {
        guard !password.isEmpty, !appLock.isVerifyingPassword else { return }
        await appLock.unlock(password: password) { candidate in
            try await auth.verifyAccountPassword(candidate)
        }
        if !appLock.isLocked {
            password = ""
        } else {
            // A failed check is read with the keyboard down: the message and the
            // two ways out must all be on screen, and the keyboard would sit on
            // top of `Đăng xuất`. Tapping the field brings it back for a retry.
            passwordFocused = false
        }
    }

    /// Cold launch with the lock on: prompt as soon as the cover is up — but
    /// only while the scene is interactive, never from the background (where the
    /// system sheet has nowhere to appear).
    private func promptOnAppear() async {
        #if DEBUG
        // Screenshot QA only: a headless simulator cannot tap, so the second
        // action is opened from the environment instead. `1` leaves the cover in
        // its default state, `password` opens the field, and `submit` presses the
        // CTA with `WV_QA_APP_LOCK_PASSWORD` — a deliberately wrong one when the
        // variable is absent — so the failure copy in a shot is the server's real
        // answer rather than a mock.
        if let qa = Self.qaScreenshot {
            guard qa == "password" || qa == "submit" else { return }
            revealPasswordEntry(focus: qa == "password")
            if qa == "submit" {
                let supplied = ProcessInfo.processInfo.environment["WV_QA_APP_LOCK_PASSWORD"] ?? ""
                password = supplied.isEmpty ? "warrly-qa-not-the-password" : supplied
                await submitPassword()
            }
            return
        }
        #endif
        if scenePhase == .active {
            await appLock.unlock()
        }
    }

    /// Screenshot QA only — see `AppLockStore`. `nil` unless a DEBUG build was
    /// launched with `WV_QA_APP_LOCK`; a Release build compiles the lookup out.
    private static var qaScreenshot: String? {
        #if DEBUG
        return ProcessInfo.processInfo.environment["WV_QA_APP_LOCK"]
        #else
        return nil
        #endif
    }
}

/// Chooses the tab shell's presentation for the window it is in.
///
/// `sidebarAdaptable` is the one Apple primitive that gives a phone a real
/// two-posture shell without a second view hierarchy: a compact window (the
/// Duo's outer 5.4" panel, any iPhone) keeps the tab bar, and a regular one
/// (the unfolded 7.6" inner display) can take the sidebar, with the same
/// selection and the same navigation stacks on both sides of the fold.
///
/// The `#available` branch is evaluated once per launch, never per resize, so
/// this modifier cannot swap the container under a running navigation stack.
/// On iOS 17 the style does not exist and the shell keeps the plain tab bar.
private struct WVSidebarAdaptableShell: ViewModifier {
    func body(content: Content) -> some View {
        // Keep the ordinary tab bar on the Duo. `.sidebarAdaptable` promoted
        // the cover panel to a right-side sidebar because the phone window
        // reports a regular vertical size class; that is not the app's shell
        // and it is not what the App Store screenshots should show.
        content
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
            .tabItem { Label(L.t("Gói dịch vụ"), systemImage: "arrow.triangle.2.circlepath") }
            .tag(2)

            NavigationStack {
                WishlistScreen(client: client)
            }
            .tabItem { Label(L.t("Muốn mua"), systemImage: "heart.fill") }
            .tag(3)

            NavigationStack {
                MoreScreen(client: client)
            }
            // The destination is `MoreScreen` — settings, the server inbox and the
            // account — so the tab said "Add" and opened something that adds
            // nothing. The `+` that actually creates a device lives in each list's
            // toolbar; this tab is the one place the account lives.
            .tabItem { Label(L.t("Tôi"), systemImage: "person.crop.circle.fill") }
            // Server inbox plus files still in the Share Extension queue: a
            // shared receipt that has not uploaded yet is still waiting for the
            // user, and a failed drain must not make the badge claim "0".
            .badge(inboxStore.count + inboxStore.pendingSharedCount)
            .tag(4)
        }
        // Fold/unfold must not cost the user their place. The style is chosen
        // by `WVSidebarAdaptableShell` **once per process** (an `#available`
        // check, not a width check): `sidebarAdaptable` draws the ordinary tab
        // bar on a compact window and a sidebar on a regular one, so the same
        // `TabView` — and therefore the same five `NavigationStack`s, their
        // pushed screens and their scroll positions — survives a fold. A
        // `if tier == .compact` around two different containers would rebuild
        // the subtree and silently pop every stack.
        .modifier(WVSidebarAdaptableShell())
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
            if router.pendingDeviceId != nil || router.pendingHandoffCode != nil {
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
            if router.pendingDeviceId != nil || router.pendingHandoffCode != nil {
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
        // A claim link opened while another tab was showing. The sheet itself is
        // presented by DevicesScreen, which owns the authenticated navigation
        // stack — this only brings that tab forward.
        .onChange(of: router.pendingHandoffCode) { _, code in
            if code != nil { selection = 1 }
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
        // A capture performed from the Control Center sheet (presented by
        // `RootView`, outside this view's tree) added a row; refresh the badge.
        .onReceive(NotificationCenter.default.publisher(for: .warrlyInboxChanged)) { _ in
            Task { await inboxStore.load() }
        }
    }
}
