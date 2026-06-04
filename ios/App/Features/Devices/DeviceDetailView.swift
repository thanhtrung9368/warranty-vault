import SwiftUI
import UIKit
import WarrantyVaultKit

// ============================================================
// DeviceDetailView — device detail screen
//
// Ports DeviceDetailScreen from project/ios/js/screens-1.jsx.
// Hero icon + info groups + warranty timeline cards + attachments.
// Edit → push DeviceFormView; add/edit warranty → push WarrantyFormView.
// ============================================================

struct DeviceDetailView: View {
    let client: APIClient
    @ObservedObject var devicesStore: DevicesStore
    let device: Device

    @StateObject private var store: WarrantiesStore

    @State private var showActionMenu = false
    @State private var showDeleteAlert = false
    @State private var deletionError: String?
    @State private var actionError: String?
    @State private var deviceStatus: DeviceStatus
    @State private var statusSaving = false

    @Environment(\.dismiss) private var dismiss

    init(client: APIClient, devicesStore: DevicesStore, device: Device) {
        self.client = client
        self.devicesStore = devicesStore
        self.device = device
        _store = StateObject(wrappedValue: WarrantiesStore(client: client, deviceId: device.id))
        _deviceStatus = State(initialValue: device.status)
    }

    // MARK: - Computed

    private var currentDevice: Device {
        devicesStore.devices.first(where: { $0.id == device.id }) ?? device
    }

    private var warranties: [Warranty] { store.warranties }
    private var attachments: [AttachmentMeta] { store.device?.attachments ?? [] }

    private var maxDaysLeft: Int? {
        guard !warranties.isEmpty else { return nil }
        return warranties.map { warrantyDaysLeft($0) }.max()
    }

    // MARK: - Body

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // Hero section
                heroSection

                // Warranty timeline card (if any)
                if !warranties.isEmpty {
                    warrantyTimelineCard
                        .padding(.top, 12)
                }

                // Info group — purchase
                WVSectionHeader("Mua hàng")
                WVGroup {
                    WVRow(icon: "calendar", iconColor: WVColor.red,
                          title: "Ngày mua",
                          detail: WVFormat.date(currentDevice.purchaseDate))
                    WVDivider(inset: 60)
                    WVRow(icon: "wallet", iconColor: WVColor.green,
                          title: "Giá mua",
                          detail: WVFormat.vnd(currentDevice.purchasePrice))
                    WVDivider(inset: 60)
                    WVRow(icon: "store", iconColor: WVColor.orange,
                          title: "Nơi mua",
                          detail: currentDevice.purchasePlace ?? "—")
                    WVDivider(inset: 60)
                    WVRow(icon: "hash", iconColor: WVColor.blue,
                          title: "Serial / IMEI",
                          detail: currentDevice.serialNumber ?? "—")
                }

                // Warranty list group
                WVSectionHeader("Bảo hành (\(warranties.count)/5)")
                warrantyListGroup

