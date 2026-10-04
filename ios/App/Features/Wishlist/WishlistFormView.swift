import SwiftUI
import WarrantyVaultKit

// MARK: - WishlistFormView

struct WishlistFormView: View {
    let client: APIClient
    @ObservedObject var store: WishlistStore
    var item: WishlistItem?      // nil → create

    @EnvironmentObject private var catalog: CatalogStore
    @EnvironmentObject private var toast:   WVToastCenter
    @Environment(\.dismiss) private var dismiss

    // Fields
    @State private var name:               String
    @State private var brand:              String
    @State private var category:           String
    @State private var initialPrice:       Int?
    @State private var currentPrice:       Int?
    @State private var buyUrl:             String
    @State private var hasTargetDate:      Bool
    @State private var targetDate:         Date
    @State private var reminderDays:       String
    @State private var priority:           WishlistPriority
    @State private var notes:              String

    // UI
    @State private var showCatPicker   = false
    @State private var showDiscard     = false
    @State private var isBusy          = false
    @State private var topError: String?

    private var isEditing: Bool { item != nil }
    private var isValid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty &&
        (currentPrice ?? 0) > 0
    }

    // MARK: - Init

    init(client: APIClient, store: WishlistStore, item: WishlistItem? = nil) {
        self.client = client
        self.store  = store
        self.item   = item

        _name           = State(initialValue: item?.name ?? "")
        _brand          = State(initialValue: item?.brand ?? "")
        _category       = State(initialValue: item?.category ?? "phone")
        _initialPrice   = State(initialValue: item?.initialPrice)
        _currentPrice   = State(initialValue: item?.currentPrice)
        _buyUrl         = State(initialValue: item?.buyUrl ?? "")
        _hasTargetDate  = State(initialValue: item?.targetDate != nil)
        _targetDate     = State(initialValue: item?.targetDate ?? Date())
        _reminderDays   = State(initialValue: item?.reminderIntervalDays.map { String($0) } ?? "")
        _priority       = State(initialValue: item?.priority ?? .WANT)
        _notes          = State(initialValue: item?.notes ?? "")
    }

    // MARK: - Body

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer().frame(height: WVSpacing.sm)

                // Basic info
                WVGroup {
                    fieldRow(L.t("Tên")) {
                        TextField("iPhone 16 Pro...", text: $name)
                            .font(.system(size: 17))
                            .multilineTextAlignment(.trailing)
                    }
                    WVDivider()
                    fieldRow(L.t("Hãng")) {
                        TextField("Apple...", text: $brand)
                            .font(.system(size: 17))
                            .multilineTextAlignment(.trailing)
                    }
                    WVDivider()
                    Button { showCatPicker = true } label: {
                        HStack {
                            Text(L.t("Loại"))
                                .font(.system(size: 17))
                                .foregroundStyle(WVColor.label)
                            Spacer()
                            HStack(spacing: 6) {
                                WVLeadingIcon(
                                    icon: WVCategory.icon(for: category),
                                    color: WVCategory.accent(for: category),
                                    size: 22
                                )
                                Text(catName(category))
                                    .font(.system(size: 17))
                                    .foregroundStyle(WVColor.label3)
                            }
                            WVIcon("arrowRight", size: 13, weight: .semibold)
                                .foregroundStyle(WVColor.label4)
                        }
                        .padding(.horizontal, 16)
                        .frame(minHeight: 44)
                        .padding(.vertical, 7)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(WVRowButtonStyle())
                }

                // Price
                WVSectionHeader(L.t("Giá"))
                WVGroup {
                    fieldRow(L.t("Giá ban đầu")) {
                        WVMoneyField(value: $initialPrice).frame(width: 150)
                    }
                    WVDivider()
                    fieldRow(L.t("Giá hiện tại")) {
                        WVMoneyField(value: $currentPrice).frame(width: 150)
                    }
                    WVDivider()
                    fieldRow("Link mua") {
                        TextField("https://...", text: $buyUrl)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .font(.system(size: 17))
                            .multilineTextAlignment(.trailing)
                    }
                }

                // Schedule & priority
                WVSectionHeader(L.t("Lịch & ưu tiên"))
                WVGroup {
                    WVRowContainer {
                        Toggle(L.t("Có ngày dự kiến"), isOn: $hasTargetDate)
                            .font(.system(size: 17))
                    }
                    if hasTargetDate {
                        WVDivider()
                        WVRowContainer {
                            DatePicker(L.t("Ngày dự kiến"), selection: $targetDate,
                                       displayedComponents: .date)
                                .font(.system(size: 17))
                        }
                    }
                    WVDivider()
                    fieldRow(L.t("Nhắc lại (ngày)")) {
                        TextField("14", text: $reminderDays)
                            .keyboardType(.numberPad)
                            .font(.system(size: 17))
                            .multilineTextAlignment(.trailing)
                    }
                }

                // Priority picker
                WVSectionHeader(L.t("Mức độ thèm"))
                WVGroup {
                    ForEach(Array(WishlistPriority.allCases.enumerated()), id: \.element) { idx, p in
                        if idx > 0 { WVDivider() }
                        Button { priority = p } label: {
                            HStack(spacing: 12) {
                                WVChip(p.chipLabel, tone: p.chipTone)
                                Spacer()
                                if priority == p {
                                    WVIcon("check", size: 16, weight: .bold)
                                        .foregroundStyle(WVColor.tint)
                                }
                            }
                            .padding(.horizontal, 16)
                            .frame(minHeight: 44)
                            .padding(.vertical, 4)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(WVRowButtonStyle())
                    }
                }

                // Notes
                WVSectionHeader(L.t("Ghi chú"))
                WVGroup {
                    WVRowContainer {
                        TextField(L.t("Ghi chú thêm..."), text: $notes, axis: .vertical)
                            .font(.system(size: 17))
                            .lineLimit(3...6)
                    }
                }

                if let topError {
                    Text(topError)
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.red)
                        .padding(.horizontal, WVSpacing.gutter)
                        .padding(.top, WVSpacing.sm)
                }

                VStack(spacing: 0) {
                    Spacer().frame(height: WVSpacing.lg)
                    WVButton(
                        isEditing ? L.t("Lưu thay đổi") : L.t("Thêm vào wishlist"),
                        icon: isEditing ? "save" : "heart"
                    ) {
                        Task { await submit() }
                    }
                    .disabled(!isValid || isBusy)
                    .padding(.horizontal, WVSpacing.gutter)
                    Spacer().frame(height: WVSpacing.xl)
                }
            }
        }
        .wvScreen()
        .navigationTitle(isEditing ? L.t("Sửa món") : L.t("Thêm món"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await catalog.loadIfNeeded() }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(L.t("Huỷ")) { showDiscard = true }
                    .foregroundStyle(WVColor.tint)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button(isEditing ? L.t("Lưu") : L.t("Thêm")) { Task { await submit() } }
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(isValid ? WVColor.tint : WVColor.label4)
                    .disabled(!isValid || isBusy)
            }
        }
        .alert(L.t("Bỏ thay đổi?"), isPresented: $showDiscard) {
            Button(L.t("Tiếp tục"), role: .cancel) {}
            Button(L.t("Bỏ"), role: .destructive) { dismiss() }
        }
        .sheet(isPresented: $showCatPicker) {
            WishCategoryPickerSheet(selected: $category)
        }
    }

    // MARK: - Helpers

    private func fieldRow<F: View>(_ label: String, @ViewBuilder field: () -> F) -> some View {
        WVRowContainer {
            HStack {
                Text(label)
                    .font(.system(size: 17))
                    .foregroundStyle(WVColor.label)
                Spacer()
                field().foregroundStyle(WVColor.label3)
            }
        }
    }

    private func catName(_ code: String) -> String {
        catalog.categories.first(where: { $0.code == code })?.name ?? code.capitalized
    }

    // MARK: - Submit

    private func submit() async {
        topError = nil; isBusy = true
        defer { isBusy = false }

        var input              = WishlistInput(name: name)
        input.category         = category.isEmpty ? nil : category
        input.brand            = brand.isEmpty ? nil : brand
        input.initialPrice     = initialPrice
        input.currentPrice     = currentPrice
        input.buyUrl           = buyUrl.isEmpty ? nil : buyUrl
        // The picker's day, written in the zone the picker drew it in — a pinned
        // format stores the day before the one on screen east of the pin.
        input.targetDate       = hasTargetDate
            ? WireDay.string(from: targetDate) : nil
        input.priority         = priority
        input.status           = item?.status ?? .WATCHING
        input.notes            = notes.isEmpty ? nil : notes
        input.reminderIntervalDays = Int(reminderDays)

        do {
            if let item {
                try await store.update(id: item.id, input)
                toast.show(L.t("Đã lưu"))
            } else {
                _ = try await store.create(input)
                toast.show(L.t("Đã thêm vào wishlist 💖"))
            }
            dismiss()
        } catch {
            topError = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }
}

