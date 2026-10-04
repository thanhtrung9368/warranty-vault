import SwiftUI
import WarrantyVaultKit

// ============================================================
// DevicesScreen — "Thiết bị" tab root
//
// Ports DevicesScreen from project/ios/js/screens-1.jsx.
// Searchable list of devices, status filter, sort sheet.
// "+" toolbar button → push DeviceFormView (create mode).
// ============================================================

struct DevicesScreen: View {
    let client: APIClient

    @StateObject private var store: DevicesStore
    @EnvironmentObject private var catalog: CatalogStore

    // Search + filter state
    @State private var searchQuery = ""
    @State private var statusFilter: DeviceStatus? = nil
    @State private var categoryFilter: String? = nil
    @State private var sortOrder: DeviceSortOrder = .purchaseDesc
    @State private var showFilterSheet = false

    init(client: APIClient) {
        self.client = client
        _store = StateObject(wrappedValue: DevicesStore(client: client))
    }

    // MARK: - Filtered list

    enum DeviceSortOrder: String, CaseIterable {
        case purchaseDesc = "purchase-desc"
        case warrantyAsc  = "warranty-asc"
        case priceDesc    = "price-desc"
        case priceAsc     = "price-asc"
        case name         = "name"

        var label: String {
            switch self {
            case .purchaseDesc: return L.t("Mới mua nhất")
            case .warrantyAsc:  return L.t("BH sắp hết trước")
            case .priceDesc:    return L.t("Giá cao nhất")
            case .priceAsc:     return L.t("Giá thấp nhất")
            case .name:         return L.t("Tên A → Z")
            }
        }
    }

    private var filteredDevices: [Device] {
        var arr = store.devices
        let q = searchQuery.trimmingCharacters(in: .whitespaces).lowercased()
        if !q.isEmpty {
            arr = arr.filter {
                let hay = "\($0.name) \($0.brand ?? "") \($0.model ?? "") \($0.serialNumber ?? "")".lowercased()
                return hay.contains(q)
            }
        }
        if let sf = statusFilter {
            arr = arr.filter { $0.status == sf }
        }
        if let cf = categoryFilter {
            arr = arr.filter { $0.category == cf }
        }
        switch sortOrder {
        case .purchaseDesc:
            arr.sort { $0.purchaseDate > $1.purchaseDate }
        case .warrantyAsc:
            arr = Self.sortedByWarrantyEndAscending(arr)
        case .priceDesc:
            arr.sort { $0.purchasePrice > $1.purchasePrice }
        case .priceAsc:
            arr.sort { $0.purchasePrice < $1.purchasePrice }
        case .name:
            arr.sort { $0.name.localizedCompare($1.name) == .orderedAscending }
        }
        return arr
    }

    /// "BH sắp hết trước": soonest effective warranty end first. Devices with
    /// no warranty package sort last, mirroring the Go list endpoint
    /// (`services.ListDevices` treats a missing `effectiveWarrantyEnd` as
    /// infinitely far away when ordering ascending).
    static func sortedByWarrantyEndAscending(_ devices: [Device]) -> [Device] {
        devices.sorted { a, b in
            switch (a.effectiveWarrantyEnd, b.effectiveWarrantyEnd) {
            case let (lhs?, rhs?): return lhs < rhs
            case (nil, _?):        return false
            case (_?, nil):        return true
            case (nil, nil):       return false
            }
        }
    }

    private var hasActiveFilters: Bool {
        statusFilter != nil || categoryFilter != nil || sortOrder != .purchaseDesc
    }

    private var categoryFilterLabel: String? {
        guard let code = categoryFilter else { return nil }
        return catalog.categories.first(where: { $0.code == code })?.name
            ?? CategoryLabels.label(for: code)
    }

    // MARK: - Body

