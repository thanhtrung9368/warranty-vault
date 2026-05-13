import SwiftUI
import WarrantyVaultKit

struct WarrantyEditorSheet: View {
    @ObservedObject var store: WarrantiesStore
    let warranty: Warranty?

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var catalog: CatalogStore

    @State private var type: WarrantyType
    @State private var provider: String
    @State private var startDate: Date
    @State private var months: String
    @State private var cost: String
    @State private var address: String
    @State private var phone: String
    @State private var notes: String

    @State private var isSubmitting = false
    @State private var topError: String?
    @State private var fieldErrors: [String: [String]] = [:]

    init(store: WarrantiesStore, warranty: Warranty?) {
        self.store = store
        self.warranty = warranty
        _type = State(initialValue: warranty?.type ?? .STANDARD)
        _provider = State(initialValue: warranty?.provider ?? "")
        _startDate = State(initialValue: warranty?.startDate ?? Date())
        _months = State(initialValue: warranty.map { String($0.months) } ?? "12")
        _cost = State(initialValue: warranty?.cost.map { String($0) } ?? "")
        _address = State(initialValue: warranty?.address ?? "")
        _phone = State(initialValue: warranty?.phone ?? "")
        _notes = State(initialValue: warranty?.notes ?? "")
    }

    private var isEditing: Bool { warranty != nil }

    var body: some View {
        NavigationStack {
            Form {
                Section(header: sectionHeader("Loại bảo hành")) {
                    Picker("Loại", selection: $type) {
                        ForEach(WarrantyType.allCases, id: \.self) { t in
                            Text(t.label).tag(t)
                        }
                    }
                }

                Section(header: sectionHeader("Thông tin gói")) {
                    TextField("Đơn vị bảo hành", text: $provider)
                    AutocompleteChips(
                        suggestions: providerSuggestions.map(\.name),
                        text: $provider,
                        onPick: { name in prefillFromProvider(named: name) }
                    )
                    if let errs = fieldErrors["provider"], let msg = errs.first {
                        Text(msg).font(.system(size: 12)).foregroundStyle(WV.Tokens.destructive)
                    }
                    DatePicker("Ngày bắt đầu", selection: $startDate, displayedComponents: .date)
                    TextField("Số tháng", text: $months)
                        .keyboardType(.numberPad)
                    if let errs = fieldErrors["months"], let msg = errs.first {
                        Text(msg).font(.system(size: 12)).foregroundStyle(WV.Tokens.destructive)
                    }
                    TextField("Phí gói (VND, tuỳ chọn)", text: $cost)
                        .keyboardType(.numberPad)
                }

                Section(header: sectionHeader("Liên hệ")) {
                    TextField("Số điện thoại", text: $phone)
                        .keyboardType(.phonePad)
                    TextField("Địa chỉ trung tâm", text: $address, axis: .vertical)
                        .lineLimit(1...3)
                }

                Section(header: sectionHeader("Ghi chú")) {
                    TextField("Ghi chú (tuỳ chọn)", text: $notes, axis: .vertical)
                        .lineLimit(2...5)
                }

                if let topError {
                    Section {
                        Label(topError, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(WV.Tokens.destructive)
                            .font(.system(size: 13))
                    }
                }
            }
            .navigationTitle(isEditing ? "Sửa bảo hành" : "Thêm bảo hành")
            .navigationBarTitleDisplayMode(.inline)
            .task { await catalog.loadIfNeeded() }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Huỷ") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await submit() } } label: {
                        if isSubmitting { ProgressView() } else { Text("Lưu").bold() }
                    }
                    .disabled(isSubmitting || (Int(months) ?? 0) < 1)
                }
            }
        }
    }

    private var providerSuggestions: [WarrantyProviderOption] {
        Array(catalog.warrantyProviders(matching: provider).prefix(8))
    }

    private func prefillFromProvider(named name: String) {
        guard let opt = catalog.warrantyProviders.first(where: { $0.name == name }) else { return }
        if phone.isEmpty, let p = opt.phone { phone = p }
        if address.isEmpty, let a = opt.address { address = a }
    }

    private func submit() async {
        topError = nil; fieldErrors = [:]
        isSubmitting = true
        defer { isSubmitting = false }

        let isoDate = ISO8601DateFormatter.dayOnly.string(from: startDate)
        var input = WarrantyInput(
            type: type, startDate: isoDate, months: Int(months) ?? 0
        )
        input.provider = provider.isEmpty ? nil : provider
        input.cost = Int(cost)
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
