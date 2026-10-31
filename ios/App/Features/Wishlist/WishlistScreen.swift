import SwiftUI
import WarrlyKit

// MARK: - Filter

private enum WishFilter: String, Hashable {
    case watchingDecided = "WATCHING_DECIDED"
    case purchased       = "PURCHASED"
    case all             = ""
}

// MARK: - Sort

private enum WishSort: String, CaseIterable {
    case priorityDesc = "priority-desc"
    case targetAsc    = "target-asc"
    case priceDesc    = "price-desc"
    case priceAsc     = "price-asc"

    var label: String {
        switch self {
        case .priorityDesc: return L.t("Mức độ thèm cao")
        case .targetAsc:    return L.t("Target gần nhất")
        case .priceDesc:    return L.t("Giá cao")
        case .priceAsc:     return L.t("Giá thấp")
        }
    }
}

private let priorityOrder: [WishlistPriority: Int] = [.MUST: 3, .WANT: 2, .MAYBE: 1]

// MARK: - WishlistScreen

/// Wishlist — §8.6 of the visual direction.
///
/// This screen leads with the items: there is no summary block. The old
/// pink→purple gradient hero is now one 13 pt line directly under the title
/// (`3 món · 57.380.000 ₫`), and the segment control sits directly under that
/// line. Rows are the shared content-row anatomy (§3/§8.1): 28 pt neutral tile,
/// `rowTitle` name, `meta` brand · category label, then the price (`rowValue`)
/// with the target date under it as the §6 deadline column.
struct WishlistScreen: View {
    let client: APIClient
    @StateObject private var store: WishlistStore
    @EnvironmentObject private var toast: WVToastCenter
    /// Destination requested by a tapped wishlist reminder
    /// (`url: /wishlist/<id>`). Consumed once the tab is on screen.
    @EnvironmentObject private var router: AppRouter

    @State private var query      = ""
    @State private var filter     = WishFilter.watchingDecided
    @State private var sort       = WishSort.priorityDesc
    @State private var showSort   = false
    @State private var pushCreate = false
    /// The id a push asked for. Its own destination binding rather than a value
    /// pushed from the list: the detail screen loads by id, so it can open even
    /// when the row is filtered out or the list has not arrived yet.
    @State private var deepLinkedWishlistId: String?

    init(client: APIClient) {
        self.client = client
        _store = StateObject(wrappedValue: WishlistStore(client: client))
    }

    // MARK: - Computed

    private var watching: [WishlistItem] {
        store.items.filter { $0.status == .WATCHING || $0.status == .DECIDED }
    }
    private var watchingTotal: Int {
        watching.reduce(0) { $0 + ($1.currentPrice ?? 0) }
    }

    private var filtered: [WishlistItem] {
        var arr = store.items
        let ql = query.lowercased()
        if !ql.isEmpty {
            arr = arr.filter {
                "\($0.name) \($0.brand ?? "")".lowercased().contains(ql)
            }
        }
        switch filter {
        case .watchingDecided:
            arr = arr.filter { $0.status == .WATCHING || $0.status == .DECIDED }
        case .purchased:
            arr = arr.filter { $0.status == .PURCHASED }
        case .all:
            break
        }
        switch sort {
        case .priorityDesc:
            arr.sort { (priorityOrder[$0.priority] ?? 0) > (priorityOrder[$1.priority] ?? 0) }
        case .targetAsc:
            arr.sort {
                let a = $0.targetDate ?? Date.distantFuture
                let b = $1.targetDate ?? Date.distantFuture
                return a < b
            }
        case .priceDesc:
            arr.sort { ($0.currentPrice ?? 0) > ($1.currentPrice ?? 0) }
        case .priceAsc:
            arr.sort { ($0.currentPrice ?? 0) < ($1.currentPrice ?? 0) }
        }
        return arr
    }

    // MARK: - Body

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                if !watching.isEmpty {
                    wishSummaryLine
                }

                WVSegmented(
                    options: [
                        (WishFilter.watchingDecided, L.t("Đang ngó")),
                        (WishFilter.purchased,       L.t("Đã mua")),
                        (WishFilter.all,             L.t("Tất cả")),
                    ],
                    selection: $filter
                )
                .padding(.horizontal, WVSpacing.gutter)
                .padding(.top, WVSpacing.sm)

                Spacer().frame(height: WVSpacing.md)