    var body: some View {
        VStack(spacing: 0) {
            // Search bar
            HStack(spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 15))
                        .foregroundStyle(WVColor.label3)
                    TextField(L.t("Tìm thiết bị..."), text: $searchQuery)
                        .font(.system(size: 16))
                        .foregroundStyle(WVColor.label)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    if !searchQuery.isEmpty {
                        Button { searchQuery = "" } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(WVColor.label3)
                        }
                    }
                }
                .padding(.horizontal, 10)
                .frame(height: 36)
                .background(WVColor.fill2)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .padding(.horizontal, WVSpacing.gutter)
            .padding(.top, 8)
            .padding(.bottom, 8)

            Divider().foregroundStyle(WVColor.sep)

            deviceList
        }
        .wvScreen()
        .navigationTitle(L.t("Thiết bị"))
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    showFilterSheet = true
                } label: {
                    Label(L.t("Lọc"), systemImage: hasActiveFilters ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease")
                        .foregroundStyle(WVColor.tint)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(value: DeviceFormNav.create) {
                    Image(systemName: "plus")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
        .navigationDestination(for: DeviceFormNav.self) { nav in
            switch nav {
            case .create:
                DeviceFormView(client: client, store: store, device: nil)
            case .edit(let device):
                DeviceFormView(client: client, store: store, device: device)
            }
        }
        .navigationDestination(for: Device.self) { device in
            DeviceDetailView(client: client, devicesStore: store, device: device)
        }
        // Dashboard push via DashDeviceNav (cross-tab usage doesn't apply here)
        .sheet(isPresented: $showFilterSheet) {
            DeviceFilterSheet(statusFilter: $statusFilter,
                              categoryFilter: $categoryFilter,
                              sortOrder: $sortOrder,
                              categories: catalog.categories)
        }
        .task { await store.load() }
        .refreshable { await store.load() }
    }

    // MARK: - List content

    @ViewBuilder
    private var deviceList: some View {
        let items = filteredDevices
        if items.isEmpty {
            let isFiltering = !searchQuery.isEmpty || hasActiveFilters
            WVEmpty(
                icon: isFiltering ? "search" : "package",
                title: isFiltering ? L.t("Không có gì khớp") : L.t("Chưa có thiết bị nào"),
                description: isFiltering
                    ? L.t("Thử nới bộ lọc xem sao.")
                    : L.t("Thêm thiết bị đầu tiên — laptop, điện thoại, máy giặt... gì cũng được.")
            ) {
                if !isFiltering {
                    NavigationLink(value: DeviceFormNav.create) {
                        WVButton(L.t("Thêm thiết bị"), icon: "plus") {}
                    }
                }
            }
        } else {
            ScrollView {
                LazyVStack(spacing: 0) {
                    if let categoryFilterLabel {
                        HStack(spacing: 6) {
                            Text(L.t("Loại: %@", categoryFilterLabel))
                                .font(.system(size: 13))
                                .foregroundStyle(WVColor.label3)
                            Spacer()
                        }
                        .padding(.horizontal, 32)
                        .padding(.top, 12)
                    }

                    WVGroup {
                        ForEach(Array(items.enumerated()), id: \.element.id) { idx, device in
                            if idx > 0 { WVDivider(inset: 60) }
                            NavigationLink(value: device) {
                                DeviceListRow(device: device)
                            }
                            .buttonStyle(WVRowButtonStyle())
                        }
                    }
                    .padding(.top, 16)

                    Text(L.p("%d thiết bị", items.count))
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.label3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 32)
                        .padding(.top, 8)
                        .padding(.bottom, 24)
                }
            }
        }
    }
}

// MARK: - Device list row

private struct DeviceListRow: View {
    let device: Device

    var body: some View {
        HStack(spacing: 12) {
            WVLeadingIcon(
                icon: WVCategory.icon(for: device.category),
                color: WVCategory.accent(for: device.category),
                size: 36
            )
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .center, spacing: 6) {
                    Text(device.name)
                        .font(.system(size: 16, weight: .medium, design: .default))
                        .foregroundStyle(WVColor.label)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    // Effective warranty end (max endDate across the device's
                    // packages), straight from the list projection.
                    if let end = device.effectiveWarrantyEnd {
                        WarrantyPill(daysLeft: WVFormat.daysUntil(end))
                    } else {
                        DeviceStatusChip(status: device.status)
                    }
                }
                HStack(spacing: 6) {
                    Text("\(device.brand ?? "—") · \(WVFormat.vnd(device.purchasePrice))")
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.label3)
                        .lineLimit(1)
                    if let count = device.attachmentCount, count > 0 {
                        HStack(spacing: 2) {
                            WVIcon("paperclip", size: 10)
                            Text("\(count)")
                                .font(.system(size: 12))
                        }
                        .foregroundStyle(WVColor.label3)
                    }
                }
            }
            WVIcon("arrowRight", size: 13)
                .foregroundStyle(WVColor.label4)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .padding(.vertical, 7)
        .contentShape(Rectangle())
    }
}

