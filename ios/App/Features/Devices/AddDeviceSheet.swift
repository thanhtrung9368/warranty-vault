import SwiftUI
import WarrantyVaultKit

struct AddDeviceSheet: View {
    @ObservedObject var store: DevicesStore
    let client: APIClient
    /// When non-nil the sheet is in edit mode.
    let editing: Device?

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var catalog: CatalogStore

    @State private var name: String
    @State private var category: String
    @State private var brand: String
    @State private var model: String
    @State private var serialNumber: String
    @State private var purchasePlace: String
    @State private var purchaseDate: Date
    @State private var purchasePrice: String
    @State private var warrantyMonths: String
    @State private var notes: String
    @State private var status: DeviceStatus

    @State private var isSubmitting = false
    @State private var topError: String?
    @State private var fieldErrors: [String: [String]] = [:]

    init(store: DevicesStore, client: APIClient, editing: Device? = nil) {
        self.store = store
        self.client = client
        self.editing = editing
        _name = State(initialValue: editing?.name ?? "")
        _category = State(initialValue: editing?.category ?? "PHONE")
        _brand = State(initialValue: editing?.brand ?? "")
        _model = State(initialValue: editing?.model ?? "")
        _serialNumber = State(initialValue: editing?.serialNumber ?? "")
        _purchasePlace = State(initialValue: editing?.purchasePlace ?? "")
        _purchaseDate = State(initialValue: editing?.purchaseDate ?? Date())
        _purchasePrice = State(initialValue: editing.map { String($0.purchasePrice) } ?? "")
        // warrantyMonths only applies on create (server creates an initial Warranty row).
        // Editing a device doesn't touch warranties — they're managed per-warranty on detail.
        _warrantyMonths = State(initialValue: editing == nil ? "12" : "0")
        _notes = State(initialValue: editing?.notes ?? "")
        _status = State(initialValue: editing?.status ?? .ACTIVE)
    }

    private var isEditing: Bool { editing != nil }

    private var categoryOptions: [CategoryOption] {
        catalog.categories.isEmpty ? Self.fallbackCategories : catalog.categories
    }

    /// Brand options filtered to the currently-selected category code, narrowed
    /// further by what the user is typing in the brand field.
    private var brandSuggestions: [String] {
        catalog.brands(matching: brand, category: category).prefix(8).map(\.name)
    }

    private var storeSuggestions: [String] {
        catalog.stores(matching: purchasePlace).prefix(8).map(\.name)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(header: sectionHeader("Thông tin chính")) {
                    TextField("Tên thiết bị", text: $name)
                    Picker("Loại", selection: $category) {
                        ForEach(categoryOptions) { opt in
                            Text(opt.name).tag(opt.code)
                        }
                    }
                    TextField("Hãng", text: $brand)
                    AutocompleteChips(suggestions: brandSuggestions, text: $brand)
                    TextField("Model", text: $model)
                    TextField("Số serial", text: $serialNumber)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.characters)
                }
                Section(header: sectionHeader("Mua")) {
                    DatePicker("Ngày mua", selection: $purchaseDate, displayedComponents: .date)
                    TextField("Giá (VND)", text: $purchasePrice)
                        .keyboardType(.numberPad)
                    TextField("Nơi mua", text: $purchasePlace)
                    AutocompleteChips(suggestions: storeSuggestions, text: $purchasePlace)
                }
                if !isEditing {
                    Section(header: sectionHeader("Bảo hành ban đầu")) {
                        TextField("Số tháng bảo hành", text: $warrantyMonths)
                            .keyboardType(.numberPad)
                    }
                }
                if isEditing {
                    Section(header: sectionHeader("Trạng thái")) {
                        Picker("Trạng thái", selection: $status) {
                            ForEach(DeviceStatus.allCases, id: \.self) { s in
                                Text(s.label).tag(s)
                            }
                        }
                    }
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
            .navigationTitle(isEditing ? "Sửa thiết bị" : "Thêm thiết bị")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Huỷ") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await submit() } } label: {
                        if isSubmitting { ProgressView() } else { Text("Lưu").bold() }
                    }
                    .disabled(isSubmitting || name.isEmpty)
                }
            }
            .task {
                await catalog.loadIfNeeded()
                if !catalog.categories.isEmpty,
                   !catalog.categories.contains(where: { $0.code == category }) {
                    category = catalog.categories.first?.code ?? "OTHER"
                }
            }
        }
    }

    private static let fallbackCategories: [CategoryOption] = [
        .init(code: "PHONE", name: "Điện thoại"),
        .init(code: "LAPTOP", name: "Laptop"),
        .init(code: "TABLET", name: "Máy tính bảng"),
        .init(code: "OTHER", name: "Khác"),
    ]

    private func submit() async {
        topError = nil; fieldErrors = [:]
        isSubmitting = true
        defer { isSubmitting = false }

        let isoDate = ISO8601DateFormatter.dayOnly.string(from: purchaseDate)
        var input = DeviceInput(
            name: name, category: category, purchaseDate: isoDate
        )
        input.brand = brand.trimmingCharacters(in: .whitespaces).isEmpty ? nil : brand
        input.model = model.trimmingCharacters(in: .whitespaces).isEmpty ? nil : model
        input.serialNumber = serialNumber.trimmingCharacters(in: .whitespaces).isEmpty
            ? nil : serialNumber
        input.purchasePlace = purchasePlace.trimmingCharacters(in: .whitespaces).isEmpty
            ? nil : purchasePlace
        input.purchasePrice = Int(purchasePrice) ?? 0
        input.warrantyMonths = isEditing ? 0 : (Int(warrantyMonths) ?? 0)
        input.status = status
        input.notes = notes.trimmingCharacters(in: .whitespaces).isEmpty ? nil : notes

        do {
            if let editing {
                _ = try await store.update(id: editing.id, input)
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

extension ISO8601DateFormatter {
    static let dayOnly: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()
}
