import SwiftUI
import WarrlyKit

/// "Đồ dùng thiết yếu" — the restock list that lives inside Wishlist.
///
/// Two groups, not two screens: things to buy (LOW/OUT) come first, then the
/// ones that are still enough. `cadenceDays` is only a check-in interval; the
/// app never claims the user has run out.
struct StaplesView: View {
    let client: APIClient

    @StateObject private var store: StapleStore
    @State private var showCreate = false
    @State private var editing: Staple?
    @State private var purchasing: Staple?
    @State private var historyItem: Staple?
    @State private var deleting: Staple?
    @State private var actionError: String?

    init(client: APIClient) {
        self.client = client
        _store = StateObject(wrappedValue: StapleStore(client: client))
    }

    private var toBuy: [Staple] { store.items.filter { $0.state != .ENOUGH } }
    private var enough: [Staple] { store.items.filter { $0.state == .ENOUGH } }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                if store.state == .loading && store.items.isEmpty {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, WVSpacing.xxl)
                } else if case .error(let message) = store.state, store.items.isEmpty {
                    WVEmpty(
                        icon: "package",
                        title: L.t("Không tải được đồ dùng"),
                        description: message
                    ) {
                        WVButton(L.t("Thử lại"), kind: .secondary) {
                            Task { await store.load() }
                        }
                    }
                } else if store.items.isEmpty {
                    WVEmpty(
                        icon: "package",
                        title: L.t("Chưa có đồ dùng nào"),
                        description: L.t("Thêm món đầu tiên để nhắc mua lại khi sắp hết.")
                    ) {
                        WVButton(L.t("Thêm đồ dùng"), icon: "plus") { showCreate = true }
                    }
                } else {
                    if !toBuy.isEmpty {
                        WVSectionHeader(L.t("Cần mua"))
                        WVGroup { rows(toBuy) }
                    }
                    if !enough.isEmpty {
                        WVSectionHeader(L.t("Đủ dùng"))
                        WVGroup { rows(enough) }
                    }
                    WVSectionFooter(L.t("Nhắc mua lại dùng thông báo của ứng dụng. Bật trong Cài đặt nếu chưa bật."))
                }

                Spacer().frame(height: WVSpacing.xl)
            }
        }
        .wvScreen()
        .navigationTitle(L.t("Đồ dùng thiết yếu"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showCreate = true } label: {
                    WVIcon("plus", size: 17, weight: .semibold)
                        .foregroundStyle(WVColor.tint)
                }
                .accessibilityLabel(L.t("Thêm đồ dùng"))
            }
        }
        .task { await store.load() }
        .refreshable { await store.load() }
        .sheet(isPresented: $showCreate) {
            NavigationStack {
                StapleFormView(client: client, store: store)
            }
        }
        .sheet(item: $editing) { item in
            NavigationStack {
                StapleFormView(client: client, store: store, item: item)
            }
        }
        .sheet(item: $purchasing) { item in
            StaplePurchaseSheet(store: store, item: item)
        }
        .sheet(item: $historyItem) { item in
            StaplePurchaseHistorySheet(store: store, item: item)
        }
        .confirmationDialog(
            L.t("Xoá đồ dùng?"),
            isPresented: Binding(
                get: { deleting != nil },
                set: { if !$0 { deleting = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button(L.t("Xoá"), role: .destructive) {
                guard let item = deleting else { return }
                deleting = nil
                Task {
                    do { try await store.delete(id: item.id) }
                    catch { actionError = error.localizedDescription }
                }
            }
            Button(L.t("Huỷ"), role: .cancel) { deleting = nil }
        } message: {
            Text(deleting?.name ?? "")
        }
        .alert(L.t("Không lưu được"), isPresented: Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )) {
            Button("OK", role: .cancel) { actionError = nil }
        } message: {
            Text(actionError ?? "")
        }
    }

    @ViewBuilder
    private func rows(_ list: [Staple]) -> some View {
        ForEach(Array(list.enumerated()), id: \.element.id) { idx, item in
            if idx > 0 { WVDivider() }
            StapleRow(
                item: item,
                onEdit: { editing = item },
                onMark: { state in
                    Task {
                        do { try await store.mark(item, state: state) }
                        catch { actionError = error.localizedDescription }
                    }
                },
                onRestock: { purchasing = item },
                onHistory: { historyItem = item },
                onDelete: { deleting = item }
            )
        }
    }
}

