import SwiftUI
import WarrantyVaultKit

struct WishlistEditorSheet: View {
    @ObservedObject var store: WishlistStore
    let item: WishlistItem?

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var catalog: CatalogStore

    @State private var name: String
    @State private var category: String
    @State private var brand: String
    @State private var initialPrice: String
    @State private var currentPrice: String
    @State private var buyUrl: String
    @State private var imageUrl: String
    @State private var hasTargetDate: Bool
    @State private var targetDate: Date
    @State private var priority: WishlistPriority
    @State private var status: WishlistStatus
    @State private var notes: String
    @State private var reminderIntervalDays: String

    @State private var isSubmitting = false
    @State private var topError: String?
    @State private var fieldErrors: [String: [String]] = [:]

    init(store: WishlistStore, item: WishlistItem?) {
        self.store = store
        self.item = item
        _name = State(initialValue: item?.name ?? "")
        _category = State(initialValue: item?.category ?? "")
        _brand = State(initialValue: item?.brand ?? "")
        _initialPrice = State(initialValue: item?.initialPrice.map { String($0) } ?? "")
        _currentPrice = State(initialValue: item?.currentPrice.map { String($0) } ?? "")
        _buyUrl = State(initialValue: item?.buyUrl ?? "")
        _imageUrl = State(initialValue: item?.imageUrl ?? "")
        _hasTargetDate = State(initialValue: item?.targetDate != nil)
        _targetDate = State(initialValue: item?.targetDate ?? Date())
        _priority = State(initialValue: item?.priority ?? .WANT)
        _status = State(initialValue: item?.status ?? .WATCHING)
        _notes = State(initialValue: item?.notes ?? "")
        _reminderIntervalDays = State(
            initialValue: item?.reminderIntervalDays.map { String($0) } ?? ""
        )
    }

    private var isEditing: Bool { item != nil }

    var body: some View {
        NavigationStack {
            Form {
                Section(header: sectionHeader("Thông tin chính")) {
                    TextField("Tên món", text: $name)
                    TextField("Loại / Danh mục", text: $category)
                    TextField("Hãng", text: $brand)
                    AutocompleteChips(
                        suggestions: catalog.brands(matching: brand).prefix(8).map(\.name),
                        text: $brand
                    )
                }

                Section(header: sectionHeader("Giá")) {
                    TextField("Giá ban đầu (VND)", text: $initialPrice)
                        .keyboardType(.numberPad)
                    TextField("Giá hiện tại (VND)", text: $currentPrice)
                        .keyboardType(.numberPad)
                }

                Section(header: sectionHeader("Liên kết")) {
                    TextField("Link mua", text: $buyUrl)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                    TextField("Link ảnh", text: $imageUrl)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                }

                Section(header: sectionHeader("Mục tiêu")) {
                    Toggle("Có hạn mua", isOn: $hasTargetDate)
                    if hasTargetDate {
                        DatePicker("Hạn mua", selection: $targetDate, displayedComponents: .date)
                    }
                    Picker("Mức độ", selection: $priority) {
                        ForEach(WishlistPriority.allCases, id: \.self) { p in
                            Text(p.label).tag(p)
                        }
                    }
                    Picker("Trạng thái", selection: $status) {
                        ForEach(WishlistStatus.allCases, id: \.self) { s in
                            Text(s.label).tag(s)
                        }
                    }
                }

                Section(header: sectionHeader("Nhắc lại")) {
                    TextField("Mỗi N ngày (tuỳ chọn)", text: $reminderIntervalDays)
                        .keyboardType(.numberPad)
                }

                Section(header: sectionHeader("Ghi chú")) {
                    TextField("Ghi chú (tuỳ chọn)", text: $notes, axis: .vertical)
                        .lineLimit(2...5)
                }

                if isEditing {
                    Section {
                        Button("Xoá khỏi danh sách", role: .destructive) {
                            Task { await deleteAndDismiss() }
                        }
                    }
                }

                if let topError {
                    Section {
                        Label(topError, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(WV.Tokens.destructive)
                            .font(.system(size: 13))
                    }
                }
            }
            .navigationTitle(isEditing ? "Sửa món thèm" : "Thêm món thèm")
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
                    .disabled(isSubmitting || name.isEmpty)
                }
            }
        }
    }

    private func submit() async {
        topError = nil; fieldErrors = [:]
        isSubmitting = true
        defer { isSubmitting = false }

        var input = WishlistInput(name: name)
        input.category = category.isEmpty ? nil : category
        input.brand = brand.isEmpty ? nil : brand
        input.initialPrice = Int(initialPrice)
        input.currentPrice = Int(currentPrice)
        input.buyUrl = buyUrl.isEmpty ? nil : buyUrl
        input.imageUrl = imageUrl.isEmpty ? nil : imageUrl
        input.targetDate = hasTargetDate
            ? ISO8601DateFormatter.dayOnly.string(from: targetDate)
            : nil
        input.priority = priority
        input.status = status
        input.notes = notes.isEmpty ? nil : notes
        input.reminderIntervalDays = Int(reminderIntervalDays)

        do {
            if let item {
                try await store.update(id: item.id, input)
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

    private func deleteAndDismiss() async {
        guard let item else { return }
        do {
            try await store.delete(id: item.id)
            dismiss()
        } catch let err as APIError {
            topError = err.localizedDescription
        } catch {
            topError = error.localizedDescription
        }
    }
}
