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
                    WVEmpty(icon: "alert", title: L.t("Không tải được số liệu"), description: msg) {
                        WVButton(L.t("Thử lại")) { Task { await loadAll() } }
                            .padding(.horizontal, 32)
                    }
                }
                .wvScreen()

            case .loaded:
                if store.snapshot.totalDevices == 0 && store.snapshot.totalSubs == 0
                    && store.snapshot.totalWishlist == 0 {
                    ScrollView {
                        WVEmpty(icon: "chart",
                                title: L.t("Chưa có gì để thống kê"),
                                description: L.t("Thêm thiết bị xong quay lại nhé."))
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
                ProgressView(L.t("Đang tải..."))
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
                WVSectionHeader(L.t("Chi phí & tài sản"))
                kpiGrid

                // 12-month bar chart
                WVSectionHeader(L.t("Chi phí 12 tháng gần nhất"))
                WVSectionFooter(L.t("Gồm tiền thiết bị và gói bảo hành (tính theo ngày bắt đầu của gói)."))
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

                // Spending forecast — the forward-looking half of this screen
                // (`GET /api/v1/forecast`), deliberately separate from the
                // historical rollup above it.
                forecastSection

                // Category donut
                WVSectionHeader(L.t("Phân bổ theo loại"))
                WVSectionFooter(L.t("Gói bảo hành được tính vào loại của thiết bị mà nó bảo vệ."))
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
                WVSectionHeader(L.t("Theo trạng thái"))
                summaryCards

                Spacer().frame(height: 24)
            }
        }
        .wvScreen()
    }

    // MARK: - Spending forecast (GET /api/v1/forecast)

    /// The forward-looking section: expected subscription charges month by
    /// month, plus the warranty and wishlist milestones in the same window.
    ///
    /// Three things this section refuses to do:
    ///   * it never shows one "you will spend" number — money that *will* be
    ///     charged automatically and money the user must decide about are two
    ///     different figures (`subscriptionAutoRenewVnd`);
    ///   * it never adds warranty or wishlist money to the subscription total:
    ///     the API documents `warrantyExpiringVnd` as the old package's price
    ///     (a savings reference) and `wishlistTargetVnd` as a last-recorded
    ///     price — both "may happen", not "will be charged";
    ///   * it never hides the API's own `note`, which says exactly that.
    @ViewBuilder
    private var forecastSection: some View {
        WVSectionHeader(L.t("Dự báo chi tiêu"))

        if let forecast = store.snapshot.forecast {
            WVSectionFooter(windowDescription(forecast))
            forecastNoteCard(forecast.note)
            forecastWindowPicker

            // Keeps `subscriptionVnd` honest: the sum the user sees below is
            // the API's own total, not a re-add of the buckets.
            forecastSummaryCard(forecast)
            forecastChartCard(forecast)
            forecastMonthList(forecast)
            forecastWarrantyCard(forecast)
            forecastWishlistCard(forecast)
        } else if let error = store.snapshot.forecastError {
            WVCard {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        WVIcon("alert", size: 14)
                        Text(L.t("Không tải được dự báo"))
                            .font(.system(size: 15, weight: .semibold))
                    }
                    .foregroundStyle(WVColor.orange)
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.label3)
                    Text(L.t("Các số liệu phía trên vẫn đúng — chỉ phần dự báo này bị thiếu."))
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.label3)
                    WVButton(L.t("Thử lại"), kind: .secondary) {
                        Task { await store.loadForecast(months: store.snapshot.forecastMonths) }
                    }
                }
            }
            forecastWindowPicker
        } else {
            WVSectionFooter(L.t("Đang tính các khoản sắp tới…"))
            WVCard {
                VStack(alignment: .leading, spacing: 8) {
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(WVColor.fill3)
                        .frame(height: 14)
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(WVColor.fill3)
                        .frame(width: 200, height: 14)
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(WVColor.fill3)
                        .frame(width: 140, height: 14)
                }
                .redacted(reason: .placeholder)
            }
        }
    }

    /// The server's own explanation of the model, shown verbatim and **before**
    /// the numbers, because it is what stops them being read as a bill.
    private func forecastNoteCard(_ note: String) -> some View {
        WVCard {
            HStack(alignment: .top, spacing: 8) {
                WVIcon("info", size: 14)
                    .foregroundStyle(WVColor.blue)
                Text(note)
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.label2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// 6 / 12 / 24 months. `months` is clamped before it leaves the client, and
    /// the number of buckets is whatever the API returns — normally `months + 1`.
    private var forecastWindowPicker: some View {
        WVSegmented(
            options: ForecastRules.monthOptions.map {
                (value: $0, label: ForecastRules.monthsLabel($0))
            },
            selection: Binding(
                get: { store.snapshot.forecastMonths },
                // Window change → one new `/forecast` read. The generic is
                // spelled out because a bare `Task {}` here is ambiguous.
                set: { months in
                    Task<Void, Never> { await store.loadForecast(months: months) }
                }
            )
        )
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.top, 10)
        .disabled(store.snapshot.forecastLoading)
    }

    private func windowDescription(_ forecast: Forecast) -> String {
        L.t("Cửa sổ %@: ", ForecastRules.monthsLabel(forecast.months))
            + "\(WVFormat.date(forecast.windowStart)) → \(WVFormat.date(forecast.windowEnd)) "
            + L.p("(%d tháng lịch).", forecast.buckets.count)
    }

    /// Certain spend vs. spend the user has to decide about. Never a single sum.
    private func forecastSummaryCard(_ forecast: Forecast) -> some View {
        let summary = ForecastRules.summary(forecast)
        return WVCard {
            VStack(alignment: .leading, spacing: 10) {
                Text(WVFormat.vnd(summary.autoRenewTotalVnd))
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(WVColor.label)
                Text(L.t("%@ · %d kỳ gia hạn · %d gói",
                          ForecastCopy.autoRenewHeading, summary.chargesCount, summary.subscriptionsCount))
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.label3)

                HStack(spacing: 6) {
                    WVIcon("refresh", size: 12)
                    Text("\(ForecastCopy.manualRenewHeading): \(WVFormat.vnd(summary.manualRenewTotalVnd))")
                        .font(.system(size: 13, weight: .semibold))
                }
                .foregroundStyle(WVColor.orange)

                Text(ForecastCopy.autoRenewNote)
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)

                WVDivider()

                Text(L.t("Trung bình theo tháng: %@ — bằng con số “Phí định kỳ mỗi tháng” ở trên.",
                             WVFormat.vnd(summary.monthlyAverageVnd)))
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)

                if summary.referenceOnlyTotalVnd > 0 {
                    Text(L.t("Ngoài ra còn %@ tiền tham khảo (bảo hành + wishlist) — KHÔNG cộng vào các con số trên.",
                                 WVFormat.vnd(summary.referenceOnlyTotalVnd)))
                        .font(.system(size: 12))
                        .foregroundStyle(WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    /// Month-by-month subscription charges. The bars are the *total* renewals in
    /// each month; the auto-renew split is spelled out in the list underneath.
    private func forecastChartCard(_ forecast: Forecast) -> some View {
        let labels = ForecastRules.chartLabels(forecast.buckets)
        let points = zip(forecast.buckets, labels).map { bucket, label in
            WVChartPoint(label: label, value: Double(bucket.subscriptionVnd))
        }
        return VStack(spacing: 0) {
            WVSectionFooter(L.t("Kỳ gia hạn subscription theo từng tháng trong cửa sổ (không gồm tiền bảo hành hay wishlist)."))
            WVCard {
                WVBarChart(
                    data: points,
                    height: 160,
                    color: WVColor.brand,
                    formatY: { v in
                        if v >= 1_000_000 { return "\(Int(v / 1_000_000))M" }
                        if v >= 1_000     { return "\(Int(v / 1_000))k" }
                        return "\(Int(v))"
                    }
                )
            }
        }
    }

    /// The month list. Zero-filled months are dropped (`activeBuckets`) so a
    /// 24-month window doesn't print two years of `0 ₫`.
    @ViewBuilder
    private func forecastMonthList(_ forecast: Forecast) -> some View {
        let months = ForecastRules.activeBuckets(forecast.buckets)
        if months.isEmpty {
            WVCard {
                Text(ForecastCopy.emptyWindow(months: forecast.months))
                    .font(.system(size: 14))
                    .foregroundStyle(WVColor.label3)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 12)
            }
        } else {
            WVGroup {
                ForEach(Array(months.enumerated()), id: \.element.id) { idx, bucket in
                    if idx > 0 { WVDivider(inset: 16) }
                    ForecastMonthRow(bucket: bucket)
                }
            }
        }
    }

    @ViewBuilder
    private func forecastWarrantyCard(_ forecast: Forecast) -> some View {
        if !forecast.upcomingWarranties.isEmpty {
            WVCard {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        WVIcon("shieldCheck", size: 14)
                            .foregroundStyle(WVColor.orange)
                        Text(L.t("Bảo hành sắp hết trong cửa sổ"))
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(WVColor.label)
                    }
                    Text(ForecastCopy.warrantySavingsNote)
                        .font(.system(size: 12))
                        .foregroundStyle(WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)

                    ForEach(forecast.upcomingWarranties) { warranty in
                        HStack(alignment: .top, spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(warranty.deviceName)
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(WVColor.label)
                                    .lineLimit(1)
                                Text(L.t("%@ · hết hạn %@",
                                          warranty.type.label + (warranty.provider.map { " · \($0)" } ?? ""),
                                          WVFormat.date(warranty.endDate)))
                                    .font(.system(size: 12))
                                    .foregroundStyle(WVColor.label3)
                                    .lineLimit(1)
                            }
                            Spacer(minLength: 6)
                            Text(warranty.costVnd.map(WVFormat.compactVnd) ?? ForecastCopy.noPriceRecorded)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(warranty.costVnd == nil ? WVColor.label4 : WVColor.label)
                                .lineLimit(1)
                        }
                        .padding(.top, 4)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func forecastWishlistCard(_ forecast: Forecast) -> some View {
        if !forecast.upcomingWishlist.isEmpty {
            WVCard {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        WVIcon("heart", size: 14)
                            .foregroundStyle(WVColor.pink)
                        Text(L.t("Wishlist tới mốc trong cửa sổ"))
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(WVColor.label)
                    }
                    Text(ForecastCopy.wishlistNote)
                        .font(.system(size: 12))
                        .foregroundStyle(WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)

                    ForEach(forecast.upcomingWishlist) { item in
                        HStack(alignment: .top, spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.name)
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(WVColor.label)
                                    .lineLimit(1)
                                Text("\(item.priority.label) · \(item.status.label) · \(WVFormat.date(item.targetDate))")
                                    .font(.system(size: 12))
                                    .foregroundStyle(WVColor.label3)
                                    .lineLimit(1)
                            }
                            Spacer(minLength: 6)
                            Text(item.currentPriceVnd.map(WVFormat.compactVnd) ?? ForecastCopy.noPriceRecorded)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(item.currentPriceVnd == nil ? WVColor.label4 : WVColor.label)
                                .lineLimit(1)
                        }
                        .padding(.top, 4)
                    }
                }
            }
        }
    }

    // MARK: - Hero gradient card

    private var heroCard: some View {
        let snap = store.snapshot
        return VStack(alignment: .leading, spacing: 6) {
            Text(L.t("TỔNG GIÁ TRỊ THIẾT BỊ"))
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.white.opacity(0.85))
                .tracking(1)
            Text(WVFormat.vnd(snap.totalDevicesValue))
                .font(.system(size: 32, weight: .bold))
                .foregroundStyle(.white)
            Text(L.t("%d thiết bị · %d đăng ký đang hoạt động", snap.totalDevices, snap.activeSubs))
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
            Text(L.t("Không tải được gói bảo hành của một vài thiết bị — các con số bên dưới có thể thiếu."))
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
                eyebrow: L.t("Bảo hành sắp hết"),
                value: "\(snap.expiringIn30Days)",
                sub: L.t("trong 30 ngày"),
                icon: "shieldCheck"
            )
            WVWidget(
                eyebrow: L.t("Sub mỗi tháng"),
                value: WVFormat.compactVnd(snap.monthlyEquivalent),
                sub: L.p("%d gói đang chạy", snap.activeSubs),
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
                eyebrow: L.t("Tổng chi %d", year),
                value: WVFormat.compactVnd(yearTotals.total),
                sub: L.t("%d thiết bị • %d gói BH", yearTotals.deviceCount, yearTotals.warrantyCount)
            )
            WVStatCard(
                eyebrow: L.t("Tổng chi mua sắm"),
                value: WVFormat.compactVnd(snap.allTimeTotals.total),
                sub: L.t("%d thiết bị • %d gói BH",
                         snap.allTimeTotals.deviceCount, snap.allTimeTotals.warrantyCount)
            )
            WVStatCard(
                eyebrow: L.t("Tài sản còn bảo hành"),
                value: WVFormat.compactVnd(snap.assetValue.total),
                sub: L.t("%d/%d thiết bị", snap.assetValue.count, snap.totalDevices)
            )
            WVStatCard(
                eyebrow: L.t("Phí định kỳ mỗi tháng"),
                value: WVFormat.compactVnd(snap.monthlyEquivalent),
                sub: L.t("~%@/năm", WVFormat.compactVnd(snap.monthlyEquivalent * 12))
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
                Text(L.t("TỔNG CHI THEO NĂM"))
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
                    Text(L.t("%d thiết bị • %d gói trong %d", totals.deviceCount, totals.warrantyCount, year))
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.label3)

                    if byCategory.isEmpty {
                        Text(L.t("Chưa có chi phí nào trong năm %d.", year))
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
            WVSectionHeader(L.t("Top 5 thiết bị đắt nhất"))
            WVSectionFooter(L.t("Xếp theo giá mua thiết bị (chưa gồm gói bảo hành)."))

            if top.isEmpty {
                WVCard {
                    Text(L.t("Chưa có dữ liệu."))
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
                        Text(L.t("Theo trạng thái thiết bị"))
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
                        Text(L.t("Theo trạng thái đăng ký"))
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
                        Text(L.t("Theo trạng thái wishlist"))
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
            return [WVDonutSlice(label: L.t("Trống"), value: 1, color: WVColor.fill3)]
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

/// One month of the spending forecast.
///
/// Keeps the auto-renew split visible per month (`tự động X`) and tags the
/// warranty / wishlist money as reference-only, so no single number in the row
/// can be mistaken for "this much will be charged".
private struct ForecastMonthRow: View {
    let bucket: ForecastBucket

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(ForecastRules.monthLabel(bucket.month))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(WVColor.label)

                Spacer(minLength: 6)

                if bucket.subscriptionCount > 0 {
                    Text(WVFormat.vnd(bucket.subscriptionVnd))
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(WVColor.label)
                        .lineLimit(1)
                } else {
                    Text(L.t("Không có kỳ gia hạn"))
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.label3)
                }
            }

            if bucket.subscriptionCount > 0 {
                Text(L.t("%d kỳ · %@ %@", bucket.subscriptionCount,
                             ForecastCopy.autoRenewHeading, WVFormat.vnd(bucket.subscriptionAutoRenewVnd)))
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)
                if bucket.manualRenewVnd > 0 {
                    Text("\(ForecastCopy.manualRenewHeading): \(WVFormat.vnd(bucket.manualRenewVnd))")
                        .font(.system(size: 12))
                        .foregroundStyle(WVColor.orange)
                }
            }

            HStack(spacing: 6) {
                if bucket.warrantyExpiringCount > 0 {
                    WVChip(L.t("BH hết hạn: %d · %@", bucket.warrantyExpiringCount,
                                       WVFormat.compactVnd(bucket.warrantyExpiringVnd)),
                           tone: .orange)
                }
                if bucket.wishlistTargetCount > 0 {
                    WVChip("Wishlist: \(bucket.wishlistTargetCount) · \(WVFormat.compactVnd(bucket.wishlistTargetVnd))",
                           tone: .blue)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}

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
