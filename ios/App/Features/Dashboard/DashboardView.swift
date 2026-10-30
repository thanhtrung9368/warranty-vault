import SwiftUI
import WarrlyKit

// ============================================================
// DashboardView — "Tổng quan" tab
//
// Ports DashboardScreen from project/ios/js/screens-1.jsx.
// Hero greeting + 4-widget stat grid + upcoming-warranty
// preview + subscriptions cost card + wishlist preview.
// Subscription/wishlist rows are display-only (no cross-tab push).
// ============================================================

struct DashboardView: View {
    let client: APIClient

    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @StateObject private var devicesStore: DevicesStore
    @StateObject private var subsStore: SubscriptionsStore
    @StateObject private var wishStore: WishlistStore
    @StateObject private var remindersStore: RemindersStore
    @StateObject private var statsStore: StatsStore
    /// The derived "Việc cần xử lý" queue. Fetched here for its badge **only** —
    /// the screen itself loads again when it opens.
    @StateObject private var actionsStore: ActionQueueStore

    @State private var showQuickAdd = false
    @State private var quickAddTarget: DashQuickAdd?

    init(client: APIClient) {
        self.client = client
        _devicesStore = StateObject(wrappedValue: DevicesStore(client: client))
        _subsStore = StateObject(wrappedValue: SubscriptionsStore(client: client))
        _wishStore = StateObject(wrappedValue: WishlistStore(client: client))
        _remindersStore = StateObject(wrappedValue: RemindersStore(client: client))
        _statsStore = StateObject(wrappedValue: StatsStore(client: client))
        _actionsStore = StateObject(wrappedValue: ActionQueueStore(client: client))
    }

    // MARK: - Computed stats

    /// `true` once the device list read has answered at least once, so the
    /// quiet rollup line is never drawn as a row of zeroes before a read.
    ///
    /// A failed *refresh* with rows already on screen keeps the line: those
    /// numbers are stale, not invented.
    private var devicesReady: Bool {
        if case .loaded = devicesStore.state { return true }
        return !devicesStore.devices.isEmpty
    }

    /// The four warranty tiles, computed in `WarrlyKit.warrantyRollup` so the
    /// boundaries are testable and match Android and the web.
    ///
    /// This used to be `max(0, activeDevices - expiringSoon)`: `activeDevices`
    /// came from the server's `devicesByStatus[.ACTIVE]` (which counts any ACTIVE
    /// row, warranty expired or not) while `expiringSoon` was a *subset* of the
    /// genuinely covered ones — so the tile subtracted the very devices the card
    /// below was pointing at and read 0 for an account with one device 9 days
    /// out, and simultaneously kept devices whose warranty had already lapsed.
    private var warranty: WarrantyRollup { warrantyRollup(devices: devicesStore.devices) }

    private var activeSubs: [Subscription] {
        subsStore.subscriptions.filter { $0.status == .ACTIVE }
    }
    private var monthlyTotal: Int {
        statsStore.snapshot.monthlyEquivalent
    }
    private var upcomingSubs: [(sub: Subscription, days: Int)] {
        activeSubs
            .map { s in (s, WVFormat.daysUntil(s.renewalDate)) }
            .sorted { $0.1 < $1.1 }
            .prefix(3)
            .map { ($0.0, $0.1) }
    }

    private var wishItems: [WishlistItem] {
        wishStore.items
            .filter { $0.status == .WATCHING || $0.status == .DECIDED }
            .prefix(3)
            .map { $0 }
    }

    // MARK: - Body

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // Greeting
                greetingSection

                // "Hạn gần nhất" — one card naming the nearest deadline,
                // then the next three. This replaced a 2×2 grid of counts:
                // a count says how many are coming without ever saying when,
                // which is the one fact the home screen exists to answer.
                deadlineSection

                // "Việc cần xử lý" — the derived queue, one tap away, directly
                // below the deadline because it is the other block that asks
                // for something.
                actionQueueSection

                // Subscriptions cost card
                if activeSubs.count > 0 {
                    subsSection
                }

                // Wishlist preview
                if wishItems.count > 0 {
                    wishlistSection
                }

