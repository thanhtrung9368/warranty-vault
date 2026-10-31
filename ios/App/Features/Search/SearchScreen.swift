import SwiftUI
import WarrlyKit

// ============================================================
// SearchScreen — global, cross-entity search
//
// The four entity tabs each have their own `.searchable`, but each one only
// filters the rows it already holds — nothing searches *across* entities, so
// "samsung" could not find a Samsung Cloud subscription, the Galaxy Buds on the
// wishlist, or the OCR text of a scanned receipt. `GET /api/v1/search?q=&limit=`
// answers all four groups in one round trip, and this is the surface for it.
//
// Why a pushed screen instead of `.searchable` on the tab shell: the shell is a
// five-tab `TabView` where each tab owns its own `NavigationStack`, and a search
// that spans three of those tabs does not belong inside any one of them. A
// dedicated screen keeps the four list screens (and their existing per-screen
// filters) untouched, and can be pushed from any tab's stack — it owns the three
// list stores its detail destinations need.
//
// Rows. A hit is not a search-shaped row: it is the row its own screen shows
// (§4 "the same row everywhere it appears", §8.8). A device hit is the Thiết bị
// row — neutral 28 pt tile, name, `brand · price`, the §6 deadline column. A
// subscription hit is the Đăng ký row — price over the renewal state. A wishlist
// hit is the Wishlist row — price over the target date. A receipt hit keeps the
// file row, with its filing state as the second line of the same value column.
//
// That is the fix for §1.11, the reason this screen is in the pass: the state
// "where does this thing stand?" used to be drawn three ways in this one list —
// a green filled pill (`Đang dùng`), green text (`Đang hoạt động`) and grey text
// (`Đang theo dõi`) — while "sold" was a blue pill, blue being the app's
// information colour on the state that needs no action at all. There is now one
// drawing for it: the trailing column, text only, coloured by §6 alone. A status
// word is not a second drawing.
//
// Receipts have no tab and no detail screen: a hit opens a sheet that shows the
// file and the OCR transcript it matched, with the same inbox/file state the
// inbox renders. The group is empty for an account that has never scanned, and
// an empty group is not rendered at all.
//
// States: blank query (idle), typing/debounce (loading), results grouped by
// entity, a real query with no matches, over-long input and transport failures.
// A blank query is never an error — the server answers 200 with empty groups and
// the screen just shows the initial prompt again.
// ============================================================

struct SearchScreen: View {
    let client: APIClient

    @StateObject private var devicesStore: DevicesStore
    @StateObject private var subsStore: SubscriptionsStore
    @StateObject private var wishStore: WishlistStore

    @State private var query = ""
    @State private var results: SearchResults?
    @State private var isLoading = false
    @State private var errorMessage: String?
    /// The receipt hit whose preview sheet is open. `nil` = closed.
    @State private var previewHit: AttachmentSearchHit?

    /// Rows fetched **per group** (server default 20, cap 50).
    private static let limit = SearchQueryRules.defaultLimit
    /// Wait for the typing to settle before asking the server.
    private static let debounceNanos: UInt64 = 300_000_000

    init(client: APIClient) {
        self.client = client
        _devicesStore = StateObject(wrappedValue: DevicesStore(client: client))
        _subsStore = StateObject(wrappedValue: SubscriptionsStore(client: client))
        _wishStore = StateObject(wrappedValue: WishlistStore(client: client))
    }

    private var phase: SearchPhase {
        SearchPhase.resolve(query: query, isLoading: isLoading, results: results, error: errorMessage)
    }