                if filtered.isEmpty {
                    WVEmpty(
                        icon: query.isEmpty ? "heart" : "search",
                        title: query.isEmpty ? L.t("Wishlist trống") : L.t("Không có gì khớp"),
                        description: query.isEmpty
                            ? L.t("Note đồ đang thèm — giá, link, deadline.")
                            : L.t("Thử từ khoá khác")
                    ) {
                        if query.isEmpty {
                            WVButton(L.t("Thêm món"), icon: "plus") { pushCreate = true }
                        }
                    }
                } else {
                    wishList
                }

                Spacer().frame(height: WVSpacing.xl)
            }
        }
        .wvScreen()
        .navigationTitle("Wishlist")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $query, prompt: L.t("Tìm món..."))
        .toolbar { toolbarContent }
        .task {
            await openPendingWishlistIfNeeded()
            await store.load()
        }
        .refreshable { await store.load() }
        .onChange(of: router.pendingWishlistId) { _, id in
            guard id != nil else { return }
            Task { await openPendingWishlistIfNeeded() }
        }
        .sheet(isPresented: $showSort) { sortSheet }
        .navigationDestination(for: WishlistItem.self) { item in
            WishlistDetailView(client: client, store: store, itemId: item.id)
        }
        .navigationDestination(item: $deepLinkedWishlistId) { id in
            WishlistDetailView(client: client, store: store, itemId: id)
        }
        .navigationDestination(isPresented: $pushCreate) {
            WishlistFormView(client: client, store: store)
        }
    }

    /// Takes a notification's destination exactly once, after the tab appears.
    /// `AppRouter` keeps the id until then, so a cold launch from a push still
    /// lands on the right wishlist item. `WishlistDetailView` fetches by id, so
    /// the item does not have to be in `store` yet.
    private func openPendingWishlistIfNeeded() async {
        guard let id = router.consumeWishlist() else { return }
        deepLinkedWishlistId = id
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        // Sort is a secondary control: `label2`, not coral (§5.1).
        ToolbarItem(placement: .topBarLeading) {
            Button { showSort = true } label: {
                WVIcon("filter", size: 18).foregroundStyle(WVColor.label2)
            }
        }
        // The one coral affordance on this screen.
        ToolbarItem(placement: .topBarTrailing) {
            Button { pushCreate = true } label: {
                WVIcon("plus", size: 17, weight: .semibold)
                    .foregroundStyle(WVColor.tint)
            }
        }
    }

    // MARK: - Summary line

    /// The `ĐANG THÊM 3 MÓN / 57.380.000 ₫` hero used to be a gradient card.
    /// This screen leads with the items, so it collapses to one meta line; the
    /// item count now lives here instead of in the footer it replaced.
    private var wishSummaryLine: some View {
        Text(L.p("%d món", watching.count) + " · " + WVFormat.vnd(watchingTotal))
            .wvFont(.footnote)
            .foregroundStyle(WVColor.label3)
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, WVSpacing.gutter)
            .padding(.top, WVSpacing.sm)
    }

    // MARK: - List

    private var wishList: some View {
        WVGroup {
            ForEach(Array(filtered.enumerated()), id: \.element.id) { idx, item in
                if idx > 0 { WVDivider() }
                NavigationLink(value: item) {
                    WishRowContent(item: item)
                        .padding(.horizontal, WVSpacing.gutter)
                        .frame(minHeight: 44)
                        .padding(.vertical, WVSpacing.sm)
                }
                .buttonStyle(WVRowButtonStyle())
            }
        }
    }

    // MARK: - Sort sheet

    private var sortSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    Spacer().frame(height: WVSpacing.md)
                    WVGroup {
                        ForEach(Array(WishSort.allCases.enumerated()), id: \.element) { idx, s in
                            // Text-only rows have no leading icon, so the 56 pt
                            // icon-derived hairline would float under the label.
                            if idx > 0 { WVDivider(inset: WVSpacing.gutter) }
                            Button {
                                sort = s
                                showSort = false
                            } label: {
                                HStack {
                                    Text(s.label)
                                        .wvFont(.body)
                                        .foregroundStyle(WVColor.label)
                                    Spacer()
                                    if sort == s {
                                        // Position already says "selected" — the
                                        // checkmark is `label`, not coral (§5.1).
                                        WVIcon("check", size: 16, weight: .bold)
                                            .foregroundStyle(WVColor.label)
                                    }
                                }
                                .padding(.horizontal, WVSpacing.gutter)
                                .frame(minHeight: 44)
                                .padding(.vertical, WVSpacing.xs)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(WVRowButtonStyle())
                        }
                    }
                }
            }
            .wvScreen()
            .navigationTitle(L.t("Sắp xếp"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L.t("Xong")) { showSort = false }
                        .wvFont(.bodyEmphasis)
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - Row content

/// One wishlist row. Same anatomy as every other content row (§3): neutral
/// 28 pt tile with a 20 pt glyph, name + meta on the left, and the value
/// column on the right — here the price, with the §6 target-date column under
/// it. The value column is reserved at the shared 96 pt (§8.1), so the price
/// can never be squeezed to a few points and reduced to a lone separator; the
/// name takes whatever width is left after that column.
private struct WishRowContent: View {
    let item: WishlistItem

    /// The reserved width of the trailing value column — the same 96 pt the
    /// device row uses (§8.1). Reserved rather than measured so every row's
    /// price ends on the same x, and so a long name can never take the space
    /// the price needs. This is the Breville-row fix: `layoutPriority(1)` on
    /// the name without a reserved column let the name consume the row and
    /// left the trailing price a few points wide.
    ///
    /// Scaled, not pinned: at a large non-Accessibility size a fixed 96 would
    /// squeeze the price (and a target-date label) below their minimum scale.
    @ScaledMetric(relativeTo: .body) private var valueColumnWidth: CGFloat = 96

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var delta: Double? {
        guard let init_ = item.initialPrice, let cur = item.currentPrice, init_ != 0 else { return nil }
        let d = Double(cur - init_) / Double(init_) * 100
        return d == 0 ? nil : d
    }

    /// `Apple · Laptop` — the catalog label, never the raw wire code (§8.6).
    private var categoryLabel: String? {
        guard let code = item.category, !code.isEmpty else { return nil }
        return CategoryLabels.label(for: code)
    }

    private var meta: String {
        [item.brand, categoryLabel]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            accessibilityRow
        } else {
            regularRow
        }
    }

    // MARK: Layout

    private var regularRow: some View {
        HStack(spacing: WVSpacing.md) {
            leadingIcon
            // The name fills the width the value column does not need and keeps
            // layout priority over the remainder (§10.3 #8), but the reserved
            // column — not the priority — is what keeps the price on screen.
            // Priority alone let a long name consume the row and left the
            // trailing price a few points wide (§8.6).
            nameAndMeta
                .frame(maxWidth: .infinity, alignment: .leading)
                .layoutPriority(1)
            valueColumn(alignment: .trailing)
                .frame(width: valueColumnWidth, alignment: .trailing)
            chevron
        }
    }

    /// At Accessibility sizes the value column no longer fits beside the name,
    /// so it moves under it — same information, same order, one axis.
    private var accessibilityRow: some View {
        VStack(alignment: .leading, spacing: WVSpacing.sm) {
            HStack(alignment: .top, spacing: WVSpacing.md) {
                leadingIcon
                nameAndMeta
                    .layoutPriority(1)
                chevron
            }
            valueColumn(alignment: .leading)
                .padding(.leading, 40)   // 28 pt tile + 12 pt gap
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var leadingIcon: some View {
        WVLeadingIcon(icon: WVCategory.icon(for: item.category), size: 28)
    }

    private var chevron: some View {
        WVIcon("arrowRight", size: 13, weight: .semibold)
            .foregroundStyle(WVColor.label4)
    }

    private var nameAndMeta: some View {
        VStack(alignment: .leading, spacing: WVSpacing.xs) {
            Text(item.name)
                .wvFont(.bodyEmphasis)
                .foregroundStyle(WVColor.label)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
                .fixedSize(horizontal: false, vertical: true)

            if !meta.isEmpty || delta != nil {
                HStack(spacing: WVSpacing.sm) {
                    if !meta.isEmpty {
                        Text(meta)
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.label3)
                            .lineLimit(1)
                    }
                    if let d = delta {
                        // A verdict, not an identity: meta size, state colour.
                        Text(deltaLabel(d))
                            .wvFont(.footnote)
                            .foregroundStyle(d < 0 ? WVColor.green : WVColor.red)
                            .lineLimit(1)
                    }
                }
            }
        }
    }

    /// Price (`rowValue`, always `label`) over the target date (§6). The date
    /// is only drawn when the item has one — a wishlist item is not a warranty,
    /// so there is no "chưa ghi hạn" fallback here.
    private func valueColumn(alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: WVSpacing.xs) {
            if let cur = item.currentPrice {
                Text(WVFormat.vnd(cur))
                    .wvFont(.body, weight: .medium)
                    .foregroundStyle(WVColor.label)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            if let target = item.targetDate {
                WarrantyPill(daysLeft: WVFormat.daysUntil(target), endDate: target)
            }
        }
    }

    private func deltaLabel(_ d: Double) -> String {
        "\(d < 0 ? "↓" : "↑") \(String(format: "%.1f", abs(d)))%"
    }
}
