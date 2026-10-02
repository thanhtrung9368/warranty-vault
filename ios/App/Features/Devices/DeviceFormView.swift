import SwiftUI
import PhotosUI
import UIKit
import WarrantyVaultKit

// ============================================================
// Shared date-formatter extension (was in deleted AddDeviceSheet.swift)
// ============================================================

extension ISO8601DateFormatter {
    /// A `DateFormatter` (not `ISO8601DateFormatter`) that writes `yyyy-MM-dd`.
    /// Kept as `dayOnly` on `ISO8601DateFormatter` for backwards compatibility with
    /// sites across the app that call `ISO8601DateFormatter.dayOnly.string(from:)`.
    static let dayOnly: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()
}

// ============================================================
// DeviceFormView — add / edit device (pushed as a screen)
//
// Ports DeviceFormScreen from project/ios/js/screens-1.jsx.
// - Create mode: shows initial warranty fields.
// - Edit mode: shows status picker, hides warranty section.
// ============================================================

struct DeviceFormView: View {
    let client: APIClient
    @ObservedObject var store: DevicesStore
    let device: Device?   // nil = create mode

    @EnvironmentObject private var catalog: CatalogStore
    @Environment(\.dismiss) private var dismiss

    // Form fields
    @State private var name: String
    @State private var category: String
    @State private var brand: String
    @State private var model: String
    @State private var serial: String
    @State private var purchaseDate: Date
    @State private var price: Int?
    @State private var purchasePlace: String
    @State private var warrantyMonths: String
    @State private var warrantyProvider: String
    @State private var warrantyPhone: String
    @State private var warrantyAddress: String
    @State private var status: DeviceStatus
    @State private var notes: String

    // UI state
    @State private var showCategoryPicker = false
    @State private var showDiscardAlert = false
    @State private var isSubmitting = false
    @State private var topError: String?
    @State private var fieldErrors: [String: [String]] = [:]

    // OCR receipt scan (create flow only, gated on the per-user AI opt-in).
    @State private var scanPhotoItem: PhotosPickerItem?
    @State private var scanning = false
    @State private var scanInfo: ScanInfo?
    @State private var aiEnabled = false

    struct ScanInfo { let confidence: String; let unmatched: [String] }

    private var isEditing: Bool { device != nil }

    init(client: APIClient, store: DevicesStore, device: Device?) {
        self.client = client
        self.store = store
        self.device = device
        _name = State(initialValue: device?.name ?? "")
        _category = State(initialValue: device?.category ?? "phone")
        _brand = State(initialValue: device?.brand ?? "")
        _model = State(initialValue: device?.model ?? "")
        _serial = State(initialValue: device?.serialNumber ?? "")
        _purchaseDate = State(initialValue: device?.purchaseDate ?? Date())
        _price = State(initialValue: device?.purchasePrice)
        _purchasePlace = State(initialValue: device?.purchasePlace ?? "")
        _warrantyMonths = State(initialValue: "12")
        _warrantyProvider = State(initialValue: "")
        _warrantyPhone = State(initialValue: "")
        _warrantyAddress = State(initialValue: "")
        _status = State(initialValue: device?.status ?? .ACTIVE)
        _notes = State(initialValue: device?.notes ?? "")
    }

    // MARK: - Validation