                // The four counts the old grid shouted, demoted to one quiet
                // line. `warrantyRollup` stays the single source of truth, so
                // Dashboard, Stats and Android still agree numerically.
                if devicesReady {
                    DeadlineSummaryLine(rollup: warranty)
                }

                Spacer().frame(height: 24)
            }
        }
        .wvScreen()
        .navigationTitle(L.t("Tổng quan"))
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            // Global search lives on the landing tab: it spans three other tabs
            // (thiết bị / đăng ký / wishlist), so it can't sit inside any one of
            // them without hiding two thirds of the results.
            ToolbarItem(placement: .topBarLeading) {
                NavigationLink {
                    SearchScreen(client: client)
                } label: {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(WVColor.tint)
                }
                .accessibilityLabel(L.t("Tìm kiếm"))
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showQuickAdd = true } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
        .sheet(isPresented: $showQuickAdd) {
            DashQuickAddSheet { target in
                showQuickAdd = false
                quickAddTarget = target
            }
        }
        // "Thêm nhanh" from the dashboard opens the same create forms the tabs
        // use. Previously the sheet just dismissed itself, so the buttons did
        // nothing.
        .sheet(item: $quickAddTarget) { target in
            switch target {
            case .device:
                DeviceFormView(client: client, store: devicesStore, device: nil)
            case .subscription:
                SubscriptionFormView(client: client, store: subsStore, subscription: nil)
            case .wishlist:
                WishlistFormView(client: client, store: wishStore, item: nil)
            }
        }
        .navigationDestination(for: DashDeviceNav.self) { nav in
            // The reminder row names a device id, not a loaded `Device`. The
            // destination now loads it inline and then pushes the real screen;
            // it used to push a bare `ProgressView`, i.e. a tap that navigates
            // to "loading" and can stay there forever. `DeviceRouteDestination`
            // also states an honest "not found" (with a retry) for a device
            // deleted on another phone, instead of spinning.
            DeviceRouteDestination(client: client, store: devicesStore, deviceId: nav.id)
        }
        // Where a "Việc cần xử lý" row can lead. Registered here, on the stack
        // that owns them, rather than inside the pushed screen.
        .navigationDestination(for: ActionQueueNav.self) { nav in
            switch nav {
            case .device(let id):
                DeviceRouteDestination(client: client, store: devicesStore, deviceId: id)
            case .deviceForm(let id):
                // The "Ghi hạn" shortcut on the two return-window rows. Same
                // inline resolve, then the form that actually has the input.
                DeviceRouteDestination(client: client, store: devicesStore,
                                       deviceId: id, mode: .edit)
            case .subscription(let id):
                SubscriptionDetailView(client: client, store: subsStore, subscriptionId: id)
            case .wishlistItem(let id):
                WishlistDetailView(client: client, store: wishStore, itemId: id)
            }
        }
        .task {
            await withTaskGroup(of: Void.self) { g in
                g.addTask { await self.devicesStore.load() }
                g.addTask { await self.subsStore.load() }
                g.addTask { await self.wishStore.load() }
                g.addTask { await self.remindersStore.load() }
                g.addTask { await self.statsStore.load() }
                g.addTask { await self.actionsStore.load() }
            }
        }
        .refreshable {
            await withTaskGroup(of: Void.self) { g in
                g.addTask { await self.devicesStore.load() }
                g.addTask { await self.subsStore.load() }
                g.addTask { await self.wishStore.load() }
                g.addTask { await self.remindersStore.load() }
                g.addTask { await self.statsStore.load() }
                g.addTask { await self.actionsStore.load() }
            }
        }
    }

    // MARK: - Greeting

    private var userName: String {
        if case .authenticated(let user) = auth.status {
            return user.name ?? user.email.components(separatedBy: "@").first ?? L.t("Bạn")
        }
        return L.t("Bạn")
    }

    private var greetingTitle: String {
        let h = Calendar.current.component(.hour, from: Date())
        if h < 12 { return L.t("Chào buổi sáng,") }
        if h < 18 { return L.t("Chào buổi chiều,") }
        return L.t("Chào buổi tối,")
    }

    private var greetingSection: some View {
        WVHeroGreeting(name: userName, subtitle: greetingTitle)
    }

    // MARK: - Deadlines

    /// The three dated feeds merged into one board.
    ///
    /// Warranty reminders are the feed the server already sorted and filtered
    /// to warranties ending inside the window; active subscriptions and
    /// wishlist target dates are the other two things with a date the user
    /// could miss. Return windows are deliberately absent: they exist only on
    /// the device detail read, so including them here would cost one request
    /// per device.
    private var deadlineCandidates: [DeadlineCandidate] {
        var out: [DeadlineCandidate] = []
        for r in remindersStore.entries {
            out.append(DeadlineCandidate(
                kind: .warranty,
                entityId: r.deviceId,
                title: r.device.name,
                category: r.device.category,
                date: r.endDate,
                days: WVFormat.daysUntil(r.endDate)
            ))
        }
        for s in activeSubs {
            out.append(DeadlineCandidate(
                kind: .subscription,
                entityId: s.id,
                title: s.name,
                category: s.category,
                date: s.renewalDate,
                days: WVFormat.daysUntil(s.renewalDate)
            ))
        }
        for item in wishStore.items
        where item.status == .WATCHING || item.status == .DECIDED {
            guard let target = item.targetDate else { continue }
            out.append(DeadlineCandidate(
                kind: .wishlist,
                entityId: item.id,
                title: item.name,
                category: item.category,
                date: target,
                days: WVFormat.daysUntil(target)
            ))
        }
        return out
    }

    /// True once every feed that can produce a deadline has answered (loaded
    /// or failed). Until then the board must not claim "no deadline": an empty
    /// array is not the same fact as an empty account.
    private var deadlineReadsSettled: Bool {
        let reminders: Bool
        switch remindersStore.state {
        case .loaded, .error: reminders = true
        case .idle, .loading: reminders = false
        }
        let subscriptions: Bool
        switch subsStore.state {
        case .loaded, .error: subscriptions = true
        case .idle, .loading: subscriptions = false
        }
        let wishlist: Bool
        switch wishStore.state {
        case .loaded, .error: wishlist = true
        case .idle, .loading: wishlist = false
        }
        return reminders && subscriptions && wishlist
    }

    /// The first feed failure, if any. While candidates exist this is a
    /// footnote — the board shown is real, just possibly incomplete. With no
    /// candidates it replaces the empty state, because "nothing dated" cannot
    /// be concluded from a read that failed.
    private var deadlineReadError: String? {
        if case let .error(message) = remindersStore.state { return message }
        if case let .error(message) = subsStore.state { return message }
        if case let .error(message) = wishStore.state { return message }
        return nil
    }

    private func deadlineNav(_ candidate: DeadlineCandidate) -> ActionQueueNav {
        switch candidate.kind {
        case .warranty:     return .device(candidate.entityId)
        case .subscription: return .subscription(candidate.entityId)
        case .wishlist:     return .wishlistItem(candidate.entityId)
        }
    }

    @ViewBuilder
    private var deadlineSection: some View {
        let board = DeadlineBoard.board(deadlineCandidates)

        if let nearest = board.nearest {
            WVDashSectionHead(L.t("Hạn gần nhất"))
            DeadlineCard(candidate: nearest, navigation: deadlineNav(nearest))

            if !board.rows.isEmpty {
                WVGroup {
                    ForEach(Array(board.rows.enumerated()), id: \.element.id) { idx, row in
                        if idx > 0 { WVDivider(inset: 62) }
                        NavigationLink(value: deadlineNav(row)) {
                            DeadlineRow(candidate: row)
                        }
                        .buttonStyle(WVRowButtonStyle())
                    }
                }
                .padding(.top, 10)
            }

            if deadlineReadError != nil {
                deadlinePartialFailureNote
            }
        } else if !deadlineReadsSettled {
            WVDashSectionHead(L.t("Hạn gần nhất"))
            DeadlineSkeleton()
        } else if let message = deadlineReadError {
            WVDashSectionHead(L.t("Hạn gần nhất"))
            WVGroup {
                HStack(spacing: 12) {
                    WVLeadingIcon(icon: "alert", color: WVColor.orange, size: 34)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L.t("Không tải được hạn gần nhất"))
                            .wvFont(.calloutEmphasis)
                            .foregroundStyle(WVColor.label)
                        Text(message)
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.label3)
                            .lineLimit(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 8)
                    Button(L.t("Thử lại")) { Task { await reloadDeadlineSources() } }
                        .wvFont(.footnoteEmphasis)
                        .foregroundStyle(WVColor.tint)
                        .buttonStyle(.plain)
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
                .padding(.vertical, 10)
            }
            .padding(.bottom, 4)
        } else {
            WVDashSectionHead(L.t("Hạn gần nhất"))
            WVGroup {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top, spacing: 12) {
                        WVLeadingIcon(icon: "calendar", color: WVColor.orange, size: 34)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L.t("Chưa có hạn nào"))
                                .wvFont(.calloutEmphasis)
                                .foregroundStyle(WVColor.label)
                            Text(L.t("Thêm thiết bị để app nhắc bạn trước khi hết bảo hành."))
                                .wvFont(.footnote)
                                .foregroundStyle(WVColor.label3)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 8)
                    }
                    WVButton(L.t("Thêm thiết bị"), icon: "plus",
                             kind: .secondary, size: .small) {
                        quickAddTarget = .device
                    }
                }
                .padding(16)
            }
            .padding(.bottom, 4)
        }
    }

    private var deadlinePartialFailureNote: some View {
        HStack(spacing: 6) {
            WVIcon("alert", size: 11)
                .foregroundStyle(WVColor.orange)
            Text(L.t("Một số hạn có thể chưa được tải."))
                .wvFont(.footnote)
                .foregroundStyle(WVColor.label3)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 6)
            Button(L.t("Thử lại")) { Task { await reloadDeadlineSources() } }
                .wvFont(.footnoteEmphasis)
                .foregroundStyle(WVColor.tint)
                .buttonStyle(.plain)
        }
        .padding(.horizontal, 32)
        .padding(.top, 8)
    }

    private func reloadDeadlineSources() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.remindersStore.load() }
            group.addTask { await self.subsStore.load() }
            group.addTask { await self.wishStore.load() }
        }
    }

    // MARK: - Action queue ("Việc cần xử lý")

    /// The dashboard's door into `GET /api/v1/actions`.
    ///
    /// The badge is `counts.total` — the server's count of the items that are
    /// **actionable right now**. It is never the number of rows on screen (a
    /// `?snoozed=true` read adds rows without adding work) and never a local sum,
    /// so a snooze can move a row without moving the badge's meaning.
    private var actionQueueSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            WVDashSectionHead(L.t("Việc cần xử lý"))

            WVGroup {
                NavigationLink {
                    ActionQueueScreen(store: actionsStore)
                } label: {
                    actionQueueRow
                }
                .buttonStyle(WVRowButtonStyle())
            }
            .padding(.bottom, 4)
        }
    }

    private var actionQueueRow: some View {
        let total = actionsStore.badgeCount
        let urgent = (total ?? 0) > 0

        return HStack(spacing: 12) {
            WVLeadingIcon(icon: urgent ? "alert" : "checkCircle",
                          color: urgent ? WVColor.orange : WVColor.green,
                          size: 34)

            VStack(alignment: .leading, spacing: 2) {
                Text(L.t("Việc cần xử lý"))
                    .wvFont(.calloutEmphasis)
                    .foregroundStyle(WVColor.label)
                // A failed read shows no number at all: "0 việc" would be a claim
                // this screen cannot support.
                Text(ActionQueueRules.entrySubtitle(counts: actionsStore.queue?.counts))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 8)

            if let total, total > 0 {
                Text("\(total)")
                    .wvFont(.caption, weight: .bold)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 3)
                    .frame(minHeight: 22)
                    .background(WVColor.red)
                    .clipShape(Capsule())
            }

            WVIcon("arrowRight", size: 13, weight: .semibold)
                .foregroundStyle(WVColor.label4)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }

    // MARK: - Subscriptions section

    private var subsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            WVDashSectionHead(L.t("Gói đăng ký"))

            WVCard(padding: 16) {
                VStack(alignment: .leading, spacing: 0) {
                    // Monthly total
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(WVFormat.vnd(monthlyTotal))
                            .wvFont(.statValue)
                            .foregroundStyle(WVColor.label)
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)
                        Text(L.t("/ tháng"))
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.label3)
                    }
                    Text(L.t("~ %@/năm", WVFormat.vnd(monthlyTotal * 12))
                                + " · " + L.p("%d gói đang chạy", activeSubs.count))
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                        .padding(.top, 2)

                    Rectangle()
                        .fill(WVColor.sep)
                        .frame(height: 0.5)
                        .padding(.vertical, 12)

                    Text(L.t("SẮP GIA HẠN"))
                        .wvFont(.captionEmphasis)
                        .foregroundStyle(WVColor.label3)
                        .padding(.bottom, 6)

                    ForEach(upcomingSubs, id: \.sub.id) { pair in
                        DashSubRow(sub: pair.sub, days: pair.days)
                    }
                }
            }
            .padding(.bottom, 4)
        }
    }

    // MARK: - Wishlist section

    private var wishlistSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            WVDashSectionHead(L.t("Đang thèm"))
            WVGroup {
                ForEach(Array(wishItems.enumerated()), id: \.element.id) { idx, item in
                    if idx > 0 { WVDivider(inset: 60) }
                    WVRow(
                        icon: WVCategory.icon(for: item.category),
                        iconColor: WVCategory.accent(for: item.category),
                        iconLarge: false,
                        title: item.name,
                        subtitle: [item.brand, item.targetDate.map { WVFormat.date($0) }]
                            .compactMap { $0 }.joined(separator: " • "),
                        detail: item.currentPrice.map { WVFormat.vnd($0) },
                        chevron: false
                    )
                }
            }
            .padding(.bottom, 4)
        }
    }
}

