import SwiftUI
import WarrantyVaultKit

// ============================================================
// SearchScreen — global, cross-entity search
//
// The four entity tabs each have their own `.searchable`, but each one only
// filters the rows it already holds — nothing searches *across* entities, so
// "samsung" could not find a Samsung Cloud subscription or the Galaxy Buds on
// the wishlist. `GET /api/v1/search?q=&limit=` answers all three groups in one
// round trip, and this is the surface for it.
//
// Why a pushed screen instead of `.searchable` on the tab shell: the shell is a
// five-tab `TabView` where each tab owns its own `NavigationStack`, and a search
// that spans three of those tabs does not belong inside any one of them. A
// dedicated screen keeps the four list screens (and their existing per-screen
// filters) untouched, and can be pushed from any tab's stack — it owns the three
// list stores its detail destinations need.
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
                Spacer().frame(height: 8)
                content
                Spacer().frame(height: 24)
            }
        }
        .wvScreen()
        .navigationTitle("Tìm kiếm")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(
            text: $query,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: "Thiết bị, gói đăng ký, wishlist..."
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
    }

    // MARK: - States

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .idle:
            WVEmpty(
                icon: "search",
                title: "Tìm mọi thứ",
                description: "Gõ tên thiết bị, gói đăng ký hoặc món trong wishlist. Không dấu vẫn khớp — “dien thoai” tìm ra “Điện thoại”."
            )

        case .tooLong:
            WVEmpty(
                icon: "alert",
                title: "Từ khoá quá dài",
                description: SearchQueryRules.tooLongMessage
            )

        case .loading:
            HStack(spacing: 8) {
                ProgressView()
                Text("Đang tìm…")
                    .font(.system(size: 15))
                    .foregroundStyle(WVColor.label3)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 60)

        case .results:
            if let results { resultList(results) }

        case .noResults:
            WVEmpty(
                icon: "search",
                title: "Không có gì khớp",
                description: "Không tìm thấy thiết bị, gói đăng ký hay món wishlist nào. Thử từ khoá ngắn hơn."
            )

        case .failed(let message):
            WVEmpty(
                icon: "alert",
                title: "Không tìm được",
                description: message
            )
        }
    }

    // MARK: - Results

    private func resultList(_ results: SearchResults) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(results.totalCount == 1 ? "1 kết quả" : "\(results.totalCount) kết quả")
                .font(.system(size: 13))
                .foregroundStyle(WVColor.label3)
                .padding(.horizontal, WVSpacing.titleGutter)
                .padding(.bottom, 4)

            ForEach(results.sections) { section in
                WVSectionHeader(section.title)
                WVGroup {
                    rows(for: section.kind, in: results)
                }
            }

            // Each group is capped by `limit`, so say it rather than let the
            // list look complete when it isn't.
            if results.sections.contains(where: { $0.count >= Self.limit }) {
                WVSectionFooter("Mỗi nhóm hiện tối đa \(Self.limit) kết quả. Gõ cụ thể hơn để thu hẹp.")
            }
        }
    }

    @ViewBuilder
    private func rows(for kind: SearchSection.Kind, in results: SearchResults) -> some View {
        switch kind {
        case .devices:
            ForEach(Array(results.devices.enumerated()), id: \.element.id) { idx, device in
                if idx > 0 { WVDivider(inset: 60) }
                NavigationLink(value: SearchNav.device(device)) {
                    SearchDeviceRow(device: device)
                }
                .buttonStyle(WVRowButtonStyle())
            }

        case .subscriptions:
            ForEach(Array(results.subscriptions.enumerated()), id: \.element.id) { idx, sub in
                if idx > 0 { WVDivider(inset: 60) }
                NavigationLink(value: SearchNav.subscription(sub)) {
                    SearchSubscriptionRow(sub: sub)
                }
                .buttonStyle(WVRowButtonStyle())
            }

        case .wishlist:
            ForEach(Array(results.wishlist.enumerated()), id: \.element.id) { idx, item in
                if idx > 0 { WVDivider(inset: 60) }
                NavigationLink(value: SearchNav.wishlist(item)) {
                    SearchWishlistRow(item: item)
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
                ?? "Không kết nối được máy chủ."
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

private struct SearchDeviceRow: View {
    let device: Device

    private var tone: WVChipTone {
        switch device.status {
        case .ACTIVE:  return .green
        case .EXPIRED: return .gray
        case .SOLD:    return .blue
        case .BROKEN:  return .red
        case .LOST:    return .orange
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            WVLeadingIcon(
                icon: WVCategory.icon(for: device.category),
                color: WVCategory.accent(for: device.category),
                size: 36
            )
            VStack(alignment: .leading, spacing: 2) {
                Text(device.name)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(WVColor.label)
                    .lineLimit(1)
                Text("\(device.brand ?? "—") · \(WVFormat.vnd(device.purchasePrice))")
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            WVChip(device.status.label, tone: tone)
            WVIcon("arrowRight", size: 13)
                .foregroundStyle(WVColor.label4)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 52)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }
}

private struct SearchSubscriptionRow: View {
    let sub: Subscription

    var body: some View {
        HStack(spacing: 12) {
            WVLeadingIcon(
                icon: WVCategory.icon(for: sub.category),
                color: WVCategory.accent(for: sub.category),
                size: 36
            )
            VStack(alignment: .leading, spacing: 2) {
                Text(sub.name)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(WVColor.label)
                    .lineLimit(1)
                Text([sub.brand, sub.plan, sub.accountEmail]
                    .compactMap { $0 }.filter { !$0.isEmpty }
                    .joined(separator: " · "))
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text(WVFormat.vnd(sub.price))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(WVColor.label)
                Text(sub.status.label)
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)
            }
            WVIcon("arrowRight", size: 13)
                .foregroundStyle(WVColor.label4)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 52)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }
}

private struct SearchWishlistRow: View {
    let item: WishlistItem

    var body: some View {
        HStack(spacing: 12) {
            WVLeadingIcon(
                icon: WVCategory.icon(for: item.category),
                color: WVCategory.accent(for: item.category),
                size: 36
            )
            VStack(alignment: .leading, spacing: 2) {
                Text(item.name)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(WVColor.label)
                    .lineLimit(1)
                Text([item.brand, item.notes]
                    .compactMap { $0 }.filter { !$0.isEmpty }
                    .joined(separator: " · "))
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                if let price = item.currentPrice {
                    Text(WVFormat.vnd(price))
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(WVColor.label)
                }
                Text(item.status.label)
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)
            }
            WVIcon("arrowRight", size: 13)
                .foregroundStyle(WVColor.label4)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 52)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }
}
