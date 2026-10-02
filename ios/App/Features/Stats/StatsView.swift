import SwiftUI
import WarrantyVaultKit

// ============================================================
// StatsView — overview statistics dashboard.
// Port of StatsScreen in screens-3.jsx.
// Uses WVBarChart / WVDonut from Charts.swift.
// Data comes from StatsStore (per-user rollups) + RemindersStore.
// ============================================================

struct StatsView: View {
    let client: APIClient

    @StateObject private var store: StatsStore
    /// Only used as the push destination for the "Top 5 thiết bị đắt nhất" rows.
    @StateObject private var devicesStore: DevicesStore

    /// Year shown in the "Tổng chi theo năm" card. `nil` until the rollup has
    /// loaded, so we can default to the current year without a flash.
    @State private var selectedYear: Int?

    init(client: APIClient) {
        self.client = client
        _store = StateObject(wrappedValue: StatsStore(client: client))
        _devicesStore = StateObject(wrappedValue: DevicesStore(client: client))
    }

    var body: some View {
        Group {
            switch store.state {
            case .idle, .loading:
                ScrollView {
                    VStack(spacing: 0) {
                        Spacer().frame(height: 8)
                        statsHeroSkeleton
                        Spacer().frame(height: 24)
                    }
                }
                .wvScreen()

            case .error(let msg):
                ScrollView {
                    WVEmpty(icon: "alert", title: "Không tải được số liệu", description: msg) {
                        WVButton("Thử lại") { Task { await loadAll() } }
                            .padding(.horizontal, 32)
                    }
                }
                .wvScreen()

            case .loaded:
                if store.snapshot.totalDevices == 0 && store.snapshot.totalSubs == 0 {
                    ScrollView {
                        WVEmpty(icon: "chart",
                                title: "Chưa có gì để thống kê",
                                description: "Thêm thiết bị xong quay lại nhé.")
                    }
                    .wvScreen()
                } else {
                    mainContent
                }
            }
        }
        .task { await loadAll() }
        .refreshable { await loadAll() }
        .navigationDestination(for: DashDeviceNav.self) { nav in
            if let device = devicesStore.devices.first(where: { $0.id == nav.id }) {
                DeviceDetailView(client: client, devicesStore: devicesStore, device: device)
            } else {
                ProgressView("Đang tải...")
                    .navigationTitle(nav.name)
                    .task { await devicesStore.load() }
            }
        }
    }

    // MARK: - Main content

    private var mainContent: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer().frame(height: 8)

                // Hero gradient card
                heroCard
                    .padding(.horizontal, WVSpacing.gutter)

                Spacer().frame(height: 12)

                // Widget row
                widgetRow
                    .padding(.horizontal, WVSpacing.gutter)

                if !store.snapshot.warrantiesComplete {
                    incompleteWarrantiesBanner
                }

                // KPI row — same four numbers as the web stats page.
                WVSectionHeader("Chi phí & tài sản")
                kpiGrid

                // 12-month bar chart
                WVSectionHeader("Chi phí 12 tháng gần nhất")
                WVSectionFooter("Gồm tiền thiết bị và gói bảo hành (tính theo ngày bắt đầu của gói).")
                WVCard {
                    WVBarChart(
                        data: monthBarData,
                        height: 160,
                        color: WVColor.brand,
                        formatY: { v in
                            if v >= 1_000_000 { return "\(Int(v / 1_000_000))M" }
                            if v >= 1_000     { return "\(Int(v / 1_000))k" }
                            return "\(Int(v))"
                        }
                    )
                }

