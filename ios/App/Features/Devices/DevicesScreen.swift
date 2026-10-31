import SwiftUI
import WarrlyKit

// ============================================================
// DevicesScreen — "Thiết bị" tab root
//
// Ports DevicesScreen from project/ios/js/screens-1.jsx.
// Searchable list of devices, status filter, sort sheet.
// "+" toolbar menu → DeviceFormView (one device) or BulkDeviceAddView (a batch).
// ============================================================

struct DevicesScreen: View {
    let client: APIClient

    @StateObject private var store: DevicesStore
    /// The *same* repair-extension source the dashboard, the reminders list and
    /// the device hero read. Its only value here is `repairDaysByDevice`, built
    /// from the claims read inside `load()`: time a device spent in a closed
    /// repair does not count against its warranty (Luật 19/2023, Điều 30.2.c),
    /// so the list must add it before printing a deadline. A second
    /// implementation of that rule is a second number, and this screen already
    /// printed one that disagreed with every other screen.
    ///
    /// The store's reminder reads are unused by this screen; `load()` is the
    /// only door to the claims map it publishes, and the extension is display-
    /// only — nothing here writes a date back.
    @StateObject private var remindersStore: RemindersStore
    @EnvironmentObject private var catalog: CatalogStore
    /// Owned by `MainTabView`; capturing a receipt refreshes this so the
    /// "Thêm" badge is already correct when the user goes looking for it.
    @EnvironmentObject private var inbox: InboxStore

    // Search + filter state
    @State private var searchQuery = ""
    @State private var statusFilter: DeviceStatus? = nil
    @State private var categoryFilter: String? = nil
    /// **Deadline first**, not purchase date (§8.1, fixes §1.3).
    ///
    /// The list is the answer to "what needs me next?", so the default order is
    /// the one that puts the device with 8 days left at the top instead of
    /// fourth behind three devices that do not expire for years. The menu still
    /// offers all five orders; this only changes which one you get without
    /// asking.
    @State private var sortOrder: DeviceSortOrder = .warrantyAsc

    /// One sheet binding for both the filter and the capture flow: two
    /// independent `.sheet` modifiers on the same view is a presentation race
    /// waiting to happen.
    @State private var activeSheet: DevicesSheet?
    @State private var captureSucceeded = false
    @State private var showCaptureAlert = false
    @State private var showInbox = false
    /// The add-flow's two pushes. Value-based links inside a menu are
    /// unreliable across iOS versions, so the dialog's buttons drive these flags
    /// and the destinations below own the navigation.
    @State private var showCreateForm = false
    @State private var showBulkAdd = false
    /// The "+" toolbar button presents a confirmation dialog (not a `Menu`):
    /// a `Menu` with a custom `WVIcon` label stopped responding to taps on
    /// iOS 27, and a plain button + system dialog has one predictable hit path.
    @State private var showAddOptions = false
    /// Destination requested by Spotlight / a URL / an App Intent. It is only
    /// resolved after the list is loaded, so a cold launch from a search result
    /// still lands on the right device.
    @EnvironmentObject private var router: AppRouter
    @State private var deepLinkedDevice: Device?
    @State private var showMissingDeviceAlert = false

    init(client: APIClient) {
        self.client = client
        _store = StateObject(wrappedValue: DevicesStore(client: client))
        _remindersStore = StateObject(wrappedValue: RemindersStore(client: client))
    }

    private enum DevicesSheet: Identifiable {
        case filter
        case capture

        var id: String {
            switch self {
            case .filter: return "filter"
            case .capture: return "capture"
            }
        }
    }

    // MARK: - Filtered list

    enum DeviceSortOrder: String, CaseIterable {
        case purchaseDesc = "purchase-desc"
        case warrantyAsc  = "warranty-asc"
        case priceDesc    = "price-desc"
        case priceAsc     = "price-asc"
        case name         = "name"

        var label: String {
            switch self {
            case .purchaseDesc: return L.t("Mới mua nhất")
            case .warrantyAsc:  return L.t("BH sắp hết trước")
            case .priceDesc:    return L.t("Giá cao nhất")
            case .priceAsc:     return L.t("Giá thấp nhất")
            case .name:         return L.t("Tên A → Z")
            }
        }
    }

