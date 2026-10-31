import SwiftUI
import WarrlyKit

// ============================================================
// DashboardView — "Tổng quan" tab
//
// The home screen answers one question — *what is the next date I could miss,
// and how long do I have?* — so it has exactly one lead: the deadline card at
// the top. Nothing sits above it but the 34 pt title (§7).
//
// That is why the greeting is gone. `WVHeroGreeting` carried the avatar, "Chào
// buổi sáng" and the user's name — the largest coral thing on the screen, and
// the only decoration above the one fact the user opened the app for. The name
// lives in Hồ sơ.
//
// Subscription and wishlist previews are display-only (no cross-tab push); the
// deadline rows and the action-queue door are the two things that navigate.
// ============================================================

struct DashboardView: View {
    let client: APIClient

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

    /// The four warranty tiles' numbers, computed in `WarrlyKit.warrantyRollup`
    /// so the boundaries are testable and match Android and the web.
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
                // "Hạn gần nhất" — one card naming the next deadline the user
                // can still act on, then the next three. Nothing above it.
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

                Spacer().frame(height: WVSpacing.xl)
            }
        }
        .wvScreen()
        .navigationTitle(L.t("Tổng quan"))
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            // Global search lives on the landing tab: it spans three other tabs
            // (thiết bị / đăng ký / wishlist), so it can't sit inside any one of
            // them without hiding two thirds of the results.
            //
            // Coral is the screen's one action, so the search glyph is neutral
            // (§5.1). The `+` below keeps the tint.
            ToolbarItem(placement: .topBarLeading) {
                NavigationLink {
                    SearchScreen(client: client)
                } label: {
                    WVIcon("search", size: 17)
                        .foregroundStyle(WVColor.label2)
                }
                .accessibilityLabel(L.t("Tìm kiếm"))
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showQuickAdd = true } label: {
                    WVIcon("plus", size: 17)
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
            // A sold device is not a deadline (§8.1: sold rows sort out of
            // every list). The status lives on the device, not on the date, so
            // it cannot be asked of `WarrantyPill`; the honest thing is to drop
            // the row rather than draw a countdown nobody should act on.
            if r.device.status == DeviceStatus.SOLD.rawValue { continue }
            // Display-only legal extension: repair time is not counted against
            // the warranty. The reminder feed still fires on the server's raw
            // end date; only the date this card prints moves.
            let end = remindersStore.adjustedEnd(r.endDate, deviceId: r.deviceId)
            out.append(DeadlineCandidate(
                kind: .warranty,
                entityId: r.deviceId,
                title: r.device.name,
                category: r.device.category,
                date: end,
                days: WVFormat.daysUntil(end)
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

    /// The board in date order, one row per entity.
    private var orderedDeadlines: [DeadlineCandidate] {
        DeadlineBoard.deduplicated(deadlineCandidates)
    }

    /// The card's candidate: the nearest deadline the user can still act on.
    ///
    /// `DeadlineBoard.board` is not used for this on purpose — its `nearest` is
    /// the earliest date *including the past*, which is how a 2022 subscription
    /// ended up above a watch with 18 days left (§1.4). An overdue date is a
    /// record, not a task. When every candidate is past there is nothing to
    /// act on, so the most recent one is shown and `DeadlineCard` says `Đã qua`.
    private func leadCandidate(in ordered: [DeadlineCandidate]) -> DeadlineCandidate? {
        ordered.first { $0.days >= 0 } ?? ordered.last
    }

    /// The three rows under the card: the next dates in order, so the overdue
    /// ones come first with `đã hết hạn` (§8.3). The card's own candidate is
    /// skipped so the same deadline is never listed twice.
    private func boardRows(_ ordered: [DeadlineCandidate],
                           card: DeadlineCandidate?) -> [DeadlineCandidate] {
        Array(ordered.filter { $0.id != card?.id }.prefix(DeadlineBoard.rowCount))
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
        let ordered = orderedDeadlines
        let card = leadCandidate(in: ordered)

        if let card {
            WVDashSectionHead(L.t("Hạn gần nhất"))
            DeadlineCard(candidate: card, navigation: deadlineNav(card))

            let rows = boardRows(ordered, card: card)
            if !rows.isEmpty {
                WVGroup {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { idx, row in
                        if idx > 0 { WVDivider() }
                        NavigationLink(value: deadlineNav(row)) {
                            DashboardRow(icon: WVCategory.icon(for: row.category),
                                         title: row.title,
                                         meta: DeadlineCopy.kindLabel(row.kind),
                                         chevron: true) {
                                WarrantyPill(daysLeft: row.days, endDate: row.date)
                            }
                        }
                        .buttonStyle(WVRowButtonStyle())
                    }
                }
                .padding(.top, WVSpacing.md)
            }

            // The legal extension moves dates on this board, so it has to be
            // named here too — a deadline that silently jumped later would
            // otherwise look like a server bug.
            if remindersStore.hasRepairExtension {
                WVSectionFooter(WarrantyRepairAdjustment.legalNote)
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
                HStack(spacing: WVSpacing.md) {
                    WVLeadingIcon(icon: "alert", size: 28)
                    VStack(alignment: .leading, spacing: WVSpacing.xs) {
                        Text(L.t("Không tải được hạn gần nhất"))
                            .wvFont(.calloutEmphasis)
                            .foregroundStyle(WVColor.label)
                        Text(message)
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.label3)
                            .lineLimit(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: WVSpacing.sm)
                    Button(L.t("Thử lại")) { Task { await reloadDeadlineSources() } }
                        .wvFont(.footnoteEmphasis)
                        .foregroundStyle(WVColor.label)
                        .buttonStyle(.plain)
                }
                .padding(.horizontal, WVSpacing.gutter)
                .frame(minHeight: 44)
                .padding(.vertical, WVSpacing.sm)
            }
            .padding(.bottom, WVSpacing.xs)
        } else {
            WVDashSectionHead(L.t("Hạn gần nhất"))
            WVGroup {
                VStack(alignment: .leading, spacing: WVSpacing.md) {
                    HStack(alignment: .top, spacing: WVSpacing.md) {
                        WVLeadingIcon(icon: "calendar", size: 28)
                        VStack(alignment: .leading, spacing: WVSpacing.xs) {
                            Text(L.t("Chưa có hạn nào"))
                                .wvFont(.calloutEmphasis)
                                .foregroundStyle(WVColor.label)
                            Text(L.t("Thêm thiết bị để app nhắc bạn trước khi hết bảo hành."))
                                .wvFont(.footnote)
                                .foregroundStyle(WVColor.label3)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: WVSpacing.sm)
                    }
                    WVButton(L.t("Thêm thiết bị"), icon: "plus",
                             kind: .secondary, size: .small) {
                        quickAddTarget = .device
                    }
                }
                .padding(WVSpacing.gutter)
            }
            .padding(.bottom, WVSpacing.xs)
        }
    }

    private var deadlinePartialFailureNote: some View {
        HStack(spacing: WVSpacing.sm) {
            WVIcon("alert", size: 11)
                .foregroundStyle(WVColor.orange)
            Text(L.t("Một số hạn có thể chưa được tải."))
                .wvFont(.footnote)
                .foregroundStyle(WVColor.label3)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: WVSpacing.sm)
            Button(L.t("Thử lại")) { Task { await reloadDeadlineSources() } }
                .wvFont(.footnoteEmphasis)
                .foregroundStyle(WVColor.label)
                .buttonStyle(.plain)
        }
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.top, WVSpacing.sm)
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
    /// The count is `counts.total` — the server's count of the items that are
    /// **actionable right now**. It is never the number of rows on screen (a
    /// `?snoozed=true` read adds rows without adding work) and never a local sum,
    /// so a snooze can move a row without moving the meaning. A failed read
    /// shows no number at all: "0 việc" would be a claim this screen cannot
    /// support.
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
            .padding(.bottom, WVSpacing.xs)
        }
    }

    /// One row, not a card: the section head already names the queue, so the row
    /// carries the workload (`6 việc cần xử lý`) and its severity (`1 mức cao`)
    /// instead of repeating the heading in a title and again in a subtitle.
    /// The old red count badge is gone — six things to do is not six alarms
    /// (§5.2: a count is not a state).
    private var actionQueueRow: some View {
        let counts = actionsStore.queue?.counts

        let title: String
        if let total = actionsStore.badgeCount {
            title = total == 0 ? L.t("Không còn việc nào")
                               : L.p("%d việc cần xử lý", total)
        } else {
            title = L.t("Việc cần xử lý")
        }
        let meta: String? = (counts?.high ?? 0) > 0
            ? L.p("%d mức cao", counts?.high ?? 0)
            : nil

        return DashboardRow(icon: (counts?.total ?? 0) > 0 ? "alert" : "checkCircle",
                            tile: false,
                            title: title,
                            meta: meta,
                            chevron: true) {
            EmptyView()
        }
    }

    // MARK: - Subscriptions section

    /// The monthly total is this section's one card — a plain number, the
    /// screen's second and last card (§4). The renewal rows are a group below
    /// it, because a card never contains a divider: they are rows among
    /// themselves, and each carries the §6 deadline column.
    private var subsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            WVDashSectionHead(L.t("Gói đăng ký"))

            WVCard(padding: WVSpacing.gutter) {
                VStack(alignment: .leading, spacing: WVSpacing.xs) {
                    HStack(alignment: .firstTextBaseline, spacing: WVSpacing.sm) {
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
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if !upcomingSubs.isEmpty {
                WVGroup {
                    ForEach(Array(upcomingSubs.enumerated()), id: \.element.sub.id) { idx, pair in
                        if idx > 0 { WVDivider() }
                        DashboardRow(icon: WVCategory.icon(for: pair.sub.category),
                                     tile: false,
                                     title: pair.sub.name,
                                     meta: subMeta(pair.sub)) {
                            WarrantyPill(daysLeft: pair.days, endDate: pair.sub.renewalDate)
                        }
                    }
                }
                .padding(.top, WVSpacing.md)
            }
        }
        .padding(.bottom, WVSpacing.xs)
    }

    /// `Apple · Hàng tháng` — the same meta line the Đăng ký screen uses (§8.5).
    /// The renewal date itself is the trailing column's job (§6), so it is not
    /// repeated here.
    private func subMeta(_ sub: Subscription) -> String {
        [sub.brand, sub.billingCycle.label]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    // MARK: - Wishlist section

    private var wishlistSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            WVDashSectionHead(L.t("Đang thèm"))
            WVGroup {
                ForEach(Array(wishItems.enumerated()), id: \.element.id) { idx, item in
                    if idx > 0 { WVDivider() }
                    wishRow(item)
                }
            }
            .padding(.bottom, WVSpacing.xs)
        }
    }

    /// Name and price, with the name holding layout priority so a long product
    /// name wraps into the space instead of the price being pushed off (§1.13).
    /// The meta uses the Vietnamese category label, never the raw code (§1.14).
    @ViewBuilder
    private func wishRow(_ item: WishlistItem) -> some View {
        let meta = [item.brand, CategoryLabels.label(for: item.category)]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")

        if let price = item.currentPrice {
            DashboardRow(icon: WVCategory.icon(for: item.category),
                         tile: false,
                         title: item.name,
                         meta: meta) {
                Text(WVFormat.vnd(price))
                    .wvFont(.body, weight: .medium)
                    .foregroundStyle(WVColor.label)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        } else {
            DashboardRow(icon: WVCategory.icon(for: item.category),
                         tile: false,
                         title: item.name,
                         meta: meta) {
                EmptyView()
            }
        }
    }
}

// MARK: - Navigation value for device push from dashboard

struct DashDeviceNav: Hashable {
    let id: String
    let name: String
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
                                // A destination is not the screen's action: the
                                // coral stays on the `+` that opened this sheet
                                // (§5.1).
                                WVIcon(target.icon, size: 15)
                                    .foregroundStyle(WVColor.label2)
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