                // Category donut
                WVSectionHeader("Phân bổ theo loại")
                WVSectionFooter("Gói bảo hành được tính vào loại của thiết bị mà nó bảo vệ.")
                WVCard {
                    HStack(spacing: 16) {
                        WVDonut(data: donutSlices, size: 120)
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(donutSlices.prefix(6)) { slice in
                                HStack(spacing: 6) {
                                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                                        .fill(slice.color)
                                        .frame(width: 10, height: 10)
                                    Text(slice.label)
                                        .font(.system(size: 13))
                                        .foregroundStyle(WVColor.label)
                                        .lineLimit(1)
                                    Spacer(minLength: 4)
                                    Text(WVFormat.compactVnd(Int(slice.value)))
                                        .font(.system(size: 12))
                                        .foregroundStyle(WVColor.label3)
                                }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }

                // Year breakdown + top 5
                yearSection
                topDevicesSection

                // Summary section cards
                WVSectionHeader("Theo trạng thái")
                summaryCards

                Spacer().frame(height: 24)
            }
        }
        .wvScreen()
    }

    // MARK: - Hero gradient card

    private var heroCard: some View {
        let snap = store.snapshot
        return VStack(alignment: .leading, spacing: 6) {
            Text("TỔNG GIÁ TRỊ THIẾT BỊ")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.white.opacity(0.85))
                .tracking(1)
            Text(WVFormat.vnd(snap.totalDevicesValue))
                .font(.system(size: 32, weight: .bold))
                .foregroundStyle(.white)
            Text("\(snap.totalDevices) thiết bị · \(snap.activeSubs) đăng ký đang hoạt động")
                .font(.system(size: 13))
                .foregroundStyle(.white.opacity(0.85))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(
            LinearGradient(
                colors: [Color(hex: "FF6B45"), Color(hex: "FF2D55")],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
    }

    private var statsHeroSkeleton: some View {
        RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous)
            .fill(WVColor.fill3)
            .frame(height: 110)
            .padding(.horizontal, WVSpacing.gutter)
            .redacted(reason: .placeholder)
    }

    private var incompleteWarrantiesBanner: some View {
        HStack(alignment: .top, spacing: 8) {
            WVIcon("alert", size: 14)
            Text("Không tải được gói bảo hành của một vài thiết bị — các con số bên dưới có thể thiếu.")
                .font(.system(size: 13))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .foregroundStyle(WVColor.orange)
        .padding(12)
        .background(WVColor.orange.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.top, 12)
    }

    // MARK: - Widget row

    private var widgetRow: some View {
        let snap = store.snapshot
        return HStack(spacing: 12) {
            WVWidget(
                eyebrow: "Bảo hành sắp hết",
                value: "\(snap.expiringIn30Days)",
                sub: "trong 30 ngày",
                icon: "shieldCheck"
            )
            WVWidget(
                eyebrow: "Sub mỗi tháng",
                value: WVFormat.compactVnd(snap.monthlyEquivalent),
                sub: "\(snap.activeSubs) gói đang chạy",
                icon: "refresh"
            )
        }
    }

    // MARK: - KPI grid

    private var kpiGrid: some View {
        let snap = store.snapshot
        let year = currentYear
        let yearTotals = store.yearTotals(year)
        let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

        return LazyVGrid(columns: columns, spacing: 12) {
            WVStatCard(
                eyebrow: "Tổng chi \(year)",
                value: WVFormat.compactVnd(yearTotals.total),
                sub: "\(yearTotals.deviceCount) thiết bị • \(yearTotals.warrantyCount) gói BH"
            )
            WVStatCard(
                eyebrow: "Tổng chi mua sắm",
                value: WVFormat.compactVnd(snap.allTimeTotals.total),
                sub: "\(snap.allTimeTotals.deviceCount) thiết bị • \(snap.allTimeTotals.warrantyCount) gói BH"
            )
            WVStatCard(
                eyebrow: "Tài sản còn bảo hành",
                value: WVFormat.compactVnd(snap.assetValue.total),
                sub: "\(snap.assetValue.count)/\(snap.totalDevices) thiết bị"
            )
            WVStatCard(
                eyebrow: "Phí định kỳ mỗi tháng",
                value: WVFormat.compactVnd(snap.monthlyEquivalent),
                sub: "~\(WVFormat.compactVnd(snap.monthlyEquivalent * 12))/năm"
            )
        }
        .padding(.horizontal, WVSpacing.gutter)
    }

    // MARK: - Year breakdown

    private var currentYear: Int {
        selectedYear ?? Calendar.current.component(.year, from: Date())
    }

    private var yearSection: some View {
        let year = currentYear
        let totals = store.yearTotals(year)
        let byCategory = store.yearCategoryTotals(year)
            .filter { $0.total > 0 }
            .sorted { $0.total > $1.total }

        return VStack(spacing: 0) {
            HStack {
                Text("TỔNG CHI THEO NĂM")
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.label3)
                Spacer()
                yearPicker
            }
            .padding(.horizontal, 32)
            .padding(.top, 20)
            .padding(.bottom, 6)

            WVCard {
                VStack(alignment: .leading, spacing: 4) {
                    Text(WVFormat.vnd(totals.total))
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(WVColor.label)
                    Text("\(totals.deviceCount) thiết bị • \(totals.warrantyCount) gói trong \(year)")
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.label3)

                    if byCategory.isEmpty {
                        Text("Chưa có chi phí nào trong năm \(year).")
                            .font(.system(size: 13))
                            .foregroundStyle(WVColor.label3)
                            .padding(.top, 10)
                    } else {
                        ForEach(byCategory) { row in
                            HStack(spacing: 8) {
                                WVLeadingIcon(
                                    icon: WVCategory.icon(for: row.category),
                                    color: WVCategory.accent(for: row.category),
                                    size: 26
                                )
                                Text(row.label)
                                    .font(.system(size: 14))
                                    .foregroundStyle(WVColor.label)
                                    .lineLimit(1)
                                Spacer(minLength: 6)
                                Text(WVFormat.vnd(row.total))
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(WVColor.label)
                            }
                            .padding(.top, 8)
                        }
                    }
                }
            }
        }
    }

    private var yearPicker: some View {
        let years = store.snapshot.years.isEmpty
            ? [Calendar.current.component(.year, from: Date())]
            : store.snapshot.years

        return Menu {
            ForEach(years, id: \.self) { y in
                Button {
                    selectedYear = y
                } label: {
                    if y == currentYear {
                        Label("\(y)", systemImage: "checkmark")
                    } else {
                        Text("\(y)")
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text("\(currentYear)")
                    .font(.system(size: 15, weight: .semibold))
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
            }
            .foregroundStyle(WVColor.tint)
        }
    }

    // MARK: - Top 5 devices

    private var topDevicesSection: some View {
        let top = store.snapshot.topDevices
        return VStack(spacing: 0) {
            WVSectionHeader("Top 5 thiết bị đắt nhất")
            WVSectionFooter("Xếp theo giá mua thiết bị (chưa gồm gói bảo hành).")

            if top.isEmpty {
                WVCard {
                    Text("Chưa có dữ liệu.")
                        .font(.system(size: 14))
                        .foregroundStyle(WVColor.label3)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, 12)
                }
            } else {
                WVGroup {
                    ForEach(Array(top.enumerated()), id: \.element.id) { idx, device in
                        if idx > 0 { WVDivider(inset: 60) }
                        NavigationLink(value: DashDeviceNav(id: device.id, name: device.name)) {
                            TopDeviceRow(rank: idx + 1, device: device)
                        }
                        .buttonStyle(WVRowButtonStyle())
                    }
                }
            }
        }
    }

    // MARK: - Summary cards

    private var summaryCards: some View {
        VStack(spacing: 0) {
            // Devices by status
            WVCard {
                VStack(alignment: .leading, spacing: 10) {
                    Label {
                        Text("Theo trạng thái thiết bị")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(WVColor.label)
                    } icon: {
                        WVIcon("shieldCheck", size: 14)
                            .foregroundStyle(WVColor.brand)
                    }
                    ForEach(DeviceStatus.allCases, id: \.self) { status in
                        let n = store.snapshot.devicesByStatus[status] ?? 0
                        if n > 0 {
                            StatsSummaryRow(label: status.label, value: "\(n)")
                        }
                    }
                }
            }

            Spacer().frame(height: 12)

            // Subscriptions by status
            WVCard {
                VStack(alignment: .leading, spacing: 10) {
                    Label {
                        Text("Theo trạng thái đăng ký")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(WVColor.label)
                    } icon: {
                        WVIcon("refresh", size: 14)
                            .foregroundStyle(WVColor.blue)
                    }
                    ForEach(SubscriptionStatus.allCases, id: \.self) { status in
                        let n = store.snapshot.subsByStatus[status] ?? 0
                        if n > 0 {
                            StatsSummaryRow(label: status.label, value: "\(n)")
                        }
                    }
                }
            }

            Spacer().frame(height: 12)

            // Wishlist by status
            WVCard {
                VStack(alignment: .leading, spacing: 10) {
                    Label {
                        Text("Theo trạng thái wishlist")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(WVColor.label)
                    } icon: {
                        WVIcon("heart", size: 14)
                            .foregroundStyle(WVColor.pink)
                    }
                    ForEach(WishlistStatus.allCases, id: \.self) { status in
                        let n = store.snapshot.wishlistByStatus[status] ?? 0
                        if n > 0 {
                            StatsSummaryRow(label: status.label, value: "\(n)")
                        }
                    }
                }
            }
        }
    }

    // MARK: - Chart data

    /// Real 12-month spend: device purchases by `purchaseDate` plus warranty
    /// package costs by `startDate`, bucketed by calendar month.
    private var monthBarData: [WVChartPoint] {
        store.snapshot.monthlyBuckets.map { bucket in
            WVChartPoint(label: bucket.label, value: Double(bucket.total))
        }
    }

    /// Real category breakdown. Slice size is money spent (devices +
    /// warranties); the legend prints the same VND amount.
    ///
    /// Edge case: when every device in a category was recorded with a 0 ₫ price
    /// and no warranty cost, every total is 0 and a money-weighted ring would
    /// render empty — fall back to device counts so the chart still says
    /// something. The legend keeps showing the (zero) money either way.
    private var donutSlices: [WVDonutSlice] {
        let colors: [Color] = [
            WVColor.brand, WVColor.green, WVColor.orange,
            WVColor.red, WVColor.purple, WVColor.blue,
            WVColor.teal, WVColor.yellow
        ]
        let totals = store.snapshot.categoryTotals
        let moneyWeighted = totals.reduce(0) { $0 + $1.total } > 0
        let slices = totals
            .filter { moneyWeighted ? $0.total > 0 : $0.count > 0 }
            .sorted { moneyWeighted ? $0.total > $1.total : $0.count > $1.count }
            .enumerated()
            .map { idx, row in
                WVDonutSlice(
                    label: row.label,
                    value: Double(moneyWeighted ? row.total : row.count),
                    color: colors[idx % colors.count]
                )
            }

        if slices.isEmpty {
            return [WVDonutSlice(label: "Trống", value: 1, color: WVColor.fill3)]
        }
        return slices
    }

    // MARK: - Load

    private func loadAll() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.store.load() }
            group.addTask { await self.devicesStore.load() }
        }
        // Default the year picker to the newest year that actually has data.
        if selectedYear == nil {
            selectedYear = store.snapshot.years.first
                ?? Calendar.current.component(.year, from: Date())
        }
    }
}