// MARK: - Device status chip

private struct DeviceStatusChip: View {
    let status: DeviceStatus

    private var label: String {
        switch status {
        case .ACTIVE:  return L.t("Đang dùng")
        case .EXPIRED: return L.t("Hết BH")
        case .SOLD:    return L.t("Đã bán")
        case .BROKEN:  return L.t("Hỏng")
        case .LOST:    return L.t("Mất")
        }
    }

    private var tone: WVChipTone {
        switch status {
        case .ACTIVE:  return .green
        case .EXPIRED: return .gray
        case .SOLD:    return .blue
        case .BROKEN:  return .red
        case .LOST:    return .orange
        }
    }

    var body: some View {
        WVChip(label, tone: tone)
    }
}

// MARK: - Filter sheet

private struct DeviceFilterSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var statusFilter: DeviceStatus?
    @Binding var categoryFilter: String?
    @Binding var sortOrder: DevicesScreen.DeviceSortOrder
    let categories: [CategoryOption]

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(DevicesScreen.DeviceSortOrder.allCases, id: \.rawValue) { opt in
                        Button {
                            sortOrder = opt
                        } label: {
                            HStack {
                                Text(opt.label)
                                    .foregroundStyle(WVColor.label)
                                Spacer()
                                if sortOrder == opt {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(WVColor.tint)
                                        .font(.system(size: 15, weight: .semibold))
                                }
                            }
                        }
                    }
                } header: {
                    Text(L.t("Sắp xếp"))
                }

                Section {
                    Button {
                        statusFilter = nil
                    } label: {
                        HStack {
                            Text(L.t("Tất cả")).foregroundStyle(WVColor.label)
                            Spacer()
                            if statusFilter == nil {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(WVColor.tint)
                                    .font(.system(size: 15, weight: .semibold))
                            }
                        }
                    }
                    ForEach(DeviceStatus.allCases, id: \.self) { s in
                        Button {
                            statusFilter = s
                        } label: {
                            HStack {
                                Text(s.label).foregroundStyle(WVColor.label)
                                Spacer()
                                if statusFilter == s {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(WVColor.tint)
                                        .font(.system(size: 15, weight: .semibold))
                                }
                            }
                        }
                    }
                } header: {
                    Text(L.t("Trạng thái"))
                }

                // Category filter — mirrors the web's `DevicesFilterBar`,
                // which passes `?category=` to `GET /v1/devices`.
                Section {
                    Button {
                        categoryFilter = nil
                    } label: {
                        HStack {
                            Text(L.t("Tất cả")).foregroundStyle(WVColor.label)
                            Spacer()
                            if categoryFilter == nil {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(WVColor.tint)
                                    .font(.system(size: 15, weight: .semibold))
                            }
                        }
                    }
                    ForEach(categories) { option in
                        Button {
                            categoryFilter = option.code
                        } label: {
                            HStack {
                                Text(option.name).foregroundStyle(WVColor.label)
                                Spacer()
                                if categoryFilter == option.code {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(WVColor.tint)
                                        .font(.system(size: 15, weight: .semibold))
                                }
                            }
                        }
                    }
                } header: {
                    Text(L.t("Loại"))
                }
            }
            .navigationTitle(L.t("Lọc & Sắp xếp"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(L.t("Xoá")) {
                        statusFilter = nil
                        categoryFilter = nil
                        sortOrder = .purchaseDesc
                    }
                    .foregroundStyle(WVColor.tint)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Xong") { dismiss() }
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Navigation enum

enum DeviceFormNav: Hashable {
    case create
    case edit(Device)
}
