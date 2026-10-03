import SwiftUI
import UIKit
import WarrantyVaultKit

// MARK: - WishlistDetailView

struct WishlistDetailView: View {
    let client: APIClient
    @ObservedObject var store: WishlistStore
    let itemId: String

    @EnvironmentObject private var toast: WVToastCenter

    @State private var item: WishlistItem?
    @State private var prices: [WishlistPrice]    = []
    @State private var isLoading                   = false
    @State private var errorMsg: String?
    @State private var showUpdatePrice             = false
    @State private var showMore                    = false
    @State private var showDelete                  = false
    @State private var localStatus: WishlistStatus = .WATCHING
    @State private var pushEdit                    = false
    /// Backs the "Đã mua → Xem thiết bị" link: marking a wishlist item
    /// PURCHASED makes the server create a Device, and this is where that
    /// device is reachable from.
    @StateObject private var devicesStore: DevicesStore

    init(client: APIClient, store: WishlistStore, itemId: String) {
        self.client = client
        self.store = store
        self.itemId = itemId
        _devicesStore = StateObject(wrappedValue: DevicesStore(client: client))
    }

    // MARK: Body

    var body: some View {
        Group {
            if let w = item {
                mainContent(w)
            } else if isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                WVEmpty(icon: "alert", title: "Không tìm thấy")
            }
        }
        .navigationTitle(item?.name ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showMore = true } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.system(size: 17))
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
        .task { await reload() }
        .refreshable { await reload() }
        .sheet(isPresented: $showUpdatePrice) {
            if let w = item {
                WishUpdatePriceSheet(store: store, itemId: w.id,
                                     defaultPrice: w.currentPrice ?? 0) {
                    Task { await reload() }
                }
            }
        }
        .confirmationDialog("", isPresented: $showMore, titleVisibility: .hidden) {
            Button("Sửa") { pushEdit = true }
            Button("Update giá") { showUpdatePrice = true }
            if item?.status != .PURCHASED {
                Button("Đã mua → tạo thiết bị") { Task { await markPurchased() } }
            }
            Button("Xoá", role: .destructive) { showDelete = true }
            Button("Huỷ", role: .cancel) {}
        }
        .alert("Xoá khỏi wishlist?", isPresented: $showDelete) {
            Button("Huỷ", role: .cancel) {}
            Button("Xoá", role: .destructive) { Task { await deleteItem() } }
        } message: {
            Text("\"\(item?.name ?? "")\" và lịch sử giá sẽ bị xoá.")
        }
        .navigationDestination(isPresented: $pushEdit) {
            if let w = item {
                WishlistFormView(client: client, store: store, item: w)
            }
        }
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

    private func mainContent(_ w: WishlistItem) -> some View {
        ScrollView {
            VStack(spacing: 0) {
                heroSection(w)
                if w.purchasedDeviceId != nil { purchasedBanner(w) }
                priceCard(w)             .padding(.top, WVSpacing.sm)
                quickActions(w)
                infoSection(w)
                priceHistorySection
                statusSection(w)
                if let notes = w.notes, !notes.isEmpty { noteSection(notes) }
                deleteSection
                Spacer().frame(height: WVSpacing.xl)
            }
        }
        .wvScreen()
    }

    // MARK: - Hero

    private func heroSection(_ w: WishlistItem) -> some View {
        VStack(spacing: 12) {
            WVLeadingIcon(
                icon: WVCategory.icon(for: w.category),
                color: WVCategory.accent(for: w.category),
                size: 64
            )
            Text(w.name)
                .font(.system(size: 22, weight: .bold))
                .tracking(-0.4)
                .foregroundStyle(WVColor.label)
            let sub = [w.brand, w.category]
                .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
            if !sub.isEmpty {
                Text(sub)
                    .font(.system(size: 14))
                    .foregroundStyle(WVColor.label3)
            }
            HStack(spacing: 6) {
                WVChip(w.priority.chipLabel, tone: w.priority.chipTone)
                WVChip(localStatus.wishChipLabel, tone: localStatus.wishChipTone)
            }
        }
        .padding(.horizontal, WVSpacing.titleGutter)
        .padding(.top, WVSpacing.xs)
        .padding(.bottom, WVSpacing.md)
    }

    // MARK: - Purchased banner
    //
    // Marking a wishlist item "Đã mua" makes the Go service create a linked
    // Device in the same transaction and echo its id back as
    // `purchasedDeviceId`. The web links to `/devices/{id}` here; on iOS the
    // row pushes that device's detail screen.
    @ViewBuilder
    private func purchasedBanner(_ w: WishlistItem) -> some View {
        if let deviceId = w.purchasedDeviceId, !deviceId.isEmpty {
            NavigationLink(value: DashDeviceNav(id: deviceId, name: w.name)) {
                HStack(spacing: 8) {
                    WVIcon("shoppingBag", size: 14)
                    Text("Đã mua → Xem thiết bị")
                        .font(.system(size: 14, weight: .semibold))
                    Spacer(minLength: 4)
                    WVIcon("arrowRight", size: 12, weight: .semibold)
                }
                .foregroundStyle(WVColor.green)
                .padding(.horizontal, 14)
                .frame(minHeight: 40)
                .background(WVColor.green.opacity(0.14))
                .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.horizontal, WVSpacing.gutter)
            .padding(.bottom, WVSpacing.sm)
            .task { await devicesStore.load() }
        }
    }

    // MARK: - Price card

    private func priceCard(_ w: WishlistItem) -> some View {
        WVCard {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .lastTextBaseline, spacing: 8) {
                    Text(WVFormat.vnd(w.currentPrice ?? 0))
                        .font(.system(size: 26, weight: .bold))
                        .foregroundStyle(WVColor.label)

                    if let init_ = w.initialPrice, let cur = w.currentPrice,
                       init_ != 0, cur != init_ {
                        let d = Double(cur - init_) / Double(init_) * 100
                        Text("\(d < 0 ? "↓" : "↑") \(String(format: "%.1f", abs(d)))%")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(d < 0 ? WVColor.green : WVColor.red)
                    }
                }

                // Stats row
                let pVals = prices.map { $0.price }
                let minP = pVals.min() ?? 0
                let maxP = pVals.max() ?? 0
                Text("Giá ban đầu \(WVFormat.vnd(w.initialPrice ?? 0)) · Min \(WVFormat.vnd(minP)) · Max \(WVFormat.vnd(maxP))")
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.label3)
                    .padding(.top, 2)

                // Price chart
                if prices.count > 1 {
                    let pts = prices.map { p in
                        WVChartPoint(
                            label: String(WVFormat.date(p.recordedAt).prefix(5)),
                            value: Double(p.price)
                        )
                    }
                    WVLineChart(data: pts, height: 140, color: WVColor.pink) { v in
                        let m = v / 1_000_000
                        return String(format: "%.1fM", m)
                    }
                    .padding(.top, WVSpacing.sm)
                }
            }
        }
    }

    // MARK: - Quick actions

    private func quickActions(_ w: WishlistItem) -> some View {
        HStack(spacing: WVSpacing.sm) {
            WVButton("Update giá", icon: "wallet", kind: .secondary, size: .small,
                     fullWidth: true) { showUpdatePrice = true }

            if w.status != .PURCHASED {
                WVButton("Đã mua", icon: "shoppingBag", kind: .primary, size: .small,
                         fullWidth: true) { Task { await markPurchased() } }
            }
        }
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.top, WVSpacing.md)
    }

    // MARK: - Info section

    private func infoSection(_ w: WishlistItem) -> some View {
        // Build the row list imperatively here (a @ViewBuilder body can't hold
        // `var`/`append` statements), then render it.
        var rows: [(icon: String, color: Color, title: String, detail: String)] = []
        if let td = w.targetDate {
            rows.append(("calendar", WVColor.orange, "Ngày dự kiến", WVFormat.date(td)))
        }
        if let n = w.reminderIntervalDays, n > 0 {
            rows.append(("bell", WVColor.red, "Nhắc lại", "Mỗi \(n) ngày"))
        }
        if let cat = w.category, !cat.isEmpty {
            rows.append(("tag", WVColor.purple, "Loại", CategoryLabels.label(for: cat)))
        }
        let buyURL = w.buyUrl.flatMap { $0.isEmpty ? nil : URL(string: $0) }

        return VStack(spacing: 0) {
            WVSectionHeader("Thông tin")
            WVGroup {
                if rows.isEmpty && buyURL == nil {
                    WVRowContainer {
                        Text("Không có thông tin bổ sung")
                            .font(.system(size: 15))
                            .foregroundStyle(WVColor.label3)
                    }
                } else {
                    ForEach(Array(rows.enumerated()), id: \.offset) { idx, row in
                        if idx > 0 { WVDivider(inset: 60) }
                        WVRow(icon: row.icon, iconColor: row.color,
                              title: row.title, detail: row.detail)
                    }
                    if let url = buyURL {
                        if !rows.isEmpty { WVDivider(inset: 60) }
                        WVRow(icon: "externalLink", iconColor: WVColor.blue,
                              title: "Mua ở đâu", chevron: true, role: .tint) {
                            UIApplication.shared.open(url)
                        }
                    }
                }
            }
        }
        .padding(.top, WVSpacing.sm)
    }

    // MARK: - Price history

    private var priceHistorySection: some View {
        VStack(spacing: 0) {
            WVSectionHeader("Lịch sử giá (\(prices.count))")
            WVGroup {
                if prices.isEmpty {
                    WVRowContainer {
                        Text("Chưa có lịch sử giá nào")
                            .font(.system(size: 15))
                            .foregroundStyle(WVColor.label3)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.vertical, WVSpacing.sm)
                    }
                } else {
                    let sorted = prices.sorted { $0.recordedAt > $1.recordedAt }
                    ForEach(Array(sorted.prefix(8).enumerated()), id: \.element.id) { idx, p in
                        if idx > 0 { WVDivider(inset: 60) }
                        WVRow(
                            icon: idx == 0 ? "tag" : "clock",
                            iconColor: idx == 0 ? WVColor.brand : WVColor.gray,
                            title: WVFormat.date(p.recordedAt),
                            subtitle: p.note,
                            detail: WVFormat.vnd(p.price)
                        )
                    }
                }
            }
        }
        .padding(.top, WVSpacing.sm)
    }

    // MARK: - Status section (chip picker)

    private func statusSection(_ w: WishlistItem) -> some View {
        VStack(alignment: .leading, spacing: WVSpacing.sm) {
            WVSectionHeader("Đổi trạng thái")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: WVSpacing.sm) {
                    ForEach(WishlistStatus.allCases, id: \.self) { s in
                        let active = localStatus == s
                        Button {
                            Task { await changeStatus(s, w: w) }
                        } label: {
                            Text(s.wishChipLabel)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(active ? .white : WVColor.label2)
                                .padding(.horizontal, 12)
                                .frame(height: 30)
                                .background(active ? WVColor.brand : WVColor.fill3)
                                .clipShape(Capsule())
                        }
                        .buttonStyle(WVPressableStyle())
                    }
                }
                .padding(.horizontal, WVSpacing.gutter)
            }
        }
        .padding(.top, WVSpacing.sm)
    }

    // MARK: - Note

    private func noteSection(_ text: String) -> some View {
        VStack(spacing: 0) {
            WVSectionHeader("Ghi chú")
            WVGroup {
                WVRowContainer {
                    Text(text)
                        .font(.system(size: 15))
                        .foregroundStyle(WVColor.label)
                        .lineSpacing(4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, WVSpacing.xs)
                }
            }
        }
        .padding(.top, WVSpacing.sm)
    }

    // MARK: - Delete

    private var deleteSection: some View {
        VStack(spacing: 0) {
            Spacer().frame(height: WVSpacing.md)
            WVGroup {
                WVRow(icon: "trash", iconColor: WVColor.red,
                      title: "Xoá khỏi wishlist", role: .destructive) {
                    showDelete = true
                }
            }
        }
    }

    // MARK: - Data

    private func reload() async {
        // Optimistic from store
        if item == nil {
            item = store.items.first(where: { $0.id == itemId })
            if let w = item { localStatus = w.status }
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let (w, ps) = try await client.getWishlistItem(id: itemId)
            item        = w
            prices      = ps.sorted { $0.recordedAt < $1.recordedAt }
            localStatus = w.status
            errorMsg    = nil
        } catch {
            errorMsg = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }

    private func changeStatus(_ newStatus: WishlistStatus, w: WishlistItem) async {
        let prev = localStatus
        localStatus = newStatus
        var input = wishInputFrom(w)
        input.status = newStatus
        do {
            try await store.update(id: w.id, input)
            await reload()
            toast.show("Đổi sang \"\(newStatus.wishChipLabel)\"")
        } catch {
            localStatus = prev
            toast.show((error as? APIError)?.localizedDescription ?? error.localizedDescription)
        }
    }

    private func markPurchased() async {
        guard let w = item else { return }
        var input = wishInputFrom(w)
        input.status = .PURCHASED
        do {
            try await store.update(id: w.id, input)
            await reload()
            toast.show("Tạo thiết bị từ wishlist")
        } catch {
            toast.show((error as? APIError)?.localizedDescription ?? error.localizedDescription)
        }
    }

    private func deleteItem() async {
        do {
            try await store.delete(id: itemId)
        } catch {
            toast.show((error as? APIError)?.localizedDescription ?? error.localizedDescription)
        }
    }

    private func wishInputFrom(_ w: WishlistItem) -> WishlistInput {
        var input          = WishlistInput(name: w.name)
        input.category     = w.category
        input.brand        = w.brand
        input.initialPrice = w.initialPrice
        input.currentPrice = w.currentPrice
        input.buyUrl       = w.buyUrl
        // Carried back unchanged: decoded in the device's zone, so written in the
        // device's zone. `WireDay` is the exact inverse of that decode.
        input.targetDate   = w.targetDate.map { WireDay.string(from: $0) }
        input.priority     = w.priority
        input.status       = w.status
        input.notes        = w.notes
        input.reminderIntervalDays = w.reminderIntervalDays
        return input
    }
}