    private var filteredDevices: [Device] {
        var arr = store.devices
        let q = searchQuery.trimmingCharacters(in: .whitespaces).lowercased()
        if !q.isEmpty {
            arr = arr.filter {
                let hay = "\($0.name) \($0.brand ?? "") \($0.model ?? "") \($0.serialNumber ?? "")".lowercased()
                return hay.contains(q)
            }
        }
        if let sf = statusFilter {
            arr = arr.filter { $0.status == sf }
        }
        if let cf = categoryFilter {
            arr = arr.filter { $0.category == cf }
        }
        return Self.soldLast(ordered(arr))
    }

    /// The chosen order, applied.
    private func ordered(_ arr: [Device]) -> [Device] {
        switch sortOrder {
        case .purchaseDesc:
            return arr.sorted { $0.purchaseDate > $1.purchaseDate }
        case .warrantyAsc:
            return sortedByWarrantyEndAscending(arr)
        case .priceDesc:
            return StatsRollup.sortedByPurchaseValue(arr, descending: true)
        case .priceAsc:
            return StatsRollup.sortedByPurchaseValue(arr, descending: false)
        case .name:
            return arr.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        }
    }

    /// Sold devices go to the end of **every** order (§8.1).
    ///
    /// A sold device is not a deadline: there is nothing left to act on, and in
    /// the old purchase-date order a sold Nintendo Switch sat at row two,
    /// between two live devices, looking exactly as urgent as them. `filter`
    /// preserves the order it is given, so this is a stable partition rather
    /// than a second sort.
    static func soldLast(_ devices: [Device]) -> [Device] {
        devices.filter { $0.status != .SOLD } + devices.filter { $0.status == .SOLD }
    }

    /// The deadline this screen prints **and** sorts by: the server's
    /// effective warranty end plus the days the device spent in closed repairs
    /// (Luật 19/2023, Điều 30.2.c — repair time does not count against the
    /// warranty period).
    ///
    /// This is `RemindersStore.adjustedEnd`, the same call the dashboard
    /// (`DashboardView.swift:230`), the reminders list and the device hero
    /// (`DeviceDetailView.swift:133`) make, so the Apple Watch cannot read
    /// `còn 8 ngày` here and `còn 18 ngày` everywhere else. `nil` stays `nil`:
    /// a device with no recorded end has no adjusted end either.
    private func displayedWarrantyEnd(for device: Device) -> Date? {
        guard let end = device.effectiveWarrantyEnd else { return nil }
        return remindersStore.adjustedEnd(end, deviceId: device.id)
    }

    /// "BH sắp hết trước": soonest displayed deadline first. Devices with no
    /// warranty package sort last, mirroring the Go list endpoint
    /// (`services.ListDevices` treats a missing `effectiveWarrantyEnd` as
    /// infinitely far away when ordering ascending).
    ///
    /// It compares `displayedWarrantyEnd`, not the raw `effectiveWarrantyEnd`:
    /// an order derived from one value while the row prints another is exactly
    /// the disagreement defect A is about — the list would claim to be
    /// "soonest first" and then show a row with 18 days above one with 8.
    private func sortedByWarrantyEndAscending(_ devices: [Device]) -> [Device] {
        devices.sorted { a, b in
            switch (displayedWarrantyEnd(for: a), displayedWarrantyEnd(for: b)) {
            case let (lhs?, rhs?): return lhs < rhs
            case (nil, _?):        return false
            case (_?, nil):        return true
            case (nil, nil):       return false
            }
        }
    }

    private var hasActiveFilters: Bool {
        statusFilter != nil || categoryFilter != nil || sortOrder != .warrantyAsc
    }

    private var categoryFilterLabel: String? {
        guard let code = categoryFilter else { return nil }
        return catalog.categories.first(where: { $0.code == code })?.name
            ?? CategoryLabels.label(for: code)
    }

    // MARK: - Body