// MARK: - Row

private struct StapleRow: View {
    let item: Staple
    let onEdit: () -> Void
    let onMark: (StapleState) -> Void
    let onRestock: () -> Void
    let onHistory: () -> Void
    let onDelete: () -> Void

    private var color: Color {
        switch item.state {
        case .ENOUGH: return WVColor.green
        case .LOW:    return WVColor.orange
        case .OUT:    return WVColor.red
        }
    }

    private var stateLabel: String {
        switch item.state {
        case .ENOUGH: return L.t("Đủ dùng")
        case .LOW:    return L.t("Sắp hết")
        case .OUT:    return L.t("Đã hết")
        }
    }

    private var meta: String {
        let parts = [item.category, item.unit]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return parts.isEmpty ? L.t("Đồ dùng") : parts.joined(separator: " · ")
    }

    /// The purchase summary, when at least one purchase has been recorded.
    /// Two labels, not one total: "last" and "lowest" answer different
    /// questions, and a nil summary must render nothing rather than "0 ₫".
    private var priceSummary: String? {
        guard item.hasPurchaseSummary else { return nil }
        var parts: [String] = []
        if let last = item.lastPrice {
            parts.append(L.t("Lần cuối %@", WVFormat.vnd(last)))
        }
        if let lowest = item.lowestPrice {
            parts.append(L.t("Thấp nhất %@", WVFormat.vnd(lowest)))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// The next check-in, if the item has a cadence and a purchase day. This is
    /// a reminder, not a prediction of emptiness.
    private var dueText: String? {
        guard item.state == .ENOUGH,
              let cadence = item.cadenceDays,
              cadence > 0,
              let last = item.lastBoughtAt
        else { return nil }
        let cal = Calendar.current
        guard let due = cal.date(byAdding: .day, value: cadence, to: cal.startOfDay(for: last)) else {
            return nil
        }
        let days = cal.dateComponents(
            [.day], from: cal.startOfDay(for: Date()), to: cal.startOfDay(for: due)
        ).day ?? 0
        if days < 0 { return L.t("Đến lúc kiểm tra") }
        if days == 0 { return L.t("Hôm nay") }
        return L.t("Còn %d ngày", days)
    }

    var body: some View {
        HStack(spacing: WVSpacing.md) {
            WVLeadingIcon(icon: "package", color: color, size: 28)

            Button(action: onEdit) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.name)
                        .wvFont(.bodyEmphasis)
                        .foregroundStyle(WVColor.label)
                        .lineLimit(2)
                    Text(meta)
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                        .lineLimit(1)
                    if let priceSummary {
                        Text(priceSummary)
                            .wvFont(.caption)
                            .foregroundStyle(WVColor.label3)
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            VStack(alignment: .trailing, spacing: 3) {
                Text(stateLabel)
                    .wvFont(.footnote, weight: .semibold)
                    .foregroundStyle(color)
                if let dueText {
                    Text(dueText)
                        .wvFont(.caption)
                        .foregroundStyle(WVColor.label3)
                        .lineLimit(1)
                }
            }

            Menu {
                Button { onMark(.LOW) } label: {
                    Label(L.t("Sắp hết"), systemImage: "exclamationmark.triangle")
                }
                Button { onMark(.OUT) } label: {
                    Label(L.t("Đã hết"), systemImage: "xmark.circle")
                }
                Button { onRestock() } label: {
                    Label(L.t("Đã mua lại"), systemImage: "arrow.clockwise")
                }
                Button { onHistory() } label: {
                    Label(L.t("Lịch sử giá"), systemImage: "clock.arrow.circlepath")
                }
                Divider()
                Button { onEdit() } label: {
                    Label(L.t("Sửa"), systemImage: "pencil")
                }
                Button(role: .destructive) { onDelete() } label: {
                    Label(L.t("Xoá"), systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(WVColor.label3)
                    .frame(width: 32, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel(L.t("Tuỳ chọn"))
        }
        .padding(.horizontal, WVSpacing.gutter)
        .frame(minHeight: 44)
        .padding(.vertical, WVSpacing.sm)
    }
}
