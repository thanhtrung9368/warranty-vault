import SwiftUI
import UIKit
import WarrlyKit

// ============================================================
// DeviceDetailView — device detail screen
//
// Ported from project/ios/js/screens-1.jsx, re-cut to the visual direction:
// the hero leads with the deadline (§6), not with a 64 pt category icon.
// Deadline hero + receipt strip + attachment rows + info groups + the
// warranty/repair disclosure.
// Edit → push DeviceFormView; add/edit warranty → push WarrantyFormView.
// ============================================================

struct DeviceDetailView: View {
    let client: APIClient
    @ObservedObject var devicesStore: DevicesStore
    let device: Device

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @StateObject private var store: WarrantiesStore
    /// The device's receipts, shared by the hero strip and the full section.
    @StateObject private var attachmentsModel: DeviceAttachmentsModel

    /// The warranty/repair apparatus is one disclosure, collapsed by default:
    /// it is the second tier of this screen, not the answer to "am I covered?".
    @State private var warrantyRepairExpanded: Bool
    /// Screenshot-QA only: setting this to `warrantyRepairAnchor` scrolls the
    /// disclosure to the top. `nil` at every other time, so normal scrolling is
    /// untouched.
    @State private var qaScrollTarget: String?

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
        _attachmentsModel = StateObject(
            wrappedValue: DeviceAttachmentsModel(client: client, deviceId: device.id)
        )
        _deviceStatus = State(initialValue: device.status)
        _warrantyRepairExpanded = State(initialValue: Self.qaWarrantyRepairExpanded)
    }

    /// Screenshot-QA only: `WV_QA_EXPAND_WARRANTY_REPAIR=1` starts the
    /// warranty/repair disclosure open, and `WV_QA_SCROLL_TO_WARRANTY=1`
    /// scrolls it to the top after the first read. DEBUG-only, like the other
    /// `WV_QA_*` hooks: a physical tap cannot be injected into a headless
    /// simulator, and the expanded state is exactly what needs photographing at
    /// Accessibility sizes.
    private static var qaWarrantyRepairExpanded: Bool {
#if DEBUG
        ProcessInfo.processInfo.environment["WV_QA_EXPAND_WARRANTY_REPAIR"] == "1"
#else
        false
#endif
    }

    // MARK: - Computed

    private var currentDevice: Device {
        devicesStore.devices.first(where: { $0.id == device.id }) ?? device
    }

    private var warranties: [Warranty] { store.warranties }
    private var attachments: [AttachmentMeta] { attachmentsModel.attachments }

    /// `true` once the detail read has landed.
    ///
    /// Section headers that print a count use this: `0/5` before the read is a
    /// false state (the list is empty because nothing arrived, not because the
    /// device has none), while after the read `0` is a fact worth showing.
    private var detailLoaded: Bool { store.state == .loaded }

    /// The furthest warranty end, from the server. Used by the handover
    /// checklist's "know the warranty end date" line; `nil` means the app
    /// genuinely does not know, and the checklist says so rather than inventing
    /// a date.
    ///
    /// The **server** answers this on both reads and only over whole-unit rows
    /// (`openapi.yaml` `DeviceWithEffectiveWarranty`), so a component-scoped
    /// warranty — a fridge's ten-year motor cover — cannot become the device's
    /// end. Order: the detail read, then the list projection, and only then the
    /// local `StatsRollup` helper, which exists for a device this process has
    /// not re-read since it was created or edited.
    private var effectiveWarrantyEnd: Date? {
        store.device?.effectiveWarrantyEnd
            ?? currentDevice.effectiveWarrantyEnd
            ?? StatsRollup.effectiveWarrantyEnd(warranties)
    }

    /// The legal, **display-only** end of the device's warranty: the effective
    /// end plus the duration of this device's closed repairs (Luật 19/2023,
    /// Điều 30.2.c — repair time is not counted against the warranty period).
    ///
    /// `nil` before the detail read lands, because until then `store.claims`
    /// is empty for "not read yet", not "no claims". Showing `+0` in that
    /// window would be a claim the data cannot support; the hero falls back to
    /// the raw server date, which is exactly today's behaviour. Once loaded,
    /// `hasExtension == false` means the two dates are the same.
    ///
    /// Never written anywhere: `Warranty.endDate` and the server's reminder
    /// schedule stay untouched. See `WarrantyRepairAdjustment`.
    private var repairExtension: WarrantyRepairExtension? {
        guard detailLoaded, let end = effectiveWarrantyEnd else { return nil }
        return WarrantyRepairAdjustment.adjust(rawEnd: end, claims: store.claims)
    }

    /// The date the hero shows: adjusted when there is a repair extension,
    /// the server's own end otherwise.
    private var displayedWarrantyEnd: Date? {
        guard let end = effectiveWarrantyEnd else { return nil }
        if let extension_ = repairExtension, extension_.hasExtension {
            return extension_.adjustedEnd
        }
        return end
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
                // Hero section — name, warranty end date, day count, receipts.
                heroSection

                // Receipts: the strip in the hero is the viewing surface; this
                // is the managing one (add, describe, delete). It sits directly
                // under the strip it feeds, not at the bottom of the page.
                WVSectionHeader(attachmentsModel.hasLoaded
                    ? L.t("File đính kèm (%d/5)", attachmentsModel.attachments.count)
                    : L.t("File đính kèm"))
                DeviceAttachmentsSection(client: client, model: attachmentsModel)

                // The warranty/repair apparatus — warranty packages, brand
                // lookup, claims, contacts, the pre-service checklist, the
                // service directory and the handover certificate — is one
                // collapsed disclosure. Each block keeps its own card and
                // header inside; together they were six of this screen's
                // sixteen sections, which made a device with two facts read
                // like a document. The mismatch signal is not lost: the hero
                // carries an orange chip while this is closed.
                WVDisclosure(
                    title: L.t("Bảo hành & sửa chữa"),
                    subtitle: L.t("Gói bảo hành, sửa chữa, liên hệ, bàn giao và chia sẻ"),
                    icon: "shieldCheck",
                    isExpanded: $warrantyRepairExpanded
                ) {
                    // The per-package progress cards are the overview; the
                    // list below is where a package is added or edited.
                    if !warranties.isEmpty {
                        warrantyTimelineCard
                            .padding(.top, WVSpacing.sm)
                    }

                    // Warranty packages.
                    //
                    // The count is only printed once the detail read has
                    // landed. Before that `warranties` is empty because
                    // *nothing has been read yet*, not because the device has
                    // none — "(0/5)" there is a claim it cannot support.
                    WVSectionHeader(detailLoaded
                        ? L.t("Bảo hành (%d/5)", warranties.count)
                        : L.t("Bảo hành"))
                    warrantyListGroup

                    // Brand warranty lookup ("Đối chiếu với hãng"). Its
                    // mismatch is the one fact that can change what the user
                    // believes about the warranty, which is why the hero chip
                    // repeats it while this block is closed.
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

                    // Repairs ("Sửa chữa & bảo hành"). A claim belongs to a
                    // device, so the device detail is its anchor. When the
                    // device is marked BROKEN and no claim is open, the
                    // section's inline nudge is the way out of the dead end.
                    ClaimsSection(store: store, device: currentDevice, client: client)

                    // Warranty contact group (if phones/addresses present)
                    let contactWarranties = warranties.filter { $0.phone != nil || $0.address != nil }
                    if !contactWarranties.isEmpty {
                        WVSectionHeader(L.t("Liên hệ bảo hành"))
                        WVGroup {
                            ForEach(Array(contactWarranties.enumerated()), id: \.element.id) { _, w in
                                if let phone = w.phone {
                                    WVDivider()
                                    WVRow(icon: "phone",
                                          title: phone,
                                          subtitle: w.provider,
                                          chevron: true,
                                          action: { openURL("tel:\(phone)") })
                                }
                                if let address = w.address {
                                    WVDivider()
                                    WVRow(icon: "mapPin",
                                          title: address,
                                          subtitle: w.provider,
                                          chevron: true,
                                          action: { openURL("https://maps.google.com/?q=\(address.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")") })
                                }
                            }
                        }
                    }

                    // Pre-service handover checklist. It sits with the
                    // warranty contact details because that is the moment the
                    // user is about to hand the machine over; the list itself
                    // is generated per device and ticked in memory only.
                    WVSectionHeader(L.t("Trước khi đi bảo hành"))
                    WVSectionFooter(L.t("Danh sách nhắc bạn gỡ khoá, sao lưu, chuẩn bị giấy tờ và kiểm tra máy khi nhận lại — những việc quyết định chuyến đi có thành công hay không."))
                    WVGroup {
                        WVRow(icon: "checklist",
                              title: L.t("Danh sách bàn giao trước khi sửa"),
                              subtitle: L.t("Chỉ tick trong phiên này, không lưu lên máy chủ"),
                              chevron: true,
                              action: { showServiceChecklist = true })
                    }

                    // Where to actually take the machine (FEATURE_IDEAS #15).
                    // Its own read: a failure to load it must not look like
                    // "the app has no information".
                    ServiceDirectorySection(
                        client: client,
                        deviceId: currentDevice.id
                    )

                    // The handover certificate (FEATURE_IDEAS #2). The link
                    // exists to be handed to a buyer, so it is offered with the
                    // warranty contact details rather than with the receipts.
                    ShareCertificatesSection(
                        client: client,
                        deviceId: currentDevice.id,
                        deviceName: currentDevice.name
                    )
                }
                .modifier(WVQAScrollAnchor())

                // Info group — purchase. Every row here is a read-only fact: a
                // neutral 20 pt glyph in the standard 28 pt tile, the label, and
                // the value in the `rowValue` role (17 medium, `label3`).
                WVSectionHeader(L.t("Mua hàng"))
                WVGroup {
                    DeviceFactRow(icon: "calendar",
                                  title: L.t("Ngày mua"),
                                  detail: WVFormat.date(currentDevice.purchaseDate))
                    if let window = returnWindowDisplay {
                        WVDivider()
                        // Read-only: this is the server's own derived deadline
                        // (`COALESCE(receivedAt, purchaseDate) + returnWindowDays`),
                        // never recomputed here. There is no input for the window
                        // length on purpose — see `DeviceReturnWindow`.
                        DeviceFactRow(icon: "arrowDown",
                                      title: L.t("Hạn đổi/trả"),
                                      subtitle: window.note,
                                      detail: window.value)
                    }
                    WVDivider()
                    DeviceFactRow(icon: "wallet",
                                  title: L.t("Giá mua"),
                                  subtitle: purchasePriceDisplay.subtitle,
                                  detail: purchasePriceDisplay.detail)
                    if currentDevice.usesForeignCurrency {
                        WVDivider()
                        // The locked rate, stated so the two prices above make
                        // sense together. It is history, not a live quote.
                        DeviceFactRow(icon: "globe",
                                      title: L.t("Tiền tệ"),
                                      subtitle: currentDevice.fxRate.map {
                                          L.t("1 %@ = %@", currentDevice.currencyCode, WVFormat.rate($0))
                                      },
                                      detail: currentDevice.currencyCode)
                    }
                    WVDivider()
                    DeviceFactRow(icon: "store",
                                  title: L.t("Nơi mua"),
                                  detail: currentDevice.purchasePlace ?? "—")
                    WVDivider()
                    DeviceFactRow(icon: "hash",
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
                            DeviceFactRow(
                                icon: activation.state == .requiredNotActivated
                                    ? "shieldX" : "shieldCheck",
                                title: L.t("Kích hoạt"),
                                detail: status
                            )
                        }
                        if let day = activation.buyByDay {
                            if activation.status != nil { WVDivider() }
                            DeviceFactRow(icon: "calendar",
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
                        DeviceFactRow(icon: "clock",
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
                            DeviceFactRow(icon: "calendar",
                                          title: L.t("Ngày bán"),
                                          detail: day)
                        }
                        if let price = sale.price {
                            if sale.day != nil { WVDivider() }
                            DeviceFactRow(icon: "wallet",
                                          title: L.t("Giá bán"),
                                          subtitle: soldPriceVndDisplay,
                                          detail: WVFormat.currency(price, currentDevice.currency))
                        }
                        if let profit = sale.profit {
                            WVDivider()
                            WVRowContainer {
                                HStack(spacing: WVSpacing.md) {
                                    WVLeadingIcon(
                                        icon: profit.tone == .loss ? "trendingDown" : "trendingUp",
                                        size: 28
                                    )
                                    Text(L.t("Lãi/lỗ so với giá mua"))
                                        .wvFont(.body)
                                        .foregroundStyle(WVColor.label)
                                    Spacer(minLength: WVSpacing.sm)
                                    // "Lãi 2.000.000 ₫" / "Lỗ 500.000 ₫" / "Hoà vốn"
                                    // — the same wording web and Android render.
                                    // The word carries the verdict: money is
                                    // never red or green (§5.2).
                                    Text(profit.label)
                                        .wvFont(.body, weight: .medium)
                                        .foregroundStyle(WVColor.label)
                                }
                            }
                        }
                    }
                }

                // Note
                if let note = currentDevice.notes, !note.isEmpty {
                    WVSectionHeader(L.t("Ghi chú"))
                    WVGroup {
                        Text(note)
                            .wvFont(.body)
                            .foregroundStyle(WVColor.label)
                            .lineSpacing(4)
                            .padding(.horizontal, WVSpacing.gutter)
                            .frame(minHeight: 44)
                            .padding(.vertical, WVSpacing.sm)
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
                    VStack(alignment: .leading, spacing: WVSpacing.xs) {
                        ForEach(Array(statusWarnings.enumerated()), id: \.offset) { _, warning in
                            HStack(alignment: .top, spacing: WVSpacing.sm) {
                                WVIcon("alert", size: 12)
                                    .foregroundStyle(WVColor.orange)
                                Text("\(warning.fieldLabel): \(warning.displayMessage)")
                                    .wvFont(.footnote)
                                    .foregroundStyle(WVColor.label2)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Text(DeviceWarningCopy.savedNote)
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.label3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, WVSpacing.gutter)
                    .padding(.top, WVSpacing.sm)
                }

                // Delete row. Red text, and red only as text: a 20 pt red glyph
                // and a red label with no tile behind them (§8.2). A destructive
                // row is the one place red belongs outside a date (§5.2).
                WVGroup {
                    WVRowContainer(action: { showDeleteAlert = true }) {
                        HStack(spacing: WVSpacing.md) {
                            WVIcon("trash", size: 20)
                                .foregroundStyle(WVColor.red)
                            Text(L.t("Xoá thiết bị"))
                                .wvFont(.body)
                                .foregroundStyle(WVColor.red)
                            Spacer(minLength: WVSpacing.sm)
                        }
                    }
                }
                .padding(.top, WVSpacing.gutter)

                if let actionError {
                    Text(actionError)
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.red)
                        .padding(.horizontal, WVSpacing.gutter)
                        .padding(.top, WVSpacing.sm)
                }

                Spacer().frame(height: WVSpacing.xl)
            }
            .modifier(WVQAScrollTargetLayout())
        }
        // QA screenshots scroll the disclosure's top to the top of the scroll
        // view. The translucent nav bar may sit over the card's rounded
        // corners, but the header's text is below it and stays whole.
        .modifier(WVQAScrollPosition(target: $qaScrollTarget))
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
                    // Neutral, not coral: this screen's one coral action is the
                    // dashed "Thêm" receipt tile in the hero, and a coral "..."
                    // was one of the four meanings §5.1 removes.
                    Image(systemName: "ellipsis.circle")
                        .wvFont(.body)
                        .foregroundStyle(WVColor.label)
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
            // The purchase date seeds the start-date default and is the value
            // the form discloses a conflict against.
            WarrantyFormView(store: store, warranty: nav.warranty,
                             currency: currentDevice.currencyCode,
                             purchaseDate: currentDevice.purchaseDate)
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
        .task {
            await store.load()
            // The hero strip has its own read so a receipt is visible before
            // the rest of the detail lands; the full section shares the result.
            await attachmentsModel.loadIfNeeded()
#if DEBUG
            // Screenshot-QA only. Wait for the attachments read (and the
            // receipt decode that follows it) before moving, so the anchor's
            // final position is the one used.
            if ProcessInfo.processInfo.environment["WV_QA_SCROLL_TO_WARRANTY"] == "1" {
                try? await Task.sleep(nanoseconds: 600_000_000)
                qaScrollTarget = warrantyRepairAnchor
            }
#endif
        }
        .refreshable {
            await store.load()
            await attachmentsModel.reload()
        }
    }

    // MARK: - Hero section

    private var heroSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: WVSpacing.md) {
                // The name is the deadline's caption, not a second title
                // competing with the navigation bar: one line, 20 semibold, a
                // 20 pt neutral glyph in front of it. The 64 pt coral tile and
                // the status chip are gone — the deadline block below already
                // says the state, and coral belongs to the one action (§5.1).
                HStack(spacing: WVSpacing.md) {
                    WVIcon(WVCategory.icon(for: currentDevice.category),
                           size: 20, weight: .regular)
                        .foregroundStyle(WVColor.label2)
                        .accessibilityHidden(true)
                    Text(currentDevice.name)
                        .wvFont(.title3Emphasis)
                        .foregroundStyle(WVColor.label)
                        // One line at every content size; at Accessibility
                        // sizes the name wraps instead of clipping.
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !deviceModelLine.isEmpty {
                    Text(deviceModelLine)
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                        .fixedSize(horizontal: false, vertical: true)
                }

                heroDeadlineBlock

                // The one chip on this screen, and the one fact that can change
                // what the user believes about the warranty. Amber, never red.
                if brandWarrantyMismatch != nil {
                    WVChip(BrandWarrantyCopy.mismatchBadge, tone: .orange, icon: "alert")
                }
            }
            .padding(.horizontal, WVSpacing.gutter)
            .padding(.top, WVSpacing.xxl)
            .padding(.bottom, WVSpacing.gutter)
            .frame(maxWidth: .infinity, alignment: .leading)

            // The receipt, where the eye lands — directly under the deadline,
            // not as the fourteenth section of sixteen. Its behaviour is fixed
            // (§9.1); the tile gap is the only thing that changed, 10 → 12.
            ReceiptStrip(client: client, model: attachmentsModel)

            Spacer().frame(height: WVSpacing.gutter)
        }
    }

    /// `Apple · iPhone 16 Pro Max 256GB`, or an empty string when neither is
    /// recorded.
    private var deviceModelLine: String {
        [currentDevice.brand, currentDevice.model]
            .compactMap { $0 }
            .joined(separator: " · ")
    }

    // MARK: - Hero deadline block

    /// The lead surface of §6: eyebrow, 28 pt day count, absolute date.
    ///
    /// Three literal lines — `Bảo hành` at 13 semibold `label3`, the day count
    /// at 28 bold in the state colour, `Hết hạn 20/09/2027` at 13 `label3`. It
    /// is deliberately **not** `WarrantyPill`: that is the row form, and past 90
    /// days it prints the date in `label3`, which is exactly the line this
    /// block already carries under the number.
    ///
    /// When this device has closed repairs, the date and the countdown are the
    /// **legal** ones (`raw end + repair days`), and the two lines under them
    /// say why and that the retailer has not necessarily agreed. The server's
    /// raw date is still printed in the warranty card inside the disclosure, so
    /// the user sees both numbers rather than a silently moved date.
    @ViewBuilder
    private var heroDeadlineBlock: some View {
        VStack(alignment: .leading, spacing: WVSpacing.xs) {
            Text(DeadlineCopy.kindLabel(.warranty))
                .wvFont(.footnoteEmphasis)
                .foregroundStyle(WVColor.label3)

            Text(heroDeadlineLead)
                .wvFont(.statValue)
                .foregroundStyle(heroDeadlineColor)
                .fixedSize(horizontal: false, vertical: true)

            if let end = displayedWarrantyEnd {
                Text(DeadlineCopy.dateLabel(kind: .warranty, dateText: WVFormat.date(end)))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let extension_ = repairExtension, extension_.hasExtension {
                Text(WarrantyRepairAdjustment.addedDaysLabel(extension_.days))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)
                Text(WarrantyRepairAdjustment.legalNote)
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// `còn 324 ngày` / `Hết hạn hôm nay` / `Đã hết hạn` — §6's grammar, at
    /// 28 pt instead of row size.
    ///
    /// A **sold** device short-circuits to `Đã bán`: it is not a deadline, and
    /// `WarrantyPill` has no `sold` input at all (the row form leaves that case
    /// to the list screen). No recorded date is `Chưa ghi hạn`, never a
    /// countdown the data cannot support.
    private var heroDeadlineLead: String {
        if currentDevice.status == .SOLD { return L.t("Đã bán") }
        guard let end = displayedWarrantyEnd else { return L.t("Chưa ghi hạn") }
        let days = WVFormat.daysUntil(end)
        switch WarrantyPillCopy.status(daysLeft: days) {
        case .expired:     return L.t("Đã hết hạn")
        case .danger:      return days == 0 ? L.t("Hết hạn hôm nay") : L.p("còn %d ngày", days)
        case .warn, .safe: return L.p("còn %d ngày", days)
        }
    }

    /// The lead's colour: the state scale at large size. Green is the "> 90
    /// days" state **on a lead surface** (§5.2 and the brief's correction E) —
    /// the row form prints a grey date instead. Gray is sold or past; `label4`
    /// is "no date", which is not a state.
    private var heroDeadlineColor: Color {
        if currentDevice.status == .SOLD { return WVColor.label3 }
        guard let end = displayedWarrantyEnd else { return WVColor.label4 }
        return WarrantyPillCopy.status(daysLeft: WVFormat.daysUntil(end)).heroColor
    }

    // MARK: - Warranty timeline card

    private var warrantyTimelineCard: some View {
        WVCard(padding: WVSpacing.gutter) {
            VStack(alignment: .leading, spacing: WVSpacing.gutter) {
                Text(L.t("Tổng quan bảo hành"))
                    .wvFont(.subheadlineEmphasis)
                    .foregroundStyle(WVColor.label)
                ForEach(Array(warranties.enumerated()), id: \.element.id) { idx, w in
                    if idx > 0 {
                        Rectangle().fill(WVColor.sep).frame(height: 0.5)
                    }
                    WarrantyTimelineRow(warranty: w)
                }

                // The per-package rows above keep the **server's** dates: they
                // are per package, while the legal extension is per device. The
                // device-level adjusted end is stated once here, with the raw
                // date it came from, so the hero and this card cannot look like
                // two unrelated numbers.
                if let extension_ = repairExtension, extension_.hasExtension {
                    Rectangle().fill(WVColor.sep).frame(height: 0.5)
                    VStack(alignment: .leading, spacing: WVSpacing.xs) {
                        Text(L.t("Hạn điều chỉnh: %@ (gốc %@)",
                                 WVFormat.date(extension_.adjustedEnd),
                                 WVFormat.date(extension_.rawEnd)))
                            .wvFont(.footnoteEmphasis)
                            .foregroundStyle(WVColor.green)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(WarrantyRepairAdjustment.addedDaysLabel(extension_.days))
                            .wvFont(.caption)
                            .foregroundStyle(WVColor.label3)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(WarrantyRepairAdjustment.legalNote)
                            .wvFont(.caption)
                            .foregroundStyle(WVColor.label3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    // MARK: - Warranty list group

    private var warrantyListGroup: some View {
        WVGroup {
            let canAdd = warranties.count < 5
            ForEach(Array(warranties.enumerated()), id: \.element.id) { idx, w in
                if idx > 0 { WVDivider() }
                NavigationLink(value: WarrantyFormNav(warranty: w)) {
                    WarrantyListRow(warranty: w)
                }
                .buttonStyle(WVRowButtonStyle())
            }
            if canAdd {
                if !warranties.isEmpty { WVDivider() }
                NavigationLink(value: WarrantyFormNav(warranty: nil)) {
                    // Neutral, with a chevron for the affordance: the one coral
                    // action on this screen is the receipt strip's "Thêm" tile
                    // (§5.1), not every "add" row on the page.
                    DeviceFactRow(icon: "plus",
                                  title: L.t("Thêm gói bảo hành"),
                                  chevron: true)
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

// MARK: - Screenshot-QA scroll plumbing

#if DEBUG
/// The disclosure's scroll anchor. DEBUG-only so the Release binary contains
/// neither the hook's identity nor its string.
private let warrantyRepairAnchor = "warranty-repair-disclosure"
#endif

/// Gives the disclosure a scroll identity only in DEBUG. In Release this is
/// the identity modifier.
private struct WVQAScrollAnchor: ViewModifier {
    func body(content: Content) -> some View {
#if DEBUG
        content.id(warrantyRepairAnchor)
#else
        content
#endif
    }
}

/// Marks the scroll targets only in DEBUG. In Release this is the identity
/// modifier, so the layout carries no state for a screenshot hook.
private struct WVQAScrollTargetLayout: ViewModifier {
    func body(content: Content) -> some View {
#if DEBUG
        content.scrollTargetLayout()
#else
        content
#endif
    }
}

/// Applies the screenshot-QA scroll binding only in DEBUG. In Release this is
/// the identity modifier, so ordinary scrolling never writes `@State`.
private struct WVQAScrollPosition: ViewModifier {
    @Binding var target: String?

    func body(content: Content) -> some View {
#if DEBUG
        content.scrollPosition(id: $target, anchor: .top)
#else
        content
#endif
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
                            .padding(.horizontal, WVSpacing.gutter)
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
                        .padding(.horizontal, WVSpacing.gutter)
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
///
/// Its *shape* follows the new hero (§9.2 allows that, the behaviour may not
/// change): 20 pt glyph + name, then the three deadline lines, then the first
/// group of rows. The old 64 pt circle promised an icon the screen no longer has.
private struct DeviceDetailSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: WVSpacing.md) {
                HStack(spacing: WVSpacing.md) {
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(WVColor.fill3)
                        .frame(width: 20, height: 20)
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(WVColor.fill3)
                        .frame(width: 170, height: 20)
                }
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(WVColor.fill3)
                    .frame(width: 64, height: 13)
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(WVColor.fill3)
                    .frame(width: 150, height: 28)
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(WVColor.fill3)
                    .frame(width: 120, height: 13)
            }
            .padding(.horizontal, WVSpacing.gutter)
            .padding(.top, WVSpacing.xxl)
            .padding(.bottom, WVSpacing.gutter)
            .frame(maxWidth: .infinity, alignment: .leading)

            WVGroup {
                ForEach(0..<3) { i in
                    if i > 0 { WVDivider() }
                    HStack(spacing: WVSpacing.md) {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(WVColor.fill3)
                            .frame(width: 28, height: 28)
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(WVColor.fill3)
                            .frame(height: 14)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, WVSpacing.gutter)
                    .padding(.vertical, WVSpacing.sm)
                    .redacted(reason: .placeholder)
                }
            }
        }
    }
}

// MARK: - Fact row

/// One read-only fact row of this screen: `Mua hàng`, `Nhắc nhở`, the activation
/// rows, the resale pair and the "Thêm gói bảo hành" affordance.
///
/// Same geometry as `WVRow` — neutral 28 pt tile with its 20 pt `label2` glyph,
/// 12 pt gap, 16 pt row inset, 44 pt floor, 8 pt vertical padding — plus the two
/// roles §8.2 asks for and `WVRow` does not carry: the trailing value is
/// `rowValue` (17 **medium**, `label3`, §2) and the title keeps layout priority
/// so it is never the thing that truncates first (§10.3 check 8).
private struct DeviceFactRow: View {
    var icon: String?
    let title: String
    var subtitle: String?
    var detail: String?
    var chevron: Bool = false

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var titleText: some View {
        Text(title)
            .wvFont(.body)
            .foregroundStyle(WVColor.label)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var subtitleText: some View {
        Text(subtitle ?? "")
            .wvFont(.footnote)
            .foregroundStyle(WVColor.label3)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var detailText: some View {
        Text(detail ?? "")
            .wvFont(.body, weight: .medium)
            .foregroundStyle(WVColor.label3)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                accessible
            } else {
                regular
            }
        }
        .padding(.horizontal, WVSpacing.gutter)
        .frame(minHeight: 44)
        .padding(.vertical, WVSpacing.sm)
        .contentShape(Rectangle())
    }

    private var regular: some View {
        HStack(spacing: WVSpacing.md) {
            if let icon { WVLeadingIcon(icon: icon, size: 28) }
            VStack(alignment: .leading, spacing: 1) {
                titleText.lineLimit(1)
                if subtitle != nil { subtitleText.lineLimit(1) }
            }
            // The label is what must survive; the value may scale to fit.
            .layoutPriority(1)
            Spacer(minLength: WVSpacing.sm)
            if detail != nil { detailText }
            if chevron {
                WVIcon("arrowRight", size: 13, weight: .semibold)
                    .foregroundStyle(WVColor.label4)
            }
        }
    }

    /// At Accessibility sizes the trailing value steals the width the label
    /// needs, so it moves onto its own line under it — the same split `WVRow`
    /// makes, so a fact row and a shared row still look like one list.
    private var accessible: some View {
        VStack(alignment: .leading, spacing: WVSpacing.xs) {
            HStack(alignment: .top, spacing: WVSpacing.md) {
                if let icon { WVLeadingIcon(icon: icon, size: 28) }
                VStack(alignment: .leading, spacing: 1) {
                    titleText.lineLimit(3)
                    if subtitle != nil { subtitleText.lineLimit(3) }
                }
                .layoutPriority(1)
                if chevron {
                    WVIcon("arrowRight", size: 13, weight: .semibold)
                        .foregroundStyle(WVColor.label4)
                }
            }
            if let detail {
                Text(detail)
                    .wvFont(.body, weight: .medium)
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, icon == nil ? 0 : 40)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Warranty timeline row

private struct WarrantyTimelineRow: View {
    let warranty: Warranty

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

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

    private var typeLabel: String {
        switch warranty.type {
        case .STANDARD:    return L.t("BH chính hãng")
        case .EXTENDED:    return L.t("BH mở rộng")
        case .THIRD_PARTY: return L.t("BH bên thứ 3")
        }
    }

    /// The package type as text, not a filled chip: pills are gone from content
    /// (§4), and a type is identity, not state (§5.2).
    private var typeText: some View {
        Text(typeLabel)
            .wvFont(.footnoteEmphasis)
            .foregroundStyle(WVColor.label2)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: WVSpacing.sm) {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: WVSpacing.xs) {
                    typeText
                    if let provider = warranty.provider {
                        Text(provider)
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.label3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    WarrantyPill(daysLeft: daysLeft, endDate: warranty.endDate)
                }
            } else {
                HStack(alignment: .center, spacing: WVSpacing.sm) {
                    typeText
                    if let provider = warranty.provider {
                        Text(provider)
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.label3)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        Spacer(minLength: 0)
                    }
                    WarrantyPill(daysLeft: daysLeft, endDate: warranty.endDate)
                }
            }
            WVProgressBar(value: progressValue, tone: progressTone)
            HStack {
                Text(WVFormat.date(warranty.startDate))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
                Spacer()
                Text(WVFormat.date(warranty.endDate))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
            }
            // Contract terms when the row has any. Compact: this card is the
            // overview, the full terms live in the warranty list below.
            if terms.hasAnyTerms {
                WarrantyTermsBlock(terms: terms, compact: true)
                    .padding(.top, WVSpacing.xs)
            }
        }
    }
}

// MARK: - Warranty list row

private struct WarrantyListRow: View {
    let warranty: Warranty

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    /// Same derived terms as the timeline row. Rendered below the existing
    /// three-fragment subtitle only when there is something to show, so a
    /// no-terms row is byte-for-byte the old layout.
    private var terms: WarrantyTerms { warranty.terms }

    private var typeLabel: String {
        switch warranty.type {
        case .STANDARD:    return L.t("BH chính hãng")
        case .EXTENDED:    return L.t("BH mở rộng")
        case .THIRD_PARTY: return L.t("BH bên thứ 3")
        }
    }

    var body: some View {
        HStack(spacing: WVSpacing.md) {
            // Neutral tile, as every other row's icon is: a warranty type is
            // identity, and colour is reserved for state (§5.1).
            WVLeadingIcon(icon: "shieldCheck", size: 28)
            VStack(alignment: .leading, spacing: WVSpacing.xs) {
                Text(warranty.provider ?? typeLabel)
                    .wvFont(.bodyEmphasis)
                    .foregroundStyle(WVColor.label)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                    .fixedSize(horizontal: false, vertical: true)
                // Joined from three fragments rather than one template: the
                // English month count inflects ("1 month" / "24 months") and a
                // `%d` inside a whole sentence could not do that. Vietnamese
                // renders exactly as before.
                Text([typeLabel,
                      L.p("%d tháng", warranty.months),
                      L.t("Hết %@", WVFormat.date(warranty.endDate))]
                        .joined(separator: " · "))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                    .fixedSize(horizontal: false, vertical: true)
                // Full contract terms: component (or "Toàn bộ máy"), cap and
                // deductible as money, claims used out of allowed, scope,
                // region, transferability and exclusions. Absent for a row with
                // no terms, which therefore looks exactly as before.
                if terms.hasAnyTerms {
                    WarrantyTermsBlock(terms: terms)
                        .padding(.top, WVSpacing.xs)
                }
            }
            Spacer(minLength: WVSpacing.sm)
            WVIcon("arrowRight", size: 13)
                .foregroundStyle(WVColor.label4)
        }
        .padding(.horizontal, WVSpacing.gutter)
        .frame(minHeight: 44)
        .padding(.vertical, WVSpacing.sm)
        .contentShape(Rectangle())
    }
}

// MARK: - Days helper (no warrantyEndDate available without separate store load)

private func warrantyDaysLeft(_ w: Warranty) -> Int {
    WVFormat.daysUntil(w.endDate)
}

// MARK: - Deadline tone

/// The deadline tone, as a colour. `WarrantyPillCopy` lives in the Kit and knows
/// no SwiftUI colors; the hero's 28 pt lead uses the same
/// safe/warn/danger/expired mapping, so the lead and the rows cannot disagree
/// about urgency — only about how the "> 90 days" state is drawn (§5.2: green
/// on a lead surface, a grey absolute date in a row).
private extension WarrantyPillCopy.Status {
    var heroColor: Color {
        switch self {
        case .safe:    return WVColor.green
        case .warn:    return WVColor.orange
        case .danger:  return WVColor.red
        case .expired: return WVColor.label3
        }
    }
}