    private var isValid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
    }

    // MARK: - Category options

    private var categoryOptions: [CategoryOption] {
        catalog.categories.isEmpty ? Self.fallbackCategories : catalog.categories
    }

    private var selectedCategoryLabel: String {
        categoryOptions.first(where: { $0.code.lowercased() == category.lowercased() })?.name
            ?? category
    }

    private var brandSuggestions: [String] {
        catalog.brands(matching: brand, category: category).prefix(8).map(\.name)
    }

    private var storeSuggestions: [String] {
        catalog.stores(matching: purchasePlace).prefix(8).map(\.name)
    }

    // MARK: - Body

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Spacer().frame(height: 8)

                // OCR receipt scan — create flow only, gated on AI opt-in
                if !isEditing && aiEnabled {
                    PhotosPicker(selection: $scanPhotoItem, matching: .images) {
                        HStack(spacing: 12) {
                            if scanning {
                                ProgressView()
                            } else {
                                WVIcon("receipt", size: 22)
                                    .foregroundStyle(WVColor.tint)
                            }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(scanning ? "Đang quét hoá đơn…" : "Quét hoá đơn / phiếu bảo hành")
                                    .font(.system(size: 16, weight: .semibold))
                                    .foregroundStyle(WVColor.label)
                                Text("Chụp hoặc chọn ảnh để tự điền — vẫn kiểm tra lại trước khi lưu")
                                    .font(.system(size: 12))
                                    .foregroundStyle(WVColor.label3)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(WVColor.tint.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    .disabled(scanning)
                    .padding(.horizontal, 16)

                    if let info = scanInfo {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(info.confidence == "high"
                                 ? "Đã điền nháp từ hoá đơn"
                                 : "Đã điền nháp — độ tin cậy chưa cao, kiểm tra kỹ nhé")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(WVColor.label2)
                            if !info.unmatched.isEmpty {
                                Text("Cần xem lại: " + info.unmatched.map(Self.unmatchedLabel).joined(separator: ", "))
                                    .font(.system(size: 12))
                                    .foregroundStyle(WVColor.label3)
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Spacer().frame(height: 16)
                }

                // Basic info
                WVGroup {
                    inputRow(label: "Tên", placeholder: "MacBook Pro M3...", text: $name)
                    WVDivider()
                    inputRow(label: "Hãng", placeholder: "Apple, Samsung...", text: $brand)
                    if !brandSuggestions.isEmpty {
                        WVDivider()
                        AutocompleteRow(suggestions: brandSuggestions, text: $brand)
                    }
                    WVDivider()
                    inputRow(label: "Model", placeholder: "14-inch M3 Pro...", text: $model)
                    WVDivider()
                    // Category picker row
                    Button { showCategoryPicker = true } label: {
                        HStack(spacing: 12) {
                            Text("Loại")
                                .font(.system(size: 17))
                                .foregroundStyle(WVColor.label)
                            Spacer(minLength: 8)
                            HStack(spacing: 6) {
                                WVLeadingIcon(
                                    icon: WVCategory.icon(for: category),
                                    color: WVCategory.accent(for: category),
                                    size: 22
                                )
                                Text(selectedCategoryLabel)
                                    .font(.system(size: 17))
                                    .foregroundStyle(WVColor.label3)
                            }
                            WVIcon("arrowRight", size: 13)
                                .foregroundStyle(WVColor.label4)
                        }
                        .padding(.horizontal, 16)
                        .frame(minHeight: 44)
                        .padding(.vertical, 7)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(WVRowButtonStyle())
                    WVDivider()
                    inputRow(label: "Serial / IMEI", placeholder: "Không bắt buộc",
                             text: $serial, autocapitalize: .characters)
                }

                // Purchase info
                WVSectionHeader("Mua hàng")
                WVGroup {
                    // Date picker
                    HStack(spacing: 12) {
                        Text("Ngày mua")
                            .font(.system(size: 17))
                            .foregroundStyle(WVColor.label)
                        Spacer()
                        DatePicker("", selection: $purchaseDate, displayedComponents: .date)
                            .labelsHidden()
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .padding(.vertical, 7)

                    WVDivider()

                    // Price field
                    HStack(spacing: 12) {
                        Text("Giá mua")
                            .font(.system(size: 17))
                            .foregroundStyle(WVColor.label)
                        Spacer(minLength: 8)
                        WVMoneyField(value: $price, placeholder: "0 ₫")
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .padding(.vertical, 7)

                    WVDivider()
                    inputRow(label: "Nơi mua", placeholder: "CellphoneS, TopZone...", text: $purchasePlace)
                    if !storeSuggestions.isEmpty {
                        WVDivider()
                        AutocompleteRow(suggestions: storeSuggestions, text: $purchasePlace)
                    }
                }

                // Default warranty (create mode only)
                if !isEditing {
                    WVSectionHeader("Bảo hành mặc định")
                    WVSectionFooter("Mày có thể thêm nhiều gói khác trong chi tiết thiết bị.")
                    WVGroup {
                        HStack(spacing: 12) {
                            Text("Số tháng")
                                .font(.system(size: 17))
                                .foregroundStyle(WVColor.label)
                            Spacer(minLength: 8)
                            TextField("12", text: $warrantyMonths)
                                .keyboardType(.numberPad)
                                .multilineTextAlignment(.trailing)
                                .font(.system(size: 17))
                                .foregroundStyle(WVColor.label)
                        }
                        .padding(.horizontal, 16)
                        .frame(minHeight: 44)
                        .padding(.vertical, 7)
                        WVDivider()
                        inputRow(label: "Hãng BH", placeholder: "Apple Việt Nam...", text: $warrantyProvider)
                        WVDivider()
                        inputRow(label: "SĐT BH", placeholder: "1800-...", text: $warrantyPhone, keyboard: .phonePad)
                        WVDivider()
                        inputRow(label: "Địa chỉ", placeholder: "Bitexco, Q.1, TP.HCM", text: $warrantyAddress)
                    }
                }

                // Status (edit mode only)
                if isEditing {
                    WVSectionHeader("Trạng thái")
                    WVGroup {
                        let statusOptions: [(DeviceStatus, String)] = [
                            (.ACTIVE, "Đang dùng"),
                            (.BROKEN, "Ngừng dùng"),
                            (.SOLD, "Đã bán"),
                            (.LOST, "Mất"),
                            (.EXPIRED, "Đã lưu trữ"),
                        ]
                        ForEach(Array(statusOptions.enumerated()), id: \.offset) { idx, pair in
                            if idx > 0 { WVDivider() }
                            Button {
                                status = pair.0
                            } label: {
                                HStack {
                                    Text(pair.1)
                                        .font(.system(size: 17))
                                        .foregroundStyle(WVColor.label)
                                    Spacer()
                                    if status == pair.0 {
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
                }

                // Notes
                WVSectionHeader("Ghi chú")
                WVGroup {
                    TextField("Ghi chú thêm...", text: $notes, axis: .vertical)
                        .font(.system(size: 17))
                        .foregroundStyle(WVColor.label)
                        .lineLimit(2...8)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 44)
                        .padding(.vertical, 10)
                }

                // Error
                if let topError {
                    Text(topError)
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.red)
                        .padding(.horizontal, 32)
                        .padding(.top, 8)
                }

                // CTA button
                VStack(spacing: 0) {
                    WVButton(
                        isEditing ? "Lưu thay đổi" : "Thêm thiết bị",
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
        .navigationTitle(isEditing ? "Sửa thiết bị" : "Thiết bị mới")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Huỷ") { showDiscardAlert = true }
                    .foregroundStyle(WVColor.tint)
            }
            ToolbarItem(placement: .topBarTrailing) {
                if isSubmitting {
                    ProgressView()
                } else {
                    Button(isEditing ? "Lưu" : "Thêm") {
                        Task { await submit() }
                    }
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(isValid ? WVColor.tint : WVColor.label3)
                    .disabled(!isValid)
                }
            }
        }
        .sheet(isPresented: $showCategoryPicker) {
            CategoryPickerSheet(selected: $category, options: categoryOptions)
        }
        .alert("Bỏ thay đổi?", isPresented: $showDiscardAlert) {
            Button("Tiếp tục sửa", role: .cancel) {}
            Button("Bỏ", role: .destructive) { dismiss() }
        } message: {
            Text("Tất cả thông tin đã nhập sẽ mất.")
        }
        .task { await catalog.loadIfNeeded() }
        .task {
            if !isEditing, let v = try? await client.getAIOptIn() { aiEnabled = v }
        }
        .onChange(of: scanPhotoItem) { _, item in
            guard let item else { return }
            Task { await handleScan(item) }
        }
    }

    // MARK: - OCR receipt scan

    private func handleScan(_ item: PhotosPickerItem) async {
        defer { scanPhotoItem = nil }
        scanning = true
        topError = nil
        scanInfo = nil
        defer { scanning = false }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { return }
            guard data.count <= AttachmentFileType.maxBytes else {
                topError = AttachmentFileType.tooLargeMessage
                return
            }
            // The OCR endpoint only takes JPEG/PNG/WEBP and cross-checks the
            // declared Content-Type against the magic bytes. iPhones write
            // HEIC by default, so transcode anything else to JPEG first
            // instead of declaring a type the server will reject.
            let payload = Self.ocrPayload(from: data)
            guard let payload else {
                topError = AttachmentFileType.ocrUnsupportedMessage
                return
            }
            let fileName = "receipt-\(Int(Date().timeIntervalSince1970)).\(payload.fileExtension)"
            let draft = try await client.extractReceipt(
                fileName: fileName, fileType: payload.mimeType, data: payload.data
            )
            applyDraft(draft)
            scanInfo = ScanInfo(confidence: draft.confidence, unmatched: draft.unmatched)
        } catch let err as APIError {
            topError = err.localizedDescription
        } catch {
            topError = "Không quét được hoá đơn, thử lại sau"
        }
    }

    /// JPEG/PNG/WEBP go up untouched; anything else `UIImage` can decode
    /// (HEIC, GIF, …) is re-encoded as JPEG. Returns nil when the bytes aren't
    /// an image the receipt-scan endpoint could accept at all.
    static func ocrPayload(from data: Data) -> (mimeType: String, fileExtension: String, data: Data)? {
        if !AttachmentFileType.ocrNeedsTranscode(data),
           let detected = AttachmentFileType.detect(data) {
            return (detected.mimeType, detected.fileExtension, data)
        }
        guard let image = UIImage(data: data),
              let jpeg = image.jpegData(compressionQuality: 0.9) else { return nil }
        return ("image/jpeg", "jpg", jpeg)
    }

    /// Seeds the form from an extracted draft. Category is only applied when it
    /// matches a known catalog code; brand/place are set verbatim (free-text
    /// inputs). Never writes — the user still reviews & taps save.
    private func applyDraft(_ d: DraftDevice) {
        if let v = d.name, !v.isEmpty { name = v }
        if let v = d.category,
           categoryOptions.contains(where: { $0.code.lowercased() == v.lowercased() }) {
            category = v
        }
        if let v = d.brand, !v.isEmpty { brand = v }
        if let v = d.model, !v.isEmpty { model = v }
        if let v = d.serialNumber, !v.isEmpty { serial = v }
        if let v = d.purchaseDate, let date = WVFormat.parseDay(v) { purchaseDate = date }
        if let v = d.purchasePrice { price = v }
        if let v = d.purchasePlace, !v.isEmpty { purchasePlace = v }
        if let v = d.warrantyMonths { warrantyMonths = String(v) }
    }

    private static func unmatchedLabel(_ key: String) -> String {
        switch key {
        case "brand": return "Hãng"
        case "purchasePlace": return "Nơi mua"
        case "category": return "Loại thiết bị"
        default: return key
        }
    }

    // MARK: - Row helpers

    private func inputRow(
        label: String,
        placeholder: String,
        text: Binding<String>,
        keyboard: UIKeyboardType = .default,
        autocapitalize: TextInputAutocapitalization = .sentences
    ) -> some View {
        HStack(spacing: 12) {
            Text(label)
                .font(.system(size: 17))
                .foregroundStyle(WVColor.label)
                .frame(width: 110, alignment: .leading)
            TextField(placeholder, text: text)
                .font(.system(size: 17))
                .foregroundStyle(WVColor.label)
                .keyboardType(keyboard)
                .textInputAutocapitalization(autocapitalize)
                .autocorrectionDisabled()
                .multilineTextAlignment(.trailing)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .padding(.vertical, 7)
    }

    // MARK: - Submit

    private func submit() async {
        topError = nil; fieldErrors = [:]
        isSubmitting = true
        defer { isSubmitting = false }

        let isoDate = WVFormat.isoDay(purchaseDate)
        var input = DeviceInput(name: name.trimmingCharacters(in: .whitespaces),
                                category: category, purchaseDate: isoDate)
        input.brand = brand.isEmpty ? nil : brand
        input.model = model.isEmpty ? nil : model
        input.serialNumber = serial.isEmpty ? nil : serial
        input.purchasePlace = purchasePlace.isEmpty ? nil : purchasePlace
        input.purchasePrice = price ?? 0
        input.status = status
        input.notes = notes.isEmpty ? nil : notes

        if !isEditing {
            input.warrantyMonths = Int(warrantyMonths) ?? 0
            input.warrantyProvider = warrantyProvider.isEmpty ? nil : warrantyProvider
            input.warrantyPhone = warrantyPhone.isEmpty ? nil : warrantyPhone
            input.warrantyAddress = warrantyAddress.isEmpty ? nil : warrantyAddress
        } else {
            input.warrantyMonths = 0
        }

        do {
            if let device {
                _ = try await store.update(id: device.id, input)
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

    // MARK: - Fallback categories

    private static let fallbackCategories: [CategoryOption] = [
        .init(code: "phone",   name: "Điện thoại"),
        .init(code: "laptop",  name: "Laptop"),
        .init(code: "tablet",  name: "Máy tính bảng"),
        .init(code: "watch",   name: "Đồng hồ"),
        .init(code: "tv",      name: "TV"),
        .init(code: "audio",   name: "Tai nghe / Loa"),
        .init(code: "appliance", name: "Gia dụng"),
        .init(code: "console", name: "Máy game"),
        .init(code: "other",   name: "Khác"),
    ]
}

// MARK: - Autocomplete chips row (adapted for new DS)

private struct AutocompleteRow: View {
    let suggestions: [String]
    @Binding var text: String

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: WVSpacing.xs) {
                ForEach(suggestions, id: \.self) { s in
                    Button {
                        text = s
                    } label: {
                        Text(s)
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
}

// MARK: - Category picker sheet

private struct CategoryPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var selected: String
    let options: [CategoryOption]

    var body: some View {
        NavigationStack {
            List {
                ForEach(options) { opt in
                    Button {
                        selected = opt.code
                        dismiss()
                    } label: {
                        HStack(spacing: 12) {
                            WVLeadingIcon(
                                icon: WVCategory.icon(for: opt.code),
                                color: WVCategory.accent(for: opt.code),
                                size: 28
                            )
                            Text(opt.name)
                                .font(.system(size: 17))
                                .foregroundStyle(WVColor.label)
                            Spacer()
                            if selected.lowercased() == opt.code.lowercased() {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(WVColor.tint)
                                    .font(.system(size: 15, weight: .semibold))
                            }
                        }
                    }
                }
            }
            .navigationTitle("Chọn loại")
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
}