    // MARK: - Body

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                content
            }
            .padding(.bottom, WVSpacing.xl)
        }
        .wvScreen()
        .navigationTitle(L.t("Tìm kiếm"))
        .navigationBarTitleDisplayMode(.inline)
        // §8.8 describes this field as `fill3`, radius 8, 36 pt tall, 16 pt
        // gutter — which is what the system search bar already draws — and asks
        // for its `Hủy` to become `label` (§5.1: a secondary control is not
        // coral). That button belongs to the system search controller: SwiftUI
        // exposes no per-screen style for it, and the only handles are a global
        // `UISearchBar` appearance (every screen's search field) or replacing
        // the system field with a hand-built one (loses focus/keyboard handling
        // and the screenshot-QA path). Left as the system draws it; reported.
        .searchable(
            text: $query,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: L.t("Thiết bị, gói đăng ký, wishlist, hoá đơn...")
        )
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        // `.task(id:)` cancels the previous run when `query` changes, so the
        // debounce sleep and the in-flight request are both superseded by the
        // next keystroke.
        .task(id: query) { await search() }
        .navigationDestination(for: SearchNav.self) { nav in
            destination(for: nav)
        }
        .sheet(item: $previewHit) { hit in
            AttachmentSearchPreviewSheet(client: client, hit: hit)
        }
    }

    // MARK: - States

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .idle:
            WVEmpty(
                icon: "search",
                title: L.t("Tìm mọi thứ"),
                description: L.t("Gõ tên thiết bị, gói đăng ký, món trong wishlist hoặc nội dung hoá đơn. Không dấu vẫn khớp — “dien thoai” tìm ra “Điện thoại”.")
            )

        case .tooLong:
            WVEmpty(
                icon: "alert",
                title: L.t("Từ khoá quá dài"),
                description: SearchQueryRules.tooLongMessage
            )

        case .loading:
            loading

        case .results:
            if let results { resultList(results) }

        case .noResults:
            WVEmpty(
                icon: "search",
                title: L.t("Không có gì khớp"),
                description: L.t("Không tìm thấy thiết bị, gói đăng ký, món wishlist hay văn bản hoá đơn nào. Thử từ khoá ngắn hơn.")
            )

        case .failed(let message):
            WVEmpty(
                icon: "alert",
                title: L.t("Không tìm được"),
                description: message
            )
        }
    }

    /// The debounce window. One inline spinner and one meta line, at a spacing
    /// step (§3) instead of a fixed 60 pt.
    private var loading: some View {
        HStack(spacing: WVSpacing.sm) {
            ProgressView()
            Text(L.t("Đang tìm…"))
                .wvFont(.subheadline)
                .foregroundStyle(WVColor.label3)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, WVSpacing.xl)
    }

    // MARK: - Results

    private func resultList(_ results: SearchResults) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(L.p("%d kết quả", results.totalCount))
                .wvFont(.footnote)
                .foregroundStyle(WVColor.label3)
                .padding(.horizontal, WVSpacing.gutter)
                .padding(.top, WVSpacing.sm)

            ForEach(results.sections) { section in
                // §8.8's group heading is the 20 pt semibold sentence-case
                // content heading — `WVDashSectionHead`, **not**
                // `WVSectionHeader`. The latter is the OS-shaped grouped-list
                // header (13 pt, uppercase, tracked) that Cài đặt / Hồ sơ /
                // Thêm use; it would re-uppercase these titles and put the
                // wrong role on a content heading.
                WVDashSectionHead(section.title)
                WVGroup {
                    rows(for: section.kind, in: results)
                }
            }

            // Each group is capped by `limit`, so say it rather than let the
            // list look complete when it isn't.
            if results.sections.contains(where: { $0.count >= Self.limit }) {
                WVSectionFooter(L.t("Mỗi nhóm hiện tối đa %d kết quả. Gõ cụ thể hơn để thu hẹp.", Self.limit))
            }
        }
    }

    @ViewBuilder
    private func rows(for kind: SearchSection.Kind, in results: SearchResults) -> some View {
        switch kind {
        case .devices:
            ForEach(Array(results.devices.enumerated()), id: \.element.id) { idx, device in
                // `WVDivider()` defaults to `rowInset` (56) = 16 gutter + 28
                // tile + 12 gap, so the hairline starts where the name does
                // (§3). Every group below has the same 28 pt leading tile.
                if idx > 0 { WVDivider() }
                NavigationLink(value: SearchNav.device(device)) {
                    SearchDeviceRow(device: device)
                }
                .buttonStyle(WVRowButtonStyle())
            }

        case .subscriptions:
            ForEach(Array(results.subscriptions.enumerated()), id: \.element.id) { idx, sub in
                if idx > 0 { WVDivider() }
                NavigationLink(value: SearchNav.subscription(sub)) {
                    SearchSubscriptionRow(sub: sub)
                }
                .buttonStyle(WVRowButtonStyle())
            }

        case .wishlist:
            ForEach(Array(results.wishlist.enumerated()), id: \.element.id) { idx, item in
                if idx > 0 { WVDivider() }
                NavigationLink(value: SearchNav.wishlist(item)) {
                    SearchWishlistRow(item: item)
                }
                .buttonStyle(WVRowButtonStyle())
            }

        case .attachments:
            ForEach(Array(results.attachments.enumerated()), id: \.element.id) { idx, hit in
                if idx > 0 { WVDivider() }
                Button { previewHit = hit } label: {
                    SearchAttachmentRow(hit: hit)
                }
                .buttonStyle(WVRowButtonStyle())
            }
        }
    }

    // MARK: - Destinations

    /// Each result pushes exactly the screen its own tab would push.
    ///
    /// The detail screens read their data from the API themselves, but they fall
    /// back to the list store for an instant render — and their quick actions
    /// (đổi trạng thái, mua rồi) go through it. This screen owns its own copies,
    /// so they are filled lazily when a destination appears.
    @ViewBuilder
    private func destination(for nav: SearchNav) -> some View {
        switch nav {
        case .device(let device):
            DeviceDetailView(client: client, devicesStore: devicesStore, device: device)
                .task { if devicesStore.devices.isEmpty { await devicesStore.load() } }

        case .subscription(let sub):
            SubscriptionDetailView(client: client, store: subsStore, subscriptionId: sub.id)
                .task { if subsStore.subscriptions.isEmpty { await subsStore.load() } }

        case .wishlist(let item):
            WishlistDetailView(client: client, store: wishStore, itemId: item.id)
                .task { if wishStore.items.isEmpty { await wishStore.load() } }
        }
    }

    // MARK: - Fetching

    private func search() async {
        errorMessage = nil
        results = nil

        // Blank input: the box was cleared (or never typed in). No request, and
        // above all no error — deleting the last character is not a mistake.
        guard !SearchQueryRules.isBlank(query) else {
            isLoading = false
            return
        }
        // Over 200 runes the server answers 400, so the screen says so instead.
        guard !SearchQueryRules.exceedsMaxRunes(query) else {
            isLoading = false
            return
        }

        isLoading = true
        do {
            try await Task.sleep(nanoseconds: Self.debounceNanos)
            let response = try await client.search(q: query, limit: Self.limit)
            try Task.checkCancellation()
            results = response
            isLoading = false
        } catch is CancellationError {
            // A newer keystroke took over; that task owns the state now.
        } catch {
            // A newer keystroke cancelled this run. URLSession surfaces that as
            // `URLError.cancelled`, not `CancellationError`, so check the task
            // too — the new run owns the state, and a fast typist must not see a
            // flash of "không kết nối được".
            if Task.isCancelled || error is CancellationError
                || (error as? URLError)?.code == .cancelled {
                return
            }
            isLoading = false
            errorMessage = (error as? APIError)?.localizedDescription
                ?? L.t("Không kết nối được máy chủ.")
        }
    }
}

