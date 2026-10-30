import SwiftUI
import WarrlyKit

// MARK: - Monthly‑equivalent helper

private func subMonthlyEquivalent(_ sub: Subscription) -> Double {
    let p = Double(sub.price)
    switch sub.billingCycle {
    case .MONTHLY:   return p
    case .QUARTERLY: return p / 3
    case .YEARLY:    return p / 12
    case .LIFETIME:  return 0
    case .CUSTOM:
        let d = Double(sub.intervalDays ?? 30)
        return d > 0 ? p / d * 30 : 0
    }
}

// MARK: - Status filter

private enum SubFilter: String, Hashable {
    case activePaused = "ACTIVE_PAUSED"
    case cancelled    = "CANCELLED"
    case all          = ""
}

// MARK: - Sort

private enum SubSort: String, CaseIterable {
    case renewalAsc  = "renewal-asc"
    case monthlyDesc = "monthly-desc"
    case priceDesc   = "price-desc"
    case nameAsc     = "name-asc"

    var label: String {
        switch self {
        case .renewalAsc:  return L.t("Sắp gia hạn trước")
        case .monthlyDesc: return L.t("Tốn nhiều / tháng")
        case .priceDesc:   return L.t("Giá / chu kỳ cao")
        case .nameAsc:     return L.t("Tên A → Z")
        }
    }
}

// MARK: - SubscriptionsScreen

struct SubscriptionsScreen: View {
    let client: APIClient
    @StateObject private var store: SubscriptionsStore
    @EnvironmentObject private var toast: WVToastCenter
    /// Destination requested by a tapped subscription-renewal notification
    /// (`url: /subscriptions/<id>`). Consumed once the tab is on screen.
    @EnvironmentObject private var router: AppRouter

    @State private var query      = ""
    @State private var filter     = SubFilter.activePaused
    @State private var sort       = SubSort.renewalAsc
    @State private var showSort   = false
    @State private var pushCreate = false
    /// The id a push asked for. Its own destination binding rather than a value
    /// pushed from the list: the detail screen loads by id, so it can open even
    /// when the row is filtered out or the list has not arrived yet.
    @State private var deepLinkedSubscriptionId: String?

    init(client: APIClient) {
        self.client = client
        _store = StateObject(wrappedValue: SubscriptionsStore(client: client))
    }

    // MARK: - Computed

    private var activeSubs: [Subscription] {
        store.subscriptions.filter { $0.status == .ACTIVE }
    }
    private var monthly: Double {
        activeSubs.reduce(0) { $0 + subMonthlyEquivalent($1) }
    }
    private var yearly: Double { monthly * 12 }

    private var filtered: [Subscription] {
        var arr = store.subscriptions
        let ql = query.lowercased()
        if !ql.isEmpty {
            arr = arr.filter {
                "\($0.name) \($0.brand ?? "") \($0.plan ?? "")".lowercased().contains(ql)
            }
        }
        switch filter {
        case .activePaused:
            arr = arr.filter { $0.status == .ACTIVE || $0.status == .PAUSED }
        case .cancelled:
            arr = arr.filter { $0.status == .CANCELED }
        case .all:
            break
        }
        switch sort {
        case .renewalAsc:
            arr.sort { $0.renewalDate < $1.renewalDate }
        case .monthlyDesc:
            arr.sort { subMonthlyEquivalent($0) > subMonthlyEquivalent($1) }
        case .priceDesc:
            arr.sort { $0.price > $1.price }
        case .nameAsc:
            arr.sort { $0.name.localizedCompare($1.name) == .orderedAscending }
        }
        return arr
    }

    // MARK: - Body

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                if !activeSubs.isEmpty {
                    subCostCard
                }

                Spacer().frame(height: WVSpacing.md)

                // "Soát gói đăng ký" — GET /api/v1/subscriptions/audit, one tap
                // away. A plain entry row with no count on purpose: the report is
                // a separate endpoint with its own `note` and `thresholds`, so
                // fetching it here just to print a number would double this tab's
                // requests and give the list a second failure mode. The audit
                // screen owns its own badge.
                auditEntryRow

