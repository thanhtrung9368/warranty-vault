import SwiftUI
import WarrlyKit

/// Create/edit an essential. The cadence is optional; a manual item is just a
/// name + state. The form defaults "last bought" to today because that is the
/// only date a user reliably knows when adding a new bottle.
struct StapleFormView: View {
    let client: APIClient
    @ObservedObject var store: StapleStore
    var item: Staple?

    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var category: String
    @State private var unit: String
    @State private var useCadence: Bool
    @State private var cadenceText: String
    @State private var lastBoughtAt: Date
    @State private var state: StapleState
    @State private var notes: String
    @State private var showCategoryPicker = false
    @State private var busy = false
    @State private var errorMessage: String?

    init(client: APIClient, store: StapleStore, item: Staple? = nil) {
        self.client = client
        self.store = store
        self.item = item
        _name = State(initialValue: item?.name ?? "")
        _category = State(initialValue: item?.category ?? "")
        _unit = State(initialValue: item?.unit ?? "")
        _useCadence = State(initialValue: item?.cadenceDays != nil)
        _cadenceText = State(initialValue: item?.cadenceDays.map(String.init) ?? "30")
        _lastBoughtAt = State(initialValue: item?.lastBoughtAt ?? Date())
        _state = State(initialValue: item?.state ?? .ENOUGH)
        _notes = State(initialValue: item?.notes ?? "")
    }

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !busy
            && (!useCadence || validCadence)
    }

    private var validCadence: Bool {
        guard let n = Int(cadenceText) else { return false }
        return (1...3650).contains(n)
    }

    /// Categories already used by this account, so a custom category from an
    /// older item reappears in the picker instead of demanding retyping.
    private var existingCategories: [String] {
        var seen = Set<String>()
        return store.items
            .compactMap { $0.category?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer().frame(height: WVSpacing.sm)

                WVGroup {
                    fieldRow(L.t("Tên")) {
                        TextField(L.t("Dầu gội, kem đánh răng..."), text: $name)
                            .wvFont(.body)
                            .multilineTextAlignment(.trailing)
                    }
                    WVDivider()
                    fieldRow(L.t("Nhóm")) {
                        Button { showCategoryPicker = true } label: {
                            HStack(spacing: 6) {
                                Text(category.isEmpty
                                     ? L.t("Chọn nhóm")
                                     : StapleCategories.label(category))
                                    .wvFont(.body)
                                    .foregroundStyle(category.isEmpty ? WVColor.label3 : WVColor.label)
                                    .lineLimit(1)
                                WVIcon("arrowRight", size: 13, weight: .semibold)
                                    .foregroundStyle(WVColor.label4)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                    WVDivider()
                    fieldRow(L.t("Đơn vị")) {
                        TextField(L.t("chai, tuýp, gói..."), text: $unit)
                            .wvFont(.body)
                            .multilineTextAlignment(.trailing)
                    }
                }

                WVSectionHeader(L.t("Trạng thái"))
                WVGroup {
                    WVSegmented(
                        options: StapleState.allCases.map { (value: $0, label: stateLabel($0)) },
                        selection: $state
                    )
                    .padding(WVSpacing.sm)
                }
                WVSectionFooter(L.t("“Đủ dùng” là mặc định; “Sắp hết” đưa món vào Cần mua."))

                WVSectionHeader(L.t("Nhắc mua lại"))
                WVGroup {
                    WVRowContainer {
                        Toggle(isOn: $useCadence) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(L.t("Nhắc theo tần suất"))
                                    .wvFont(.body)
                                    .foregroundStyle(WVColor.label)
                                Text(L.t("Kiểm tra định kỳ, không phải dự đoán hết hàng."))
                                    .wvFont(.footnote)
                                    .foregroundStyle(WVColor.label3)
                            }
                        }
                        .tint(WVColor.tint)
                    }
                    if useCadence {
                        WVDivider()
                        WVRowContainer {
                            HStack(spacing: WVSpacing.sm) {
                                Text(L.t("Mỗi"))
                                    .wvFont(.body)
                                    .foregroundStyle(WVColor.label)
                                Spacer()
                                TextField("30", text: $cadenceText)
                                    .keyboardType(.numberPad)
                                    .multilineTextAlignment(.trailing)
                                    .wvFont(.body)
                                    .frame(width: 64)
                                Text(L.t("ngày"))
                                    .wvFont(.body)
                                    .foregroundStyle(WVColor.label)
                            }
                        }
                        WVDivider()
                        WVRowContainer {
                            HStack {
                                Text(L.t("Lần mua gần nhất"))
                                    .wvFont(.body)
                                    .foregroundStyle(WVColor.label)
                                Spacer()
                                DatePicker(
                                    "",
                                    selection: $lastBoughtAt,
                                    displayedComponents: .date
                                )
                                .labelsHidden()
                            }
                        }
                    }
                }
                WVSectionFooter(L.t("Ứng dụng nhắc một lần vào ngày đến hạn; bật thông báo trong Cài đặt để nhận."))

                WVSectionHeader(L.t("Ghi chú"))
                WVGroup {
                    WVRowContainer {
                        TextField(L.t("Ghi chú thêm..."), text: $notes, axis: .vertical)
                            .wvFont(.body)
                            .lineLimit(3...6)
                    }
                }

                if let errorMessage {
                    Text(errorMessage)
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, WVSpacing.gutter)
                        .padding(.top, WVSpacing.sm)
                }

                if item != nil {
                    WVButton(L.t("Đã mua lại"), kind: .secondary) {
                        lastBoughtAt = Date()
                        state = .ENOUGH
                        Task { await submit() }
                    }
                    .padding(.horizontal, WVSpacing.gutter)
                    .padding(.top, WVSpacing.lg)
                }

                Spacer().frame(height: WVSpacing.xl)
            }
        }
        .wvScreen()
        .navigationTitle(item == nil ? L.t("Thêm đồ dùng") : L.t("Sửa đồ dùng"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(L.t("Huỷ")) { dismiss() }
                    .disabled(busy)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button(L.t("Lưu")) { Task { await submit() } }
                    .fontWeight(.semibold)
                    .disabled(!canSave)
            }
        }
        .sheet(isPresented: $showCategoryPicker) {
            NavigationStack {
                StapleCategoryPickerSheet(
                    selected: $category,
                    existing: existingCategories
                )
            }
            .presentationDetents([.medium, .large])
        }
        .alert(L.t("Không lưu được"), isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    // MARK: - Helpers

    private func stateLabel(_ state: StapleState) -> String {
        switch state {
        case .ENOUGH: return L.t("Đủ dùng")
        case .LOW:    return L.t("Sắp hết")
        case .OUT:    return L.t("Đã hết")
        }
    }

    private func fieldRow<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        HStack(spacing: WVSpacing.md) {
            Text(title)
                .wvFont(.body)
                .foregroundStyle(WVColor.label)
            Spacer(minLength: WVSpacing.sm)
            content()
                .wvFont(.body)
                .foregroundStyle(WVColor.label)
        }
        .padding(.horizontal, WVSpacing.gutter)
        .frame(minHeight: 44)
        .padding(.vertical, WVSpacing.xs)
    }

    private func cleaned(_ s: String) -> String? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    private func submit() async {
        guard canSave else { return }
        busy = true
        errorMessage = nil
        defer { busy = false }

        var input = StapleInput(name: name.trimmingCharacters(in: .whitespacesAndNewlines))
        input.category = cleaned(category)
        input.unit = cleaned(unit)
        if useCadence {
            guard let days = Int(cadenceText), (1...3650).contains(days) else {
                errorMessage = L.t("Số ngày phải từ 1 đến 3650")
                return
            }
            input.cadenceDays = days
        }
        input.lastBoughtAt = StapleStore.apiDay(lastBoughtAt)
        input.state = state
        input.notes = cleaned(notes)

        do {
            if let item {
                try await store.update(id: item.id, input)
            } else {
                try await store.create(input)
            }
            dismiss()
        } catch let APIError.server(_, envelope) {
            errorMessage = envelope.message ?? L.t("Không lưu được.")
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
