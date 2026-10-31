import SwiftUI
import WarrlyKit

// ============================================================
// StatsView — overview statistics dashboard.
//
// One lead: the money still under warranty (§7 / §8.4). Under it, the
// three number groups the brief asks for — Bảo hành, Chi phí, Gói đăng
// ký — then the repair verdict card, the 12-month chart, the spending
// forecast and the two navigable lists.
//
// Everything in this file follows the visual direction: no gradient
// hero, no stat tiles, no uppercase kickers, no coloured identity
// icons. Money is the full VND amount everywhere a value is shown;
// the only compact money left is the chart's y-axis, which is
// geometry (§2) and uses the app's own compact formatter.
// ============================================================

struct StatsView: View {
    let client: APIClient

    @StateObject private var store: StatsStore
    /// Only used as the push destination for the "Top 5 thiết bị đắt nhất" rows.
    @StateObject private var devicesStore: DevicesStore

    /// Year shown in the "Tổng chi" row and the category breakdown. `nil`
    /// until the rollup has loaded, so we can default to the newest year
    /// with data without a flash.
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
                    statsSkeleton
                }
                .wvScreen()

            case .error(let msg):
                ScrollView {
                    WVEmpty(icon: "alert", title: L.t("Không tải được số liệu"), description: msg) {
                        WVButton(L.t("Thử lại")) { Task { await loadAll() } }
                    }
                }
                .wvScreen()

            case .loaded:
                if statsIsEmpty {
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
            // Inline resolve, then the real screen. This used to push a
            // `ProgressView` as the destination — a blank screen whose only
            // content was the spinner, which is exactly the state the owner
            // called out as "the user cannot tell what is happening".
            DeviceRouteDestination(client: client, store: devicesStore, deviceId: nav.id)
        }
        .toolbar {
            if store.state == .loaded, !statsIsEmpty {
                ToolbarItem(placement: .topBarTrailing) { yearMenu }
            }
        }
    }

    // MARK: - Main content

    private var mainContent: some View {
        ScrollView {
            VStack(spacing: 0) {
                leadBlock

                if !store.snapshot.warrantiesComplete {
                    incompleteWarrantiesBanner
                }

                warrantyGroup
                costGroup
                subscriptionGroup

                repairSection
                spendChartSection
                forecastSection
                categorySection
                topDevicesSection

                Spacer().frame(height: WVSpacing.xl)
            }
        }
        .wvScreen()
    }

    // MARK: - Lead

    /// The one number this screen is about: what is still under warranty.
    /// A plain block on `bg` — no card, no radius, no gradient.
    private var leadBlock: some View {
        VStack(alignment: .leading, spacing: WVSpacing.sm) {
            Text(L.t("Tài sản còn bảo hành"))
                .wvFont(.footnoteEmphasis)
                .foregroundStyle(WVColor.label3)

            Text(WVFormat.vnd(store.snapshot.assetValue.total))
                .wvFont(.statValue)
                .foregroundStyle(WVColor.label)
                .lineLimit(1)
                .minimumScaleFactor(0.5)

            coverageLine
                .wvFont(.footnote)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.top, WVSpacing.xl)
    }

    /// `4/7 thiết bị · 1 thiết bị trong 30 ngày` — one sentence, two clauses.
    ///
    /// The count and the window are **one** clause, not two: `1 thiết bị` on its
    /// own does not say which devices, and `Sắp hết trong 30 ngày` after another
    /// separator turned the subline into a list of three unrelated facts. Joined
    /// by a space they read the way §8.4 asks — "1 device ending inside 30 days".
    /// The phrase is the catalogue's lowercase `trong 30 ngày` (the sub-label the
    /// pre-redesign "Bảo hành sắp hết" widget printed under this same count),
    /// because it can sit mid-sentence where the capitalised label
    /// `Sắp hết trong 30 ngày` cannot.
    ///
    /// Composed from `Text` so the second clause wraps with the first and keeps
    /// its own colour — that colour is the sentence's point.
    private var coverageLine: Text {
        let snap = store.snapshot
        var line = Text(L.t("%d/%d thiết bị", snap.assetValue.count, snap.totalDevices))
            .foregroundColor(WVColor.label3)
        if snap.expiringIn30Days > 0 {
            line = line
                + Text(" · ").foregroundColor(WVColor.label4)
                + Text(L.p("%d thiết bị", snap.expiringIn30Days) + " " + L.t("trong 30 ngày"))
                    .foregroundColor(WVColor.red)
        }
        return line
    }

    private var incompleteWarrantiesBanner: some View {
        WVNotice(message: L.t("Không tải được gói bảo hành của một vài thiết bị — các con số bên dưới có thể thiếu."))
            .padding(.horizontal, WVSpacing.gutter)
            .padding(.top, WVSpacing.md)
    }

    // MARK: - Number groups

    private var warrantyGroup: some View {
        VStack(spacing: 0) {
            WVDashSectionHead(L.t("Bảo hành"))
            WVGroup {
                StatValueRow(
                    label: L.t("Bảo hành sắp hết"),
                    value: L.p("%d thiết bị", store.snapshot.expiringIn30Days)
                )
            }
        }
    }

    private var costGroup: some View {
        let snap = store.snapshot
        return VStack(spacing: 0) {
            WVDashSectionHead(L.t("Chi phí"))
            WVGroup {
                StatValueRow(
                    label: L.t("Tổng chi mua sắm"),
                    value: WVFormat.vnd(snap.allTimeTotals.total)
                )
                WVDivider(inset: WVSpacing.gutter)
                StatValueRow(
                    label: L.t("Tổng chi %d", currentYear),
                    value: WVFormat.vnd(store.yearTotals(currentYear).total)
                )
                if let repairs = snap.repairSpend, repairs.hasAnyCost {
                    WVDivider(inset: WVSpacing.gutter)
                    StatValueRow(
                        label: L.t("Tiền sửa chữa"),
                        value: WVFormat.vnd(repairs.totalVnd)
                    )
                }
            }
        }
    }

    private var subscriptionGroup: some View {
        let snap = store.snapshot
        return VStack(spacing: 0) {
            WVDashSectionHead(L.t("Gói đăng ký"))
            WVGroup {
                StatValueRow(
                    label: L.t("Phí định kỳ mỗi tháng"),
                    value: WVFormat.vnd(snap.monthlyEquivalent)
                )
                WVDivider(inset: WVSpacing.gutter)
                StatValueRow(
                    label: L.t("Đang hoạt động"),
                    value: L.p("%d gói", snap.activeSubs)
                )
            }
        }
    }

    // MARK: - Repair spend (Claim.cost)

    /// What repairs actually cost, and — separately — whether each one was
    /// worth it against the purchase price. The money total lives in the
    /// "Chi phí" group above; this block is the verdict, and the only
    /// screen-level card on the screen (§8.4).
    ///
    /// The section is absent in three cases, each for a different reason:
    ///
    ///  * `repairSpend == nil` — the claims read failed or has not landed, so
    ///    the app does not know; printing `0 ₫` would be a false fact;
    ///  * `hasAnyCost == false` — every claim has `cost == nil`, i.e. nobody
    ///    recorded money, so there is no line to draw;
    ///  * the screen is otherwise empty (handled by the parent empty state).
    ///
    /// A recorded `0` still renders: a warranty-covered repair is an answer.
    @ViewBuilder
    private var repairSection: some View {
        if let repairs = store.snapshot.repairSpend, repairs.hasAnyCost {
            // The total is the "Tiền sửa chữa" row in the Chi phí group above;
            // this block is the verdict that explains it, so it carries its own
            // sentence-case title instead of repeating the group's label.
            WVCard {
                VStack(alignment: .leading, spacing: WVSpacing.md) {
                    VStack(alignment: .leading, spacing: WVSpacing.xs) {
                        Text(L.t("Đáng sửa hay không, so với giá mua"))
                            .wvFont(.bodyEmphasis)
                            .foregroundStyle(WVColor.label)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(L.p("%d lần", repairs.pricedClaimCount)
                             + " · " + L.p("%d thiết bị", repairs.deviceCount))
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.label3)
                    }

                    if repairs.comparisons.isEmpty {
                        Text(L.t("Chưa có lần sửa nào đủ cả chi phí và giá mua để so sánh."))
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.label3)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        WVDivider(inset: 0)

                        ForEach(repairs.comparisons.prefix(5)) { comparison in
                            RepairComparisonRow(comparison: comparison)
                        }

                        if repairs.comparisons.count > 5 {
                            Text(L.p("… và %d lần sửa khác",
                                     repairs.comparisons.count - 5))
                                .wvFont(.footnote)
                                .foregroundStyle(WVColor.label3)
                        }
                    }
                }
            }
            .padding(.top, WVSpacing.xl)

            WVSectionFooter(L.t("Tách riêng khỏi tổng chi mua sắm: đây là tiền đã chi để sửa, sau khi đã mua thiết bị."))

            // The cross-device list is also reachable from "Thêm"; this is the
            // contextual way in from the numbers that made the user ask.
            NavigationLink {
                ClaimsListView(client: client)
            } label: {
                HStack(spacing: WVSpacing.md) {
                    WVLeadingIcon(icon: "wrench", size: 28)
                    Text(L.t("Xem tất cả lần sửa"))
                        .wvFont(.bodyEmphasis)
                        .foregroundStyle(WVColor.label)
                    Spacer(minLength: WVSpacing.sm)
                    WVIcon("arrowRight", size: 13, weight: .semibold)
                        .foregroundStyle(WVColor.label4)
                }
                .padding(.horizontal, WVSpacing.gutter)
                .frame(minHeight: 44)
                .padding(.vertical, WVSpacing.sm)
                .contentShape(Rectangle())
            }
            .buttonStyle(WVRowButtonStyle())
            .background(WVColor.bg2)
            .clipShape(RoundedRectangle(cornerRadius: WVRadius.list, style: .continuous))
            .padding(.horizontal, WVSpacing.gutter)
            .padding(.top, WVSpacing.md)
        }
    }

    // MARK: - 12-month chart

    /// Historical spend. The one place coral survives in content (§5.2): a
    /// chart is a picture of the data and needs data ink.
    private var spendChartSection: some View {
        VStack(spacing: 0) {
            WVDashSectionHead(L.t("Chi phí 12 tháng gần nhất"))

            // The calendar range belongs in the chart's header, but a 20 pt
            // heading cannot hold both phrases on one line without a mid-phrase
            // wrap — so it is the header's 13 pt caption at the same 16 inset.
            if let range = monthRangeLabel {
                WVSectionFooter(range)
                    .padding(.bottom, WVSpacing.sm)
            }

            StatsCard {
                WVBarChart(
                    data: monthBarData,
                    height: 160,
                    color: WVColor.brand,
                    formatY: { WVFormat.compactVnd(Int($0)) }
                )
            }

            // The explanation moves below the chart (§8.4), where it does not
            // stand between the heading and the picture.
            WVSectionFooter(L.t("Gồm tiền thiết bị và gói bảo hành (tính theo ngày bắt đầu của gói)."))
        }
    }

    private var monthRangeLabel: String? {
        let buckets = store.snapshot.monthlyBuckets
        guard let first = buckets.first, let last = buckets.last else { return nil }
        return "\(String(format: "%02d/%04d", first.month, first.year)) – "
            + "\(String(format: "%02d/%04d", last.month, last.year))"
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
        WVDashSectionHead(L.t("Dự báo chi tiêu"))

        if let forecast = store.snapshot.forecast {
            VStack(spacing: WVSpacing.md) {
                forecastNoteCard(forecast.note)
                forecastWindowPicker
                WVSectionFooter(windowDescription(forecast))

                // Keeps `subscriptionVnd` honest: the sum the user sees below is
                // the API's own total, not a re-add of the buckets.
                forecastSummaryCard(forecast)
                forecastChartCard(forecast)
                forecastMonthList(forecast)
                forecastWarrantyCard(forecast)
                forecastWishlistCard(forecast)
            }
            .padding(.bottom, WVSpacing.sm)
        } else if let error = store.snapshot.forecastError {
            VStack(spacing: WVSpacing.md) {
                StatsCard {
                    VStack(alignment: .leading, spacing: WVSpacing.sm) {
                        HStack(spacing: WVSpacing.sm) {
                            WVIcon("alert", size: 14)
                            Text(L.t("Không tải được dự báo"))
                                .wvFont(.footnoteEmphasis)
                        }
                        .foregroundStyle(WVColor.orange)
                        Text(error)
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.label3)
                        Text(L.t("Các số liệu phía trên vẫn đúng — chỉ phần dự báo này bị thiếu."))
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.label3)
                        WVButton(L.t("Thử lại"), kind: .secondary) {
                            Task { await store.loadForecast(months: store.snapshot.forecastMonths) }
                        }
                    }
                }
                forecastWindowPicker
            }
            .padding(.bottom, WVSpacing.sm)
        } else {
            VStack(spacing: WVSpacing.md) {
                StatsCard {
                    VStack(alignment: .leading, spacing: WVSpacing.sm) {
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
                WVSectionFooter(L.t("Đang tính các khoản sắp tới…"))
            }
            .padding(.bottom, WVSpacing.sm)
        }
    }

    /// The server's own explanation of the model, shown verbatim and **before**
    /// the numbers, because it is what stops them being read as a bill.
    private func forecastNoteCard(_ note: String) -> some View {
        StatsCard {
            HStack(alignment: .top, spacing: WVSpacing.sm) {
                WVIcon("info", size: 14)
                    .foregroundStyle(WVColor.label3)
                Text(note)
                    .wvFont(.footnote)
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
        return StatsCard {
            VStack(alignment: .leading, spacing: WVSpacing.sm) {
                Text(WVFormat.vnd(summary.autoRenewTotalVnd))
                    .wvFont(.title3Emphasis)
                    .foregroundStyle(WVColor.label)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                // Composed from per-count fragments rather than one template: English
                // inflects each noun independently, so a two-count sentence cannot be a
                // single key without printing "1 renewals · 1 subscriptions".
                Text("\(ForecastCopy.autoRenewHeading) · "
                     + L.p("%d kỳ gia hạn", summary.chargesCount) + " · "
                     + L.p("%d gói", summary.subscriptionsCount))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)

                Text("\(ForecastCopy.manualRenewHeading): \(WVFormat.vnd(summary.manualRenewTotalVnd))")
                    .wvFont(.footnoteEmphasis)
                    .foregroundStyle(WVColor.label2)

                Text(ForecastCopy.autoRenewNote)
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)

                WVDivider(inset: 0)

                Text(L.t("Trung bình theo tháng: %@ — bằng con số “Phí định kỳ mỗi tháng” ở trên.",
                             WVFormat.vnd(summary.monthlyAverageVnd)))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)

                if summary.referenceOnlyTotalVnd > 0 {
                    Text(L.t("Ngoài ra còn %@ tiền tham khảo (bảo hành + wishlist) — KHÔNG cộng vào các con số trên.",
                                 WVFormat.vnd(summary.referenceOnlyTotalVnd)))
                        .wvFont(.footnote)
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
            StatsCard {
                WVBarChart(
                    data: points,
                    height: 160,
                    color: WVColor.brand,
                    formatY: { WVFormat.compactVnd(Int($0)) }
                )
            }
            WVSectionFooter(L.t("Kỳ gia hạn subscription theo từng tháng trong cửa sổ (không gồm tiền bảo hành hay wishlist)."))
        }
    }

    /// The month list. Zero-filled months are dropped (`activeBuckets`) so a
    /// 24-month window doesn't print two years of `0 ₫`.
    @ViewBuilder
    private func forecastMonthList(_ forecast: Forecast) -> some View {
        let months = ForecastRules.activeBuckets(forecast.buckets)
        if months.isEmpty {
            StatsCard {
                Text(ForecastCopy.emptyWindow(months: forecast.months))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, WVSpacing.md)
            }
        } else {
            WVGroup {
                ForEach(Array(months.enumerated()), id: \.element.id) { idx, bucket in
                    if idx > 0 { WVDivider(inset: WVSpacing.gutter) }
                    ForecastMonthRow(bucket: bucket)
                }
            }
        }
    }

    @ViewBuilder
    private func forecastWarrantyCard(_ forecast: Forecast) -> some View {
        if !forecast.upcomingWarranties.isEmpty {
            StatsCard {
                VStack(alignment: .leading, spacing: WVSpacing.sm) {
                    HStack(spacing: WVSpacing.sm) {
                        WVIcon("shieldCheck", size: 14)
                            .foregroundStyle(WVColor.label3)
                        Text(L.t("Bảo hành sắp hết trong cửa sổ"))
                            .wvFont(.bodyEmphasis)
                            .foregroundStyle(WVColor.label)
                    }
                    Text(ForecastCopy.warrantySavingsNote)
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)

                    ForEach(forecast.upcomingWarranties) { warranty in
                        ForecastListRow(
                            title: warranty.deviceName,
                            subtitle: L.t("%@ · hết hạn %@",
                                           warranty.type.label + (warranty.provider.map { " · \($0)" } ?? ""),
                                           WVFormat.date(warranty.endDate)),
                            trailing: warranty.costVnd.map(WVFormat.vnd) ?? ForecastCopy.noPriceRecorded,
                            trailingDimmed: warranty.costVnd == nil
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func forecastWishlistCard(_ forecast: Forecast) -> some View {
        if !forecast.upcomingWishlist.isEmpty {
            StatsCard {
                VStack(alignment: .leading, spacing: WVSpacing.sm) {
                    HStack(spacing: WVSpacing.sm) {
                        WVIcon("heart", size: 14)
                            .foregroundStyle(WVColor.label3)
                        Text(L.t("Wishlist tới mốc trong cửa sổ"))
                            .wvFont(.bodyEmphasis)
                            .foregroundStyle(WVColor.label)
                    }
                    Text(ForecastCopy.wishlistNote)
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)

                    ForEach(forecast.upcomingWishlist) { item in
                        ForecastListRow(
                            title: item.name,
                            subtitle: "\(item.priority.label) · \(item.status.label) · \(WVFormat.date(item.targetDate))",
                            trailing: item.currentPriceVnd.map(WVFormat.vnd) ?? ForecastCopy.noPriceRecorded,
                            trailingDimmed: item.currentPriceVnd == nil
                        )
                    }
                }
            }
        }
    }

    // MARK: - Category breakdown (selected year)

    /// The category split for the year in the toolbar. This replaces the
    /// two-column year card and the rainbow donut: the same numbers, as
    /// rows, with money in the app's own format and no identity colours.
    private var categorySection: some View {
        let year = currentYear
        let byCategory = store.yearCategoryTotals(year)
            .filter { $0.total > 0 }
            .sorted { $0.total > $1.total }

        return VStack(spacing: 0) {
            WVDashSectionHead(L.t("Phân bổ theo loại"))

            if byCategory.isEmpty {
                StatsCard {
                    Text(L.t("Chưa có chi phí nào trong năm %d.", year))
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, WVSpacing.md)
                }
            } else {
                WVGroup {
                    ForEach(Array(byCategory.enumerated()), id: \.element.id) { idx, row in
                        if idx > 0 { WVDivider(inset: WVDivider.rowInset) }
                        CategorySpendRow(
                            category: row.category,
                            label: row.label,
                            total: row.total
                        )
                    }
                }
            }

            WVSectionFooter(L.t("Gói bảo hành được tính vào loại của thiết bị mà nó bảo vệ."))
        }
    }

    // MARK: - Top 5 devices

    private var topDevicesSection: some View {
        let top = store.snapshot.topDevices
        return VStack(spacing: 0) {
            WVDashSectionHead(L.t("Top 5 thiết bị đắt nhất"))

            if top.isEmpty {
                StatsCard {
                    Text(L.t("Chưa có dữ liệu."))
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, WVSpacing.md)
                }
            } else {
                WVGroup {
                    ForEach(Array(top.enumerated()), id: \.element.id) { idx, device in
                        if idx > 0 { WVDivider(inset: WVDivider.rowInset) }
                        NavigationLink(value: DashDeviceNav(id: device.id, name: device.name)) {
                            TopDeviceRow(rank: idx + 1, device: device)
                        }
                        .buttonStyle(WVRowButtonStyle())
                    }
                }
            }

            WVSectionFooter(L.t("Xếp theo giá mua thiết bị (chưa gồm gói bảo hành)."))
        }
    }

    // MARK: - Year

    private var currentYear: Int {
        selectedYear ?? Calendar.current.component(.year, from: Date())
    }

    /// `2026`, never `2.026`. A year is an identifier, not a quantity: built as
    /// a `LocalizedStringKey` (`Text("\(currentYear)")`) the `Int` interpolation
    /// goes through the localised integer formatter, which groups thousands —
    /// `2.026` in Vietnamese, `2,026` in English. Every label below is therefore
    /// built from a plain `String`, which the text and `Label` initialisers
    /// render verbatim.
    private var yearMenu: some View {
        let years = store.snapshot.years.isEmpty
            ? [Calendar.current.component(.year, from: Date())]
            : store.snapshot.years

        return Menu {
            ForEach(years, id: \.self) { year in
                Button {
                    selectedYear = year
                } label: {
                    if year == currentYear {
                        Label(String(year), systemImage: "checkmark")
                    } else {
                        Text(String(year))
                    }
                }
            }
        } label: {
            HStack(spacing: WVSpacing.xs) {
                Text(String(currentYear))
                    .wvFont(.body, weight: .medium)
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
            }
            .foregroundStyle(WVColor.label2)
        }
    }

    // MARK: - Chart data

    /// Real 12-month spend: device purchases by `purchaseDate` plus warranty
    /// package costs by `startDate`, bucketed by calendar month. The bars are
    /// labelled `T1…T12` (the window's position, not "January"); the calendar
    /// range is in the section heading.
    private var monthBarData: [WVChartPoint] {
        let prefix = L.effectiveLanguage == .vi ? "T" : "M"
        return store.snapshot.monthlyBuckets.enumerated().map { idx, bucket in
            WVChartPoint(label: "\(prefix)\(idx + 1)", value: Double(bucket.total))
        }
    }

    // MARK: - States

    private var statsIsEmpty: Bool {
        store.snapshot.totalDevices == 0
            && store.snapshot.totalSubs == 0
            && store.snapshot.totalWishlist == 0
    }

    /// A calm static placeholder for the lead block — same silhouette, no
    /// shimmer (§9.2).
    private var statsSkeleton: some View {
        VStack(alignment: .leading, spacing: WVSpacing.sm) {
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(WVColor.fill3)
                .frame(width: 140, height: 13)
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(WVColor.fill3)
                .frame(width: 220, height: 28)
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(WVColor.fill3)
                .frame(width: 180, height: 13)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.top, WVSpacing.xl)
        .redacted(reason: .placeholder)
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

/// One label/value row in a number group (§8.4): label `rowTitle` left,
/// value `rowValue` right. Money keeps the full VND amount and may scale,
/// but never truncates mid-number.
private struct StatValueRow: View {
    let label: String
    let value: String

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: WVSpacing.xs) {
                    labelText
                    valueText
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack(alignment: .firstTextBaseline, spacing: WVSpacing.md) {
                    labelText
                        .layoutPriority(1)
                    Spacer(minLength: WVSpacing.sm)
                    valueText
                }
            }
        }
        .padding(.horizontal, WVSpacing.gutter)
        .frame(minHeight: 44)
        .padding(.vertical, WVSpacing.sm)
    }

    private var labelText: some View {
        Text(label)
            .wvFont(.bodyEmphasis)
            .foregroundStyle(WVColor.label)
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var valueText: some View {
        Text(value)
            .wvFont(.body, weight: .medium)
            .foregroundStyle(WVColor.label)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }
}

/// A category's spend for the selected year: neutral 28 pt tile, category
/// label, full VND value.
private struct CategorySpendRow: View {
    let category: String
    let label: String
    let total: Int

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                HStack(alignment: .top, spacing: WVSpacing.md) {
                    WVLeadingIcon(icon: WVCategory.icon(for: category), size: 28)
                    VStack(alignment: .leading, spacing: WVSpacing.xs) {
                        labelText
                        valueText
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack(spacing: WVSpacing.md) {
                    WVLeadingIcon(icon: WVCategory.icon(for: category), size: 28)
                    labelText
                        .layoutPriority(1)
                    Spacer(minLength: WVSpacing.sm)
                    valueText
                }
            }
        }
        .padding(.horizontal, WVSpacing.gutter)
        .frame(minHeight: 44)
        .padding(.vertical, WVSpacing.sm)
    }

    private var labelText: some View {
        Text(label)
            .wvFont(.bodyEmphasis)
            .foregroundStyle(WVColor.label)
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var valueText: some View {
        Text(WVFormat.vnd(total))
            .wvFont(.body, weight: .medium)
            .foregroundStyle(WVColor.label)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }
}

/// One month of the spending forecast.
///
/// Keeps the auto-renew split visible per month (`tự động X`) and tags the
/// warranty / wishlist money as reference-only, so no single number in the row
/// can be mistaken for "this much will be charged". The reference amounts are
/// plain `label3` text — they are facts, not alarms, and not pills.
private struct ForecastMonthRow: View {
    let bucket: ForecastBucket

    var body: some View {
        VStack(alignment: .leading, spacing: WVSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: WVSpacing.sm) {
                Text(ForecastRules.monthLabel(bucket.month))
                    .wvFont(.bodyEmphasis)
                    .foregroundStyle(WVColor.label)
                    .lineLimit(1)
                    .layoutPriority(1)

                Spacer(minLength: WVSpacing.sm)

                amountText
            }

            if bucket.subscriptionCount > 0 {
                Text(L.p("%d kỳ", bucket.subscriptionCount) + " · "
                     + "\(ForecastCopy.autoRenewHeading) \(WVFormat.vnd(bucket.subscriptionAutoRenewVnd))")
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
                if bucket.manualRenewVnd > 0 {
                    Text("\(ForecastCopy.manualRenewHeading): \(WVFormat.vnd(bucket.manualRenewVnd))")
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                }
            }

            if bucket.warrantyExpiringCount > 0 {
                Text(L.t("BH hết hạn: %d · %@", bucket.warrantyExpiringCount,
                             WVFormat.vnd(bucket.warrantyExpiringVnd)))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
            }
            if bucket.wishlistTargetCount > 0 {
                Text("Wishlist: \(bucket.wishlistTargetCount) · \(WVFormat.vnd(bucket.wishlistTargetVnd))")
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
            }
        }
        .padding(.horizontal, WVSpacing.gutter)
        .frame(minHeight: 44)
        .padding(.vertical, WVSpacing.sm)
    }

    @ViewBuilder
    private var amountText: some View {
        if bucket.subscriptionCount > 0 {
            Text(WVFormat.vnd(bucket.subscriptionVnd))
                .wvFont(.body, weight: .medium)
                .foregroundStyle(WVColor.label)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        } else {
            Text(L.t("Không có kỳ gia hạn"))
                .wvFont(.footnote)
                .foregroundStyle(WVColor.label3)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct ForecastListRow: View {
    let title: String
    let subtitle: String
    let trailing: String
    let trailingDimmed: Bool

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: WVSpacing.xs) {
                    titleText
                    subtitleText
                    trailingText
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack(alignment: .top, spacing: WVSpacing.sm) {
                    VStack(alignment: .leading, spacing: WVSpacing.xs) {
                        titleText
                        subtitleText
                    }
                    .layoutPriority(1)
                    Spacer(minLength: WVSpacing.sm)
                    trailingText
                }
            }
        }
        .padding(.top, WVSpacing.xs)
    }

    private var titleText: some View {
        Text(title)
            .wvFont(.bodyEmphasis)
            .foregroundStyle(WVColor.label)
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var subtitleText: some View {
        Text(subtitle)
            .wvFont(.footnote)
            .foregroundStyle(WVColor.label3)
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var trailingText: some View {
        Text(trailing)
            .wvFont(.body, weight: .medium)
            .foregroundStyle(trailingDimmed ? WVColor.label4 : WVColor.label)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }
}

/// A row-card at the chart/forecast scale: 12 pt, `bg2`, 16 pt padding.
///
/// §4 keeps 16 pt for the one screen-level card (the repair block); every
/// other block on this screen is a row-card, so it uses the list radius.
private struct StatsCard<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(WVSpacing.gutter)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(WVColor.bg2)
            .clipShape(RoundedRectangle(cornerRadius: WVRadius.list, style: .continuous))
            .padding(.horizontal, WVSpacing.gutter)
    }
}

// MARK: - Repair spend row

/// One "was this repair worth it?" comparison: what the repair cost against
/// what the device was bought for.
///
/// The same shape and the same green/red/grey mapping as the resale block's
/// "Lãi/lỗ so với giá mua" row — a second visual language for the same
/// comparison would make two answered questions look like two different kinds
/// of fact. The label already carries the amount ("rẻ hơn giá mua …"), so the
/// row never prints a bare verdict. The verdict is the coloured part; the
/// amounts are meta (§8.4).
private struct RepairComparisonRow: View {
    let comparison: StatsRollup.RepairComparison

    private var tone: Color {
        switch comparison.verdict {
        case .worthFixing:    return WVColor.green
        case .notWorthFixing: return WVColor.red
        case .breakEven:      return WVColor.label2
        }
    }

    /// Always a vertical block. Side-by-side looked compact at Large, but both
    /// the amounts and the verdict sentence are long enough to ellipsize at the
    /// default size — and a verdict cut after "cheaper th…" is worse than one
    /// more line.
    var body: some View {
        VStack(alignment: .leading, spacing: WVSpacing.xs) {
            Text(comparison.deviceName)
                .wvFont(.bodyEmphasis)
                .foregroundStyle(WVColor.label)
                .lineLimit(nil)
                .fixedSize(horizontal: false, vertical: true)

            Text(L.t("Sửa %@ · giá mua %@",
                     WVFormat.vnd(comparison.costVnd),
                     WVFormat.vnd(comparison.purchasePriceVnd)))
                .wvFont(.footnote)
                .foregroundStyle(WVColor.label3)
                .lineLimit(nil)
                .fixedSize(horizontal: false, vertical: true)

            Text(comparison.label)
                .wvFont(.footnoteEmphasis)
                .foregroundStyle(tone)
                .lineLimit(nil)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, WVSpacing.xs)
    }
}

private struct TopDeviceRow: View {
    let rank: Int
    let device: Device

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                HStack(alignment: .top, spacing: WVSpacing.md) {
                    icon
                    VStack(alignment: .leading, spacing: WVSpacing.xs) {
                        titleText
                        metaText
                        priceText
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack(alignment: .top, spacing: WVSpacing.md) {
                    icon
                    VStack(alignment: .leading, spacing: WVSpacing.xs) {
                        titleText
                        metaText
                    }
                    .layoutPriority(1)
                    Spacer(minLength: WVSpacing.sm)
                    priceText
                }
            }
        }
        .padding(.horizontal, WVSpacing.gutter)
        .frame(minHeight: 44)
        .padding(.vertical, WVSpacing.sm)
        .contentShape(Rectangle())
    }

    private var icon: some View {
        WVLeadingIcon(icon: WVCategory.icon(for: device.category), size: 28)
    }

    private var titleText: some View {
        Text(device.name)
            .wvFont(.bodyEmphasis)
            .foregroundStyle(WVColor.label)
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// The ranking is a fact about the list, not a decoration, so it stays —
    /// as the first item of the meta line rather than a coral numeral column.
    private var metaText: some View {
        Text("#\(rank) · " + [CategoryLabels.label(for: device.category),
                              device.brand,
                              WVFormat.date(device.purchaseDate)]
                .compactMap { $0 }
                .filter { !$0.isEmpty }
                .joined(separator: " · "))
            .wvFont(.footnote)
            .foregroundStyle(WVColor.label3)
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var priceText: some View {
        VStack(alignment: .trailing, spacing: WVSpacing.xs) {
            // The ranking is by VND value, so a foreign device shows both:
            // its own price (`999 USD`) and the VND it contributed. The native
            // 999 is never rendered as dong.
            Text(WVFormat.currency(device.purchasePrice, device.currency))
                .wvFont(.body, weight: .medium)
                .foregroundStyle(WVColor.label)
                .lineLimit(1)
            if device.usesForeignCurrency, let vnd = device.purchasePriceInVnd {
                Text(WVFormat.vnd(vnd))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(1)
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }
}
