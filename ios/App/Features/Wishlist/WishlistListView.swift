import SwiftUI
import WarrantyVaultKit

struct WishlistListView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject var store: WishlistStore
    @State private var showAdd = false

    init(client: APIClient) {
        _store = StateObject(wrappedValue: WishlistStore(client: client))
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Thèm")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showAdd = true } label: {
                            Image(systemName: "plus.circle.fill")
                                .font(.system(size: 22))
                                .foregroundStyle(WV.Tokens.primary)
                        }
                    }
                }
                .navigationDestination(for: WishlistItem.self) { item in
                    WishlistDetailView(client: auth.client, store: store, itemId: item.id)
                }
        }
        .task { await store.load() }
        .refreshable { await store.load() }
        .sheet(isPresented: $showAdd) {
            WishlistEditorSheet(store: store, item: nil)
        }
        .background(WV.Tokens.bg)
    }

    @ViewBuilder
    private var content: some View {
        switch store.state {
        case .idle:
            ScrollView { WVSkeletonList(count: 4) }
        case .loading where store.items.isEmpty:
            ScrollView { WVSkeletonList(count: 4) }
        case .error(let msg) where store.items.isEmpty:
            errorState(msg)
        case .loaded where store.items.isEmpty:
            emptyState
        default:
            list
        }
    }

    private var subtitle: String {
        let n = store.items.count
        if n == 0 { return "Mày chưa thèm cái nào." }
        return "Đang theo dõi \(n) món thèm."
    }

    private var list: some View {
        ScrollView {
            VStack(spacing: 0) {
                WVPageIntro(subtitle: subtitle)
                LazyVStack(spacing: WV.Spacing.md) {
                    ForEach(store.items) { item in
                        NavigationLink(value: item) {
                            WishlistCard(item: item)
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button("Xoá", role: .destructive) {
                                Task { try? await store.delete(id: item.id) }
                            }
                        }
                    }
                }
                .padding(WV.Spacing.lg)
                .animation(.spring(response: 0.35, dampingFraction: 0.85), value: store.items.count)
            }
        }
    }

    private var emptyState: some View {
        WVEmptyState(
            icon: "heart.fill",
            tint: WV.Tokens.pink,
            title: "Wishlist trống — thêm cái mày thèm đi",
            message: "Mày chưa thèm cái nào? Lạ thật. Thêm món muốn mua để theo dõi giá và nhắc lại sau.",
            ctaTitle: "Thêm món đầu tiên",
            action: { showAdd = true }
        )
    }

    private func errorState(_ msg: String) -> some View {
        WVEmptyState(
            icon: "exclamationmark.triangle.fill",
            tint: WV.Tokens.warning,
            title: "Không tải được dữ liệu",
            message: msg,
            ctaTitle: "Thử lại",
            action: { Task { await store.load() } }
        )
    }
}

private struct WishlistCard: View {
    let item: WishlistItem

    var body: some View {
        WVCard {
            HStack(alignment: .top, spacing: WV.Spacing.md) {
                ZStack {
                    RoundedRectangle(cornerRadius: WV.Radius.md)
                        .fill(WV.Tokens.pink.opacity(0.15))
                    Image(systemName: "heart.fill")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(WV.Tokens.pink)
                }
                .frame(width: 48, height: 48)

                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(item.name)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(WV.Tokens.fg)
                        Spacer()
                        WVStatusPill(item.priority.label,
                                     kind: kind(for: item.priority))
                    }
                    HStack(spacing: WV.Spacing.sm) {
                        if let brand = item.brand, !brand.isEmpty {
                            Text(brand).font(.system(size: 13))
                        }
                        Spacer()
                        WVStatusPill(item.status.label,
                                     kind: kind(for: item.status))
                    }
                    .foregroundStyle(WV.Tokens.mutedFg)
                    HStack(spacing: WV.Spacing.sm) {
                        if let cur = item.currentPrice {
                            Label(formatVND(cur), systemImage: "tag")
                                .font(.system(size: 12))
                        }
                        if let init_ = item.initialPrice, init_ != item.currentPrice {
                            Text("ban đầu " + formatVND(init_))
                                .font(.system(size: 12))
                                .strikethrough()
                        }
                        Spacer()
                        if let target = item.targetDate {
                            Label(formatDate(target), systemImage: "calendar")
                                .font(.system(size: 12))
                        }
                    }
                    .foregroundStyle(WV.Tokens.mutedFg)
                }
            }
        }
    }

    private func kind(for priority: WishlistPriority) -> WVStatusKind {
        switch priority {
        case .MUST:  return .danger
        case .WANT:  return .warning
        case .MAYBE: return .neutral
        }
    }

    private func kind(for status: WishlistStatus) -> WVStatusKind {
        switch status {
        case .WATCHING:  return .info
        case .DECIDED:   return .success
        case .SKIPPED:   return .neutral
        case .PURCHASED: return .success
        }
    }
}
