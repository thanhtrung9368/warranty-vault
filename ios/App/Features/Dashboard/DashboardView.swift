import SwiftUI
import WarrantyVaultKit

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

    @StateObject private var devicesStore: DevicesStore
    @StateObject private var subsStore: SubscriptionsStore
    @StateObject private var wishStore: WishlistStore
    @StateObject private var remindersStore: RemindersStore
    @StateObject private var statsStore: StatsStore

    @State private var showQuickAdd = false

    init(client: APIClient) {
        self.client = client
        _devicesStore = StateObject(wrappedValue: DevicesStore(client: client))
        _subsStore = StateObject(wrappedValue: SubscriptionsStore(client: client))
        _wishStore = StateObject(wrappedValue: WishlistStore(client: client))
        _remindersStore = StateObject(wrappedValue: RemindersStore(client: client))
        _statsStore = StateObject(wrappedValue: StatsStore(client: client))
    }

    // MARK: - Computed stats

    /// Upcoming warranties: devices from reminders, sorted soonest first, up to 4.
    private var upcomingFromReminders: [(deviceName: String, category: String, daysLeft: Int, deviceId: String)] {
        remindersStore.entries
            .filter { $0.daysRemaining >= 0 && $0.daysRemaining <= 30 }
            .sorted { $0.daysRemaining < $1.daysRemaining }
            .prefix(4)
            .map { r in
                (deviceName: r.device.name,
                 category: r.device.category,
                 daysLeft: r.daysRemaining,
                 deviceId: r.deviceId)
            }
    }

    private var totalDevices: Int { statsStore.snapshot.totalDevices }
    private var activeDevices: Int { (statsStore.snapshot.devicesByStatus[.ACTIVE] ?? 0) }
    private var expiringSoon: Int { statsStore.snapshot.expiringIn30Days }
    private var expiredDevices: Int {
        // "Đã hết" — count from reminders with negative days
        // Use stats snapshot: total - active? No, model doesn't have "expired warranty" stat.
        // Use reminders entries with daysRemaining < 0 count isn't in store.
        // Best effort from snapshot: any device not ACTIVE.
        (statsStore.snapshot.devicesByStatus[.EXPIRED] ?? 0)
    }
    private var safeActive: Int { max(0, activeDevices - expiringSoon) }

    private var activeSubs: [Subscription] {
        subsStore.subscriptions.filter { $0.status == .ACTIVE }
    }
    private var monthlyTotal: Int {
        statsStore.snapshot.monthlyEquivalent
    }
    private var upcomingSubs: [(sub: Subscription, days: Int)] {
        activeSubs
            .map { s -> (Subscription, Int) in
                let days = Calendar.current.dateComponents([.day], from: Date(), to: s.renewalDate).day ?? 0
                return (s, days)
            }
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

                // 2×2 stat widget grid
                statGrid
                    .padding(.horizontal, WVSpacing.gutter)
                    .padding(.bottom, 4)

                // Upcoming warranties
                upcomingWarrantiesSection

                // Subscriptions cost card
                if activeSubs.count > 0 {
                    subsSection
                }

                // Wishlist preview
                if wishItems.count > 0 {
                    wishlistSection
                }

                Spacer().frame(height: 24)
            }
        }
        .wvScreen()
        .navigationTitle("Tổng quan")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showQuickAdd = true } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
        .sheet(isPresented: $showQuickAdd) {
            DashQuickAddSheet()
        }
        .navigationDestination(for: DashDeviceNav.self) { nav in
            // Find the device from store; if not found yet show the detail with a placeholder.
            let device = devicesStore.devices.first(where: { $0.id == nav.id })
            if let device {
                DeviceDetailView(client: client, devicesStore: devicesStore, device: device)
            } else {
                // Device not in store yet — navigate anyway with a loading placeholder.
                ProgressView("Đang tải...")
                    .navigationTitle(nav.name)
                    .task { await devicesStore.load() }
            }
        }
        .task {
            await withTaskGroup(of: Void.self) { g in
                g.addTask { await self.devicesStore.load() }
                g.addTask { await self.subsStore.load() }
                g.addTask { await self.wishStore.load() }
                g.addTask { await self.remindersStore.load() }
                g.addTask { await self.statsStore.load() }
            }
        }
        .refreshable {
            await withTaskGroup(of: Void.self) { g in
                g.addTask { await self.devicesStore.load() }
                g.addTask { await self.subsStore.load() }
                g.addTask { await self.wishStore.load() }
                g.addTask { await self.remindersStore.load() }
                g.addTask { await self.statsStore.load() }
            }
        }
    }

    // MARK: - Greeting

    private var userName: String {
        if case .authenticated(let user) = auth.status {
            return user.name ?? user.email.components(separatedBy: "@").first ?? "Bạn"
        }
        return "Bạn"
    }

    private var greetingTitle: String {
        let h = Calendar.current.component(.hour, from: Date())
        if h < 12 { return "Chào buổi sáng," }
        if h < 18 { return "Chào buổi chiều," }
        return "Chào buổi tối,"
    }

    private var greetingSection: some View {
        WVHeroGreeting(name: userName, subtitle: greetingTitle)
    }

    // MARK: - Stat grid

    private var statGrid: some View {
        let cols = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]
        return LazyVGrid(columns: cols, spacing: 12) {
            WVWidget(
                eyebrow: "Thiết bị",
                value: "\(totalDevices)",
                sub: "đang theo dõi",
                icon: "package",
                brand: true
            )
            WVWidget(
                eyebrow: "Còn BH",
                value: "\(safeActive)",
                sub: "được bảo vệ",
                icon: "shieldCheck"
            )
            WVWidget(
                eyebrow: "Sắp hết ≤30d",
                value: "\(expiringSoon)",
                sub: expiringSoon > 0 ? "để ý nha" : "không có",
                icon: "alert"
            )
            WVWidget(
                eyebrow: "Đã hết",
                value: "\(expiredDevices)",
                sub: "hết kèo",
                icon: "shieldX"
            )
        }
        .padding(.bottom, 4)
    }

    // MARK: - Upcoming warranties

    @ViewBuilder
    private var upcomingWarrantiesSection: some View {
        WVDashSectionHead("Sắp hết bảo hành")
            .padding(.top, 8)

        if upcomingFromReminders.isEmpty {
            WVGroup {
                WVRow(
                    icon: "checkCircle",
                    iconColor: WVColor.green,
                    title: "Tất cả đều ngon",
                    subtitle: "Không có gói nào sắp hết trong 30 ngày"
                )
            }
            .padding(.bottom, 4)
        } else {
            WVGroup {
                ForEach(Array(upcomingFromReminders.enumerated()), id: \.offset) { idx, item in
                    if idx > 0 { WVDivider(inset: 60) }
                    NavigationLink(value: DashDeviceNav(id: item.deviceId, name: item.deviceName)) {
                        DashWarrantyRow(
                            name: item.deviceName,
                            category: item.category,
                            daysLeft: item.daysLeft
                        )
                    }
                    .buttonStyle(WVRowButtonStyle())
                }
            }
            .padding(.bottom, 4)
        }
    }

    // MARK: - Subscriptions section

    private var subsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            WVDashSectionHead("Gói đăng ký")

            WVCard(padding: 16) {
                VStack(alignment: .leading, spacing: 0) {
                    // Monthly total
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(WVFormat.vnd(monthlyTotal))
                            .font(.system(size: 28, weight: .bold))
                            .foregroundStyle(WVColor.label)
                        Text("/ tháng")
                            .font(.system(size: 13))
                            .foregroundStyle(WVColor.label3)
                    }
                    Text("~ \(WVFormat.vnd(monthlyTotal * 12))/năm · \(activeSubs.count) gói đang chạy")
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.label3)
                        .padding(.top, 2)

                    Rectangle()
                        .fill(WVColor.sep)
                        .frame(height: 0.5)
                        .padding(.vertical, 12)

                    Text("SẮP GIA HẠN")
                        .font(.system(size: 12, weight: .semibold))
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
            WVDashSectionHead("Đang thèm")
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