// MARK: - Navigation value for device push from dashboard

struct DashDeviceNav: Hashable {
    let id: String
    let name: String
}

// MARK: - Dash sub row

private struct DashSubRow: View {
    let sub: Subscription
    let days: Int

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            WVLeadingIcon(
                icon: WVCategory.icon(for: sub.category),
                color: WVCategory.accent(for: sub.category),
                size: 28
            )
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 2) {
                    nameText
                    dateText
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                nameText
                    .frame(maxWidth: .infinity, alignment: .leading)
                dateText
            }
        }
        .padding(.vertical, 4)
    }

    private var nameText: some View {
        Text(sub.name)
            .wvFont(.subheadline)
            .foregroundStyle(WVColor.label)
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var dateText: some View {
        Text(WVFormat.date(sub.renewalDate))
            .wvFont(.footnote)
            .foregroundStyle(days < 0 ? WVColor.red : WVColor.label3)
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
    }
}

// MARK: - Quick-add sheet

/// The three "Thêm nhanh" destinations from the web dashboard.
enum DashQuickAdd: String, Identifiable, CaseIterable {
    case device, subscription, wishlist

    var id: String { rawValue }

    var title: String {
        switch self {
        case .device:       return L.t("Thiết bị")
        case .subscription: return L.t("Gói đăng ký")
        case .wishlist:     return "Wishlist"
        }
    }

    var icon: String {
        switch self {
        case .device:       return "package"
        case .subscription: return "refresh"
        case .wishlist:     return "heart"
        }
    }
}

private struct DashQuickAddSheet: View {
    /// Called with the chosen destination — the presenter dismisses this sheet
    /// and opens the matching create form.
    let onSelect: (DashQuickAdd) -> Void

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(DashQuickAdd.allCases) { target in
                        Button {
                            onSelect(target)
                        } label: {
                            Label {
                                Text(target.title)
                                    .wvFont(.body)
                                    .foregroundStyle(WVColor.label)
                            } icon: {
                                WVIcon(target.icon, size: 15)
                                    .foregroundStyle(WVColor.tint)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                    }
                } header: {
                    Text(L.t("Thêm nhanh"))
                }
            }
            .navigationTitle(L.t("Thêm nhanh"))
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium])
    }
}