    var body: some View {
        // One scroll view. The search field used to be pinned above it behind a
        // full-width hairline, which cost the list 52 pt on every screen, could
        // never scroll away, and left the 34 pt title collapsing over a bar that
        // did not move with it. It now scrolls with the rows (§8.1).
        ScrollView {
            LazyVStack(spacing: 0) {
                if showsSearchField {
                    // 8 pt under the title; the content below brings its own
                    // 16 pt gutter, so the field sits one gutter above the group.
                    searchField
                        .padding(.horizontal, WVSpacing.gutter)
                        .padding(.top, WVSpacing.sm)
                }
                listContent
            }
        }
        .refreshable {
            // The list and the claims behind the legal deadline extension are
            // two independent reads; a refresh must re-read both, or the rows
            // would keep a stale `+N ngày sửa` while saying they are fresh.
            await withTaskGroup(of: Void.self) { g in
                g.addTask { await self.store.load() }
                g.addTask { await self.remindersStore.load() }
            }
        }
        .wvScreen()
        // Free-tier banner. A `safeAreaInset` — NOT a row inside the list and
        // not a conditional view driven by scroll offset:
        //
        //  * it sits above the tab bar and above the home-indicator safe area,
        //    and the list scrolls beneath it;
        //  * it stays mounted for as long as this screen is on top, so scrolling
        //    can never fire a fresh ad request (the other app learned that the
        //    expensive way — one request per unmount/remount cycle);
        //  * its slot reserves `ScreenMetrics.adBannerSlotHeight` before an ad
        //    exists, so fill never shifts the list.
        //
        // Paid accounts render nothing at all (`AdsBannerSlot` returns
        // `EmptyView`), which also drops the 50 pt reservation with it.
        .safeAreaInset(edge: .bottom, spacing: 0) {
            AdsBannerSlot()
        }
        .navigationTitle(L.t("Thiết bị"))
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    activeSheet = .filter
                } label: {
                    // §5.1: coral is the action, not a secondary control. Filter
                    // and camera are `label2` glyphs; the `+` is the screen's
                    // one coral affordance.
                    //
                    // A bare `Image`, not a `Label`. A toolbar `Label` is
                    // drawn by the bar as a template and takes the tint of the
                    // nearest `.tint` (the tab view's coral), so this glyph
                    // came out coral even with `foregroundStyle` on the label
                    // — the camera beside it, a bare image with the same
                    // `.foregroundStyle`, stayed grey. Same shape as the
                    // camera so the two neighbours cannot diverge again.
                    Image(systemName: hasActiveFilters
                          ? "line.3.horizontal.decrease.circle.fill"
                          : "line.3.horizontal.decrease")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(WVColor.label2)
                }
                .accessibilityLabel(L.t("Lọc"))
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                // Capture-first entry point. It lives on the Devices tab — the
                // place a user already goes to manage devices and receipts —
                // but it never asks for a device, so it is usable at the
                // counter before any row exists. The alternative (device
                // detail) is exactly the detour this feature removes.
                Button { activeSheet = .capture } label: {
                    WVIcon("camera", size: 17)
                        .foregroundStyle(WVColor.label2)
                }
                .accessibilityLabel(L.t("Thêm hoá đơn"))

