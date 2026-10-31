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
            // The screen's order (§8.5): the next renewal date ascending, within
            // the selected segment. This is already the default `sort`.
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
            VStack(spacing: WVSpacing.md) {
                if !activeSubs.isEmpty {
                    subCostCard
                }

                // "Soát gói đăng ký" — GET /api/v1/subscriptions/audit, one tap
                // away. It carries its own explanatory copy; the audit screen owns
                // its own badge, so this entry prints no count.
                auditCard

                WVSegmented(
                    options: [
                        (SubFilter.activePaused, L.t("Đang dùng")),
                        (SubFilter.cancelled,    L.t("Đã huỷ")),
                        (SubFilter.all,          L.t("Tất cả")),
                    ],
                    selection: $filter
                )
                .padding(.horizontal, WVSpacing.gutter)

                if filtered.isEmpty {
                    emptyState
                } else {
                    subList
                }
            }
            // 8 below the search field the large title already owns, 24 of air
            // at the bottom of the scroll.
            .padding(.top, WVSpacing.sm)
            .padding(.bottom, WVSpacing.xl)
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

    /// The way into the advisory self-audit — a card above the list (§8.5).
    ///
    /// It used to be a row, but three lines of explanation inside a row is a
    /// paragraph pretending to be one: the paragraph moves into the block and the
    /// action becomes a full-width button. The purple "search" tile goes; the
    /// glyph survives, neutral, inside the button.
    ///
    /// §8.5 names `WVButton(.secondary)`, whose label is `WVColor.tint`. That
    /// would be a third coral thing on this screen (the selected tab, the toolbar
    /// `+`), and §5.1 puts "coral for a secondary control" explicitly out — so
    /// the button keeps the secondary button's geometry (`fill2`, 12 pt radius,
    /// 17 semibold) and takes `label` for its text. Coral stays the tab plus the
    /// one create action (§10.3 check 5).
    ///
    /// The paragraph describes what the audit **reads** (recorded payment
    /// history) and never pre-judges the result — no "gói bỏ quên", no "bạn
    /// không dùng".
    private var auditCard: some View {
        VStack(alignment: .leading, spacing: WVSpacing.md) {
            Text(SubscriptionAuditRules.entrySubtitle)
                .wvFont(.footnote)
                .foregroundStyle(WVColor.label3)
                .fixedSize(horizontal: false, vertical: true)

            NavigationLink {
                SubscriptionAuditScreen(client: client, subsStore: store)
            } label: {
                HStack(spacing: WVSpacing.sm) {
                    WVIcon("search", size: 18)
                    Text(L.t("Soát gói đăng ký"))
                }
                .wvFont(.body, weight: .semibold)
                .foregroundStyle(WVColor.label)
                .frame(maxWidth: .infinity)
                .frame(minHeight: 50)
                .padding(.vertical, WVSpacing.sm)
                .background(WVColor.fill2)
                .clipShape(RoundedRectangle(cornerRadius: WVRadius.list, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(WVPressableStyle())
        }
        .padding(WVSpacing.gutter)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WVColor.bg2)
        // A row-card, not a screen-level card: only the cost card above is 16 pt
        // (§4 keeps one screen-level card per screen).
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.list, style: .continuous))
        .padding(.horizontal, WVSpacing.gutter)
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            // A secondary control is not coral (§5.1).
            Button { showSort = true } label: {
                WVIcon("filter", size: 18)
                    .foregroundStyle(WVColor.label2)
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            // The screen's one action.
            Button { pushCreate = true } label: {
                WVIcon("plus", size: 17, weight: .semibold)
                    .foregroundStyle(WVColor.tint)
            }
        }
    }

    // MARK: - Cost summary card

    /// The screen's lead (§7: "the monthly cost, as a plain number on a white
    /// card") and its only screen-level card.
    ///
    /// This was the indigo→blue gradient (§1.1) — the one screen in the app with
    /// no coral in it, coloured by nothing the user could act on. It is a white
    /// card on the grouped background now (16 pt radius, 16 pt padding); the
    /// money is `label`, because money is never a state (§5.2).
    ///
    /// §8.5's eyebrow is "Mỗi tháng", which is not a localisation key — drawing
    /// it would leave English in Vietnamese (the same defect the parent's rule D
    /// caught on "chưa có hạn"). "Phí định kỳ mỗi tháng" is the existing,
    /// translated name for this exact number (it is the Stats label for it).
    private var subCostCard: some View {
        WVCard {
            VStack(alignment: .leading, spacing: WVSpacing.sm) {
                Text(L.t("Phí định kỳ mỗi tháng"))
                    .wvFont(.footnoteEmphasis)
                    .foregroundStyle(WVColor.label3)
                Text(WVFormat.vnd(Int(monthly.rounded())))
                    .wvFont(.statValue)
                    .foregroundStyle(WVColor.label)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    // "≈ 8.688.000 ₫ một năm" in the brief; "~ %@ / năm" is the
                    // existing translated key for the same estimate and keeps the
                    // app's one money format (§1.6).
                    Text(L.t("~ %@ / năm", WVFormat.vnd(Int(yearly.rounded())))
                         + " · " + L.p("%d gói đang chạy", activeSubs.count))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: - Empty state

    @ViewBuilder
    private var emptyState: some View {
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
    }

    // MARK: - List

    private var subList: some View {
        VStack(spacing: 0) {
            WVGroup {
                ForEach(Array(filtered.enumerated()), id: \.element.id) { idx, sub in
                    // 56 = 16 + 28 + 12: the hairline aligns to the row title
                    // after the 28 pt tile (§3).
                    if idx > 0 { WVDivider() }
                    NavigationLink(value: sub) {
                        SubRowContent(sub: sub)
                            .padding(.horizontal, WVSpacing.gutter)
                            .frame(minHeight: 44)
                            .padding(.vertical, WVSpacing.sm)
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
                            // Text-only rows: no icon tile, so the hairline
                            // follows the 16 pt gutter (§3, sweep B).
                            if idx > 0 { WVDivider(inset: WVSpacing.gutter) }
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
                                        // Position already says "selected"
                                        // (§5.1): the check is `label`, not coral.
                                        WVIcon("check", size: 16, weight: .bold)
                                            .foregroundStyle(WVColor.label)
                                    }
                                }
                                .padding(.horizontal, WVSpacing.gutter)
                                .frame(minHeight: 44)
                                .padding(.vertical, WVSpacing.sm)
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
                    // The sheet's navigation tint, not a content action.
                    Button(L.t("Xong")) { showSort = false }
                        .wvFont(.bodyEmphasis)
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - Row content

/// One subscription row: a 28 pt neutral tile, the name and its cycle, and the
/// trailing money + renewal column.
///
/// §8.5's anatomy: glyph 20 pt neutral, name `rowTitle`, meta `Apple · Hàng
/// tháng`, trailing price `rowValue` `label` with the renewal state under it in
/// `meta`, coloured by §6. §10.3 check 8: the title yields before the value —
/// the trailing column is sized to its ideal width (`fixedSize`) and the name
/// truncates instead.
private struct SubRowContent: View {
    let sub: Subscription

    /// The name and the price share one line at the default size. At
    /// Accessibility sizes they stop fitting side by side, so the row stacks
    /// them: name, cycle, price, then the renewal state.
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var days: Int { WVFormat.daysUntil(sub.renewalDate) }

    var body: some View {
        HStack(alignment: .center, spacing: WVSpacing.md) {
            SubCategoryIcon(category: sub.category)
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
        HStack(alignment: .center, spacing: WVSpacing.sm) {
            VStack(alignment: .leading, spacing: WVSpacing.sm) {
                nameText
                    .lineLimit(1)
                cycleText
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .trailing, spacing: WVSpacing.sm) {
                priceText
                renewalText
            }
            // The value column is never the thing that gets ellipsized.
            .fixedSize(horizontal: true, vertical: false)
        }
    }

    private var stackedContent: some View {
        VStack(alignment: .leading, spacing: WVSpacing.xs) {
            nameText
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
            cycleText
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            priceText
            renewalText
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// No line limit here: the two layouts own it (one line in the horizontal
    /// row, three when the row stacks at Accessibility sizes) — an inner
    /// `.lineLimit(1)` would win over the outer one and clip the name at AX3.
    private var nameText: some View {
        Text(sub.name)
            .wvFont(.bodyEmphasis)
            .foregroundStyle(WVColor.label)
    }

    private var priceText: some View {
        Text(WVFormat.vnd(sub.price))
            .wvFont(.body, weight: .medium)
            .foregroundStyle(WVColor.label)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }

    private var cycleText: some View {
        Text([sub.brand, sub.billingCycle.shortLabel]
            .compactMap { $0 }.joined(separator: " · "))
            .wvFont(.footnote)
            .foregroundStyle(WVColor.label3)
    }

    /// §6's row grammar in the row's `meta` size, on a **renewal** date rather
    /// than an expiry:
    ///
    /// * more than 90 days → the absolute date, `label3`;
    /// * 31…90 days → `còn N ngày`, amber;
    /// * today…30 days → `còn N ngày` (today: `hôm nay`), red;
    /// * past → `Chưa ghi nhận kỳ mới`, `label3`.
    ///
    /// A past renewal is not an expiry. Printing the stored date (`15/02/2022`)
    /// reads as "this renewed and you missed it", when what actually happened is
    /// that the new period was never recorded — so §5.2 asks for the state to
    /// say so, in `label3` because nobody can act on 2022. It used to be a
    /// literal in the comment ("not a localisation key"), which would have put
    /// Vietnamese in an English UI; it is now a real `L.t` key in both
    /// languages.
    ///
    /// The thresholds come from `WarrantyPillCopy.status`, the unit-tested rule,
    /// so the colour can never drift from the copy; `DeadlineCopy.dayPhrase`
    /// supplies the localised day fragment. A lifetime subscription has no
    /// renewal, so it prints nothing rather than a fake one.
    @ViewBuilder
    private var renewalText: some View {
        if sub.billingCycle != .LIFETIME {
            Text(renewalLabel)
                .wvFont(.footnote)
                .foregroundStyle(renewalColor)
                .lineLimit(1)
        }
    }

    private var renewalLabel: String {
        switch WarrantyPillCopy.status(daysLeft: days) {
        case .safe:           return WVFormat.date(sub.renewalDate)
        // Past: the stored date is the wrong fact, not a stale one.
        case .expired:        return L.t("Chưa ghi nhận kỳ mới")
        case .warn, .danger:  return DeadlineCopy.dayPhrase(days)
        }
    }

    private var renewalColor: Color {
        switch WarrantyPillCopy.status(daysLeft: days) {
        case .safe, .expired: return WVColor.label3
        case .warn:           return WVColor.orange
        case .danger:         return WVColor.red
        }
    }
}

// MARK: - Leading tile

/// The row's leading tile (§3): 28 pt, `fill3`, 8 pt radius, 20 pt `label2`
/// glyph — always neutral, never a category hue.
///
/// `WVCategory.icon(for:)` falls back to "package" when the catalog category is
/// missing (or is not a subscription category), which is what put three shipping
/// boxes on the three rows that are not iCloud. §8.5 asks for the renewal symbol
/// instead. It is drawn here rather than through `WVIcon` because `WVIconMap` has
/// no name for `arrow.triangle.2.circlepath` and the design system is not this
/// screen's file.
private struct SubCategoryIcon: View {
    let category: String?

    private var catalogIcon: String? {
        let icon = WVCategory.icon(for: category)
        return icon == "package" ? nil : icon
    }

    var body: some View {
        RoundedRectangle(cornerRadius: WVRadius.sm, style: .continuous)
            .fill(WVColor.fill3)
            .frame(width: 28, height: 28)
            .overlay {
                if let icon = catalogIcon {
                    WVIcon(icon, size: 20)
                } else {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 20, weight: .semibold))
                }
            }
            .foregroundStyle(WVColor.label2)
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