// MARK: - Category picker sheet

private struct WishCategoryPickerSheet: View {
    @Binding var selected: String
    @EnvironmentObject private var catalog: CatalogStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    Spacer().frame(height: WVSpacing.sm)
                    WVGroup {
                        ForEach(Array(catalog.categories.enumerated()), id: \.element.id) { idx, c in
                            if idx > 0 { WVDivider(inset: 60) }
                            Button {
                                selected = c.code
                                dismiss()
                            } label: {
                                HStack(spacing: 12) {
                                    WVLeadingIcon(
                                        icon: WVCategory.icon(for: c.code),
                                        color: WVCategory.accent(for: c.code),
                                        size: 30
                                    )
                                    Text(c.name)
                                        .font(.system(size: 17))
                                        .foregroundStyle(WVColor.label)
                                    Spacer()
                                    if selected == c.code {
                                        WVIcon("check", size: 16, weight: .bold)
                                            .foregroundStyle(WVColor.tint)
                                    }
                                }
                                .padding(.horizontal, 16)
                                .frame(minHeight: 44)
                                .padding(.vertical, 4)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(WVRowButtonStyle())
                        }
                        // Fallback: show subscription categories if catalog has none
                        if catalog.categories.isEmpty {
                            staticCategoryFallback
                        }
                    }
                    Spacer().frame(height: WVSpacing.xl)
                }
            }
            .wvScreen()
            .navigationTitle(L.t("Loại"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Xong") { dismiss() }
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder
    private var staticCategoryFallback: some View {
        let cats = [
            ("phone", L.t("Điện thoại")), ("laptop", "Laptop"), ("tablet", L.t("Máy tính bảng")),
            ("watch", L.t("Đồng hồ")), ("audio", "Tai nghe"), ("camera", L.t("Máy ảnh")),
            ("tv", "TV"), ("appliance", L.t("Đồ gia dụng")),
        ]
        ForEach(Array(cats.enumerated()), id: \.element.0) { idx, cat in
            WVDivider(inset: 60)
            Button {
                selected = cat.0
                dismiss()
            } label: {
                HStack(spacing: 12) {
                    WVLeadingIcon(icon: WVCategory.icon(for: cat.0),
                                  color: WVCategory.accent(for: cat.0), size: 30)
                    Text(cat.1)
                        .font(.system(size: 17))
                        .foregroundStyle(WVColor.label)
                    Spacer()
                    if selected == cat.0 {
                        WVIcon("check", size: 16, weight: .bold).foregroundStyle(WVColor.tint)
                    }
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
                .padding(.vertical, 4)
                .contentShape(Rectangle())
            }
            .buttonStyle(WVRowButtonStyle())
        }
    }
}
