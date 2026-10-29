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

    /// `true` once the detail read has landed.
    ///
    /// Section headers that print a count use this: `0/5` before the read is a
    /// false state (the list is empty because nothing arrived, not because the
    /// device has none), while after the read `0` is a fact worth showing.
    private var detailLoaded: Bool { store.state == .loaded }

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

    /// Activation state and the extended-cover deadline as read-only rows, or
    /// `nil` when the device opted into neither.
    ///
    /// `activatedAt` and `extendedCoverBuyBy` are raw wire days (see
    /// `WarrantyActivation`); the countdown is day-resolution and measured on the
    /// caller's calendar, so `0` means "today is the last day". The status row is
    /// the exact state a service centre checks: required-but-not-activated is a
    /// red flag, an activation date is a green confirmation.
    private var activationDisplay: (state: WarrantyActivation.State,
                                    status: String?,
                                    buyByDay: String?,
                                    buyByNote: String?)? {
        let fields = WarrantyActivation.carried(from: currentDevice)
        guard WarrantyActivation.isVisible(fields) else { return nil }
        return (WarrantyActivation.state(fields),
                WarrantyActivation.statusLabel(fields),
                WarrantyActivation.dayLabel(fields.extendedCoverBuyBy),
                WarrantyActivation.buyByNote(fields.extendedCoverBuyBy))
    }

    /// The recorded sale as **read-only** rows, or `nil` when the device was never
    /// sold — an unsold device shows no empty money rows (the web renders its
    /// "Bán lại" card under exactly the same condition, Android its rows).
    ///
    /// Each half is rendered if it is there: the server enforces the pair, so both
    /// normally arrive together, but a legacy half-record must not be hidden.
    /// `soldAt` is a calendar day (`"2026-03-02"`), so only its day is read.
    /// Lãi/lỗ is derived here because the API deliberately returns
    /// `soldPrice − purchasePrice` to nobody.
    private var saleDisplay: (day: String?, price: Int?, profit: SaleProfitLoss?)? {
        let day = DeviceResale.dayLabel(currentDevice.soldAt)
        let price = currentDevice.soldPrice
        // Only what can actually be drawn: a date that reads as a calendar day, or
        // a price. Anything else would render an empty section.
        guard day != nil || price != nil else { return nil }
        return (day,
                price,
                DeviceResale.profitLoss(purchasePrice: currentDevice.purchasePrice,
                                        soldPrice: price,
                                        currency: currentDevice.currency))
    }

    /// The purchase price as the row shows it: the amount **in its own
    /// currency**, plus the server's VND equivalent when the device was priced
    /// abroad. The VND line is not a client conversion — it is
    /// `purchasePriceVnd` from the read, computed at the rate locked at entry.
    private var purchasePriceDisplay: (detail: String, subtitle: String?) {
        let detail = WVFormat.currency(currentDevice.purchasePrice, currentDevice.currency)
        guard currentDevice.usesForeignCurrency,
              let vnd = currentDevice.purchasePriceInVnd else {
            return (detail, nil)
        }
        return (detail, "≈ " + WVFormat.vnd(vnd))
    }

    /// The VND equivalent of a recorded sale, or nil when there is nothing to
    /// show (no sale, or a VND device whose row already is VND).
    private var soldPriceVndDisplay: String? {
        guard currentDevice.usesForeignCurrency,
              let vnd = currentDevice.soldPriceInVnd else { return nil }
        return "≈ " + WVFormat.vnd(vnd)
    }

    /// The brand warranty fields from the list projection, which every save on
    /// this store refreshes — including a form save made on another screen.
    ///
    /// Deliberately **not** `store.device` first: that detail read is loaded once
    /// and is not refreshed when the user returns from the form, so preferring
    /// it would let a status tap send stale brand fields and erase a check the
    /// form had just saved. The list projection is the same `DeviceVND` shape,
    /// so nothing is lost.
    private var brandWarrantyFields: BrandWarrantyFields {
        BrandWarrantyRules.carried(from: currentDevice)
    }

    /// The server-computed mismatch from the same fresh projection. Never
    /// re-derived here — see `BrandWarrantyRules.mismatchState` for why `nil`
    /// alone is not agreement.
    private var brandWarrantyMismatch: WarrantyMismatch? {
        currentDevice.warrantyMismatch
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

                // Brand warranty lookup ("Đối chiếu với hãng"). It sits high on
                // the screen on purpose: the mismatch is the one fact that can
                // change what the user believes about the warranty, so it must
                // not be buried under the contact directory.
                BrandWarrantySection(
                    client: client,
                    brand: currentDevice.brand,
                    fields: brandWarrantyFields,
                    mismatch: brandWarrantyMismatch,
                    purchaseDate: currentDevice.purchaseDate,
                    persist: { fields in
                        try await recordBrandWarranty(fields)
                    }
                )

                // Repairs ("Sửa chữa & bảo hành"). A claim belongs to a device,
                // so the device detail is its anchor: the section lists this
                // device's claims and carries the add/edit form. It sits high on
                // the screen on purpose — when the device is marked BROKEN and
                // no claim is open, its inline nudge is the way out of the dead
                // end that used to be the end of the journey.
                ClaimsSection(store: store, device: currentDevice, client: client)

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
                          subtitle: purchasePriceDisplay.subtitle,
                          detail: purchasePriceDisplay.detail)
                    if currentDevice.usesForeignCurrency {
                        WVDivider(inset: 60)
                        // The locked rate, stated so the two prices above make
                        // sense together. It is history, not a live quote.
                        WVRow(icon: "globe", iconColor: WVColor.blue,
                              title: L.t("Tiền tệ"),
                              subtitle: currentDevice.fxRate.map {
                                  L.t("1 %@ = %@", currentDevice.currencyCode, WVFormat.rate($0))
                              },
                              detail: currentDevice.currencyCode)
                    }
                    WVDivider(inset: 60)
                    WVRow(icon: "store", iconColor: WVColor.orange,
                          title: L.t("Nơi mua"),
                          detail: currentDevice.purchasePlace ?? "—")
                    WVDivider(inset: 60)
                    WVRow(icon: "hash", iconColor: WVColor.blue,
                          title: "Serial / IMEI",
                          detail: currentDevice.serialNumber ?? "—")
                }

                // Warranty activation / extended cover (Feature A). Read-only;
                // the three fields are edited in the device form. The activation
                // row renders the state the service centre checks, and the buy-by
                // row pairs the server day with its day-resolution countdown.
                if let activation = activationDisplay {
                    WVSectionHeader(L.t("Bảo hành & kích hoạt"))
                    WVGroup {
                        if let status = activation.status {
                            WVRow(
                                icon: activation.state == .requiredNotActivated
                                    ? "shieldX" : "shieldCheck",
                                iconColor: activation.state == .requiredNotActivated
                                    ? WVColor.red : WVColor.green,
                                title: L.t("Kích hoạt"),
                                detail: status
                            )
                        }
                        if let day = activation.buyByDay {
                            if activation.status != nil { WVDivider(inset: 60) }
                            WVRow(icon: "calendar", iconColor: WVColor.orange,
                                  title: L.t("Hạn mua gói mở rộng"),
                                  subtitle: activation.buyByNote,
                                  detail: day)
                        }
                    }
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
                                  subtitle: soldPriceVndDisplay,
                                  detail: WVFormat.currency(price, currentDevice.currency))
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

                // Warranty list group.
                //
                // The count is only printed once the detail read has landed.
                // Before that `warranties` is empty because *nothing has been
                // read yet*, not because the device has none — "(0/5)" there is
                // a claim the screen cannot support.
                WVSectionHeader(detailLoaded
                    ? L.t("Bảo hành (%d/5)", warranties.count)
                    : L.t("Bảo hành"))
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

                // Attachments. Same rule as the warranty header: the count is a
                // fact from the read, so it appears with the read.
                WVSectionHeader(detailLoaded
                    ? L.t("File đính kèm (%d/5)", attachments.count)
                    : L.t("File đính kèm"))
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
        .wvQAScrollBottom()
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
            // The fee is in the device's currency, so the form labels the unit.
            WarrantyFormView(store: store, warranty: nav.warranty,
                             currency: currentDevice.currencyCode)
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
                    // The mismatch flag is deliberately in the hero: the user
                    // should see that the brand disagrees before they read any
                    // other number on this screen. Orange, never red.
                    if brandWarrantyMismatch != nil {
                        WVChip(BrandWarrantyCopy.mismatchBadge, tone: .orange, icon: "alert")
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
        let input = deviceInput(for: d, status: status)
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

    /// The full `DeviceInput` for a save that is not the form: a status tap or
    /// the brand-check sheet. `PATCH /api/v1/devices/{id}` replaces every field,
    /// so each preserved block below is load-bearing — omitting one erases data
    /// recorded on the web or on Android.
    private func deviceInput(for d: Device, status: DeviceStatus) -> DeviceInput {
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
        // The currency trio is full-replacement too. A status tap must never
        // re-denominate the stored price: without these two the server would
        // read the row back as VND and a $999 device would become 999 ₫.
        input.currency = d.currencyCode
        // A VND row must send a null rate (the server rejects VND + rate); a
        // foreign row sends the rate it was stored with, untouched.
        input.fxRate = CurrencyRules.requiresRate(d.currency) ? d.fxRate : nil
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
        // The activation trio is a full-replacement field too: without this a
        // status tap would erase "cần kích hoạt", the activation date and the
        // extended-cover deadline recorded on another client.
        WarrantyActivation.apply(WarrantyActivation.carried(from: d), to: &input)
        // …and the same is true of the resale pair (migration 0006): tapping a
        // status is not a reason to lose a sale recorded on the web or Android.
        // Both halves travel together, or — for a device that was never sold —
        // neither does, which the encoder omits.
        DeviceResale.apply(DeviceResale.carried(from: d), to: &input)
        // The brand warranty lookup is the newest full-replacement block: a
        // status tap or an unrelated edit must not erase what the user recorded
        // from the brand's page. `brandWarrantyFields` is the fresh list
        // projection; `recordBrandWarranty` overrides it with the fresh answer.
        BrandWarrantyRules.apply(brandWarrantyFields, to: &input)
        return input
    }

    /// Persist the sheet's answer and re-read the detail, so the server-computed
    /// `warrantyMismatch` (and the brand fields) update in place.
    private func recordBrandWarranty(_ fields: BrandWarrantyFields) async throws {
        let d = currentDevice
        var input = deviceInput(for: d, status: d.status)
        BrandWarrantyRules.apply(fields, to: &input)
        _ = try await devicesStore.update(id: d.id, input)
        await store.load()
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

// MARK: - Device route destination

/// Resolves a device **id** into the screen that owns it.
///
/// A dashboard reminder, a stats "top device" row, an action-queue row and a
/// push notification all carry an id; `DeviceDetailView` and `DeviceFormView`
/// need a loaded `Device`. This view loads the list inline and then shows the
/// real screen.
///
/// Two things it deliberately does not do:
///
///   * **it never pushes a bare spinner.** `ProgressView` was the destination
///     for the dashboard and stats rows, which is why a tap looked like a
///     broken screen that never resolved;
///   * **it never spins forever.** A device deleted on another phone (or an id
///     from a stale reminder) is stated as "not found" with a retry, and a read
///     that failed is stated as a failure — the same nil ≠ empty ≠ error split
///     `ActionQueueScreen` uses.
///
/// `mode: .edit` is what the action queue's "Ghi hạn" shortcut uses: the
/// device form is where the return window is recorded.
struct DeviceRouteDestination: View {
    let client: APIClient
    @ObservedObject var store: DevicesStore
    let deviceId: String
    var mode: Mode = .detail

    enum Mode { case detail, edit }

    /// True once the resolve attempt finished, so "not found" is never claimed
    /// while the read is still running.
    @State private var didAttempt = false

    private var device: Device? { store.devices.first(where: { $0.id == deviceId }) }

    var body: some View {
        Group {
            if let device {
                switch mode {
                case .detail:
                    DeviceDetailView(client: client, devicesStore: store, device: device)
                case .edit:
                    DeviceFormView(client: client, store: store, device: device)
                }
            } else if didAttempt, case let .error(message) = store.state {
                // The read failed. Say that, not "not found": the device may
                // well exist and the list simply never arrived.
                ScrollView {
                    WVEmpty(icon: "alert",
                            title: L.t("Không tải được thiết bị"),
                            description: message) {
                        WVButton(L.t("Thử lại")) { Task { await resolve(force: true) } }
                            .padding(.horizontal, 32)
                    }
                }
                .wvScreen()
            } else if didAttempt {
                ScrollView {
                    WVEmpty(icon: "package",
                            title: L.t("Không tìm thấy thiết bị này."),
                            description: L.t("Thiết bị có thể đã bị xoá trên máy khác.")) {
                        WVButton(L.t("Thử lại"), kind: .secondary) {
                            Task { await resolve(force: true) }
                        }
                        .padding(.horizontal, 32)
                    }
                }
                .wvScreen()
            } else {
                ScrollView { DeviceDetailSkeleton() }
                    .wvScreen()
            }
        }
        .task { await resolve(force: false) }
    }

    /// One read. A forced resolve is what the retry buttons use; otherwise the
    /// already-loaded list is reused, so opening a row does not re-fetch the
    /// account's devices on every tap.
    private func resolve(force: Bool) async {
        if !force {
            if device != nil { didAttempt = true; return }
            // The list answered and this id is not in it. A retry can still be
            // asked for by hand.
            if case .loaded = store.state { didAttempt = true; return }
        }
        await store.load()
        didAttempt = true
    }
}

// MARK: - Device detail skeleton

/// The detail screen's shape while the router resolves which device to draw.
/// Static and redacted, like the other skeletons in the app — the point is a
/// surface that looks like the destination, not a spinner in an empty page.
private struct DeviceDetailSkeleton: View {
    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 12) {
                Circle()
                    .fill(WVColor.fill3)
                    .frame(width: 64, height: 64)
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(WVColor.fill3)
                    .frame(width: 170, height: 18)
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(WVColor.fill3)
                    .frame(width: 110, height: 12)
            }
            .padding(.vertical, 24)
            .frame(maxWidth: .infinity)

            WVGroup {
                ForEach(0..<3) { i in
                    if i > 0 { WVDivider(inset: 60) }
                    HStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(WVColor.fill3)
                            .frame(width: 30, height: 30)
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(WVColor.fill3)
                            .frame(height: 14)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .redacted(reason: .placeholder)
                }
            }
        }
        .padding(.top, 8)
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

    /// The nine optional contract fields, already reduced to the presentation
    /// rules. `hasAnyTerms` guards the whole block, so a warranty with no
    /// contract renders exactly as before.
    private var terms: WarrantyTerms { warranty.terms }

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
            // Contract terms when the row has any. Compact: this card is the
            // overview, the full terms live in the warranty list below.
            if terms.hasAnyTerms {
                WarrantyTermsBlock(terms: terms, compact: true)
                    .padding(.top, 2)
            }
        }
    }
}

// MARK: - Warranty list row

private struct WarrantyListRow: View {
    let warranty: Warranty

    /// Same derived terms as the timeline row. Rendered below the existing
    /// three-fragment subtitle only when there is something to show, so a
    /// no-terms row is byte-for-byte the old layout.
    private var terms: WarrantyTerms { warranty.terms }

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
                // Full contract terms: component (or "Toàn bộ máy"), cap and
                // deductible as money, claims used out of allowed, scope,
                // region, transferability and exclusions. Absent for a row with
                // no terms, which therefore looks exactly as before.
                if terms.hasAnyTerms {
                    WarrantyTermsBlock(terms: terms)
                        .padding(.top, 2)
                }
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