                // Two ways to add: one device (the long form) or a batch (the
                // four-field rows). This used to be a toolbar `Menu` with a
                // custom `WVIcon` label; on iOS 27 that combination stopped
                // answering taps, so it is now a plain `Button` + the standard
                // confirmation dialog. The dialog needs no custom label
                // rendering and has the same two choices.
                Button { showAddOptions = true } label: {
                    // The screen's one coral thing (§5.1).
                    WVIcon("plus", size: 17)
                        .foregroundStyle(WVColor.tint)
                }
                .accessibilityLabel(L.t("Thêm thiết bị"))
            }
        }
        .confirmationDialog(
            L.t("Thêm nhanh"),
            isPresented: $showAddOptions,
            titleVisibility: .visible
        ) {
            Button(L.t("Thêm thiết bị")) { showCreateForm = true }
            Button(BulkDeviceCopy.title) { showBulkAdd = true }
            Button(L.t("Huỷ"), role: .cancel) {}
        }
        .navigationDestination(for: DeviceFormNav.self) { nav in
            switch nav {
            case .create:
                DeviceFormView(client: client, store: store, device: nil)
            case .edit(let device):
                DeviceFormView(client: client, store: store, device: device)
            }
        }
        .navigationDestination(isPresented: $showCreateForm) {
            DeviceFormView(client: client, store: store, device: nil)
        }
        .navigationDestination(isPresented: $showBulkAdd) {
            BulkDeviceAddView(store: store)
        }
        .navigationDestination(for: Device.self) { device in
            DeviceDetailView(client: client, devicesStore: store, device: device)
        }
        // A Spotlight hit or App Intent can arrive while this screen is already
        // on the stack. It is a separate destination from the value-based link
        // above because there is no `Device` value yet at request time.
        .navigationDestination(item: $deepLinkedDevice) { device in
            DeviceDetailView(client: client, devicesStore: store, device: device)
        }
        // The confirmation alert can push here; a sheet-nested inbox would not
        // share the tab's navigation stack.
        .navigationDestination(isPresented: $showInbox) {
            InboxScreen(client: client)
        }
        // Dashboard push via DashDeviceNav (cross-tab usage doesn't apply here)
        .sheet(item: $activeSheet, onDismiss: {
            // The capture sheet dismisses itself after a successful upload. Its
            // `onUploaded` only sets the flag; showing an alert while the sheet
            // is still on screen would be a presentation conflict, so the alert
            // waits for this callback.
            if captureSucceeded {
                captureSucceeded = false
                showCaptureAlert = true
            }
        }) { sheet in
            switch sheet {
            case .filter:
                DeviceFilterSheet(statusFilter: $statusFilter,
                                  categoryFilter: $categoryFilter,
                                  sortOrder: $sortOrder,
                                  categories: catalog.categories)
            case .capture:
                InboxCaptureSheet(client: client) { _ in
                    captureSucceeded = true
                    Task { await inbox.load() }
                }
            }
        }
        .alert(L.t("Đã thêm vào Hộp thư đến"), isPresented: $showCaptureAlert) {
            Button(L.t("Mở hộp thư")) { showInbox = true }
            Button(L.t("Xong"), role: .cancel) {}
        } message: {
            Text(L.t("Gán tệp vào thiết bị để nó không còn trong hộp thư."))
        }
        .alert(L.t("Không tìm thấy thiết bị này."), isPresented: $showMissingDeviceAlert) {
            Button(L.t("Xong"), role: .cancel) {}
        }
        .task {
            router.restorePendingFromSharedDefaults()
            // Two independent reads, started together: the list itself, and
            // the claims the legal repair extension is computed from. The
            // extension is display-only, so a failed claims read leaves the
            // server's own date in place rather than blanking the screen.
            await withTaskGroup(of: Void.self) { g in
                g.addTask { await self.remindersStore.load() }
                if router.pendingDeviceId != nil {
                    g.addTask { await self.openPendingDeviceIfNeeded() }
                } else {
                    g.addTask { await self.store.load() }
                }
            }
        }
        .onChange(of: router.pendingDeviceId) { _, id in
            guard id != nil else { return }
            Task { await openPendingDeviceIfNeeded() }
        }
    }

    /// Loads the list and pushes the requested device.
    ///
    /// The id is consumed only after the load: consuming it first would lose the
    /// destination on a cold launch where the list request fails or is slow.
    /// A missing device is reported honestly instead of silently doing nothing —
    /// the row may have been deleted on another device since it was indexed.
    private func openPendingDeviceIfNeeded() async {
        guard let id = router.consume() else { return }
        await store.load()
        if let device = store.devices.first(where: { $0.id == id }) {
            deepLinkedDevice = device
        } else {
            showMissingDeviceAlert = true
        }
    }

    // MARK: - Search field

    /// The one search field on this screen (§8.1): `fill3`, radius 8, 36 pt
    /// tall, 16 pt gutter, 8 pt under the title, scrolling with the list.
    ///
    /// `minHeight` rather than a fixed `height`: at Accessibility sizes a 36 pt
    /// box would clip the field it contains (§10.3 check 7).
    private var searchField: some View {
        HStack(spacing: WVSpacing.sm) {
            WVIcon("search", size: 15)
                .foregroundStyle(WVColor.label3)
            TextField(L.t("Tìm thiết bị..."), text: $searchQuery)
                .wvFont(.callout)
                .foregroundStyle(WVColor.label)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            if !searchQuery.isEmpty {
                Button {
                    searchQuery = ""
                } label: {
                    // A glyph, not text: fixed sizes are the documented exception
                    // for SF Symbols (Fonts.swift), and there is no `xCircle` in
                    // the `WVIconMap`.
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(WVColor.label3)
                }
                .buttonStyle(.plain)
                // Existing key, already translated ("Delete" / "Xoá"): no new
                // string is invented for a label nobody sees (§10.3, correction D).
                .accessibilityLabel(L.t("Xoá"))
            }
        }
        .padding(.horizontal, WVSpacing.md)
        .frame(minHeight: 36)
        .background(WVColor.fill3)
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.sm, style: .continuous))
    }

    /// A search field over zero rows is a dead control: it stays out of the way
    /// on the first load's skeleton, on a failed read, and on the genuine empty
    /// account — the three states below already say everything there is to say.
    private var showsSearchField: Bool {
        !store.devices.isEmpty || store.state == .idle || store.state == .loading
    }

    // MARK: - List content

    /// The four phases of this screen, and the only place they are decided.
    ///
    /// `DevicesStore.state` existed all along; this screen simply never read it.
    /// A 40-device account on a cold launch was told **"Chưa có thiết bị nào"**
    /// with three calls to action, and a failed read looked exactly like an
    /// empty account. The gate is the one `RemindersView` already uses:
    ///
    ///   * idle / loading, no rows yet → skeleton;
    ///   * error, no rows yet          → the failure stated, with a retry;
    ///   * loaded                      → the real list, and the *real* empty
    ///     state only when the account genuinely has no devices.
    ///
    /// A stale list is still shown if a refresh fails: the rows are real, and
    /// replacing them with an error card would hide data the user can use.
    @ViewBuilder
    private var listContent: some View {
        let items = filteredDevices
        if store.devices.isEmpty, case let .error(message) = store.state {
            WVEmpty(icon: "alert",
                    title: L.t("Không tải được thiết bị"),
                    description: message) {
                WVButton(L.t("Thử lại")) { Task { await store.load() } }
            }
        } else if store.devices.isEmpty,
                  store.state == .idle || store.state == .loading {
            DevicesListSkeleton()
        } else if items.isEmpty {
            emptyState(isFiltering: !searchQuery.isEmpty || hasActiveFilters)
        } else {
            rows(items)
        }
    }

    /// A truthful "nothing here": the two cases above have already ruled out
    /// "still loading" and "the read failed".
    @ViewBuilder
    private func emptyState(isFiltering: Bool) -> some View {
        WVEmpty(
            icon: isFiltering ? "search" : "package",
            title: isFiltering ? L.t("Không có gì khớp") : L.t("Chưa có thiết bị nào"),
            description: isFiltering
                ? L.t("Thử nới bộ lọc xem sao.")
                : L.t("Thêm thiết bị đầu tiên — laptop, điện thoại, máy giặt... gì cũng được.")
        ) {
            if !isFiltering {
                VStack(spacing: WVSpacing.md) {
                    NavigationLink(value: DeviceFormNav.create) {
                        WVButton(L.t("Thêm thiết bị"), icon: "plus") { showCreateForm = true }
                    }
                    // The empty list is the strongest bulk case: someone
                    // setting up a new flat has nothing here yet and a
                    // stack of appliances to enter. Offer it before the
                    // receipt path, which is not about device rows at all.
                    WVButton(BulkDeviceCopy.title, icon: "package", kind: .secondary) {
                        showBulkAdd = true
                    }
                    // A brand-new account is the strongest capture-first
                    // case: the receipt exists but there is no device row
                    // yet. Offer the inbox path right where the empty
                    // device list otherwise dead-ends.
                    WVButton(L.t("Thêm hoá đơn"), icon: "camera", kind: .secondary) {
                        activeSheet = .capture
                    }
                }
            }
        }
    }

    /// The rows themselves: one group, hairline inset to the title (56), footer
    /// at the 16 pt gutter.
    private func rows(_ items: [Device]) -> some View {
        VStack(spacing: 0) {
            if let categoryFilterLabel {
                HStack(spacing: WVSpacing.sm) {
                    Text(L.t("Loại: %@", categoryFilterLabel))
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, WVSpacing.gutter)
                .padding(.top, WVSpacing.md)
            }

            WVGroup {
                ForEach(Array(items.enumerated()), id: \.element.id) { idx, device in
                    // `WVDivider()` defaults to `rowInset` (56): 16 gutter +
                    // 28 tile + 12 gap, so the hairline starts where the name
                    // does (§3).
                    if idx > 0 { WVDivider() }
                    NavigationLink(value: device) {
                        // The date is resolved here, once, from the same
                        // `displayedWarrantyEnd` the sort above uses — so the
                        // row cannot order by one date and print another.
                        DeviceListRow(device: device,
                                      warrantyEnd: displayedWarrantyEnd(for: device))
                    }
                    .buttonStyle(WVRowButtonStyle())
                }
            }
            .padding(.top, WVSpacing.gutter)

            // Footer: the count, then the legal note exactly when it applies.
            VStack(alignment: .leading, spacing: WVSpacing.xs) {
                Text(L.p("%d thiết bị", items.count))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)

                // The legal extension moves deadlines on this list, so it is
                // named here exactly when it is in effect — the same note the
                // dashboard and the reminders screen print, and the one
                // `WarrantyRepairAdjustment` requires of every surface that
                // shows the adjusted date. Without it a row's date would
                // silently differ from the stored one and read as a bug.
                if remindersStore.hasRepairExtension {
                    Text(WarrantyRepairAdjustment.legalNote)
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, WVSpacing.gutter)
            .padding(.top, WVSpacing.sm)
            .padding(.bottom, WVSpacing.xl)
        }
    }
}