// MARK: - WishlistPriority display

extension WishlistPriority {
    var chipLabel: String {
        switch self {
        case .MUST:  return "Cực thèm"
        case .WANT:  return "Khá thèm"
        case .MAYBE: return "Hơi thèm"
        }
    }
    var chipTone: WVChipTone {
        switch self {
        case .MUST:  return .red
        case .WANT:  return .orange
        case .MAYBE: return .gray
        }
    }
}

// MARK: - WishlistStatus display

extension WishlistStatus {
    var wishChipLabel: String {
        switch self {
        case .WATCHING:  return "Đang ngó"
        case .DECIDED:   return "Quyết mua"
        case .SKIPPED:   return "Bỏ qua"
        case .PURCHASED: return "Đã mua"
        }
    }
    var wishChipTone: WVChipTone {
        switch self {
        case .WATCHING:  return .blue
        case .DECIDED:   return .brand
        case .SKIPPED:   return .gray
        case .PURCHASED: return .green
        }
    }
}

// MARK: - Update Price sheet

struct WishUpdatePriceSheet: View {
    @ObservedObject var store: WishlistStore
    let itemId: String
    let defaultPrice: Int
    let onUpdated: () -> Void

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var toast: WVToastCenter

    @State private var price: Int?
    @State private var note    = ""
    @State private var isBusy  = false
    @State private var topError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    Spacer().frame(height: WVSpacing.sm)
                    WVGroup {
                        WVRowContainer {
                            HStack {
                                Text("Giá")
                                    .font(.system(size: 17))
                                    .foregroundStyle(WVColor.label)
                                Spacer()
                                WVMoneyField(value: $price)
                                    .frame(width: 150)
                            }
                        }
                        WVDivider()
                        WVRowContainer {
                            HStack {
                                Text("Ghi chú")
                                    .font(.system(size: 17))
                                    .foregroundStyle(WVColor.label)
                                Spacer()
                                TextField("vd: Sale Lazada...", text: $note)
                                    .multilineTextAlignment(.trailing)
                                    .font(.system(size: 17))
                                    .foregroundStyle(WVColor.label3)
                                    .frame(width: 160)
                            }
                        }
                    }
                    if let topError {
                        Text(topError)
                            .font(.system(size: 13))
                            .foregroundStyle(WVColor.red)
                            .padding(.horizontal, WVSpacing.gutter)
                            .padding(.top, WVSpacing.sm)
                    }
                    Spacer().frame(height: WVSpacing.xl)
                }
            }
            .wvScreen()
            .navigationTitle("Cập nhật giá")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Huỷ") { dismiss() }.foregroundStyle(WVColor.tint)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Lưu") { Task { await submit() } }
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(WVColor.tint)
                        .disabled(isBusy || (price ?? 0) <= 0)
                }
            }
        }
        .presentationDetents([.medium])
        .onAppear {
            price = defaultPrice > 0 ? defaultPrice : nil
            note  = ""
        }
    }

    private func submit() async {
        topError = nil; isBusy = true
        defer { isBusy = false }
        let input = PriceLogInput(price: price ?? 0, note: note.isEmpty ? nil : note)
        do {
            try await store.logPrice(id: itemId, input)
            onUpdated()
            toast.show("Đã cập nhật giá 💸")
            dismiss()
        } catch {
            topError = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }
}
