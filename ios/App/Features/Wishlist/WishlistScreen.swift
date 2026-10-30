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
                    wishSummaryCard
                }

                Spacer().frame(height: WVSpacing.md)

                WVSegmented(
                    options: [
                        (WishFilter.watchingDecided, L.t("Đang ngó")),
                        (WishFilter.purchased,       L.t("Đã mua")),
                        (WishFilter.all,             L.t("Tất cả")),
                    ],
                    selection: $filter
                )
                .padding(.horizontal, WVSpacing.gutter)

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
                                .padding(.horizontal, WVSpacing.gutter)
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
        ToolbarItem(placement: .topBarLeading) {
            Button { showSort = true } label: {
                WVIcon("filter", size: 18).foregroundStyle(WVColor.tint)
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button { pushCreate = true } label: {
                Image(systemName: "plus")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(WVColor.tint)
            }
        }
    }

    // MARK: - Summary card

    private var wishSummaryCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(L.p("ĐANG THÈM %d MÓN", watching.count))
                .wvFont(.caption2Emphasis)
                .tracking(1)
                .foregroundStyle(.white.opacity(0.85))
            Text(WVFormat.vnd(watchingTotal))
                .wvFont(.statValue)
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            Text(L.t("Tổng (theo giá hiện tại)"))
                .wvFont(.footnote)
                .foregroundStyle(.white.opacity(0.85))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(
            LinearGradient(
                colors: [Color(hex: "FF2D55"), Color(hex: "AF52DE")],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.top, WVSpacing.sm)
    }

    // MARK: - List

    private var wishList: some View {
        VStack(spacing: 0) {
            WVGroup {
                ForEach(Array(filtered.enumerated()), id: \.element.id) { idx, item in
                    if idx > 0 { WVDivider(inset: 62) }
                    NavigationLink(value: item) {
                        WishRowContent(item: item)
                            .padding(.horizontal, 16)
                            .frame(minHeight: 52)
                            .padding(.vertical, 8)
                    }
                    .buttonStyle(WVRowButtonStyle())
                }
            }
            WVSectionFooter(L.p("%d món", filtered.count))
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
                            if idx > 0 { WVDivider() }
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
                                        WVIcon("check", size: 16, weight: .bold)
                                            .foregroundStyle(WVColor.tint)
                                    }
                                }
                                .padding(.horizontal, 16)
                                .frame(minHeight: 44)
                                .padding(.vertical, 4)
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
                    Button("Xong") { showSort = false }
                        .wvFont(.bodyEmphasis)
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - Row content

private struct WishRowContent: View {
    let item: WishlistItem

    private var delta: Double? {
        guard let init_ = item.initialPrice, let cur = item.currentPrice, init_ != 0 else { return nil }
        let d = Double(cur - init_) / Double(init_) * 100
        return d == 0 ? nil : d
    }

    var body: some View {
        HStack(spacing: 12) {
            WVLeadingIcon(
                icon: WVCategory.icon(for: item.category),
                color: WVCategory.accent(for: item.category),
                size: 36
            )
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(item.name)
                        .wvFont(.callout, weight: .medium)
                        .foregroundStyle(WVColor.label)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    if let cur = item.currentPrice {
                        Text(WVFormat.vnd(cur))
                            .wvFont(.subheadlineEmphasis)
                            .foregroundStyle(WVColor.label)
                    }
                }
                HStack(spacing: 0) {
                    Text([item.brand, item.category]
                        .compactMap { $0 }.filter { !$0.isEmpty }
                        .joined(separator: " · "))
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    if let d = delta {
                        Text("\(d < 0 ? "↓" : "↑") \(String(format: "%.1f", abs(d)))%")
                            .wvFont(.captionEmphasis)
                            .foregroundStyle(d < 0 ? WVColor.green : WVColor.red)
                    }
                }
            }
            WVIcon("arrowRight", size: 13, weight: .semibold)
                .foregroundStyle(WVColor.label4)
        }
    }
}