// MARK: - Dash warranty row

private struct DashWarrantyRow: View {
    let name: String
    let category: String
    let daysLeft: Int

    var body: some View {
        HStack(spacing: 12) {
            WVLeadingIcon(
                icon: WVCategory.icon(for: category),
                color: WVCategory.accent(for: category),
                size: 36
            )
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(WVColor.label)
                    .lineLimit(1)
                Text(categoryLabel(category))
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            WarrantyPill(daysLeft: daysLeft)
            WVIcon("arrowRight", size: 13)
                .foregroundStyle(WVColor.label4)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .padding(.vertical, 7)
        .contentShape(Rectangle())
    }

    private func categoryLabel(_ code: String) -> String {
        // Map category codes to Vietnamese display labels
        switch code.lowercased() {
        case "phone":     return "Điện thoại"
        case "laptop":    return "Laptop"
        case "tablet":    return "Máy tính bảng"
        case "watch":     return "Đồng hồ"
        case "tv":        return "TV"
        case "audio":     return "Tai nghe / Loa"
        case "camera":    return "Camera"
        case "appliance": return "Thiết bị gia dụng"
        case "console":   return "Máy chơi game"
        case "monitor":   return "Màn hình"
        case "printer":   return "Máy in"
        case "vehicle":   return "Xe cộ"
        default:          return code
        }
    }
}

// MARK: - Dash sub row

private struct DashSubRow: View {
    let sub: Subscription
    let days: Int

    var body: some View {
        HStack(spacing: 10) {
            WVLeadingIcon(
                icon: WVCategory.icon(for: sub.category),
                color: WVCategory.accent(for: sub.category),
                size: 28
            )
            Text(sub.name)
                .font(.system(size: 15))
                .foregroundStyle(WVColor.label)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(WVFormat.date(sub.renewalDate))
                .font(.system(size: 13))
                .foregroundStyle(days < 0 ? WVColor.red : WVColor.label3)
                .lineLimit(1)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Quick-add sheet

private struct DashQuickAddSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        // Action sheet style — just a list of options.
        NavigationStack {
            List {
                Section {
                    Label("Thiết bị", systemImage: "shippingbox.fill")
                        .font(.system(size: 17))
                        .foregroundStyle(WVColor.label)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                        .onTapGesture { dismiss() }

                    Label("Gói đăng ký", systemImage: "arrow.triangle.2.circlepath")
                        .font(.system(size: 17))
                        .foregroundStyle(WVColor.label)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                        .onTapGesture { dismiss() }

                    Label("Wishlist", systemImage: "heart.fill")
                        .font(.system(size: 17))
                        .foregroundStyle(WVColor.label)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                        .onTapGesture { dismiss() }
                } header: {
                    Text("Thêm nhanh")
                }
            }
            .navigationTitle("Thêm nhanh")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Xong") { dismiss() }
                        .font(.system(size: 17, weight: .semibold))
                }
            }
        }
        .presentationDetents([.medium])
    }
}
