import SwiftUI
import WarrantyVaultKit

struct StatsView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var store: StatsStore

    init(client: APIClient) {
        _store = StateObject(wrappedValue: StatsStore(client: client))
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Thống kê")
                .background(WV.Tokens.bg)
        }
        .task { await store.load() }
        .refreshable { await store.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch store.state {
        case .idle, .loading:
            ScrollView {
                WVPageIntro(subtitle: "Đang tổng hợp số liệu của mày…")
                heroGrid(skeleton: true)
                    .padding(.horizontal, WV.Spacing.lg)
                    .padding(.bottom, WV.Spacing.lg)
            }
        case .error(let msg):
            errorState(msg)
        case .loaded:
            ScrollView {
                VStack(alignment: .leading, spacing: WV.Spacing.lg) {
                    WVPageIntro(subtitle: subtitle)
                    heroGrid(skeleton: false)
                        .padding(.horizontal, WV.Spacing.lg)

                    devicesSection
                        .padding(.horizontal, WV.Spacing.lg)
                    subscriptionsSection
                        .padding(.horizontal, WV.Spacing.lg)
                    wishlistSection
                        .padding(.horizontal, WV.Spacing.lg)
                }
                .padding(.bottom, WV.Spacing.xl)
                .animation(.spring(response: 0.4, dampingFraction: 0.85), value: store.snapshot.totalDevices)
            }
        }
    }

    private var subtitle: String {
        let s = store.snapshot
        if s.expiringIn7Days > 0 {
            return "Có \(s.expiringIn7Days) bảo hành hết trong 7 ngày — sắp hết hạn rồi nha."
        }
        if s.expiringIn30Days > 0 {
            return "\(s.expiringIn30Days) bảo hành sắp hết trong 30 ngày."
        }
        return "Mọi thứ đang ổn. Tốt lắm."
    }

    // MARK: - Hero grid

    @ViewBuilder
    private func heroGrid(skeleton: Bool) -> some View {
        let s = store.snapshot
        LazyVGrid(
            columns: [GridItem(.flexible(), spacing: WV.Spacing.md),
                      GridItem(.flexible(), spacing: WV.Spacing.md)],
            spacing: WV.Spacing.md
        ) {
            WVStatCard(
                icon: "square.stack.3d.up.fill",
                value: skeleton ? "–" : "\(s.totalDevices)",
                label: "Thiết bị",
                descriptor: skeleton ? " " : formatVND(s.totalDevicesValue),
                tint: WV.Tokens.primary
            )
            WVStatCard(
                icon: "shield.lefthalf.filled.badge.checkmark",
                value: skeleton ? "–" : "\(s.expiringIn30Days)",
                label: "Bảo hành sắp hết",
                descriptor: skeleton
                    ? " "
                    : (s.expiringIn7Days > 0
                       ? "\(s.expiringIn7Days) gói trong 7 ngày"
                       : "Trong 30 ngày tới"),
                tint: WV.Tokens.warning
            )
            WVStatCard(
                icon: "creditcard.fill",
                value: skeleton ? "–" : "\(s.totalSubs)",
                label: "Đăng ký",
                descriptor: skeleton ? " " : formatVND(s.monthlyEquivalent) + " / tháng",
                tint: WV.Tokens.info
            )
            WVStatCard(
                icon: "heart.fill",
                value: skeleton ? "–" : "\(s.totalWishlist)",
                label: "Wishlist",
                descriptor: skeleton ? " " : formatVND(s.watchingValue) + " đang theo dõi",
                tint: WV.Tokens.pink
            )
        }
        .redacted(reason: skeleton ? .placeholder : [])
    }

    // MARK: - Sections

    private var devicesSection: some View {
        sectionCard(
            title: "Theo trạng thái thiết bị",
            systemImage: "square.stack.3d.up.fill",
            tint: WV.Tokens.primary
        ) {
            VStack(alignment: .leading, spacing: WV.Spacing.sm) {
                ForEach(DeviceStatus.allCases, id: \.self) { status in
                    let n = store.snapshot.devicesByStatus[status] ?? 0
                    if n > 0 {
                        statRow(label: status.label, value: "\(n)")
                    }
                }
                if (DeviceStatus.allCases.allSatisfy { (store.snapshot.devicesByStatus[$0] ?? 0) == 0 }) {
                    Text("Chưa có thiết bị nào.")
                        .font(.system(size: 13))
                        .foregroundStyle(WV.Tokens.mutedFg)
                }
            }
        }
    }

    private var subscriptionsSection: some View {
        sectionCard(
            title: "Theo trạng thái đăng ký",
            systemImage: "creditcard.fill",
            tint: WV.Tokens.info
        ) {
            VStack(alignment: .leading, spacing: WV.Spacing.sm) {
                ForEach(SubscriptionStatus.allCases, id: \.self) { status in
                    let n = store.snapshot.subsByStatus[status] ?? 0
                    if n > 0 {
                        statRow(label: status.label, value: "\(n)")
                    }
                }
                if (SubscriptionStatus.allCases.allSatisfy { (store.snapshot.subsByStatus[$0] ?? 0) == 0 }) {
                    Text("Chưa có gói đăng ký nào.")
                        .font(.system(size: 13))
                        .foregroundStyle(WV.Tokens.mutedFg)
                }
            }
        }
    }

    private var wishlistSection: some View {
        sectionCard(
            title: "Theo trạng thái wishlist",
            systemImage: "heart.fill",
            tint: WV.Tokens.pink
        ) {
            VStack(alignment: .leading, spacing: WV.Spacing.sm) {
                ForEach(WishlistStatus.allCases, id: \.self) { status in
                    let n = store.snapshot.wishlistByStatus[status] ?? 0
                    if n > 0 {
                        statRow(label: status.label, value: "\(n)")
                    }
                }
                if (WishlistStatus.allCases.allSatisfy { (store.snapshot.wishlistByStatus[$0] ?? 0) == 0 }) {
                    Text("Mày chưa thèm cái nào? Lạ thật.")
                        .font(.system(size: 13))
                        .foregroundStyle(WV.Tokens.mutedFg)
                }
            }
        }
    }

    // MARK: - Helpers

    private func sectionCard<Content: View>(
        title: String,
        systemImage: String,
        tint: Color,
        @ViewBuilder content: () -> Content
    ) -> some View {
        WVCard {
            VStack(alignment: .leading, spacing: WV.Spacing.md) {
                HStack(spacing: WV.Spacing.sm) {
                    ZStack {
                        Circle().fill(tint.opacity(0.15))
                        Image(systemName: systemImage)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(tint)
                    }
                    .frame(width: 30, height: 30)
                    Text(title)
                        .font(.title3.weight(.semibold))
                }
                content()
            }
        }
    }

    private func statRow(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 14))
                .foregroundStyle(WV.Tokens.fg)
            Spacer()
            Text(value)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(WV.Tokens.fg)
        }
    }

    private func errorState(_ msg: String) -> some View {
        WVEmptyState(
            icon: "exclamationmark.triangle.fill",
            tint: WV.Tokens.warning,
            title: "Không tải được số liệu",
            message: msg,
            ctaTitle: "Thử lại",
            action: { Task { await store.load() } }
        )
    }
}
