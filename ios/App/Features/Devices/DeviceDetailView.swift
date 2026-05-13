import SwiftUI
import WarrantyVaultKit

struct DeviceDetailView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var store: WarrantiesStore
    let deviceSummary: Device

    @State private var showAddWarranty = false
    @State private var showEditDevice = false
    @State private var editingWarranty: Warranty?
    @State private var pendingActionId: String?
    @State private var actionError: String?

    private let client: APIClient
    /// Optional reference to the list's store so edits propagate back into the list.
    @ObservedObject var devicesStore: DevicesStore

    init(device: Device, client: APIClient, devicesStore: DevicesStore) {
        self.deviceSummary = device
        self.client = client
        self.devicesStore = devicesStore
        _store = StateObject(wrappedValue: WarrantiesStore(client: client, deviceId: device.id))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: WV.Spacing.lg) {
                deviceHeader
                warrantiesSection
                AttachmentsSection(
                    client: client,
                    deviceId: deviceSummary.id,
                    initialAttachments: store.device?.attachments ?? []
                )
                if let actionError {
                    Label(actionError, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(WV.Tokens.destructive)
                        .font(.system(size: 13))
                        .padding(.horizontal, WV.Spacing.lg)
                }
            }
            .padding(.vertical, WV.Spacing.lg)
        }
        .background(WV.Tokens.bg)
        .navigationTitle(deviceSummary.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        showEditDevice = true
                    } label: {
                        Label("Sửa thiết bị", systemImage: "pencil")
                    }
                    Button {
                        showAddWarranty = true
                    } label: {
                        Label("Thêm bảo hành", systemImage: "shield.checkerboard")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle.fill")
                        .font(.system(size: 22))
                        .foregroundStyle(WV.Tokens.primary)
                }
            }
        }
        .task { await store.load() }
        .refreshable { await store.load() }
        .sheet(isPresented: $showAddWarranty) {
            WarrantyEditorSheet(store: store, warranty: nil)
        }
        .sheet(item: $editingWarranty) { w in
            WarrantyEditorSheet(store: store, warranty: w)
        }
        .sheet(isPresented: $showEditDevice) {
            // Use the latest copy from the list store if present (post-edit refresh),
            // otherwise fall back to the snapshot we were navigated with.
            let latest = devicesStore.devices.first(where: { $0.id == deviceSummary.id }) ?? deviceSummary
            AddDeviceSheet(store: devicesStore, client: client, editing: latest)
        }
    }

    // MARK: - Sections

    private var deviceHeader: some View {
        WVCard {
            VStack(alignment: .leading, spacing: WV.Spacing.sm) {
                HStack(alignment: .top, spacing: WV.Spacing.md) {
                    ZStack {
                        RoundedRectangle(cornerRadius: WV.Radius.md)
                            .fill(WV.Tokens.primary.opacity(0.14))
                        Image(systemName: iconForCategory(deviceSummary.category))
                            .font(.system(size: 26, weight: .semibold))
                            .foregroundStyle(WV.Tokens.primary)
                    }
                    .frame(width: 56, height: 56)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(deviceSummary.name)
                            .font(.title3.weight(.semibold))
                        if let brand = deviceSummary.brand {
                            Text(brand + (deviceSummary.model.map { " • \($0)" } ?? ""))
                                .font(.system(size: 13))
                                .foregroundStyle(WV.Tokens.mutedFg)
                        }
                        WVStatusPill(deviceSummary.status.label, kind: kind(for: deviceSummary.status))
                    }
                    Spacer()
                }
                Divider()
                HStack {
                    metaRow(label: "Ngày mua", value: formatDate(deviceSummary.purchaseDate))
                    Spacer()
                    metaRow(label: "Giá", value: formatVND(deviceSummary.purchasePrice))
                }
                if let serial = deviceSummary.serialNumber, !serial.isEmpty {
                    metaRow(label: "Số serial", value: serial)
                }
            }
        }
        .padding(.horizontal, WV.Spacing.lg)
    }

    private func metaRow(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 11)).foregroundStyle(WV.Tokens.mutedFg)
            Text(value).font(.system(size: 14, weight: .medium))
        }
    }

    private var warrantiesSection: some View {
        VStack(alignment: .leading, spacing: WV.Spacing.md) {
            HStack {
                Text("Bảo hành")
                    .font(.title3.weight(.semibold))
                Spacer()
                Text("\(store.warranties.count) gói")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(WV.Tokens.mutedFg)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(WV.Tokens.muted))
            }
            .padding(.horizontal, WV.Spacing.lg)

            switch store.state {
            case .idle:
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, WV.Spacing.xl)
            case .loading where store.warranties.isEmpty:
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, WV.Spacing.xl)
            case .error(let msg) where store.warranties.isEmpty:
                VStack(spacing: WV.Spacing.sm) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 32))
                        .foregroundStyle(WV.Tokens.warning)
                    Text(msg)
                        .font(.system(size: 13))
                        .foregroundStyle(WV.Tokens.mutedFg)
                        .multilineTextAlignment(.center)
                    Button("Thử lại") { Task { await store.load() } }
                        .buttonStyle(SecondaryButtonStyle(fullWidth: false))
                }
                .padding(WV.Spacing.lg)
                .frame(maxWidth: .infinity)
            case .loaded where store.warranties.isEmpty:
                emptyWarranty
            default:
                VStack(spacing: WV.Spacing.md) {
                    ForEach(store.warranties) { w in
                        warrantyCard(w)
                    }
                }
                .padding(.horizontal, WV.Spacing.lg)
            }
        }
    }

    private var emptyWarranty: some View {
        WVCard {
            VStack(spacing: WV.Spacing.sm) {
                ZStack {
                    Circle().fill(WV.Tokens.primary.opacity(0.14))
                    Image(systemName: "shield.lefthalf.filled")
                        .font(.system(size: 28, weight: .semibold))
                        .foregroundStyle(WV.Tokens.primary)
                }
                .frame(width: 64, height: 64)
                Text("Chưa có gói bảo hành nào")
                    .font(.system(size: 15, weight: .semibold))
                Text("Thêm bảo hành tiêu chuẩn, mở rộng hoặc bên thứ ba.")
                    .font(.system(size: 12))
                    .foregroundStyle(WV.Tokens.mutedFg)
                    .multilineTextAlignment(.center)
                Button("Thêm bảo hành") { showAddWarranty = true }
                    .buttonStyle(PrimaryButtonStyle(fullWidth: false))
                    .padding(.top, WV.Spacing.xs)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, WV.Spacing.sm)
        }
        .padding(.horizontal, WV.Spacing.lg)
    }

    private func warrantyCard(_ w: Warranty) -> some View {
        WVCard {
            VStack(alignment: .leading, spacing: WV.Spacing.sm) {
                HStack {
                    WVStatusPill(w.type.label, kind: kind(for: w.type))
                    Spacer()
                    if w.isReminderDismissed {
                        WVStatusPill("Đã ẩn nhắc", kind: .neutral, systemImage: "eye.slash")
                    }
                    let tint = remainingTint(end: w.endDate)
                    Text(remainingLabel(end: w.endDate))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(tint)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(tint.opacity(0.14)))
                }

                if let provider = w.provider, !provider.isEmpty {
                    Text(provider)
                        .font(.system(size: 14, weight: .semibold))
                }

                HStack(spacing: WV.Spacing.lg) {
                    metaRow(label: "Bắt đầu", value: formatDate(w.startDate))
                    metaRow(label: "Kết thúc", value: formatDate(w.endDate))
                    Spacer()
                    metaRow(label: "Thời hạn", value: "\(w.months) tháng")
                }

                if let cost = w.cost, cost > 0 {
                    Text("Phí gói: \(formatVND(cost))")
                        .font(.system(size: 12))
                        .foregroundStyle(WV.Tokens.mutedFg)
                }

                if let phone = w.phone, !phone.isEmpty {
                    Label(phone, systemImage: "phone")
                        .font(.system(size: 12))
                        .foregroundStyle(WV.Tokens.mutedFg)
                }

                if let address = w.address, !address.isEmpty {
                    Label(address, systemImage: "mappin.and.ellipse")
                        .font(.system(size: 12))
                        .foregroundStyle(WV.Tokens.mutedFg)
                }

                if let notes = w.notes, !notes.isEmpty {
                    Text(notes)
                        .font(.system(size: 13))
                        .foregroundStyle(WV.Tokens.fg)
                }

                Divider()

                HStack(spacing: WV.Spacing.sm) {
                    Button {
                        Task { await toggleReminder(w) }
                    } label: {
                        if pendingActionId == "reminder-\(w.id)" {
                            ProgressView()
                        } else {
                            Label(
                                w.isReminderDismissed ? "Hiện lại" : "Đã xem, ẩn đi",
                                systemImage: w.isReminderDismissed ? "eye" : "eye.slash"
                            )
                            .font(.system(size: 12, weight: .medium))
                        }
                    }
                    .disabled(pendingActionId != nil)

                    Spacer()

                    Button {
                        editingWarranty = w
                    } label: {
                        Label("Sửa", systemImage: "pencil")
                            .font(.system(size: 12, weight: .medium))
                    }

                    Button(role: .destructive) {
                        Task { await deleteWarranty(w) }
                    } label: {
                        if pendingActionId == "delete-\(w.id)" {
                            ProgressView()
                        } else {
                            Label("Xoá", systemImage: "trash")
                                .font(.system(size: 12, weight: .medium))
                        }
                    }
                    .disabled(pendingActionId != nil)
                }
                .foregroundStyle(WV.Tokens.primary)
            }
        }
    }

    // MARK: - Actions

    private func toggleReminder(_ w: Warranty) async {
        actionError = nil
        pendingActionId = "reminder-\(w.id)"
        defer { pendingActionId = nil }
        do {
            if w.isReminderDismissed {
                try await store.restoreReminder(warrantyId: w.id)
            } else {
                try await store.dismissReminder(warrantyId: w.id)
            }
        } catch {
            actionError = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }

    private func deleteWarranty(_ w: Warranty) async {
        actionError = nil
        pendingActionId = "delete-\(w.id)"
        defer { pendingActionId = nil }
        do {
            try await store.delete(id: w.id)
        } catch {
            actionError = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }

    // MARK: - Helpers

    private func tint(for status: DeviceStatus) -> Color {
        switch status {
        case .ACTIVE:  return WV.Tokens.success
        case .EXPIRED: return WV.Tokens.mutedFg
        case .SOLD:    return WV.Tokens.primary
        case .BROKEN:  return WV.Tokens.destructive
        case .LOST:    return WV.Tokens.warning
        }
    }

    private func kind(for status: DeviceStatus) -> WVStatusKind {
        switch status {
        case .ACTIVE:  return .success
        case .EXPIRED: return .neutral
        case .SOLD:    return .accent
        case .BROKEN:  return .danger
        case .LOST:    return .warning
        }
    }

    private func tint(for type: WarrantyType) -> Color {
        switch type {
        case .STANDARD:    return WV.Tokens.mutedFg
        case .EXTENDED:    return WV.Tokens.primary
        case .THIRD_PARTY: return WV.Tokens.success
        }
    }

    private func kind(for type: WarrantyType) -> WVStatusKind {
        switch type {
        case .STANDARD:    return .neutral
        case .EXTENDED:    return .accent
        case .THIRD_PARTY: return .success
        }
    }

    private func remainingLabel(end: Date) -> String {
        let days = Calendar.current.dateComponents([.day], from: Date(), to: end).day ?? 0
        if days < 0 { return "Đã hết \(-days) ngày" }
        if days == 0 { return "Hết hôm nay" }
        if days <= 30 { return "Còn \(days) ngày" }
        let months = days / 30
        return "Còn ~\(months) tháng"
    }

    private func remainingTint(end: Date) -> Color {
        let days = Calendar.current.dateComponents([.day], from: Date(), to: end).day ?? 0
        if days < 0 { return WV.Tokens.destructive }
        if days <= 30 { return WV.Tokens.warning }
        return WV.Tokens.success
    }
}
