import SwiftUI
import WarrantyVaultKit

// ============================================================
// StatsView — overview statistics dashboard.
// Port of StatsScreen in screens-3.jsx.
// Uses WVBarChart / WVDonut from Charts.swift.
// Data comes from StatsStore + RemindersStore.
// ============================================================

struct StatsView: View {
    let client: APIClient

    @StateObject private var store: StatsStore
    @StateObject private var remindersStore: RemindersStore

    init(client: APIClient) {
        self.client = client
        _store = StateObject(wrappedValue: StatsStore(client: client))
        _remindersStore = StateObject(wrappedValue: RemindersStore(client: client))
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
                if store.snapshot.totalDevices == 0 {
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

                // 12-month bar chart
                WVSectionHeader("Chi 12 tháng gần nhất")
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
            Text("\(snap.totalDevices) thiết bị · \(snap.totalSubs) đăng ký đang hoạt động")
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
                sub: "\(snap.totalSubs) gói",
                icon: "refresh"
            )
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

    private var monthBarData: [WVChartPoint] {
        var result: [WVChartPoint] = []
        let cal = Calendar.current
        let now = Date()
        for i in stride(from: 11, through: 0, by: -1) {
            guard let m = cal.date(byAdding: .month, value: -i, to: now) else { continue }
            let comps = cal.dateComponents([.year, .month], from: m)
            let label = String(format: "%02d", comps.month ?? 0)
            // We don't have per-month data in StatsStore — use placeholder 0
            result.append(WVChartPoint(label: label, value: 0))
        }
        return result
    }

    private var donutSlices: [WVDonutSlice] {
        let snap = store.snapshot
        let colors: [Color] = [
            WVColor.brand, WVColor.green, WVColor.orange,
            WVColor.red, WVColor.purple, WVColor.blue,
            WVColor.teal, WVColor.yellow
        ]
        var slices: [WVDonutSlice] = []
        var idx = 0

        // Build slices from device status counts as a proxy for category breakdown
        // (StatsStore gives by-status, not by-category — use status counts as proxy)
        for status in DeviceStatus.allCases {
            let n = Double(snap.devicesByStatus[status] ?? 0)
            if n > 0 {
                slices.append(WVDonutSlice(
                    label: status.label,
                    value: n,
                    color: colors[idx % colors.count]
                ))
                idx += 1
            }
        }

        // Fallback when no slices
        if slices.isEmpty {
            slices.append(WVDonutSlice(label: "Trống", value: 1, color: WVColor.fill3))
        }
        return slices
    }

    // MARK: - Load

    private func loadAll() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.store.load() }
            group.addTask { await self.remindersStore.load() }
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
