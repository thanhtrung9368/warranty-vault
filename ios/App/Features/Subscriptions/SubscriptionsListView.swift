import SwiftUI
import WarrantyVaultKit

struct SubscriptionsListView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject var store: SubscriptionsStore
    @State private var showAdd = false

    init(client: APIClient) {
        _store = StateObject(wrappedValue: SubscriptionsStore(client: client))
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Đăng ký")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showAdd = true } label: {
                            Image(systemName: "plus.circle.fill")
                                .font(.system(size: 22))
                                .foregroundStyle(WV.Tokens.primary)
                        }
                    }
                }
                .navigationDestination(for: Subscription.self) { sub in
                    SubscriptionDetailView(client: auth.client, listStore: store, subscription: sub)
                }
        }
        .task { await store.load() }
        .refreshable { await store.load() }
        .sheet(isPresented: $showAdd) {
            SubscriptionEditorSheet(store: store, subscription: nil)
        }
        .background(WV.Tokens.bg)
    }

    @ViewBuilder
    private var content: some View {
        switch store.state {
        case .idle:
            ScrollView { WVSkeletonList(count: 4) }
        case .loading where store.subscriptions.isEmpty:
            ScrollView { WVSkeletonList(count: 4) }
        case .error(let msg) where store.subscriptions.isEmpty:
            errorState(msg)
        case .loaded where store.subscriptions.isEmpty:
            emptyState
        default:
            list
        }
    }

    private var subtitle: String {
        let n = store.subscriptions.count
        if n == 0 { return "Chưa có gì cả." }
        return "Mày đang chạy \(n) gói đăng ký."
    }

    private var list: some View {
        ScrollView {
            VStack(spacing: 0) {
                WVPageIntro(subtitle: subtitle)
                LazyVStack(spacing: WV.Spacing.md) {
                ForEach(store.subscriptions) { sub in
                    NavigationLink(value: sub) {
                        SubscriptionCard(subscription: sub)
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button("Gia hạn ngay") {
                            Task { try? await store.renewNow(id: sub.id) }
                        }
                        if sub.status == .ACTIVE {
                            Button("Tạm dừng") {
                                Task { try? await store.setStatus(id: sub.id, status: .PAUSED) }
                            }
                        } else if sub.status == .PAUSED {
                            Button("Tiếp tục") {
                                Task { try? await store.setStatus(id: sub.id, status: .ACTIVE) }
                            }
                        }
                        if sub.status != .CANCELED {
                            Button("Đánh dấu đã huỷ") {
                                Task { try? await store.setStatus(id: sub.id, status: .CANCELED) }
                            }
                        }
                        Button("Xoá", role: .destructive) {
                            Task { try? await store.delete(id: sub.id) }
                        }
                    }
                }
                }
                .padding(WV.Spacing.lg)
                .animation(.spring(response: 0.35, dampingFraction: 0.85), value: store.subscriptions.count)
            }
        }
    }

    private var emptyState: some View {
        WVEmptyState(
            icon: "creditcard.fill",
            tint: WV.Tokens.primary,
            title: "Chưa có gói đăng ký nào",
            message: "Theo dõi Apple One, ChatGPT, Spotify… tất tật ở đây cho khỏi quên gia hạn.",
            ctaTitle: "Thêm gói đầu tiên",
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

private struct SubscriptionCard: View {
    let subscription: Subscription

    var body: some View {
        WVCard {
            HStack(alignment: .top, spacing: WV.Spacing.md) {
                ZStack {
                    RoundedRectangle(cornerRadius: WV.Radius.md)
                        .fill(WV.Tokens.primary.opacity(0.12))
                    Image(systemName: "creditcard.fill")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(WV.Tokens.primary)
                }
                .frame(width: 48, height: 48)

                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(subscription.name)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(WV.Tokens.fg)
                        Spacer()
                        WVStatusPill(subscription.status.label,
                                     kind: kind(for: subscription.status))
                    }
                    if let plan = subscription.plan, !plan.isEmpty {
                        Text(plan)
                            .font(.system(size: 13))
                            .foregroundStyle(WV.Tokens.mutedFg)
                    }
                    HStack(spacing: WV.Spacing.sm) {
                        Label(formatVND(subscription.price), systemImage: "tag")
                            .font(.system(size: 12))
                        Text("•").foregroundStyle(WV.Tokens.mutedFg)
                        Text(subscription.billingCycle.label)
                            .font(.system(size: 12))
                        Spacer()
                        if subscription.billingCycle != .LIFETIME {
                            Label(formatDate(subscription.renewalDate), systemImage: "arrow.clockwise")
                                .font(.system(size: 12))
                        }
                    }
                    .foregroundStyle(WV.Tokens.mutedFg)
                }
            }
        }
    }

    private func kind(for status: SubscriptionStatus) -> WVStatusKind {
        switch status {
        case .ACTIVE:   return .success
        case .PAUSED:   return .warning
        case .CANCELED: return .neutral
        case .EXPIRED:  return .danger
        }
    }
}