// MARK: - Navigation

/// Hashable so a row can push without looking the entity up again.
enum SearchNav: Hashable {
    case device(Device)
    case subscription(Subscription)
    case wishlist(WishlistItem)
}

// MARK: - Rows

/// One device hit — the Thiết bị list row (§8.1), not a search-specific one.
///
/// Anatomy: 28 pt neutral tile → name 17 semibold → `brand · price` 13 → the §6
/// deadline column → 13 pt chevron. The status chip is gone: the one place a
/// state is drawn is the trailing column, and a sold device says `Đã bán` there
/// instead of wearing a blue pill (§1.11, §5.2).
private struct SearchDeviceRow: View {
    let device: Device

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    /// The cap on the trailing deadline column (§8.1), scaled so a long phrase
    /// like `Hết hạn hôm nay` cannot clip at a large non-Accessibility size.
    /// A **cap**, not a reservation: a row whose value is `còn 8 ngày` gives the
    /// unused points back to the name (§1.13). Values still end on one x,
    /// because being the last item in the row's HStack right-aligns them to it.
    @ScaledMetric(relativeTo: .body) private var valueColumnWidth: CGFloat = 96

    var body: some View {
        HStack(alignment: .center, spacing: WVSpacing.md) {
            // `WVLeadingIcon` is `fill3` + a `label2` glyph: a category is an
            // identity, not a state, so it carries no colour (§5.1).
            WVLeadingIcon(icon: WVCategory.icon(for: device.category), size: 28)
            if dynamicTypeSize.isAccessibilitySize {
                stackedContent
            } else {
                horizontalContent
            }
            WVIcon("arrowRight", size: 13)
                .foregroundStyle(WVColor.label4)
        }
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.vertical, WVSpacing.sm)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }

    private var horizontalContent: some View {
        HStack(alignment: .center, spacing: WVSpacing.md) {
            VStack(alignment: .leading, spacing: WVSpacing.sm) {
                nameText
                    .lineLimit(1)
                HStack(spacing: WVSpacing.sm) {
                    metaText
                        .lineLimit(1)
                    mismatchBadge
                        // The mismatch flag is a signal: the meta line gives
                        // way first, never it.
                        .layoutPriority(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            // §10.3 #8, §1.13: the name yields last. The priority has to sit on
            // this block — a stack only negotiates against its *direct*
            // children's priorities, so `.layoutPriority(1)` on `nameText` one
            // level down never reached the row's HStack. That, plus the 96 pt
            // the value column used to reserve whether or not it needed them,
            // is what drew `Apple Watch Serie…` with empty space to its right.
            .layoutPriority(1)

            deadlineColumn
                // A cap, not a pin: `còn 8 ngày` is narrower than 96 pt and
                // hands the difference to the name instead of holding an empty
                // gutter.
                .frame(maxWidth: valueColumnWidth, alignment: .trailing)
        }
    }

    /// At Accessibility sizes the deadline no longer fits beside the name, so
    /// the row stacks — same content, same order, only the axis changes.
    private var stackedContent: some View {
        VStack(alignment: .leading, spacing: WVSpacing.sm) {
            nameText
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
            deadlineColumn
            HStack(spacing: WVSpacing.sm) {
                metaText
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                mismatchBadge
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// No line limit here: the two layouts own it (one line in the horizontal
    /// row, three when it stacks) — an inner `.lineLimit(1)` would win over the
    /// outer one and clip the name at AX3.
    private var nameText: some View {
        Text(device.name)
            .wvFont(.bodyEmphasis)
            .foregroundStyle(WVColor.label)
    }

    private var metaText: some View {
        Text("\(device.brand ?? "—") · \(WVFormat.currency(device.purchasePrice, device.currency))")
            .wvFont(.footnote)
            .foregroundStyle(WVColor.label3)
    }

    /// §6, the row form: the absolute date beyond 90 days (that is why the pill
    /// takes `endDate`), a day count inside 90, `đã hết hạn` grey once it is
    /// gone, `chưa ghi hạn` when there is no date at all. `nil` days is "no
    /// date", never "expired".
    ///
    /// Sold short-circuits ahead of it: `WarrantyPill` has no sold input, a sold
    /// device has no deadline to report, and `Đã bán` must win over a date that
    /// is still in the future.
    @ViewBuilder
    private var deadlineColumn: some View {
        if device.status == .SOLD {
            Text(L.t("Đã bán"))
                .wvFont(.body, weight: .medium)
                .foregroundStyle(WVColor.label3)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        } else {
            WarrantyPill(daysLeft: daysLeft, endDate: device.effectiveWarrantyEnd)
        }
    }

    private var daysLeft: Int? {
        guard let end = device.effectiveWarrantyEnd else { return nil }
        return WVFormat.daysUntil(end)
    }

    /// The brand's own warranty date disagrees with the counted one. Amber
    /// because it is data that needs a look, never a fill (§5.2), and it is
    /// carried here because the search hit returns the same computed flag the
    /// list row has — a hit must not be the one payload that hides it.
    @ViewBuilder
    private var mismatchBadge: some View {
        if device.warrantyMismatch != nil {
            HStack(spacing: WVSpacing.xs) {
                WVIcon("alert", size: 12)
                Text(BrandWarrantyCopy.mismatchBadge)
                    // 13 pt is the floor for text (§2).
                    .wvFont(.footnote)
            }
            .foregroundStyle(WVColor.orange)
            .lineLimit(1)
        }
    }
}

/// One subscription hit — the Đăng ký list row (§8.5): name and cycle on the
/// left, price over the renewal state in the trailing column. No status word:
/// the renewal line already says what state the subscription is in.
private struct SearchSubscriptionRow: View {
    let sub: Subscription

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var days: Int { WVFormat.daysUntil(sub.renewalDate) }

    var body: some View {
        HStack(alignment: .center, spacing: WVSpacing.md) {
            SearchSubscriptionIcon(category: sub.category)
            if dynamicTypeSize.isAccessibilitySize {
                stackedContent
            } else {
                horizontalContent
            }
            WVIcon("arrowRight", size: 13)
                .foregroundStyle(WVColor.label4)
        }
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.vertical, WVSpacing.sm)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
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

    private var nameText: some View {
        Text(sub.name)
            .wvFont(.bodyEmphasis)
            .foregroundStyle(WVColor.label)
    }

    private var cycleText: some View {
        Text([sub.brand, sub.billingCycle.shortLabel]
            .compactMap { $0 }.filter { !$0.isEmpty }
            .joined(separator: " · "))
            .wvFont(.footnote)
            .foregroundStyle(WVColor.label3)
    }

    private var priceText: some View {
        Text(WVFormat.vnd(sub.price))
            .wvFont(.body, weight: .medium)
            .foregroundStyle(WVColor.label)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }

    /// §6's row grammar on a **renewal** date (§8.5): the absolute date beyond
    /// 90 days, `còn N ngày` inside 90, today's own phrase, and `Chưa ghi nhận
    /// kỳ mới` in `label3` once it is past — the same drawing the Đăng ký row
    /// uses, because a hit is that row (§8.8). A past renewal is not an expiry:
    /// the stored date reads as "this renewed and you missed it", while what
    /// happened is that the new period was never recorded. The thresholds come
    /// from `WarrantyPillCopy.status`, the unit-tested rule, so the colour can
    /// never drift from the copy; `DeadlineCopy.dayPhrase` supplies the
    /// localised day fragment. A lifetime subscription has no renewal, so it
    /// prints nothing rather than inventing one.
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

/// The subscription row's leading tile, the same one the Đăng ký screen uses:
/// a 28 pt `fill3` tile with a 20 pt `label2` glyph. It falls back to the
/// renewal symbol when the category has no catalogue icon — a shipping box
/// says "unknown object", which a subscription is not.
private struct SearchSubscriptionIcon: View {
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
                    // A glyph, not text: Fonts.swift keeps SF Symbol sizes on
                    // the icon scale rather than on a `WVFont` role.
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 20, weight: .semibold))
                }
            }
            .foregroundStyle(WVColor.label2)
    }
}

/// One wishlist hit — the Wishlist list row (§8.6): brand · **catalogue** label
/// (never the raw wire code, §1.14) with the price-drop verdict beside it, and
/// the price over the §6 target-date column. No `Đang theo dõi` word: the target
/// date is the state.
private struct SearchWishlistRow: View {
    let item: WishlistItem

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var deltaPercentage: Double? {
        guard let initial = item.initialPrice,
              let current = item.currentPrice,
              initial != 0
        else { return nil }
        let delta = Double(current - initial) / Double(initial) * 100
        return delta == 0 ? nil : delta
    }

    /// `Apple · Laptop` — the catalogue label, never the raw code (§1.14).
    private var categoryLabel: String? {
        guard let code = item.category, !code.isEmpty else { return nil }
        return CategoryLabels.label(for: code)
    }

    private var meta: String {
        [item.brand, categoryLabel]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                accessibilityRow
            } else {
                regularRow
            }
        }
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.vertical, WVSpacing.sm)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }

    private var regularRow: some View {
        HStack(spacing: WVSpacing.md) {
            leadingIcon
            nameAndMeta
                // §10.3 #8: the name yields to the value, never the reverse.
                .layoutPriority(1)
            Spacer(minLength: WVSpacing.sm)
            valueColumn(alignment: .trailing)
            chevron
        }
    }

    private var accessibilityRow: some View {
        VStack(alignment: .leading, spacing: WVSpacing.sm) {
            HStack(alignment: .top, spacing: WVSpacing.md) {
                leadingIcon
                nameAndMeta
                    .layoutPriority(1)
                chevron
            }
            valueColumn(alignment: .leading)
                // 28 pt tile + 12 pt gap: the value lines up under the name.
                .padding(.leading, 28 + WVSpacing.md)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var leadingIcon: some View {
        WVLeadingIcon(icon: WVCategory.icon(for: item.category), size: 28)
    }

    private var chevron: some View {
        WVIcon("arrowRight", size: 13)
            .foregroundStyle(WVColor.label4)
    }

    private var nameAndMeta: some View {
        VStack(alignment: .leading, spacing: WVSpacing.xs) {
            Text(item.name)
                .wvFont(.bodyEmphasis)
                .foregroundStyle(WVColor.label)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
                .fixedSize(horizontal: false, vertical: true)

            if !meta.isEmpty || deltaPercentage != nil {
                HStack(spacing: WVSpacing.sm) {
                    if !meta.isEmpty {
                        Text(meta)
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.label3)
                            .lineLimit(1)
                    }
                    if let delta = deltaPercentage {
                        // A verdict, not an identity: meta size, state colour
                        // (green for a drop, red for a rise).
                        Text(deltaLabel(delta))
                            .wvFont(.footnote)
                            .foregroundStyle(delta < 0 ? WVColor.green : WVColor.red)
                            .lineLimit(1)
                    }
                }
            }
        }
    }

    /// Price (`rowValue`, always `label`) over `WarrantyPill`'s §6 grammar on
    /// the target date. A wishlist item is not a warranty, so there is no
    /// `chưa ghi hạn` fallback: no target date means no second line.
    private func valueColumn(alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: WVSpacing.xs) {
            if let current = item.currentPrice {
                Text(WVFormat.vnd(current))
                    .wvFont(.body, weight: .medium)
                    .foregroundStyle(WVColor.label)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            if let target = item.targetDate {
                WarrantyPill(daysLeft: WVFormat.daysUntil(target), endDate: target)
            }
        }
    }

    private func deltaLabel(_ delta: Double) -> String {
        "\(delta < 0 ? "↓" : "↑") \(String(format: "%.1f", abs(delta)))%"
    }
}

