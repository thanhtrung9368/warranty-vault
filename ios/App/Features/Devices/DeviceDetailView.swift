import SwiftUI
import UIKit
import WarrlyKit

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
    @State private var showServiceChecklist = false
    @State private var deletionError: String?
    @State private var actionError: String?
    @State private var deviceStatus: DeviceStatus
    @State private var statusSaving = false
    /// Advisory `warnings` returned by the status PATCH. Non-blocking: the
    /// status change did happen, this only says the serial looks odd.
    @State private var statusWarnings: [DeviceWarning] = []

    /// In-memory, per-device tick state for the pre-service checklist. Shared so
    /// leaving the sheet (or this screen) and returning keeps the ticks for the
    /// rest of the app session; deliberately not persisted anywhere.
    @ObservedObject private var checklistSession = ServiceChecklistSession.shared

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

    /// The furthest warranty end, from the detail read when it has loaded and
    /// from the list projection otherwise. Used by the handover checklist's
    /// "know the warranty end date" line; `nil` means the app genuinely does not
    /// know, and the checklist says so rather than inventing a date.
    private var effectiveWarrantyEnd: Date? {
        StatsRollup.effectiveWarrantyEnd(warranties) ?? currentDevice.effectiveWarrantyEnd
    }

    /// The device facts the pre-service checklist injects into its copy.
    private var checklistDevice: ServiceChecklistDevice {
        ServiceChecklistDevice(
            name: currentDevice.name,
            category: currentDevice.category,
            serialNumber: currentDevice.serialNumber,
            warrantyEndText: effectiveWarrantyEnd.map(WVFormat.date),
            purchasePlace: currentDevice.purchasePlace,
            // The detail read's attachment array is authoritative once loaded;
            // the list projection carries a count for the moment before it is.
            attachmentCount: max(attachments.count, currentDevice.attachmentCount ?? 0)
        )
    }

    private var maxDaysLeft: Int? {
        guard !warranties.isEmpty else { return nil }
        return warranties.map { warrantyDaysLeft($0) }.max()
    }

    /// The exchange / return window as a **read-only** row, or `nil` when nothing
    /// is recorded.
    ///
    /// `returnDeadline` is the value the server computed for this read — the
    /// client never divides the days itself. `0` days is a recorded answer ("cửa
    /// hàng không cho đổi trả"), which is why it renders a line of its own instead
    /// of looking like "chưa biết".
    private var returnWindowDisplay: (value: String, note: String?)? {
        guard let detail = store.device,
              DeviceReturnWindow.hasReturnWindow(detail.returnWindowDays) else { return nil }

        if let label = DeviceReturnWindow.deadlineLabel(detail.returnDeadline) {
            return (label, DeviceReturnWindow.deadlineNote(detail.returnDeadline))
        }
        if DeviceReturnWindow.isNoExchange(detail.returnWindowDays) {
            return (L.t("Không cho đổi trả"), L.t("cửa hàng không áp dụng đổi/trả"))
        }
        return nil
    }

    /// The reminder schedule as a read-only trailing value, or `nil` when the
    /// payload has no `leadDays` (an older read, or a server that has not
    /// shipped the field yet). The row is hidden rather than showing "30/7" —
    /// this screen must not claim a schedule it does not know.
    private var leadDaysDisplay: String? {
        guard let days = currentDevice.leadDays, !days.isEmpty else { return nil }
        return LeadDaysRules.dayListText(days)
    }

    /// The recorded sale as **read-only** rows, or `nil` when the device was never
    /// sold — an unsold device shows no empty money rows (the web renders its
    /// "Bán lại" card under exactly the same condition, Android its rows).
    ///
    /// Each half is rendered if it is there: the server enforces the pair, so both
    /// normally arrive together, but a legacy half-record must not be hidden.
    /// `soldAt` is the server's Z-less naive-UTC timestamp (`"2026-03-02T00:00:00"`),
    /// so only its calendar day is read. Lãi/lỗ is derived here because the API
    /// deliberately returns `soldPrice − purchasePrice` to nobody.
    private var saleDisplay: (day: String?, price: Int?, profit: SaleProfitLoss?)? {
        let day = DeviceResale.dayLabel(currentDevice.soldAt)
        let price = currentDevice.soldPrice
        // Only what can actually be drawn: a date that reads as a calendar day, or
        // a price. Anything else would render an empty section.
        guard day != nil || price != nil else { return nil }
        return (day,
                price,
                DeviceResale.profitLoss(purchasePrice: currentDevice.purchasePrice,
                                        soldPrice: price))
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
                WVSectionHeader(L.t("Mua hàng"))
                WVGroup {
                    WVRow(icon: "calendar", iconColor: WVColor.red,
                          title: L.t("Ngày mua"),
                          detail: WVFormat.date(currentDevice.purchaseDate))
                    if let window = returnWindowDisplay {
                        WVDivider(inset: 60)
                        // Read-only: this is the server's own derived deadline
                        // (`COALESCE(receivedAt, purchaseDate) + returnWindowDays`),
                        // never recomputed here. There is no input for the window
                        // length on purpose — see `DeviceReturnWindow`.
                        WVRow(icon: "arrowDown", iconColor: WVColor.purple,
                              title: L.t("Hạn đổi/trả"),
                              subtitle: window.note,
                              detail: window.value)
                    }
                    WVDivider(inset: 60)
                    WVRow(icon: "wallet", iconColor: WVColor.green,
                          title: L.t("Giá mua"),
                          detail: WVFormat.vnd(currentDevice.purchasePrice))
                    WVDivider(inset: 60)
                    WVRow(icon: "store", iconColor: WVColor.orange,
                          title: L.t("Nơi mua"),
                          detail: currentDevice.purchasePlace ?? "—")
                    WVDivider(inset: 60)
                    WVRow(icon: "hash", iconColor: WVColor.blue,
                          title: "Serial / IMEI",
                          detail: currentDevice.serialNumber ?? "—")
                }

                // Reminder lead times ("Nhắc trước"). Per-device since the
                // `leadDays` field landed; rendered as "Nhắc trước 30 và 7 ngày"
                // in Vietnamese (or "Reminds you 30 and 7 days before" in English).
                // Read-only here — the schedule is edited in the device form.
                if let leadDaysDisplay {
                    WVSectionHeader(L.t("Nhắc nhở"))
                    WVGroup {
                        WVRow(icon: "clock", iconColor: WVColor.purple,
                              title: L.t("Nhắc trước"),
                              detail: leadDaysDisplay)
                    }
                }

                // Resale ("Bán lại", migration 0006). Read-only here; the pair is
                // edited in the device form. Shown only when a sale was recorded.
                if let sale = saleDisplay {
                    WVSectionHeader(L.t("Bán lại"))
                    WVGroup {
                        if let day = sale.day {
                            WVRow(icon: "calendar", iconColor: WVColor.blue,
                                  title: L.t("Ngày bán"),
                                  detail: day)
                        }
                        if let price = sale.price {
                            if sale.day != nil { WVDivider(inset: 60) }
                            WVRow(icon: "wallet", iconColor: WVColor.green,
                                  title: L.t("Giá bán"),
                                  detail: WVFormat.vnd(price))
                        }
                        if let profit = sale.profit {
                            WVDivider(inset: 60)
                            WVRowContainer {
                                HStack(spacing: 12) {
                                    WVLeadingIcon(
                                        icon: profit.tone == .loss ? "trendingDown" : "trendingUp",
                                        color: DeviceFormView.saleToneColor(profit.tone),
                                        size: 30
                                    )
                                    Text(L.t("Lãi/lỗ so với giá mua"))
                                        .font(.system(size: 17))
                                        .foregroundStyle(WVColor.label)
                                    Spacer(minLength: 8)
                                    // "Lãi 2.000.000 ₫" / "Lỗ 500.000 ₫" / "Hoà vốn"
                                    // — the same wording web and Android render.
                                    Text(profit.label)
                                        .font(.system(size: 17, weight: .semibold))
                                        .foregroundStyle(DeviceFormView.saleToneColor(profit.tone))
                                }
                            }
                        }
                    }
                }

                // Warranty list group
                WVSectionHeader(L.t("Bảo hành (%d/5)", warranties.count))
                warrantyListGroup

                // Warranty contact group (if phones/addresses present)
                let contactWarranties = warranties.filter { $0.phone != nil || $0.address != nil }
                if !contactWarranties.isEmpty {
                    WVSectionHeader(L.t("Liên hệ bảo hành"))
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

                // Pre-service handover checklist. Sits with the warranty contact
                // details because that is the moment the user is about to hand
                // the machine over; the list itself is generated per device and
                // ticked in memory only (no API field exists for it).
                WVSectionHeader(L.t("Trước khi đi bảo hành"))
                WVSectionFooter(L.t("Danh sách nhắc bạn gỡ khoá, sao lưu, chuẩn bị giấy tờ và kiểm tra máy khi nhận lại — những việc quyết định chuyến đi có thành công hay không."))
                WVGroup {
                    WVRow(icon: "checklist", iconColor: WVColor.orange,
                          title: L.t("Danh sách bàn giao trước khi sửa"),
                          subtitle: L.t("Chỉ tick trong phiên này, không lưu lên máy chủ"),
                          chevron: true,
                          action: { showServiceChecklist = true })
                }

                // Where to actually take the machine (FEATURE_IDEAS #15). Its own
                // read: the directory is a device-level answer, and a failure to
                // load it must not look like "the app has no information".
                ServiceDirectorySection(
                    client: client,
                    deviceId: currentDevice.id
                )

                // The handover certificate (FEATURE_IDEAS #2). The link exists to
                // be handed to a buyer, so it is offered next to the warranty
                // contact details rather than buried under the attachments.
                ShareCertificatesSection(
                    client: client,
                    deviceId: currentDevice.id,
                    deviceName: currentDevice.name
                )

                // Attachments
                WVSectionHeader(L.t("File đính kèm (%d/5)", attachments.count))
                DeviceAttachmentsSection(
                    client: client,
                    deviceId: currentDevice.id,
                    initialAttachments: attachments
                )

                // Note
                if let note = currentDevice.notes, !note.isEmpty {
                    WVSectionHeader(L.t("Ghi chú"))
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
                WVSectionHeader(L.t("Trạng thái"))
                WVSegmented(
                    options: [
                        (value: DeviceStatus.ACTIVE, label: L.t("Đang dùng")),
                        (value: DeviceStatus.BROKEN, label: L.t("Hỏng")),
                        (value: DeviceStatus.SOLD,   label: L.t("Đã bán")),
                    ],
                    selection: $deviceStatus
                )
                .padding(.horizontal, WVSpacing.gutter)
                .disabled(statusSaving)
                .onChange(of: deviceStatus) { _, newStatus in
                    guard newStatus != currentDevice.status else { return }
                    Task { await saveStatus(newStatus) }
                }

                // Serial advisories from the PATCH — amber, never an error: the
                // status change went through.
                if !statusWarnings.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(statusWarnings.enumerated()), id: \.offset) { _, warning in
                            HStack(alignment: .top, spacing: 6) {
                                WVIcon("alert", size: 12)
                                    .foregroundStyle(WVColor.orange)
                                Text("\(warning.fieldLabel): \(warning.displayMessage)")
                                    .font(.system(size: 12))
                                    .foregroundStyle(WVColor.label2)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Text(DeviceWarningCopy.savedNote)
                            .font(.system(size: 11))
                            .foregroundStyle(WVColor.label3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, WVSpacing.titleGutter)
                    .padding(.top, 6)
                }

                // Delete row
                WVGroup {
                    WVRow(icon: "trash", iconColor: WVColor.red,
                          title: L.t("Xoá thiết bị"),
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
                        Label(L.t("Sửa thông tin"), systemImage: "pencil")
                    }
                    Button {
                        UIPasteboard.general.string = currentDevice.serialNumber ?? ""
                    } label: {
                        Label(L.t("Sao chép Serial"), systemImage: "doc.on.doc")
                    }
                    .disabled(currentDevice.serialNumber == nil)
                    Divider()
                    Button(role: .destructive) {
                        showDeleteAlert = true
                    } label: {
                        Label(L.t("Xoá thiết bị"), systemImage: "trash")
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
        .alert(L.t("Xoá thiết bị?"), isPresented: $showDeleteAlert) {
            Button(L.t("Huỷ"), role: .cancel) {}
            Button(L.t("Xoá"), role: .destructive) { Task { await deleteDevice() } }
        } message: {
            Text(L.t("\"%@\" sẽ bị xoá vĩnh viễn cùng toàn bộ gói bảo hành.", currentDevice.name))
        }
        .sheet(isPresented: $showServiceChecklist) {
            ServiceChecklistSheet(
                device: checklistDevice,
                deviceID: currentDevice.id,
                session: checklistSession
            )
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
                Text(L.t("Tổng quan bảo hành"))
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
                          title: L.t("Thêm gói bảo hành"),
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
        // `d.purchaseDate` came from the shared decoder, which reads the Z-less
        // wire value in the device's own zone. Writing it back through a
        // zone-pinned formatter would move the day east of that pin — so a bare
        // status tap on "Đã bán" would silently edit the purchase date.
        let isoDate = WireDay.string(from: d.purchaseDate)
        var input = DeviceInput(name: d.name, category: d.category, purchaseDate: isoDate)
        input.brand = d.brand
        input.model = d.model
        input.serialNumber = d.serialNumber
        input.purchasePlace = d.purchasePlace
        input.purchasePrice = d.purchasePrice
        input.status = status
        input.notes = d.notes
        // A status tap is not an edit to the reminder schedule. The contract
        // already treats an absent `leadDays` as "unchanged", but this screen
        // sends what it loaded so a future server change cannot turn a status
        // tap into a silent reset to the 7/30 default.
        input.leadDays = d.leadDays
        // A status change is still a FULL replacement of the device row, so the
        // recorded exchange window has to travel with it. Omitting it here would
        // erase a window the user recorded elsewhere just because they tapped
        // "Đã bán".
        DeviceReturnWindow.apply(DeviceReturnWindow.carried(from: d), to: &input)
        // …and the same is true of the resale pair (migration 0006): tapping a
        // status is not a reason to lose a sale recorded on the web or Android.
        // Both halves travel together, or — for a device that was never sold —
        // neither does, which the encoder omits.
        DeviceResale.apply(DeviceResale.carried(from: d), to: &input)
        do {
            let result = try await devicesStore.update(id: d.id, input)
            // PATCH /devices/{id} carries the same advisory array as create. The
            // device being edited is excluded from the duplicate probe, so an
            // unchanged serial does not warn about duplicating itself.
            statusWarnings = result.warningsOrEmpty
        } catch {
            actionError = (error as? APIError)?.localizedDescription ?? error.localizedDescription
            statusWarnings = []
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
        case .ACTIVE:  return L.t("Đang dùng")
        case .EXPIRED: return L.t("Hết BH")
        case .SOLD:    return L.t("Đã bán")
        case .BROKEN:  return L.t("Hỏng")
        case .LOST:    return L.t("Mất")
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
        case .STANDARD:    return L.t("BH chính hãng")
        case .EXTENDED:    return L.t("BH mở rộng")
        case .THIRD_PARTY: return L.t("BH bên thứ 3")
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
        case .STANDARD:    return L.t("BH chính hãng")
        case .EXTENDED:    return L.t("BH mở rộng")
        case .THIRD_PARTY: return L.t("BH bên thứ 3")
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
                // Joined from three fragments rather than one template: the
                // English month count inflects ("1 month" / "24 months") and a
                // `%d` inside a whole sentence could not do that. Vietnamese
                // renders exactly as before.
                Text([typeLabel,
                      L.p("%d tháng", warranty.months),
                      L.t("Hết %@", WVFormat.date(warranty.endDate))]
                        .joined(separator: " · "))
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