// MARK: - Loading skeleton

/// Redacted rows shaped like `DeviceListRow`, with **no** "Đang tải…" header on
/// top: a skeleton that prints a label on itself is the state the owner called
/// out as senseless — the grey bars already say what is happening.
///
/// Static `.redacted`, not a moving shimmer: four screens in this app already
/// use a still placeholder, and motion would make the whole list look busy.
private struct DevicesListSkeleton: View {
    /// The row geometry it stands in for: 28 pt tile, 12 pt gap, 16 pt gutter,
    /// 8 pt vertical padding — plus a **64 × 13 bar on the trailing edge**, so
    /// the placeholder has the silhouette of a real row instead of stopping
    /// where every row continues (§1.15, §8.1).
    var body: some View {
        WVGroup {
            ForEach(0..<4) { i in
                if i > 0 { WVDivider() }
                HStack(spacing: WVSpacing.md) {
                    RoundedRectangle(cornerRadius: WVRadius.sm, style: .continuous)
                        .fill(WVColor.fill3)
                        .frame(width: 28, height: 28)
                    VStack(alignment: .leading, spacing: WVSpacing.sm) {
                        // 4 pt is the one radius left for a placeholder text bar
                        // (§4) — not a card or control radius.
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(WVColor.fill3)
                            .frame(height: 14)
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(WVColor.fill3)
                            .frame(width: 150, height: 12)
                    }
                    // The trailing value, inside the same 84 pt column the
                    // real row reserves, so the title bar ends where the title
                    // ends and the silhouette matches exactly.
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(WVColor.fill3)
                        .frame(width: 64, height: 13)
                        .frame(width: 84, alignment: .trailing)
                    WVIcon("arrowRight", size: 13)
                        .foregroundStyle(WVColor.label4)
                }
                .padding(.horizontal, WVSpacing.gutter)
                .padding(.vertical, WVSpacing.sm)
                .frame(minHeight: 44)
                .redacted(reason: .placeholder)
            }
        }
        .padding(.top, WVSpacing.gutter)
    }
}

