import SwiftUI
import WarrantyVaultKit

struct WishlistDetailView: View {
    @ObservedObject var store: WishlistStore
    let itemId: String

    @State private var showEditor = false
    @State private var showLogPrice = false
    @State private var showPurchasedConfirm = false
    @State private var pendingMark = false
    @State private var errorMessage: String?
    @State private var prices: [WishlistPrice] = []
    @State private var isLoadingDetail = false

    private let client: APIClient

    init(client: APIClient, store: WishlistStore, itemId: String) {
        self.client = client
        self.store = store
        self.itemId = itemId
    }

    /// Always read the latest copy from the store so reload picks up server-derived changes.
    private var item: WishlistItem? {
        store.items.first(where: { $0.id == itemId })
    }

    var body: some View {
        ScrollView {
            if let item {
                VStack(alignment: .leading, spacing: WV.Spacing.lg) {
                    headerCard(item)
                    actionsRow(item)
                    metaCard(item)
                    pricesCard
                    if let errorMessage {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(WV.Tokens.destructive)
                            .font(.system(size: 13))
                            .padding(.horizontal, WV.Spacing.lg)
                    }
                }
                .padding(.vertical, WV.Spacing.lg)
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.top, WV.Spacing.xl)
            }
        }
        .background(WV.Tokens.bg)
        .navigationTitle(item?.name ?? "Chi tiết")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Sửa") { showEditor = true }
                    .disabled(item == nil)
            }
        }
        .refreshable { await reloadAll() }
        .task { await loadDetail() }
        .sheet(isPresented: $showEditor, onDismiss: { Task { await loadDetail() } }) {
            if let item {
                WishlistEditorSheet(store: store, item: item)
            }
        }
        .sheet(isPresented: $showLogPrice, onDismiss: { Task { await loadDetail() } }) {
            if let item {
                LogPriceSheet(
                    store: store,
                    itemId: item.id,
                    defaultPrice: item.currentPrice ?? item.initialPrice ?? 0
                )
            }
        }
        .confirmationDialog(
            "Đánh dấu đã mua?",
            isPresented: $showPurchasedConfirm,
            titleVisibility: .visible
        ) {
            Button("Đã mua") { Task { await markPurchased() } }
            Button("Huỷ", role: .cancel) {}
        } message: {
            Text("Sẽ chuyển trạng thái sang \"Đã mua\".")
        }
    }

    // MARK: - Sections

    private func headerCard(_ item: WishlistItem) -> some View {
        WVCard {
            VStack(alignment: .leading, spacing: WV.Spacing.sm) {
                HStack(alignment: .top, spacing: WV.Spacing.md) {
                    Image(systemName: "star.fill")
                        .font(.system(size: 24))
                        .foregroundStyle(WV.Tokens.primary)
                        .frame(width: 48, height: 48)
                        .background(WV.Tokens.primary.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: WV.Radius.md))
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.name)
                            .font(.system(size: 18, weight: .semibold))
                        if let brand = item.brand, !brand.isEmpty {
                            Text(brand)
                                .font(.system(size: 13))
                                .foregroundStyle(WV.Tokens.mutedFg)
                        }
                        HStack(spacing: WV.Spacing.xs) {
                            WVStatusPill(item.priority.label, kind: kind(for: item.priority))
                            WVStatusPill(item.status.label, kind: kind(for: item.status))
                        }
                    }
                    Spacer()
                }

                Divider()

                HStack(alignment: .firstTextBaseline) {
                    if let cur = item.currentPrice {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Giá hiện tại")
                                .font(.system(size: 11))
                                .foregroundStyle(WV.Tokens.mutedFg)
                            Text(formatVND(cur))
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundStyle(WV.Tokens.primary)
                        }
                    }
                    Spacer()
                    if let init_ = item.initialPrice, init_ != item.currentPrice {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("Ban đầu")
                                .font(.system(size: 11))
                                .foregroundStyle(WV.Tokens.mutedFg)
                            Text(formatVND(init_))
                                .font(.system(size: 14))
                                .strikethrough()
                                .foregroundStyle(WV.Tokens.mutedFg)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, WV.Spacing.lg)
    }

    private func actionsRow(_ item: WishlistItem) -> some View {
        HStack(spacing: WV.Spacing.md) {
            Button {
                showLogPrice = true
            } label: {
                Label("Ghi nhận giá mới", systemImage: "tag")
            }
            .buttonStyle(PrimaryButtonStyle(fullWidth: true))

            if item.status != .PURCHASED {
                Button {
                    showPurchasedConfirm = true
                } label: {
                    if pendingMark {
                        ProgressView()
                    } else {
                        Label("Đã mua", systemImage: "checkmark.circle")
                    }
                }
                .buttonStyle(SecondaryButtonStyle(fullWidth: true))
                .disabled(pendingMark)
            }
        }
        .padding(.horizontal, WV.Spacing.lg)
    }

    private func metaCard(_ item: WishlistItem) -> some View {
        WVCard {
            VStack(alignment: .leading, spacing: WV.Spacing.sm) {
                if let category = item.category, !category.isEmpty {
                    metaRow(label: "Danh mục", value: category)
                }
                if let target = item.targetDate {
                    metaRow(label: "Hạn mua", value: formatDate(target))
                }
                if let n = item.reminderIntervalDays, n > 0 {
                    metaRow(label: "Nhắc lại", value: "Mỗi \(n) ngày")
                }
                if let url = item.buyUrl, !url.isEmpty, let u = URL(string: url) {
                    Link(destination: u) {
                        Label("Mở link mua", systemImage: "arrow.up.right.square")
                            .font(.system(size: 13))
                    }
                }
                if let url = item.imageUrl, !url.isEmpty, let u = URL(string: url) {
                    Link(destination: u) {
                        Label("Mở ảnh", systemImage: "photo")
                            .font(.system(size: 13))
                    }
                }
                if let notes = item.notes, !notes.isEmpty {
                    Divider()
                    Text(notes)
                        .font(.system(size: 13))
                        .foregroundStyle(WV.Tokens.fg)
                }
            }
        }
        .padding(.horizontal, WV.Spacing.lg)
    }

    // MARK: - Helpers

    private func metaRow(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.system(size: 12)).foregroundStyle(WV.Tokens.mutedFg)
            Spacer()
            Text(value).font(.system(size: 13, weight: .medium))
        }
    }

    private func kind(for priority: WishlistPriority) -> WVStatusKind {
        switch priority {
        case .MUST:  return .danger
        case .WANT:  return .warning
        case .MAYBE: return .neutral
        }
    }

    private func kind(for status: WishlistStatus) -> WVStatusKind {
        switch status {
        case .WATCHING:  return .info
        case .DECIDED:   return .accent
        case .SKIPPED:   return .neutral
        case .PURCHASED: return .success
        }
    }

    // MARK: - Prices

    private var pricesCard: some View {
        WVCard {
            VStack(alignment: .leading, spacing: WV.Spacing.sm) {
                HStack {
                    Text("Lịch sử giá")
                        .font(.system(size: 14, weight: .semibold))
                    Spacer()
                    if isLoadingDetail {
                        ProgressView().scaleEffect(0.8)
                    }
                }
                if prices.isEmpty {
                    Text("Chưa có ghi nhận giá nào.")
                        .font(.system(size: 13))
                        .foregroundStyle(WV.Tokens.mutedFg)
                } else {
                    ForEach(prices) { p in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(formatVND(p.price))
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(WV.Tokens.primary)
                                Spacer()
                                Text(formatDate(p.recordedAt))
                                    .font(.system(size: 12))
                                    .foregroundStyle(WV.Tokens.mutedFg)
                            }
                            if let note = p.note, !note.isEmpty {
                                Text(note)
                                    .font(.system(size: 12))
                                    .foregroundStyle(WV.Tokens.mutedFg)
                            }
                        }
                        if p.id != prices.last?.id { Divider() }
                    }
                }
            }
        }
        .padding(.horizontal, WV.Spacing.lg)
    }

    private func loadDetail() async {
        isLoadingDetail = true
        defer { isLoadingDetail = false }
        do {
            let (_, fetched) = try await client.getWishlistItem(id: itemId)
            prices = fetched
        } catch {
            // Soft fail — keep current prices, surface only via errorMessage if no item.
            errorMessage = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }

    private func reloadAll() async {
        await store.load()
        await loadDetail()
    }

    // MARK: - Actions

    private func markPurchased() async {
        guard let item else { return }
        pendingMark = true
        defer { pendingMark = false }
        var input = WishlistInput(name: item.name)
        input.category = item.category
        input.brand = item.brand
        input.initialPrice = item.initialPrice
        input.currentPrice = item.currentPrice
        input.buyUrl = item.buyUrl
        input.imageUrl = item.imageUrl
        input.targetDate = item.targetDate.map { ISO8601DateFormatter.dayOnly.string(from: $0) }
        input.priority = item.priority
        input.status = .PURCHASED
        input.notes = item.notes
        input.reminderIntervalDays = item.reminderIntervalDays
        do {
            try await store.update(id: item.id, input)
            errorMessage = nil
        } catch {
            errorMessage = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }
}

// MARK: - Log Price sheet

struct LogPriceSheet: View {
    @ObservedObject var store: WishlistStore
    let itemId: String
    let defaultPrice: Int

    @Environment(\.dismiss) private var dismiss

    @State private var price: String
    @State private var note: String = ""
    @State private var isSubmitting = false
    @State private var topError: String?

    init(store: WishlistStore, itemId: String, defaultPrice: Int) {
        self.store = store
        self.itemId = itemId
        self.defaultPrice = defaultPrice
        _price = State(initialValue: defaultPrice > 0 ? String(defaultPrice) : "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(header: sectionHeader("Giá mới")) {
                    TextField("Giá (VND)", text: $price)
                        .keyboardType(.numberPad)
                }
                Section(header: sectionHeader("Ghi chú")) {
                    TextField("Ghi chú (tuỳ chọn)", text: $note, axis: .vertical)
                        .lineLimit(2...5)
                }
                if let topError {
                    Section {
                        Label(topError, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(WV.Tokens.destructive)
                            .font(.system(size: 13))
                    }
                }
            }
            .navigationTitle("Ghi nhận giá mới")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Huỷ") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await submit() } } label: {
                        if isSubmitting { ProgressView() } else { Text("Lưu").bold() }
                    }
                    .disabled(isSubmitting || (Int(price) ?? 0) <= 0)
                }
            }
        }
    }

    private func submit() async {
        topError = nil
        isSubmitting = true
        defer { isSubmitting = false }
        let input = PriceLogInput(
            price: Int(price) ?? 0,
            note: note.isEmpty ? nil : note
        )
        do {
            try await store.logPrice(id: itemId, input)
            dismiss()
        } catch let err as APIError {
            topError = err.localizedDescription
        } catch {
            topError = error.localizedDescription
        }
    }
}
