import SwiftUI
import WarrlyKit

// ============================================================
// WarrantyFormView — add / edit a warranty (pushed as a screen)
//
// Replaces WarrantyEditorSheet.swift.
// All business logic preserved; UI ported to the new DS.
// ============================================================

struct WarrantyFormView: View {
    @ObservedObject var store: WarrantiesStore
    let warranty: Warranty?

    /// The owning device's ISO currency, so the fee field says what unit the
    /// typed number is in. `Warranty.cost` follows the device's currency, not
    /// VND; passing it here is purely informational (`nil` renders VND, the
    /// contract default).
    let currency: String?

    /// When the device was bought — the start date this form opens with.
    ///
    /// A device bought last Tết must not get a warranty that starts today: the
    /// resulting end date would be more than a year late and the app would tell
    /// the user they are covered when they are not. `nil` means the device has
    /// no purchase information, and only then does today become the default.
    let purchaseDate: Date?

    @EnvironmentObject private var catalog: CatalogStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    // Fields
    @State private var type: WarrantyType
    @State private var provider: String
    @State private var startDate: Date
    @State private var months: String
    @State private var cost: Int?
    @State private var address: String
    @State private var phone: String
    @State private var notes: String

    // Contract terms ("Điều khoản hợp đồng"). Nine fields that most plans do
    // not have, kept behind a disclosure so the everyday form — type, dates,
    // provider, fee — never grows by nine rows.
    @State private var component: String
    @State private var scope: String
    @State private var cap: Int?
    @State private var deductible: Int?
    @State private var exclusions: String
    @State private var region: String
    @State private var transferable: TransferableChoice
    @State private var claimsAllowed: String
    @State private var claimsUsed: String

    // UI state
    @State private var isSubmitting = false
    @State private var isDeleting = false
    @State private var topError: String?
    @State private var fieldErrors: [String: [String]] = [:]
    @State private var showDiscardAlert = false
    @State private var showDeleteAlert = false

    /// Collapsed by default when all nine terms are empty, expanded when any is
    /// set. The decision uses the same `WarrantyTerms.hasAnyTerms` rule the
    /// detail rows use, so "the form shows the section" and "the row shows the
    /// terms" can never disagree about whether a contract exists.
    @State private var termsExpanded: Bool

    private var isEditing: Bool { warranty != nil }

    init(store: WarrantiesStore, warranty: Warranty?, currency: String? = nil,
         purchaseDate: Date? = nil) {
        self.store = store
        self.warranty = warranty
        self.currency = currency
        self.purchaseDate = purchaseDate
        _type = State(initialValue: warranty?.type ?? .STANDARD)
        _provider = State(initialValue: warranty?.provider ?? "")
        // The purchase date is the default *because* it is when cover normally
        // starts; `today` is the fallback for a device with no purchase
        // information, never the first choice. Editing an existing plan keeps
        // the stored start date untouched.
        _startDate = State(initialValue: warranty?.startDate
            ?? WarrantyFormRules.defaultStartDate(purchaseDate: purchaseDate))
        _months = State(initialValue: warranty.map { String($0.months) }
            ?? String(WarrantyFormRules.defaultMonths))
        _cost = State(initialValue: warranty?.cost)
        _address = State(initialValue: warranty?.address ?? "")
        _phone = State(initialValue: warranty?.phone ?? "")
        _notes = State(initialValue: warranty?.notes ?? "")

        let terms = warranty.map { WarrantyTerms($0) } ?? WarrantyTerms()
        _component = State(initialValue: terms.component ?? "")
        _scope = State(initialValue: terms.scope ?? "")
        _cap = State(initialValue: terms.cap)
        _deductible = State(initialValue: terms.deductible)
        _exclusions = State(initialValue: terms.exclusions ?? "")
        _region = State(initialValue: terms.region ?? "")
        _transferable = State(initialValue: TransferableChoice(terms.transferable))
        _claimsAllowed = State(initialValue: terms.claimsAllowed.map(String.init) ?? "")
        _claimsUsed = State(initialValue: terms.claimsUsed.map(String.init) ?? "")
        _termsExpanded = State(initialValue: terms.hasAnyTerms)
    }

