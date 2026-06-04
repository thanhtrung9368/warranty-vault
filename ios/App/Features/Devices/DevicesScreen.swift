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
            case .purchaseDesc: return "Mới mua nhất"
            case .warrantyAsc:  return "BH sắp hết trước"
            case .priceDesc:    return "Giá cao nhất"
            case .priceAsc:     return "Giá thấp nhất"
            case .name:         return "Tên A → Z"
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
        switch sortOrder {
        case .purchaseDesc:
            arr.sort { $0.purchaseDate > $1.purchaseDate }
        case .warrantyAsc:
            // No warranty data at list level — just keep server order for now
            break
        case .priceDesc:
            arr.sort { $0.purchasePrice > $1.purchasePrice }
        case .priceAsc:
            arr.sort { $0.purchasePrice < $1.purchasePrice }
        case .name:
            arr.sort { $0.name.localizedCompare($1.name) == .orderedAscending }
        }
        return arr
    }

    private var hasActiveFilters: Bool { statusFilter != nil || sortOrder != .purchaseDesc }

    // MARK: - Body

    var body: some View {
        VStack(spacing: 0) {
            // Search bar
            HStack(spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 15))
                        .foregroundStyle(WVColor.label3)
                    TextField("Tìm thiết bị...", text: $searchQuery)
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
        .navigationTitle("Thiết bị")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    showFilterSheet = true
                } label: {
                    Label("Lọc", systemImage: hasActiveFilters ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease")
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
            DeviceFilterSheet(statusFilter: $statusFilter, sortOrder: $sortOrder)
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
                title: isFiltering ? "Không có gì khớp" : "Chưa có thiết bị nào",
                description: isFiltering
                    ? "Thử nới bộ lọc xem sao."
                    : "Thêm thiết bị đầu tiên — laptop, điện thoại, máy giặt... gì cũng được."
            ) {
                if !isFiltering {
                    NavigationLink(value: DeviceFormNav.create) {
                        WVButton("Thêm thiết bị", icon: "plus") {}
                    }
                }
            }
        } else {
            ScrollView {
                LazyVStack(spacing: 0) {
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

                    Text("\(items.count) thiết bị")
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
                    // Warranty pill placeholder — no per-device warranty at list level.
                    // Show status chip instead.
                    DeviceStatusChip(status: device.status)
                }
                Text("\(device.brand ?? "—") · \(WVFormat.vnd(device.purchasePrice))")
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(1)
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
        case .ACTIVE:  return "Đang dùng"
        case .EXPIRED: return "Hết BH"
        case .SOLD:    return "Đã bán"
        case .BROKEN:  return "Hỏng"
        case .LOST:    return "Mất"
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
    @Binding var sortOrder: DevicesScreen.DeviceSortOrder

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
                    Text("Sắp xếp")
                }

                Section {
                    Button {
                        statusFilter = nil
                    } label: {
                        HStack {
                            Text("Tất cả").foregroundStyle(WVColor.label)
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
                    Text("Trạng thái")
                }
            }
            .navigationTitle("Lọc & Sắp xếp")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Xoá") {
                        statusFilter = nil
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
