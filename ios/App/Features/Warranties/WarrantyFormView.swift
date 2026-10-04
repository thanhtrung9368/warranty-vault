import SwiftUI
import WarrantyVaultKit

// ============================================================
// WarrantyFormView — add / edit a warranty (pushed as a screen)
//
// Replaces WarrantyEditorSheet.swift.
// All business logic preserved; UI ported to the new DS.
// ============================================================

struct WarrantyFormView: View {
    @ObservedObject var store: WarrantiesStore
    let warranty: Warranty?

    @EnvironmentObject private var catalog: CatalogStore
    @Environment(\.dismiss) private var dismiss

    // Fields
    @State private var type: WarrantyType
    @State private var provider: String
    @State private var startDate: Date
    @State private var months: String
    @State private var cost: Int?
    @State private var address: String
    @State private var phone: String
    @State private var notes: String

    // UI state
    @State private var isSubmitting = false
    @State private var topError: String?
    @State private var fieldErrors: [String: [String]] = [:]
    @State private var showDiscardAlert = false

    private var isEditing: Bool { warranty != nil }

    init(store: WarrantiesStore, warranty: Warranty?) {
        self.store = store
        self.warranty = warranty
        _type = State(initialValue: warranty?.type ?? .STANDARD)
        _provider = State(initialValue: warranty?.provider ?? "")
        _startDate = State(initialValue: warranty?.startDate ?? Date())
        _months = State(initialValue: warranty.map { String($0.months) } ?? "12")
        _cost = State(initialValue: warranty?.cost)
        _address = State(initialValue: warranty?.address ?? "")
        _phone = State(initialValue: warranty?.phone ?? "")
        _notes = State(initialValue: warranty?.notes ?? "")
    }

    // MARK: - Validation

    private var isValid: Bool { (Int(months) ?? 0) >= 1 }

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
                    HStack(spacing: 12) {
                        Text(L.t("Hãng BH"))
                            .font(.system(size: 17))
                            .foregroundStyle(WVColor.label)
                            .frame(width: 80, alignment: .leading)
                        TextField(L.t("Apple Việt Nam..."), text: $provider)
                            .font(.system(size: 17))
                            .foregroundStyle(WVColor.label)
                            .multilineTextAlignment(.trailing)
                            .autocorrectionDisabled()
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .padding(.vertical, 7)

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
                                            .font(.system(size: 12, weight: .medium))
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
                            .font(.system(size: 12))
                            .foregroundStyle(WVColor.red)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                    }

                    WVDivider()

                    // Start date
                    HStack(spacing: 12) {
                        Text(L.t("Ngày BĐ"))
                            .font(.system(size: 17))
                            .foregroundStyle(WVColor.label)
                            .frame(width: 80, alignment: .leading)
                        Spacer()
                        DatePicker("", selection: $startDate, displayedComponents: .date)
                            .labelsHidden()
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .padding(.vertical, 7)

                    WVDivider()

                    // Months
                    HStack(spacing: 12) {
                        Text(L.t("Số tháng"))
                            .font(.system(size: 17))
                            .foregroundStyle(WVColor.label)
                            .frame(width: 80, alignment: .leading)
                        TextField("12", text: $months)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .font(.system(size: 17))
                            .foregroundStyle(WVColor.label)
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .padding(.vertical, 7)

                    if let errs = fieldErrors["months"], let msg = errs.first {
                        WVDivider()
                        Text(msg)
                            .font(.system(size: 12))
                            .foregroundStyle(WVColor.red)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                    }

                    WVDivider()

                    // Cost
                    HStack(spacing: 12) {
                        Text(L.t("Phí gói"))
                            .font(.system(size: 17))
                            .foregroundStyle(WVColor.label)
                            .frame(width: 80, alignment: .leading)
                        WVMoneyField(value: $cost, placeholder: L.t("Tuỳ chọn"))
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .padding(.vertical, 7)
                }

                // Contact
                WVSectionHeader(L.t("Liên hệ"))
                WVGroup {
                    HStack(spacing: 12) {
                        Text(L.t("SĐT"))
                            .font(.system(size: 17))
                            .foregroundStyle(WVColor.label)
                            .frame(width: 80, alignment: .leading)
                        TextField("1800-...", text: $phone)
                            .keyboardType(.phonePad)
                            .multilineTextAlignment(.trailing)
                            .font(.system(size: 17))
                            .foregroundStyle(WVColor.label)
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .padding(.vertical, 7)

                    WVDivider()

                    TextField(L.t("Địa chỉ trung tâm"), text: $address, axis: .vertical)
                        .font(.system(size: 17))
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
                        .font(.system(size: 17))
                        .foregroundStyle(WVColor.label)
                        .lineLimit(2...6)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 44)
                        .padding(.vertical, 10)
                }

                // Error banner
                if let topError {
                    Text(topError)
                        .font(.system(size: 13))
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
                    .font(.system(size: 17, weight: .semibold))
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
        .task { await catalog.loadIfNeeded() }
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