                // Warranty contact group (if phones/addresses present)
                let contactWarranties = warranties.filter { $0.phone != nil || $0.address != nil }
                if !contactWarranties.isEmpty {
                    WVSectionHeader("Liên hệ bảo hành")
                    WVGroup {
                        ForEach(Array(contactWarranties.enumerated()), id: \.element.id) { _, w in
                            if let phone = w.phone {
                                WVDivider(inset: 60)
                                WVRow(icon: "phone", iconColor: WVColor.green,
                                      title: phone,
                                      subtitle: w.provider,
                                      chevron: true,
                                      action: { openURL("tel:\(phone)") })
                            }
                            if let address = w.address {
                                WVDivider(inset: 60)
                                WVRow(icon: "mapPin", iconColor: WVColor.red,
                                      title: address,
                                      subtitle: w.provider,
                                      chevron: true,
                                      action: { openURL("https://maps.google.com/?q=\(address.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")") })
                            }
                        }
                    }
                }

                // Attachments
                WVSectionHeader("File đính kèm (\(attachments.count)/5)")
                DeviceAttachmentsSection(
                    client: client,
                    deviceId: currentDevice.id,
                    initialAttachments: attachments
                )

                // Note
                if let note = currentDevice.notes, !note.isEmpty {
                    WVSectionHeader("Ghi chú")
                    WVGroup {
                        Text(note)
                            .font(.system(size: 15))
                            .foregroundStyle(WVColor.label)
                            .lineSpacing(4)
                            .padding(.horizontal, 16)
                            .frame(minHeight: 44)
                            .padding(.vertical, 10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }

                // Status quick-change
                WVSectionHeader("Trạng thái")
                WVSegmented(
                    options: [
                        (value: DeviceStatus.ACTIVE, label: "Đang dùng"),
                        (value: DeviceStatus.BROKEN, label: "Hỏng"),
                        (value: DeviceStatus.SOLD,   label: "Đã bán"),
                    ],
                    selection: $deviceStatus
                )
                .padding(.horizontal, WVSpacing.gutter)
                .disabled(statusSaving)
                .onChange(of: deviceStatus) { _, newStatus in
                    guard newStatus != currentDevice.status else { return }
                    Task { await saveStatus(newStatus) }
                }

                // Delete row
                WVGroup {
                    WVRow(icon: "trash", iconColor: WVColor.red,
                          title: "Xoá thiết bị",
                          role: .destructive,
                          action: { showDeleteAlert = true })
                }
                .padding(.top, 16)

                if let actionError {
                    Text(actionError)
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.red)
                        .padding(.horizontal, 32)
                        .padding(.top, 8)
                }

                Spacer().frame(height: 24)
            }
        }
        .wvScreen()
        .navigationTitle(currentDevice.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    NavigationLink(value: DeviceFormNav.edit(currentDevice)) {
                        Label("Sửa thông tin", systemImage: "pencil")
                    }
                    Button {
                        UIPasteboard.general.string = currentDevice.serialNumber ?? ""
                    } label: {
                        Label("Sao chép Serial", systemImage: "doc.on.doc")
                    }
                    .disabled(currentDevice.serialNumber == nil)
                    Divider()
                    Button(role: .destructive) {
                        showDeleteAlert = true
                    } label: {
                        Label("Xoá thiết bị", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
        .navigationDestination(for: DeviceFormNav.self) { nav in
            switch nav {
            case .create:
                DeviceFormView(client: client, store: devicesStore, device: nil)
            case .edit(let d):
                DeviceFormView(client: client, store: devicesStore, device: d)
            }
        }
        .navigationDestination(for: WarrantyFormNav.self) { nav in
            WarrantyFormView(store: store, warranty: nav.warranty)
        }
        .alert("Xoá thiết bị?", isPresented: $showDeleteAlert) {
            Button("Huỷ", role: .cancel) {}
            Button("Xoá", role: .destructive) { Task { await deleteDevice() } }
        } message: {
            Text("\"\(currentDevice.name)\" sẽ bị xoá vĩnh viễn cùng toàn bộ gói bảo hành.")
        }
        .task { await store.load() }
        .refreshable { await store.load() }
    }

    // MARK: - Hero section

    private var heroSection: some View {
        VStack(spacing: 0) {
            VStack(spacing: 12) {
                WVLeadingIcon(
                    icon: WVCategory.icon(for: currentDevice.category),
                    color: WVCategory.accent(for: currentDevice.category),
                    size: 64
                )
                VStack(spacing: 4) {
                    Text(currentDevice.name)
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(WVColor.label)
                        .multilineTextAlignment(.center)
                    Text([currentDevice.brand, currentDevice.model]
                        .compactMap { $0 }
                        .joined(separator: " · "))
                        .font(.system(size: 14))
                        .foregroundStyle(WVColor.label3)
                }
                HStack(spacing: 6) {
                    DeviceStatusBadge(status: currentDevice.status)
                    if let dl = maxDaysLeft {
                        WarrantyPill(daysLeft: dl)
                    }
                }
            }
            .padding(.horizontal, WVSpacing.gutter)
            .padding(.vertical, 20)
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - Warranty timeline card

    private var warrantyTimelineCard: some View {
        WVCard(padding: 16) {
            VStack(alignment: .leading, spacing: 14) {
                Text("Tổng quan bảo hành")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(WVColor.label)
                ForEach(Array(warranties.enumerated()), id: \.element.id) { idx, w in
                    if idx > 0 {
                        Rectangle().fill(WVColor.sep).frame(height: 0.5)
                    }
                    WarrantyTimelineRow(warranty: w)
                }
            }
        }
    }

    // MARK: - Warranty list group

    private var warrantyListGroup: some View {
        WVGroup {
            let canAdd = warranties.count < 5
            ForEach(Array(warranties.enumerated()), id: \.element.id) { idx, w in
                if idx > 0 { WVDivider(inset: 60) }
                NavigationLink(value: WarrantyFormNav(warranty: w)) {
                    WarrantyListRow(warranty: w)
                }
                .buttonStyle(WVRowButtonStyle())
            }
            if canAdd {
                if !warranties.isEmpty { WVDivider(inset: 60) }
                NavigationLink(value: WarrantyFormNav(warranty: nil)) {
                    WVRow(icon: "plus", iconColor: WVColor.tint,
                          title: "Thêm gói bảo hành",
                          role: .tint)
                }
                .buttonStyle(WVRowButtonStyle())
            }
        }
    }

    // MARK: - Actions

    private func deleteDevice() async {
        do {
            try await devicesStore.delete(device.id)
            dismiss()
        } catch {
            deletionError = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }

    private func saveStatus(_ status: DeviceStatus) async {
        statusSaving = true
        defer { statusSaving = false }
        let d = currentDevice
        let isoDate = WVFormat.isoDay(d.purchaseDate)
        var input = DeviceInput(name: d.name, category: d.category, purchaseDate: isoDate)
        input.brand = d.brand
        input.model = d.model
        input.serialNumber = d.serialNumber
        input.purchasePlace = d.purchasePlace
        input.purchasePrice = d.purchasePrice
        input.status = status
        input.notes = d.notes
        do {
            _ = try await devicesStore.update(id: d.id, input)
        } catch {
            actionError = (error as? APIError)?.localizedDescription ?? error.localizedDescription
            // Revert
            deviceStatus = d.status
        }
    }

    private func openURL(_ string: String) {
        guard let url = URL(string: string) else { return }
        UIApplication.shared.open(url)
    }
}

// MARK: - Navigation value

struct WarrantyFormNav: Hashable {
    let warranty: Warranty?
    func hash(into hasher: inout Hasher) {
        hasher.combine(warranty?.id)
    }
    static func == (lhs: WarrantyFormNav, rhs: WarrantyFormNav) -> Bool {
        lhs.warranty?.id == rhs.warranty?.id
    }
}

// MARK: - Device status badge

private struct DeviceStatusBadge: View {
    let status: DeviceStatus

    private var tone: WVChipTone {
        switch status {
        case .ACTIVE:  return .green
        case .EXPIRED: return .gray
        case .SOLD:    return .blue
        case .BROKEN:  return .red
        case .LOST:    return .orange
        }
    }

    private var label: String {
        switch status {
        case .ACTIVE:  return "Đang dùng"
        case .EXPIRED: return "Hết BH"
        case .SOLD:    return "Đã bán"
        case .BROKEN:  return "Hỏng"
        case .LOST:    return "Mất"
        }
    }

    var body: some View {
        WVChip(label, tone: tone)
    }
}

// MARK: - Warranty timeline row

private struct WarrantyTimelineRow: View {
    let warranty: Warranty

    private var daysLeft: Int { warrantyDaysLeft(warranty) }
    private var isExpired: Bool { daysLeft < 0 }

    private var progressValue: Double {
        let total = Double(warranty.months * 30)
        let used = total - Double(daysLeft)
        return max(0, min(1, used / max(1, total)))
    }

    private var progressTone: Color {
        if isExpired { return WVColor.gray }
        if progressValue > 0.8 { return WVColor.red }
        if progressValue > 0.6 { return WVColor.orange }
        return WVColor.green
    }

    private var typeTone: WVChipTone {
        switch warranty.type {
        case .STANDARD:    return .brand
        case .EXTENDED:    return .purple
        case .THIRD_PARTY: return .blue
        }
    }

    private var typeLabel: String {
        switch warranty.type {
        case .STANDARD:    return "BH chính hãng"
        case .EXTENDED:    return "BH mở rộng"
        case .THIRD_PARTY: return "BH bên thứ 3"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center, spacing: 8) {
                WVChip(typeLabel, tone: typeTone)
                if let provider = warranty.provider {
                    Text(provider)
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.label3)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Spacer(minLength: 0)
                }
                WarrantyPill(daysLeft: daysLeft)
            }
            WVProgressBar(value: progressValue, tone: progressTone)
            HStack {
                Text(WVFormat.date(warranty.startDate))
                    .font(.system(size: 11))
                    .foregroundStyle(WVColor.label3)
                Spacer()
                Text(WVFormat.date(warranty.endDate))
                    .font(.system(size: 11))
                    .foregroundStyle(WVColor.label3)
            }
        }
    }
}

// MARK: - Warranty list row

private struct WarrantyListRow: View {
    let warranty: Warranty

    private var typeTone: WVChipTone {
        switch warranty.type {
        case .STANDARD:    return .brand
        case .EXTENDED:    return .purple
        case .THIRD_PARTY: return .blue
        }
    }

    private var iconColor: Color {
        switch warranty.type {
        case .STANDARD:    return WVColor.brand
        case .EXTENDED:    return WVColor.purple
        case .THIRD_PARTY: return WVColor.blue
        }
    }

    private var typeLabel: String {
        switch warranty.type {
        case .STANDARD:    return "BH chính hãng"
        case .EXTENDED:    return "BH mở rộng"
        case .THIRD_PARTY: return "BH bên thứ 3"
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            WVLeadingIcon(icon: "shieldCheck", color: iconColor, size: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(warranty.provider ?? typeLabel)
                    .font(.system(size: 17))
                    .foregroundStyle(WVColor.label)
                    .lineLimit(1)
                Text("\(typeLabel) · \(warranty.months) tháng · Hết \(WVFormat.date(warranty.endDate))")
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            WVIcon("arrowRight", size: 13)
                .foregroundStyle(WVColor.label4)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .padding(.vertical, 7)
        .contentShape(Rectangle())
    }
}

// MARK: - Days helper (no warrantyEndDate available without separate store load)

private func warrantyDaysLeft(_ w: Warranty) -> Int {
    WVFormat.daysUntil(w.endDate)
}