    // MARK: - Validation

    private var isValid: Bool {
        (Int(months) ?? 0) >= 1 && !currentTerms.hasClaimsConflict
    }

    /// The nine fields as the pure derived-presentation type, rebuilt from the
    /// live form state. One source of truth for the section's collapsed
    /// summary, the client-side claims check and the save payload.
    private var currentTerms: WarrantyTerms {
        WarrantyTerms(
            component: component,
            scope: scope,
            cap: cap,
            deductible: deductible,
            exclusions: exclusions,
            region: region,
            transferable: transferable.value,
            claimsAllowed: Int(claimsAllowed),
            claimsUsed: Int(claimsUsed)
        )
    }

    // MARK: - Dates

    /// One label + control row of the everyday form.
    ///
    /// At default sizes it is the existing fixed-label HStack. At Accessibility
    /// sizes the label moves **above** the control: an 80 pt label column at
    /// AX3 can only hold one letter per line, and the compact `DatePicker`
    /// would otherwise force the whole form wider than the screen. The control
    /// still gets the full width underneath.
    @ViewBuilder
    private func formRow<Content: View>(
        _ label: String,
        width: CGFloat = 80,
        @ViewBuilder content: () -> Content
    ) -> some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 6) {
                    Text(label)
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                    content()
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                HStack(spacing: 12) {
                    Text(label)
                        .wvFont(.body)
                        .foregroundStyle(WVColor.label)
                        .frame(width: width, alignment: .leading)
                    content()
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .padding(.vertical, 7)
    }

    /// The end date the server will derive from the two fields above it, shown
    /// live so a typo in the month count is visible before the save. `nil` for
    /// an empty/non-positive month field — the same rule that disables the CTA.
    private var computedEndDate: Date? {
        WarrantyFormRules.endDate(startDate: startDate, months: Int(months) ?? 0)
    }

    /// The purchase-date disagreement, surfaced but never blocking. A plan can
    /// legitimately start before or after the purchase (an extended plan bought
    /// later, cover backdated by the retailer), so this is a disclosure with a
    /// one-tap way back to the purchase date — not validation.
    private var dateConflict: WarrantyDateConflict? {
        WarrantyFormRules.conflict(startDate: startDate, purchaseDate: purchaseDate)
    }

    // MARK: - Suggestions

    private var providerSuggestions: [WarrantyProviderOption] {
        Array(catalog.warrantyProviders(matching: provider).prefix(8))
    }

    private func prefillFromProvider(named name: String) {
        guard let opt = catalog.warrantyProviders.first(where: { $0.name == name }) else { return }
        if phone.isEmpty, let p = opt.phone { phone = p }
        if address.isEmpty, let a = opt.address { address = a }
    }

    // MARK: - Type helpers

    private func typeTone(_ t: WarrantyType) -> WVChipTone {
        switch t {
        case .STANDARD:    return .brand
        case .EXTENDED:    return .purple
        case .THIRD_PARTY: return .blue
        }
    }

    private func typeLabel(_ t: WarrantyType) -> String {
        switch t {
        case .STANDARD:    return L.t("BH chính hãng")
        case .EXTENDED:    return L.t("BH mở rộng")
        case .THIRD_PARTY: return L.t("BH bên thứ 3")
        }
    }

    // MARK: - Body

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Spacer().frame(height: 8)

                // Warranty type picker
                WVSectionHeader(L.t("Loại bảo hành"))
                WVGroup {
                    ForEach(Array(WarrantyType.allCases.enumerated()), id: \.element) { idx, t in
                        if idx > 0 { WVDivider() }
                        Button {
                            type = t
                        } label: {
                            HStack(spacing: 12) {
                                WVChip(typeLabel(t), tone: typeTone(t))
                                Spacer()
                                if type == t {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(WVColor.tint)
                                        .font(.system(size: 15, weight: .semibold))
                                }
                            }
                            .padding(.horizontal, 16)
                            .frame(minHeight: 44)
                            .padding(.vertical, 7)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(WVRowButtonStyle())
                    }
                }

                // Package details
                WVSectionHeader(L.t("Thông tin gói"))
                WVGroup {
                    // Provider with autocomplete
                    formRow(L.t("Hãng BH")) {
                        TextField(L.t("Apple Việt Nam..."), text: $provider)
                            .wvFont(.body)
                            .foregroundStyle(WVColor.label)
                            .multilineTextAlignment(dynamicTypeSize.isAccessibilitySize
                                                    ? .leading : .trailing)
                            .autocorrectionDisabled()
                    }

                    if !providerSuggestions.isEmpty {
                        WVDivider()
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: WVSpacing.xs) {
                                ForEach(providerSuggestions) { s in
                                    Button {
                                        provider = s.name
                                        prefillFromProvider(named: s.name)
                                    } label: {
                                        Text(s.name)
                                            .wvFont(.caption, weight: .medium)
                                            .padding(.horizontal, 10)
                                            .padding(.vertical, 6)
                                            .background(WVColor.fill3)
                                            .foregroundStyle(WVColor.label2)
                                            .clipShape(Capsule())
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 6)
                        }
                    }

                    if let errs = fieldErrors["provider"], let msg = errs.first {
                        WVDivider()
                        Text(msg)
                            .wvFont(.caption)
                            .foregroundStyle(WVColor.red)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                    }

                    WVDivider()

                    // Start date
                    formRow(L.t("Ngày BĐ")) {
                        DatePicker("", selection: $startDate, displayedComponents: .date)
                            .labelsHidden()
                            // Same cap as the device form: the compact picker's
                            // intrinsic width (≈399 pt at AX3) is wider than
                            // the card interior and would push the whole form
                            // off-centre. The value stays readable; only this
                            // one system control is capped.
                            .dynamicTypeSize(...DynamicTypeSize.accessibility1)
                    }

                    WVDivider()

                    // Months
                    formRow(L.t("Số tháng")) {
                        TextField("12", text: $months)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(dynamicTypeSize.isAccessibilitySize
                                                    ? .leading : .trailing)
                            .wvFont(.body)
                            .foregroundStyle(WVColor.label)
                    }

                    // The 12 is a default, not an assertion: say so where the
                    // user can still change it. The create-device wizard labels
                    // its own pre-filled 12 the same way.
                    Text(L.t("Mặc định 12 tháng — đổi nếu hoá đơn ghi thời hạn khác."))
                        .wvFont(.caption)
                        .foregroundStyle(WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    if let errs = fieldErrors["months"], let msg = errs.first {
                        WVDivider()
                        Text(msg)
                            .wvFont(.caption)
                            .foregroundStyle(WVColor.red)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                    }

                    WVDivider()

                    // Live end date. The server derives `startDate + months`
                    // when no explicit end date is sent, so this is what the
                    // save will store — not an estimate.
                    formRow(L.t("Ngày kết thúc (dự kiến)"), width: 180) {
                        Text(computedEndDate.map(WVFormat.date) ?? "—")
                            .wvFont(.bodyEmphasis)
                            .foregroundStyle(computedEndDate == nil ? WVColor.label3 : WVColor.label)
                            .lineLimit(nil)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Text(L.t("Tính từ ngày bắt đầu + số tháng; máy chủ sẽ lưu đúng ngày này."))
                        .wvFont(.caption)
                        .foregroundStyle(WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    // The purchase date is the default, so a disagreement is
                    // either a deliberate choice (an extended plan bought
                    // later) or a mistake. Either way it must not pass
                    // silently: state the gap and offer the purchase date back.
                    if let conflict = dateConflict, let purchaseDate {
                        WVDivider()
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(alignment: .top, spacing: 8) {
                                WVIcon("alert", size: 14)
                                    .foregroundStyle(WVColor.orange)
                                    .padding(.top, 1)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(conflict.label)
                                        .wvFont(.footnoteEmphasis)
                                        .foregroundStyle(WVColor.orange)
                                        .fixedSize(horizontal: false, vertical: true)
                                    Text(L.t("Ngày mua thiết bị: %@", WVFormat.date(purchaseDate)))
                                        .wvFont(.caption)
                                        .foregroundStyle(WVColor.label3)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                            WVButton(L.t("Dùng ngày mua"), kind: .secondary,
                                     size: .small, fullWidth: false) {
                                startDate = purchaseDate
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    WVDivider()

                    // Cost. `Warranty.cost` is in the device's currency, so the
                    // field groups digits the same way and names the unit next
                    // to the number — a $99 plan must not read like 99 ₫.
                    formRow(L.t("Phí gói")) {
                        HStack(spacing: 8) {
                            WVMoneyField(value: $cost, placeholder: L.t("Tuỳ chọn"),
                                         groupingSeparator: CurrencyRules.groupingSeparator(for: currency))
                            if CurrencyRules.requiresRate(currency) {
                                Text(CurrencyRules.normalized(currency))
                                    .wvFont(.footnoteEmphasis)
                                    .foregroundStyle(WVColor.label3)
                            }
                        }
                    }
                }

                // Contact
                WVSectionHeader(L.t("Liên hệ"))
                WVGroup {
                    formRow(L.t("SĐT")) {
                        TextField("1800-...", text: $phone)
                            .keyboardType(.phonePad)
                            .multilineTextAlignment(dynamicTypeSize.isAccessibilitySize
                                                    ? .leading : .trailing)
                            .wvFont(.body)
                            .foregroundStyle(WVColor.label)
                    }

                    WVDivider()

                    TextField(L.t("Địa chỉ trung tâm"), text: $address, axis: .vertical)
                        .wvFont(.body)
                        .foregroundStyle(WVColor.label)
                        .lineLimit(1...4)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 44)
                        .padding(.vertical, 10)
                }

                // Notes
                WVSectionHeader(L.t("Ghi chú"))
                WVGroup {
                    TextField(L.t("Ghi chú (tuỳ chọn)"), text: $notes, axis: .vertical)
                        .wvFont(.body)
                        .foregroundStyle(WVColor.label)
                        .lineLimit(2...6)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 44)
                        .padding(.vertical, 10)
                }

                // Contract terms. Collapsed by default unless the saved row
                // already carries one. Everything that is true for every plan
                // stays above this line; a user who never opens a contract
                // never sees the nine fields.
                contractTermsSection

                // Error banner
                if let topError {
                    Text(topError)
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.red)
                        .padding(.horizontal, 32)
                        .padding(.top, 8)
                }

                // CTA
                VStack(spacing: 0) {
                    WVButton(
                        isEditing ? L.t("Lưu thay đổi") : L.t("Thêm bảo hành"),
                        icon: isEditing ? "save" : "plus",
                        kind: isValid ? .primary : .secondary
                    ) {
                        Task { await submit() }
                    }
                    .disabled(!isValid || isSubmitting)
                    .padding(.horizontal, WVSpacing.gutter)
                    .padding(.vertical, 20)
                }

                // Delete this plan (edit only). It lives here because this is
                // where a user goes to fix a plan — and it is one push away
                // from the device, so removing a mistyped warranty never means
                // leaving the device first. `WarrantiesStore.delete` was
                // implemented and unreachable until this row existed.
                //
                // Always behind a confirmation: the server deletes the row
                // outright, and a mistyped plan must not be permanent.
                if isEditing {
                    WVGroup {
                        WVRow(icon: "trash", iconColor: WVColor.red,
                              title: L.t("Xoá gói bảo hành"),
                              role: .destructive) {
                            showDeleteAlert = true
                        }
                        .disabled(isDeleting || isSubmitting)
                    }
                    .padding(.top, 4)

                    if isDeleting {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .padding(.top, 8)
                    }
                }

                Spacer().frame(height: 24)
            }
        }
        .wvScreen()
        .navigationTitle(isEditing ? L.t("Sửa bảo hành") : L.t("Thêm bảo hành"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(L.t("Huỷ")) { showDiscardAlert = true }
                    .foregroundStyle(WVColor.tint)
            }
            ToolbarItem(placement: .topBarTrailing) {
                if isSubmitting {
                    ProgressView()
                } else {
                    Button(isEditing ? L.t("Lưu") : L.t("Thêm")) {
                        Task { await submit() }
                    }
                    .wvFont(.bodyEmphasis)
                    .foregroundStyle(isValid ? WVColor.tint : WVColor.label3)
                    .disabled(!isValid)
                }
            }
        }
        .alert(L.t("Bỏ thay đổi?"), isPresented: $showDiscardAlert) {
            Button(L.t("Tiếp tục sửa"), role: .cancel) {}
            Button(L.t("Bỏ"), role: .destructive) { dismiss() }
        } message: {
            Text(L.t("Tất cả thông tin đã nhập sẽ mất."))
        }
        .alert(L.t("Xoá gói bảo hành?"), isPresented: $showDeleteAlert) {
            Button(L.t("Huỷ"), role: .cancel) {}
            Button(L.t("Xoá"), role: .destructive) { Task { await deleteWarranty() } }
        } message: {
            Text(L.t("Gói này sẽ bị xoá vĩnh viễn khỏi thiết bị. Không thể hoàn tác."))
        }
        .task { await catalog.loadIfNeeded() }
    }

    // MARK: - Contract terms

    /// The collapsible "Điều khoản hợp đồng" section.
    ///
    /// Design decision: the nine fields are a contract appendix, not part of
    /// the everyday answer ("this device is covered until March"). They live in
    /// their own disclosure below the fields every warranty has:
    ///
    ///  * **collapsed by default when all nine are empty** — a user who does
    ///    not care about payout caps never sees nine extra rows in an add form
    ///    that used to have eight;
    ///  * **expanded when any is set** — editing an existing contract must show
    ///    it, otherwise the form would silently hide data it is about to send;
    ///  * the header itself is the control (the chevron turns), and when the
    ///    user collapses a section that has content, the component title stays
    ///    in the header so the saved contract is still discoverable.
    ///
    /// The open/closed decision is `WarrantyTerms.hasAnyTerms`, the same rule
    /// the device-detail row uses, and `claimsUsed == 0` does not count — the
    /// server sends 0 for every warranty, so counting it would leave the
    /// section permanently expanded for everybody.
    private var contractTermsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.18)) { termsExpanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Text(L.t("Điều khoản hợp đồng").uppercased())
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(WVColor.label3)
                        .rotationEffect(.degrees(termsExpanded ? 90 : 0))
                    Spacer(minLength: 8)
                    if !termsExpanded, currentTerms.hasAnyTerms {
                        Text(currentTerms.componentTitle)
                            .wvFont(.caption)
                            .foregroundStyle(WVColor.label3)
                            .lineLimit(1)
                    }
                }
                .padding(.horizontal, 32)
                .padding(.top, 20)
                .padding(.bottom, 6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L.t("Điều khoản hợp đồng"))

            if termsExpanded {
                WVGroup {
                    componentRow
                    WVDivider()
                    termsTextFieldRow(label: L.t("Phạm vi"),
                                      placeholder: L.t("Ví dụ: lỗi kỹ thuật"),
                                      text: $scope,
                                      lines: 1...3,
                                      limit: 500)
                    WVDivider()
                    termsMoneyRow(L.t("Mức tối đa"), value: $cap)
                    WVDivider()
                    termsMoneyRow(L.t("Khấu trừ"), value: $deductible)
                    WVDivider()
                    termsTextFieldRow(label: L.t("Loại trừ"),
                                      placeholder: L.t("Ví dụ: rơi vỡ, vào nước"),
                                      text: $exclusions,
                                      lines: 2...4,
                                      limit: 500)
                    WVDivider()
                    termsTextFieldRow(label: L.t("Khu vực"),
                                      placeholder: L.t("Ví dụ: Toàn quốc"),
                                      text: $region,
                                      lines: 1...1,
                                      limit: 200)
                    WVDivider()
                    transferableRow
                    WVDivider()
                    termsCountRow(L.t("Số lần BH"), text: $claimsAllowed)
                    WVDivider()
                    termsCountRow(L.t("Đã dùng"), text: $claimsUsed)

                    // The server's one cross-field rule, stated locally before
                    // a round trip: used > allowed is a 400 on
                    // `fieldErrors.claimsUsed`.
                    if currentTerms.hasClaimsConflict {
                        WVDivider()
                        Text(L.t("Số lần đã dùng không được lớn hơn số lần cho phép."))
                            .wvFont(.caption)
                            .foregroundStyle(WVColor.red)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    if let msg = termsFieldError {
                        WVDivider()
                        Text(msg)
                            .wvFont(.caption)
                            .foregroundStyle(WVColor.red)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                WVSectionFooter(L.t("Lấy từ hợp đồng bảo hành. Để trống ô Bộ phận nếu gói áp dụng cho toàn bộ máy."))
            }
        }
    }

    private var componentRow: some View {
        termsTextFieldRow(label: L.t("Bộ phận"),
                          placeholder: L.t("Ví dụ: Pin"),
                          text: $component,
                          lines: 1...1,
                          limit: 200)
    }

    /// The first server error among the nine fields, shown once beneath the
    /// group. The contract limits are real (`component`/`region` 200 runes,
    /// `scope`/`exclusions` 500, non-negative money and counts); the form stops
    /// the length cases at the keystroke and surfaces anything else the server
    /// refuses here, next to the fields it belongs to.
    private var termsFieldError: String? {
        let keys = ["component", "scope", "cap", "deductible", "exclusions",
                    "region", "transferable", "claimsAllowed", "claimsUsed"]
        for key in keys {
            if let message = fieldErrors[key]?.first { return message }
        }
        return nil
    }

    /// Text field with its label above it. Component / scope / exclusions /
    /// region can all be sentences, so they get full width rather than a
    /// squeezed trailing field next to a label. `limit` mirrors the rune caps
    /// in the contract (`component`/`region` 200, `scope`/`exclusions` 500) and
    /// is enforced as the user types, so a very long contract note cannot be
    /// typed and then rejected. Counted in Unicode scalars, which is what Go's
    /// `[]rune` counts — a grapheme-cluster count would let a decomposed string
    /// through that the server then refuses.
    private func termsTextFieldRow(label: String,
                                   placeholder: String,
                                   text: Binding<String>,
                                   lines: ClosedRange<Int>,
                                   limit: Int) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .wvFont(.footnote)
                .foregroundStyle(WVColor.label3)
            TextField(placeholder, text: text, axis: .vertical)
                .wvFont(.body)
                .foregroundStyle(WVColor.label)
                .lineLimit(lines)
                .autocorrectionDisabled()
                .onChange(of: text.wrappedValue) { _, newValue in
                    guard newValue.unicodeScalars.count > limit else { return }
                    var truncated = String.UnicodeScalarView()
                    truncated.append(contentsOf: newValue.unicodeScalars.prefix(limit))
                    text.wrappedValue = String(truncated)
                }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// VND row, matching the existing "Phí gói" input: nil (empty) stays nil
    /// on the wire, and 0 — a real answer — is typed as 0.
    private func termsMoneyRow(_ label: String, value: Binding<Int?>) -> some View {
        formRow(label, width: 110) {
            WVMoneyField(value: value, placeholder: L.t("Tuỳ chọn"))
        }
    }

    /// Small non-negative count (claims). Empty means "not recorded": for
    /// `claimsAllowed` that is nil (unbounded); for `claimsUsed` the wire
    /// default of 0 is written by `WarrantyTerms.apply`.
    private func termsCountRow(_ label: String, text: Binding<String>) -> some View {
        formRow(label, width: 110) {
            TextField(L.t("Tuỳ chọn"), text: text)
                .keyboardType(.numberPad)
                .multilineTextAlignment(dynamicTypeSize.isAccessibilitySize
                                        ? .leading : .trailing)
                .wvFont(.body)
                .foregroundStyle(WVColor.label)
        }
    }

    /// Three-state transferable switch. A plain `Toggle` has only two states,
    /// so it could not tell "the contract does not say" (null) from "no" — and
    /// an automatic `false` here would make every saved warranty look like it
    /// has a contract term. "Chưa đặt" keeps the key out of the payload.
    private var transferableRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(L.t("Chuyển nhượng"))
                .wvFont(.footnote)
                .foregroundStyle(WVColor.label3)
            WVSegmented(
                options: TransferableChoice.allCases.map { (value: $0, label: $0.label) },
                selection: $transferable
            )
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Delete

    /// Deletes the plan currently being edited.
    ///
    /// `WarrantiesStore.delete` removes it from the shared `warranties` list, so
    /// the device detail screen this form was pushed from already shows the new
    /// count and list when we pop back — no extra reload, and no stale row.
    private func deleteWarranty() async {
        guard let warranty else { return }
        topError = nil
        isDeleting = true
        defer { isDeleting = false }
        do {
            try await store.delete(id: warranty.id)
            dismiss()
        } catch let err as APIError {
            topError = err.localizedDescription
        } catch {
            topError = error.localizedDescription
        }
    }

    // MARK: - Submit

    private func submit() async {
        topError = nil; fieldErrors = [:]
        isSubmitting = true
        defer { isSubmitting = false }

        // The picker's `Date` is zoned; `startDate` is a bare calendar day on the
        // wire. Written in the device's own zone — the one the picker drew — or a
        // device east of the formatter's pin stores the day before the one shown.
        let isoDate = WireDay.string(from: startDate)
        var input = WarrantyInput(type: type, startDate: isoDate, months: Int(months) ?? 0)
        input.provider = provider.isEmpty ? nil : provider
        input.cost = cost
        input.address = address.isEmpty ? nil : address
        input.phone = phone.isEmpty ? nil : phone
        input.notes = notes.isEmpty ? nil : notes
        // The nine contract-term fields are a full-replacement block too: the
        // form sends what it loaded, so a save from this screen cannot clear a
        // contract recorded on the web or on Android. `claimsUsed` is always
        // sent because 0 is its contract default.
        currentTerms.apply(to: &input)

        do {
            if let warranty {
                try await store.update(id: warranty.id, input)
            } else {
                _ = try await store.create(input)
            }
            dismiss()
        } catch let err as APIError {
            topError = err.localizedDescription
            fieldErrors = err.fieldErrors
        } catch {
            topError = error.localizedDescription
        }
    }
}

// MARK: - Transferable choice

/// The tri-state value of the nullable `transferable` wire field.
///
/// `Bool?` cannot be expressed by a `Toggle` without inventing a `false`, and
/// `false` is a real contract term ("không chuyển nhượng được") that must stay
/// distinguishable from "the contract does not say". The segmented control in
/// the terms section is this enum, and `.unset` simply leaves the key out.
private enum TransferableChoice: String, CaseIterable, Hashable {
    case unset
    case yes
    case no

    var label: String {
        switch self {
        case .unset: return L.t("Chưa đặt")
        case .yes:   return L.t("Có")
        case .no:    return L.t("Không")
        }
    }

    var value: Bool? {
        switch self {
        case .unset: return nil
        case .yes:   return true
        case .no:    return false
        }
    }

    init(_ value: Bool?) {
        switch value {
        case .none:      self = .unset
        case .some(true):  self = .yes
        case .some(false): self = .no
        }
    }
}