// MARK: - Device list row

/// One device, as it appears on this screen, on the dashboard and in search
/// results (§4: "the same row everywhere it appears").
///
/// Anatomy (§8.1): 28 pt `fill3` tile → name 17 semibold → meta 13 `label3` →
/// the §6 deadline column → 13 pt chevron. No pill: a capsule around a phrase
/// was doing the work of a column, and status is text (§5.2).
///
/// The name is allowed a second line. At 402 pt the name column works out at
/// 175 pt once the deadline keeps a legible 84 pt, and four of the QA account's
/// names measure 180–218 pt; wrapping keeps the name whole where shrinking the
/// type or truncating it would not (§8.1, §10.3 #8).
private struct DeviceListRow: View {
    let device: Device
    /// The row's deadline: `device.effectiveWarrantyEnd` plus this device's
    /// closed-repair days, resolved by the list (`displayedWarrantyEnd`) so the
    /// row and the "BH sắp hết trước" order read one value. `nil` is "no
    /// date", not "expired".
    let warrantyEnd: Date?

    /// The reserved width of the trailing deadline column: 84 pt at the default
    /// content size, not the 96 §8.1 nominates.
    ///
    /// 96 is the widest a value ever needs, not what the name can spare. At
    /// 402 pt the row has 271 pt for the name, the 12 pt gap and the value
    /// (402 − 32 screen gutter − 32 row padding − 28 tile − 24 for the two
    /// outer 12 pt gaps − 15.5 chevron), so the 96 pt reservation left the name
    /// 163 — the four `…` in `after/01-devices.png`. 84 still prints every §6
    /// value (`02/04/2027` measures 92 pt and the pill scales it to 0.91;
    /// `Chưa ghi hạn` needs 84 at the pill's own 0.8 floor) and hands 175 pt to
    /// the name, which is why the name wraps now instead of truncating.
    ///
    /// Reserved rather than measured so every row's value ends at the same x —
    /// a column, not a ragged edge. Scaled, not pinned: at a large
    /// non-Accessibility size a fixed 84 would clip a value mid-word.
    @ScaledMetric(relativeTo: .body) private var valueColumnWidth: CGFloat = 84