                Spacer().frame(height: WVSpacing.md)

                WVSegmented(
                    options: [
                        (SubFilter.activePaused, L.t("Đang dùng")),
                        (SubFilter.cancelled,    L.t("Đã huỷ")),
                        (SubFilter.all,          L.t("Tất cả")),
                    ],
                    selection: $filter
                )
                .padding(.horizontal, WVSpacing.gutter)

                Spacer().frame(height: WVSpacing.md)

                if filtered.isEmpty {
                    WVEmpty(
                        icon: query.isEmpty ? "refresh" : "search",
                        title: query.isEmpty ? L.t("Chưa có gói nào") : L.t("Không có gì khớp"),
                        description: query.isEmpty
                            ? L.t("Note lại Apple One, ChatGPT, Spotify, hosting...")
                            : L.t("Thử từ khoá khác")
                    ) {
                        if query.isEmpty {
                            WVButton(L.t("Thêm gói"), icon: "plus") { pushCreate = true }
                                .padding(.horizontal, WVSpacing.gutter)
                        }
                    }
                } else {
                    subList
                }

                Spacer().frame(height: WVSpacing.xl)
            }
        }
        .wvScreen()
        .navigationTitle(L.t("Đăng ký"))
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $query, prompt: L.t("Tìm gói..."))
        .toolbar { toolbarContent }
        .task {
            await openPendingSubscriptionIfNeeded()
            await store.load()
        }
        .refreshable { await store.load() }
        .onChange(of: router.pendingSubscriptionId) { _, id in
            guard id != nil else { return }
            Task { await openPendingSubscriptionIfNeeded() }
        }
        .sheet(isPresented: $showSort) { sortSheet }
        .navigationDestination(for: Subscription.self) { sub in
            SubscriptionDetailView(client: client, store: store, subscriptionId: sub.id)
        }
        .navigationDestination(item: $deepLinkedSubscriptionId) { id in
            SubscriptionDetailView(client: client, store: store, subscriptionId: id)
        }
        .navigationDestination(isPresented: $pushCreate) {
            SubscriptionFormView(client: client, store: store)
        }
    }

    /// Takes a notification's destination exactly once, after the tab appears.
    /// `AppRouter` keeps the id until then, so a cold launch from a push still
    /// lands on the right subscription.
    private func openPendingSubscriptionIfNeeded() async {
        guard let id = router.consumeSubscription() else { return }
        deepLinkedSubscriptionId = id
    }

    // MARK: - Audit entry ("Soát gói đăng ký")

    /// The way into the advisory self-audit.
    ///
    /// Deliberately a row rather than a section: the audit is read-only and
    /// carries its own explanatory copy, so it opens its own screen. The text
    /// here describes what it **reads** (recorded payment history) and never
    /// pre-judges the result — no "gói bỏ quên", no "bạn không dùng".
    private var auditEntryRow: some View {
        WVGroup {
            NavigationLink {
                SubscriptionAuditScreen(client: client, subsStore: store)
            } label: {
                HStack(spacing: 12) {
                    WVLeadingIcon(icon: "search", color: WVColor.purple, size: 34)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(SubscriptionAuditRules.entryTitle)
                            .wvFont(.calloutEmphasis)
                            .foregroundStyle(WVColor.label)
                        Text(SubscriptionAuditRules.entrySubtitle)
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.label3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 8)
                    WVIcon("arrowRight", size: 13, weight: .semibold)
                        .foregroundStyle(WVColor.label4)
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
                .padding(.vertical, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(WVRowButtonStyle())
        }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button { showSort = true } label: {
                WVIcon("filter", size: 18)
                    .foregroundStyle(WVColor.tint)
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

    // MARK: - Cost summary card

    private var subCostCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(L.t("CHI MỖI THÁNG"))
                .wvFont(.caption2Emphasis)
                .tracking(1)
                .foregroundStyle(.white.opacity(0.85))
            Text(WVFormat.vnd(Int(monthly.rounded())))
                .wvFont(.statValue)
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            Text(L.t("~ %@ / năm", WVFormat.vnd(Int(yearly.rounded())))
                 + " · " + L.p("%d gói chạy", activeSubs.count))
                .wvFont(.footnote)
                .foregroundStyle(.white.opacity(0.85))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(
            LinearGradient(
                colors: [Color(hex: "5856D6"), Color(hex: "007AFF")],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.top, WVSpacing.sm)
    }

    // MARK: - List

    private var subList: some View {
        VStack(spacing: 0) {
            WVGroup {
                ForEach(Array(filtered.enumerated()), id: \.element.id) { idx, sub in
                    if idx > 0 { WVDivider(inset: 62) }
                    NavigationLink(value: sub) {
                        SubRowContent(sub: sub)
                            .padding(.horizontal, 16)
                            .frame(minHeight: 52)
                            .padding(.vertical, 8)
                    }
                    .buttonStyle(WVRowButtonStyle())
                }
            }
            WVSectionFooter(L.p("%d gói", filtered.count))
        }
    }

    // MARK: - Sort sheet

    private var sortSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    Spacer().frame(height: WVSpacing.md)
                    WVGroup {
                        ForEach(Array(SubSort.allCases.enumerated()), id: \.element) { idx, s in
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

private struct SubRowContent: View {
    let sub: Subscription

    /// The name and the price share one line at the default size. At
    /// Accessibility sizes they stop fitting side by side, so the row stacks
    /// them: name, price, then the renewal metadata. The price is never the
    /// thing that gets ellipsized, because it is the number the screen is for.
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var days: Int   { WVFormat.daysUntil(sub.renewalDate) }
    private var overdue: Bool { days < 0 }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            WVLeadingIcon(
                icon: WVCategory.icon(for: sub.category),
                color: WVCategory.accent(for: sub.category),
                size: 36
            )
            if dynamicTypeSize.isAccessibilitySize {
                stackedContent
            } else {
                horizontalContent
            }
            WVIcon("arrowRight", size: 13, weight: .semibold)
                .foregroundStyle(WVColor.label4)
        }
    }

    private var horizontalContent: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 8) {
                Text(sub.name)
                    .wvFont(.callout, weight: .medium)
                    .foregroundStyle(WVColor.label)
                    .lineLimit(1)
                Spacer(minLength: 0)
                priceText
            }
            HStack(spacing: 0) {
                cycleText
                    .lineLimit(1)
                Spacer(minLength: 8)
                renewalText
            }
        }
    }

    private var stackedContent: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(sub.name)
                .wvFont(.callout, weight: .medium)
                .foregroundStyle(WVColor.label)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
            priceText
            cycleText
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            renewalText
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var priceText: some View {
        Text(WVFormat.vnd(sub.price))
            .wvFont(.subheadlineEmphasis)
            .foregroundStyle(WVColor.label)
    }

    private var cycleText: some View {
        Text([sub.brand, sub.billingCycle.shortLabel]
            .compactMap { $0 }.joined(separator: " · "))
            .wvFont(.footnote)
            .foregroundStyle(WVColor.label3)
    }

    @ViewBuilder
    private var renewalText: some View {
        if sub.billingCycle != .LIFETIME {
            Text(overdue ? L.t("Quá hạn %dd", abs(days)) : L.t("%dd nữa", days))
                .wvFont(.footnote)
                .foregroundStyle(overdue ? WVColor.red : WVColor.label3)
        }
    }
}

// MARK: - BillingCycle short label

extension BillingCycle {
    var shortLabel: String {
        switch self {
        case .MONTHLY:   return L.t("Hàng tháng")
        case .QUARTERLY: return L.t("Hàng quý")
        case .YEARLY:    return L.t("Hàng năm")
        case .LIFETIME:  return L.t("Trọn đời")
        case .CUSTOM:    return L.t("Tuỳ chỉnh")
        }
    }
}