/// One receipt hit. The file's row is the only one with no money and no
/// deadline, so its value column carries the two facts it does have: when it
/// was uploaded, and where it is filed.
///
/// The filing state is text, like every other state on this screen (§5.2). It
/// used to be a filled chip — orange for the inbox, blue for filed — which is
/// §1.11's defect one row further down the list.
private struct SearchAttachmentRow: View {
    let hit: AttachmentSearchHit

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    /// One line of the matched transcript, newlines flattened so a receipt
    /// header does not turn the row into a paragraph.
    private var snippet: String? {
        guard let raw = hit.attachment.extractedText else { return nil }
        let text = raw
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }

    var body: some View {
        HStack(alignment: .center, spacing: WVSpacing.md) {
            WVLeadingIcon(icon: "receipt", size: 28)
            if dynamicTypeSize.isAccessibilitySize {
                stackedContent
            } else {
                horizontalContent
            }
            WVIcon("arrowRight", size: 13)
                .foregroundStyle(WVColor.label4)
        }
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.vertical, WVSpacing.sm)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }

    private var horizontalContent: some View {
        HStack(alignment: .center, spacing: WVSpacing.sm) {
            VStack(alignment: .leading, spacing: WVSpacing.xs) {
                nameText
                    .lineLimit(1)
                    // §10.3 #8: the file name yields only after the value
                    // column has taken what it needs.
                    .layoutPriority(1)
                if let snippet {
                    snippetText(snippet)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .trailing, spacing: WVSpacing.xs) {
                dateText
                filingText
            }
            .fixedSize(horizontal: true, vertical: false)
        }
    }

    private var stackedContent: some View {
        VStack(alignment: .leading, spacing: WVSpacing.xs) {
            nameText
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
            if let snippet {
                snippetText(snippet)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            dateText
            filingText
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var nameText: some View {
        Text(hit.attachment.fileName)
            .wvFont(.bodyEmphasis)
            .foregroundStyle(WVColor.label)
    }

    private func snippetText(_ text: String) -> some View {
        Text(text)
            .wvFont(.footnote)
            .foregroundStyle(WVColor.label3)
    }

    private var dateText: some View {
        Text(WVFormat.dateTime(hit.attachment.uploadedAt))
            .wvFont(.footnote)
            .foregroundStyle(WVColor.label3)
            .lineLimit(1)
    }

    /// `Trong hộp thư` / `Đã gắn thiết bị` — the same state the inbox draws,
    /// in the one drawing this screen allows. Nothing to act on here either way
    /// (search is a read surface), so it is `label3`.
    private var filingText: some View {
        Text(hit.filing.label)
            .wvFont(.footnote)
            .foregroundStyle(WVColor.label3)
            .lineLimit(1)
    }
}