    /// At the default size the row is one line per field. At Accessibility
    /// sizes the deadline alone can be wider than the name column, so the row
    /// stacks: the name gets the full width, then the deadline, then the
    /// metadata. Same content, same order — only the axis changes.
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        HStack(alignment: .center, spacing: WVSpacing.md) {
            // Neutral by construction: `WVLeadingIcon` is `fill3` + a `label2`
            // glyph. A category is not a state, so it carries no colour (§5.1).
            WVLeadingIcon(icon: WVCategory.icon(for: device.category), size: 28)
            if dynamicTypeSize.isAccessibilitySize {
                stackedContent
            } else {
                horizontalContent
            }
            WVIcon("arrowRight", size: 13)
                .foregroundStyle(WVColor.label4)
        }
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.vertical, WVSpacing.sm)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }

    private var horizontalContent: some View {
        HStack(alignment: .center, spacing: WVSpacing.md) {
            VStack(alignment: .leading, spacing: WVSpacing.sm) {
                Text(device.name)
                    .wvFont(.bodyEmphasis)
                    .foregroundStyle(WVColor.label)
                    // §8.1 / §10.3 #8: the name is the one thing a row must
                    // not lose. The narrower column gives it 175 pt, so the
                    // names longer than that take a second line instead of an
                    // ellipsis — never a smaller type size, and never a
                    // truncated name beside a surviving value.
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: WVSpacing.sm) {
                    metaText
                        .lineLimit(1)
                    extraBadges
                        // The badges are signals (a receipt, a brand mismatch):
                        // the brand · price line gives way first, never them.
                        .layoutPriority(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            // §10.3 #8: the priority belongs on the block that is the value
            // column's *direct sibling*. `.layoutPriority(1)` on the Text one
            // level down only negotiated with the meta line inside this VStack,
            // never with the deadline column in this HStack. The narrower
            // column is what actually buys the space; this keeps the name
            // first in line if the column ever becomes elastic.
            .layoutPriority(1)

            deadlineColumn
                .frame(width: valueColumnWidth, alignment: .trailing)
        }
    }

    private var stackedContent: some View {
        VStack(alignment: .leading, spacing: WVSpacing.sm) {
            Text(device.name)
                .wvFont(.bodyEmphasis)
                .foregroundStyle(WVColor.label)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
            deadlineColumn
            HStack(spacing: WVSpacing.sm) {
                metaText
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                extraBadges
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// §6, the row form: the absolute date beyond 90 days, a day count inside
    /// 90, `đã hết hạn` grey once it is gone, `chưa ghi hạn` when there is no
    /// date at all. `WarrantyPill` *is* that grammar — it needs the date passed
    /// through, or every deadline past 90 days falls back to a day count.
    ///
    /// Sold short-circuits ahead of it: `WarrantyPill` has no sold input, a sold
    /// device has no deadline to report, and "Đã bán" must win over a date that
    /// is still in the future.
    @ViewBuilder
    private var deadlineColumn: some View {
        if device.status == .SOLD {
            Text(L.t("Đã bán"))
                .wvFont(.body, weight: .medium)
                .foregroundStyle(WVColor.label3)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        } else {
            WarrantyPill(daysLeft: effectiveDaysLeft, endDate: warrantyEnd)
        }
    }

    /// `nil` is "no date", which `WarrantyPill` draws as `Chưa ghi hạn` in
    /// `label4` — not as an expired warranty. Both numbers come from the same
    /// `warrantyEnd` the row prints, so the pill's colour, its day count and
    /// its date cannot disagree.
    private var effectiveDaysLeft: Int? {
        guard let end = warrantyEnd else { return nil }
        return WVFormat.daysUntil(end)
    }

    private var metaText: some View {
        Text("\(device.brand ?? "—") · \(WVFormat.currency(device.purchasePrice, device.currency))")
            .wvFont(.footnote)
            .foregroundStyle(WVColor.label3)
    }

    @ViewBuilder
    private var extraBadges: some View {
        HStack(spacing: WVSpacing.sm) {
            if let count = device.attachmentCount, count > 0 {
                HStack(spacing: WVSpacing.xs) {
                    WVIcon("paperclip", size: 12)
                    Text("\(count)")
                        .wvFont(.footnote)
                }
                .foregroundStyle(WVColor.label3)
            }
            // The brand disagrees with the date this row's deadline was
            // computed from. Show it in the list too, so the flag is not only
            // discoverable after opening the device. Amber because it is data
            // that needs a look, never a fill (§5.2).
            if device.warrantyMismatch != nil {
                HStack(spacing: WVSpacing.xs) {
                    WVIcon("alert", size: 12)
                    Text(BrandWarrantyCopy.mismatchBadge)
                        // 13 pt is the floor for text (§2); this badge used to
                        // be 11 pt next to a 12 pt count.
                        .wvFont(.footnote)
                }
                .foregroundStyle(WVColor.orange)
                .lineLimit(1)
            }
        }
    }
}

// MARK: - Filter sheet

private struct DeviceFilterSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var statusFilter: DeviceStatus?
    @Binding var categoryFilter: String?
    @Binding var sortOrder: DevicesScreen.DeviceSortOrder
    let categories: [CategoryOption]

    /// Coral is the action, and a checkmark is not one: the row's position
    /// already says "selected", so the mark is plain `label` (§5.1).
    private var checkmark: some View {
        WVIcon("check", size: 15)
            .foregroundStyle(WVColor.label)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(DevicesScreen.DeviceSortOrder.allCases, id: \.rawValue) { opt in
                        Button {
                            sortOrder = opt
                        } label: {
                            HStack {
                                Text(opt.label)
                                    .foregroundStyle(WVColor.label)
                                Spacer()
                                if sortOrder == opt {
                                    checkmark
                                }
                            }
                        }
                    }
                } header: {
                    Text(L.t("Sắp xếp"))
                }

                Section {
                    Button {
                        statusFilter = nil
                    } label: {
                        HStack {
                            Text(L.t("Tất cả")).foregroundStyle(WVColor.label)
                            Spacer()
                            if statusFilter == nil {
                                checkmark
                            }
                        }
                    }
                    ForEach(DeviceStatus.allCases, id: \.self) { s in
                        Button {
                            statusFilter = s
                        } label: {
                            HStack {
                                Text(s.label).foregroundStyle(WVColor.label)
                                Spacer()
                                if statusFilter == s {
                                    checkmark
                                }
                            }
                        }
                    }
                } header: {
                    Text(L.t("Trạng thái"))
                }

                // Category filter — mirrors the web's `DevicesFilterBar`,
                // which passes `?category=` to `GET /v1/devices`.
                Section {
                    Button {
                        categoryFilter = nil
                    } label: {
                        HStack {
                            Text(L.t("Tất cả")).foregroundStyle(WVColor.label)
                            Spacer()
                            if categoryFilter == nil {
                                checkmark
                            }
                        }
                    }
                    ForEach(categories) { option in
                        Button {
                            categoryFilter = option.code
                        } label: {
                            HStack {
                                Text(option.name).foregroundStyle(WVColor.label)
                                Spacer()
                                if categoryFilter == option.code {
                                    checkmark
                                }
                            }
                        }
                    }
                } header: {
                    Text(L.t("Loại"))
                }
            }
            .navigationTitle(L.t("Lọc & Sắp xếp"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(L.t("Xoá")) {
                        statusFilter = nil
                        categoryFilter = nil
                        sortOrder = .warrantyAsc
                    }
                    // A secondary control, so not coral (§5.1 — the same rule
                    // that takes the tint off "Hủy" in search, §8.8). "Xong" is
                    // this sheet's one action.
                    .foregroundStyle(WVColor.label)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L.t("Xong")) { dismiss() }
                        .wvFont(.bodyEmphasis)
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Navigation enum

enum DeviceFormNav: Hashable {
    case create
    case edit(Device)
}