// MARK: - Supporting views

private struct StatsSummaryRow: View {
    let label: String
    let value: String
    var body: some View {
        HStack {
            Text(label)
                .font(.system(size: 14))
                .foregroundStyle(WVColor.label)
            Spacer()
            Text(value)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(WVColor.label)
        }
    }
}

private struct TopDeviceRow: View {
    let rank: Int
    let device: Device

    var body: some View {
        HStack(spacing: 12) {
            Text("\(rank)")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(rank == 1 ? WVColor.brand : WVColor.label3)
                .frame(width: 18, alignment: .center)
            WVLeadingIcon(
                icon: WVCategory.icon(for: device.category),
                color: WVCategory.accent(for: device.category),
                size: 32
            )
            VStack(alignment: .leading, spacing: 2) {
                Text(device.name)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(WVColor.label)
                    .lineLimit(1)
                Text([CategoryLabels.label(for: device.category),
                      device.brand,
                      WVFormat.date(device.purchaseDate)]
                        .compactMap { $0 }
                        .filter { !$0.isEmpty }
                        .joined(separator: " • "))
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(1)
            }
            Spacer(minLength: 6)
            Text(WVFormat.vnd(device.purchasePrice))
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(WVColor.label)
                .lineLimit(1)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .padding(.vertical, 7)
        .contentShape(Rectangle())
    }
}
