import SwiftUI
import PhotosUI
import UIKit
import UniformTypeIdentifiers
import WarrantyVaultKit

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

    /// The exchange / return window, loaded from the device being edited and sent
    /// straight back on every save.
    ///
    /// This screen deliberately has **no** input for it. `PATCH
    /// /api/v1/devices/{id}` replaces the whole device, so a save that omitted
    /// these two fields would silently erase a window recorded on the web or on
    /// Android. Nothing here lets the user *set* a window — it only refuses to
    /// destroy one. When `device` is nil (create) both values are `nil`, which the
    /// encoder drops, i.e. exactly what the server already has.
    @State private var returnWindow: ReturnWindowFields

    /// Resale ("Bán lại", migration 0006): whether a sale is being recorded, the
    /// day it happened and what it went for.
    ///
    /// The pair is loaded from the device being edited and sent straight back on
    /// every save — `PATCH /api/v1/devices/{id}` replaces the whole device, so a
    /// save that omitted it would erase a sale recorded on the web or on Android.
    /// Unlike the return window this screen *does* expose the input, because all
    /// three clients now send the fields: any of them may set a sale.
    ///
    /// `soldPrice` is `Int?` on purpose: blank means "chưa bán" (the key is
    /// dropped) while `0` is a real price — a give-away — and must be sent as `0`.
    @State private var saleRecorded: Bool
    @State private var soldDate: Date
    @State private var soldPrice: Int?

    // UI state
    @State private var showCategoryPicker = false
    @State private var showDiscardAlert = false
    @State private var isSubmitting = false
    @State private var topError: String?
    @State private var fieldErrors: [String: [String]] = [:]

    /// Serial advisories from the last **successful** save (openapi:
    /// `{device, warnings}` on POST/PATCH). Non-empty means the device IS saved
    /// and this screen is only still open so the note can be read — never an
    /// error, and never a reason to clear the value that was flagged.
    @State private var savedWarnings: [DeviceWarning] = []
    /// True once a save has succeeded: blocks a second save (which would create
    /// a duplicate in create mode) and swaps the CTAs for a single "Xong".
    @State private var didSave = false

    // OCR receipt scan (create flow only, gated on the per-user AI opt-in).
    // Two sources: the photo library (JPEG/PNG/WEBP/HEIC) and Files (PDF).
    @State private var scanPhotoItem: PhotosPickerItem?
    @State private var showPhotoPicker = false
    @State private var showPDFImporter = false
    @State private var scanning = false
    @State private var scanInfo: ScanInfo?
    @State private var aiEnabled = false

    struct ScanInfo {
        let confidence: String
        /// Fields the extractor could **not** use — the user types them.
        let unmatched: [String]
        /// Advisories about values it **did** use (`draft.warnings`). A different
        /// thing from `unmatched`, and shown as such.
        let warnings: [DeviceWarning]
    }

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
        // Load the recorded window once; `submit()` writes it back unchanged.
        _returnWindow = State(initialValue: device.map(DeviceReturnWindow.carried(from:)) ?? .unknown)
        // Same for the sale. `carried` reduces `soldAt` (a Z-less naive-UTC
        // timestamp) to its `YYYY-MM-DD` day without parsing an instant, and keeps
        // a `0₫` give-away as `0` rather than as "not recorded".
        let sale = device.map(DeviceResale.carried(from:)) ?? .none
        _saleRecorded = State(initialValue: DeviceResale.hasSaleRecorded(sale))
        // The picker holds a `Date`, so the stored day is turned into one in the
        // device's own zone — the same zone the picker draws it in, and the same
        // one `saleFields` writes back from. Nothing here parses the wire value as
        // an instant: that is what would move the calendar day.
        _soldDate = State(initialValue: DeviceResale.dayDate(sale.soldAt) ?? Date())
        _soldPrice = State(initialValue: sale.soldPrice)
    }

    // MARK: - Validation

    private var isValid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
    }

    // MARK: - Resale (derived)

    /// The pair as the form currently holds it. Both halves come from the same
    /// "Ghi nhận đã bán" switch, so the form can never build one without the
    /// other when the switch is off; when it is on, `pairErrors` catches a half
    /// the user has not filled in yet.
    ///
    /// The day is written back in the picker's own zone, which is what keeps the
    /// day the user sees identical to the day the server stores.
    private var saleFields: ResaleFields {
        ResaleFields(soldAt: saleRecorded ? DeviceResale.dayString(soldDate) : nil,
                     soldPrice: saleRecorded ? soldPrice : nil)
    }

    /// Lãi/lỗ so với giá mua, live as the user types. `nil` until a sale price
    /// exists — the API never returns this (the client computes it on purpose).
    private var liveProfitLoss: SaleProfitLoss? {
        DeviceResale.profitLoss(purchasePrice: price ?? 0, soldPrice: saleFields.soldPrice)
    }

    /// Colour for a profit/loss line: green gains, red losses, neutral break-even.
    static func saleToneColor(_ tone: SaleTone) -> Color {
        switch tone {
        case .profit: return WVColor.green
        case .loss:   return WVColor.red
        case .even:   return WVColor.label2
        }
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
        ScrollViewReader { proxy in
            formBody
                // The advisory sits at the top of the form; the save button is at
                // the bottom, so without this the user would be told nothing.
                .onChange(of: didSave) { _, saved in
                    guard saved else { return }
                    withAnimation { proxy.scrollTo(Self.topAnchorID, anchor: .top) }
                }
        }
    }

    /// Anchor for "scroll back to the advisory after a save".
    private static let topAnchorID = "deviceFormTop"

    private var formBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Spacer().frame(height: 8).id(Self.topAnchorID)

                // Saved, but the server flagged the serial. Shown first, above
                // everything else, and stated as a success.
                if didSave && !savedWarnings.isEmpty {
                    saveWarningsCard
                    Spacer().frame(height: 12)
                }

                // OCR receipt scan — create flow only, gated on AI opt-in.
                // The endpoint accepts JPEG/PNG/WEBP **and PDF**, so the menu
                // offers both the photo library and a PDF file.
                if !isEditing && aiEnabled {
                    Menu {
                        Button {
                            showPhotoPicker = true
                        } label: {
                            Label("Chụp hoặc chọn ảnh", systemImage: "photo.on.rectangle")
                        }
                        Button {
                            showPDFImporter = true
                        } label: {
                            Label("Chọn tệp PDF", systemImage: "doc")
                        }
                    } label: {
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
                                Text("Chọn ảnh (JPG/PNG/WEBP/HEIC) hoặc tệp PDF để tự điền — vẫn kiểm tra lại trước khi lưu")
                                    .font(.system(size: 12))
                                    .foregroundStyle(WVColor.label3)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: 0)
                            WVIcon("arrowDown", size: 12)
                                .foregroundStyle(WVColor.label3)
                        }
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(WVColor.tint.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    .disabled(scanning || didSave)
                    .padding(.horizontal, 16)

                    if let info = scanInfo {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(info.confidence == "high"
                                 ? "Đã điền nháp từ hoá đơn"
                                 : "Đã điền nháp — độ tin cậy chưa cao, kiểm tra kỹ nhé")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(WVColor.label2)
                            // Used, but it looks wrong (e.g. an IMEI that fails
                            // its checksum). The value stays in the form.
                            if !info.warnings.isEmpty {
                                Text(DeviceWarningCopy.draftWarningsNote + " "
                                     + info.warnings.map { "\($0.fieldLabel): \($0.displayMessage)" }
                                        .joined(separator: " · "))
                                    .font(.system(size: 12))
                                    .foregroundStyle(WVColor.orange)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            // Not used at all — the user has to fill these in.
                            if !info.unmatched.isEmpty {
                                Text(DeviceWarningCopy.draftUnmatchedNote + " "
                                     + info.unmatched.map(Self.unmatchedLabel).joined(separator: ", "))
                                    .font(.system(size: 12))
                                    .foregroundStyle(WVColor.label3)
                                    .fixedSize(horizontal: false, vertical: true)
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

                // Resale ("Bán lại", migration 0006). Independent of `status`: the
                // server accepts SOLD with no figures, and figures without SOLD.
                // What it does *not* accept is half a pair — the form checks the
                // server's own rule before it sends, and shows the server's own
                // Vietnamese copy when it refuses.
                WVSectionHeader("Bán lại")
                WVSectionFooter("Ghi ngày bán và giá bán để tính lãi/lỗ so với giá mua. Bỏ trống nếu chưa bán.")
                WVGroup {
                    Button {
                        saleRecorded.toggle()
                        fieldErrors["soldAt"] = nil
                        fieldErrors["soldPrice"] = nil
                    } label: {
                        HStack(spacing: 12) {
                            Text(saleRecorded ? "Bỏ ghi nhận" : "Ghi nhận đã bán")
                                .font(.system(size: 17))
                                .foregroundStyle(WVColor.tint)
                            Spacer(minLength: 0)
                            if saleRecorded {
                                WVIcon("check", size: 15)
                                    .foregroundStyle(WVColor.tint)
                            }
                        }
                        .padding(.horizontal, 16)
                        .frame(minHeight: 44)
                        .padding(.vertical, 7)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(WVRowButtonStyle())

                    if saleRecorded {
                        WVDivider()

                        HStack(spacing: 12) {
                            Text("Ngày bán")
                                .font(.system(size: 17))
                                .foregroundStyle(WVColor.label)
                            Spacer()
                            DatePicker("", selection: $soldDate, displayedComponents: .date)
                                .labelsHidden()
                                .onChange(of: soldDate) { _, _ in fieldErrors["soldAt"] = nil }
                        }
                        .padding(.horizontal, 16)
                        .frame(minHeight: 44)
                        .padding(.vertical, 7)
                        // The server's own message, never a paraphrase of it.
                        fieldErrorRow("soldAt")

                        WVDivider()

                        HStack(spacing: 12) {
                            Text("Giá bán")
                                .font(.system(size: 17))
                                .foregroundStyle(WVColor.label)
                            Spacer(minLength: 8)
                            // Blank ⇒ nil ("chưa bán"), `0` ⇒ a real price
                            // ("cho tặng"). The field is digit-only, so the
                            // server's negative-price rule cannot be typed here.
                            WVMoneyField(value: $soldPrice, placeholder: "0 ₫")
                                .onChange(of: soldPrice) { _, _ in fieldErrors["soldPrice"] = nil }
                        }
                        .padding(.horizontal, 16)
                        .frame(minHeight: 44)
                        .padding(.vertical, 7)
                        fieldErrorRow("soldPrice")

                        WVDivider()

                        HStack(spacing: 8) {
                            Text("Nhập 0 nếu cho tặng. Cần cả ngày bán và giá bán.")
                                .font(.system(size: 12))
                                .foregroundStyle(WVColor.label3)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)

                        // Lãi/lỗ so với giá mua, updated as the user types — the
                        // same wording the web and Android clients render.
                        if let profit = liveProfitLoss {
                            WVDivider()
                            HStack(spacing: 10) {
                                WVIcon(profit.tone == .loss ? "trendingDown" : "trendingUp", size: 15)
                                    .foregroundStyle(Self.saleToneColor(profit.tone))
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(profit.label)
                                        .font(.system(size: 15, weight: .semibold))
                                        .foregroundStyle(Self.saleToneColor(profit.tone))
                                    Text("so với giá mua \(WVFormat.vnd(price ?? 0))")
                                        .font(.system(size: 12))
                                        .foregroundStyle(WVColor.label3)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 16)
                            .frame(minHeight: 44)
                            .padding(.vertical, 7)
                        }
                    }
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
                    if didSave {
                        // The save already happened; the only thing left is to
                        // leave the screen.
                        WVButton("Xong", icon: "check", kind: .primary) { dismiss() }
                            .padding(.horizontal, WVSpacing.gutter)
                            .padding(.vertical, 20)
                    } else {
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
                }

                Spacer().frame(height: 24)
            }
        }
        .wvScreen()
        .navigationTitle(isEditing ? "Sửa thiết bị" : "Thiết bị mới")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                if didSave {
                    Button("Đóng") { dismiss() }
                        .foregroundStyle(WVColor.tint)
                } else {
                    Button("Huỷ") { showDiscardAlert = true }
                        .foregroundStyle(WVColor.tint)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                if isSubmitting {
                    ProgressView()
                } else if didSave {
                    Button("Xong") { dismiss() }
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(WVColor.tint)
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
        // Photo library picker (images only — PDFs come through Files below).
        .photosPicker(isPresented: $showPhotoPicker, selection: $scanPhotoItem, matching: .images)
        .fileImporter(
            isPresented: $showPDFImporter,
            allowedContentTypes: [.pdf],
            allowsMultipleSelection: false
        ) { result in
            Task { await handlePDFImport(result) }
        }
    }

    // MARK: - OCR receipt scan

    private func handleScan(_ item: PhotosPickerItem) async {
        defer { scanPhotoItem = nil }
        topError = nil
        scanInfo = nil
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { return }
            guard data.count <= AttachmentFileType.maxBytes else {
                topError = AttachmentFileType.tooLargeMessage
                return
            }
            // The endpoint takes JPEG/PNG/WEBP/PDF and cross-checks the declared
            // Content-Type against the magic bytes. iPhones write HEIC by
            // default, so anything that isn't accepted but *is* an image is
            // re-encoded as JPEG — a PDF is never touched (it is a supported
            // input on its own, and `UIImage` cannot read it anyway).
            switch AttachmentFileType.ocrPayload(for: data) {
            case let .asIs(mimeType, fileExtension):
                await scan(fileName: "receipt-\(Self.stamp()).\(fileExtension)",
                           fileType: mimeType, data: data)

            case .transcodeToJPEG:
                guard let image = UIImage(data: data),
                      let jpeg = image.jpegData(compressionQuality: 0.9) else {
                    topError = AttachmentFileType.ocrUnsupportedMessage
                    return
                }
                await scan(fileName: "receipt-\(Self.stamp()).jpg",
                           fileType: "image/jpeg", data: jpeg)

            case .unsupported:
                topError = AttachmentFileType.ocrUnsupportedMessage
            }
        } catch {
            topError = "Không đọc được ảnh, thử lại sau"
        }
    }

    /// PDF receipts come from Files rather than the photo library, but are
    /// handled exactly like one: the bytes go up untouched.
    private func handlePDFImport(_ result: Result<[URL], Error>) async {
        topError = nil
        scanInfo = nil
        guard case let .success(urls) = result, let url = urls.first else {
            if case .failure = result { topError = "Không mở được file." }
            return
        }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            guard data.count <= AttachmentFileType.maxBytes else {
                topError = AttachmentFileType.tooLargeMessage
                return
            }
            // Only a real PDF; a picked file that sniffs as something else would
            // be rejected by the server after a wasted round trip.
            guard case let .asIs(mimeType, _) = AttachmentFileType.ocrPayload(for: data),
                  mimeType == "application/pdf" else {
                topError = AttachmentFileType.ocrUnsupportedMessage
                return
            }
            await scan(fileName: "receipt-\(Self.stamp()).pdf", fileType: mimeType, data: data)
        } catch {
            topError = "Không đọc được file."
        }
    }

    /// The single place that calls `extractReceipt`, so both entry points fill
    /// the form the same way.
    private func scan(fileName: String, fileType: String, data: Data) async {
        scanning = true
        defer { scanning = false }
        do {
            let draft = try await client.extractReceipt(
                fileName: fileName, fileType: fileType, data: data
            )
            applyDraft(draft)
            scanInfo = ScanInfo(confidence: draft.confidence,
                                unmatched: draft.unmatched,
                                warnings: draft.warningsOrEmpty)
        } catch let err as APIError {
            topError = err.localizedDescription
        } catch {
            topError = "Không quét được hoá đơn, thử lại sau"
        }
    }

    private static func stamp() -> Int { Int(Date().timeIntervalSince1970) }

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
        // The extractor normalises to `YYYY-MM-DD` (`api/internal/ai/extract.go`),
        // so the day is read off the string in the device's own zone — the zone
        // the picker below draws its `Date` in. A zone-pinned parse shows a
        // receipt dated the 2nd as the 1st to anyone west of the pin.
        if let v = d.purchaseDate, let date = WireDay.date(from: v) { purchaseDate = date }
        if let v = d.purchasePrice { price = v }
        if let v = d.purchasePlace, !v.isEmpty { purchasePlace = v }
        if let v = d.warrantyMonths { warrantyMonths = String(v) }
    }

    private static func unmatchedLabel(_ key: String) -> String {
        switch key {
        case "brand": return "Hãng"
        case "purchasePlace": return "Nơi mua"
        case "category": return "Loại thiết bị"
        // The extractor drops these when the value is unusable (>120 bytes of
        // junk, or a warranty length outside 0–120) — see `DraftDevice.unmatched`.
        case "serialNumber": return "Serial / IMEI"
        case "warrantyMonths": return "Số tháng bảo hành"
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

    /// The server's own field message under a sale input — shown verbatim, in
    /// red, or not at all. `PATCH` answers a half-filled pair with its Vietnamese
    /// copy (`Thiếu ngày bán` / `Thiếu giá bán` / `Giá bán không hợp lệ`) and the
    /// user must read exactly that, not a paraphrase.
    @ViewBuilder
    private func fieldErrorRow(_ key: String) -> some View {
        if let message = fieldErrors[key]?.first {
            Text(message)
                .font(.system(size: 12))
                .foregroundStyle(WVColor.red)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
        }
    }

    // MARK: - Submit

    private func submit() async {
        topError = nil; fieldErrors = [:]
        isSubmitting = true
        defer { isSubmitting = false }

        // The picker's `Date` is zoned; the wire value is a bare calendar day. It
        // has to be written in the zone the picker drew it in, or a device east of
        // the formatter's pin stores the day *before* the one on screen.
        let isoDate = WireDay.string(from: purchaseDate)
        var input = DeviceInput(name: name.trimmingCharacters(in: .whitespaces),
                                category: category, purchaseDate: isoDate)
        input.brand = brand.isEmpty ? nil : brand
        input.model = model.isEmpty ? nil : model
        input.serialNumber = serial.isEmpty ? nil : serial
        input.purchasePlace = purchasePlace.isEmpty ? nil : purchasePlace
        input.purchasePrice = price ?? 0
        input.status = status
        input.notes = notes.isEmpty ? nil : notes

        // The window is fully replaced by a PATCH, so the values loaded from the
        // device travel back on every save — create included (both are nil there,
        // which the encoder omits). There is no UI for this and deliberately so:
        // no client may *set* a window until all three ship the fields.
        DeviceReturnWindow.apply(returnWindow, to: &input)

        // Resale (migration 0006) — same full-replacement rule, but here the
        // screen owns the input too. The server's pair rule is checked locally
        // first so a half-filled sale is never sent at all; the copy it reports
        // is the server's own (see `DeviceResale`), and whatever the server
        // rejects beyond that still lands in `fieldErrors` below.
        let sale = saleFields
        let saleErrors = DeviceResale.pairErrors(sale, recording: saleRecorded)
        if !saleErrors.isEmpty {
            fieldErrors = saleErrors
            topError = saleErrors["soldAt"]?.first ?? saleErrors["soldPrice"]?.first
            return
        }
        DeviceResale.apply(sale, to: &input)

        if !isEditing {
            input.warrantyMonths = Int(warrantyMonths) ?? 0
            input.warrantyProvider = warrantyProvider.isEmpty ? nil : warrantyProvider
            input.warrantyPhone = warrantyPhone.isEmpty ? nil : warrantyPhone
            input.warrantyAddress = warrantyAddress.isEmpty ? nil : warrantyAddress
        } else {
            input.warrantyMonths = 0
        }

        do {
            let result: DeviceSaveResult
            if let device {
                result = try await store.update(id: device.id, input)
            } else {
                result = try await store.create(input)
            }

            // Nothing is blocked: if the server flagged the serial, the device
            // was still created/updated. Keep the screen up just long enough to
            // read the note instead of flashing a toast that the next screen
            // covers.
            let warnings = result.warningsOrEmpty
            if warnings.isEmpty {
                dismiss()
            } else {
                savedWarnings = warnings
                didSave = true
            }
        } catch let err as APIError {
            topError = err.localizedDescription
            fieldErrors = err.fieldErrors
        } catch {
            topError = error.localizedDescription
        }
    }

    // MARK: - Post-save advisories

    /// "Saved, but this looks wrong" — deliberately green (a success) carrying
    /// amber lines, never the red error styling.
    private var saveWarningsCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                WVIcon("checkCircle", size: 14)
                Text(DeviceWarningCopy.savedHeading)
                    .font(.system(size: 14, weight: .semibold))
            }
            .foregroundStyle(WVColor.green)

            ForEach(Array(savedWarnings.enumerated()), id: \.offset) { _, warning in
                HStack(alignment: .top, spacing: 6) {
                    WVIcon("alert", size: 12)
                        .foregroundStyle(WVColor.orange)
                    Text("\(warning.fieldLabel): \(warning.displayMessage)")
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.label2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Text(DeviceWarningCopy.savedNote)
                .font(.system(size: 12))
                .foregroundStyle(WVColor.label3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WVColor.green.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
        .padding(.horizontal, WVSpacing.gutter)
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
