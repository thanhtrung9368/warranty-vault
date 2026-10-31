import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import WarrlyKit

// ============================================================
// Device attachments — the receipt surface of a device
//
// Two views over one model:
//
//  * `ReceiptStrip` — the horizontal strip in the hero. A receipt is the
//    product's promise ("keep the receipt"), so it belongs where the eye
//    lands, not as the fourteenth section of sixteen.
//  * `DeviceAttachmentsSection` — the managing surface: a group of rows, one
//    per receipt (56 pt thumbnail, filename, description, one `...` menu), then
//    the add rows. It is a list of items among peers, not a card (§4), so it
//    has no background, no radius and no floating buttons of its own.
//
// Both read and write `DeviceAttachmentsModel`, so an upload from the strip
// appears in the full section immediately (and vice versa) without a second
// device read.
//
// Tapping a tile opens `QLPreviewSheet` (see DesignSystem/AttachmentPreview):
// the byte stream is bearer-gated, so this used to be a `Link` that handed
// Safari a request with no Authorization header and got a 404.
// ============================================================

// MARK: - Model

/// The attachments of one device, shared by the hero strip and the full
/// section.
///
/// Ownership used to sit inside the section: it fetched its own list, so a
/// second surface could not exist without a second read and the two could
/// disagree after an upload.
@MainActor
final class DeviceAttachmentsModel: ObservableObject {
    @Published private(set) var attachments: [AttachmentMeta]
    @Published private(set) var isLoading = false
    @Published private(set) var isUploading = false
    @Published private(set) var pendingDeleteId: String?
    @Published var errorMessage: String?

    /// True once a list read has answered (successfully or not), so a count is
    /// never printed before the read that produces it.
    @Published private(set) var hasLoaded = false

    private let client: APIClient
    let deviceId: String

    init(client: APIClient, deviceId: String, initial: [AttachmentMeta] = []) {
        self.client = client
        self.deviceId = deviceId
        self.attachments = initial
    }

    /// The server's per-device ceiling (`MAX_ATTACHMENTS_PER_DEVICE`).
    var canUpload: Bool { attachments.count < 5 }

    // MARK: Read

    func loadIfNeeded() async {
        guard !hasLoaded else { return }
        await reload()
    }

    func reload() async {
        isLoading = true
        defer { isLoading = false }
        do {
            attachments = try await client.listAttachments(deviceId: deviceId)
            errorMessage = nil
        } catch {
            errorMessage = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
        hasLoaded = true
    }

    // MARK: Write

    func apply(_ updated: AttachmentMeta) {
        guard let idx = attachments.firstIndex(where: { $0.id == updated.id }) else { return }
        attachments[idx] = updated
    }

    func delete(_ att: AttachmentMeta) async {
        errorMessage = nil
        pendingDeleteId = att.id
        defer { pendingDeleteId = nil }
        do {
            try await client.deleteAttachment(id: att.id)
            attachments.removeAll { $0.id == att.id }
            AttachmentThumbnailCache.remove(for: att.id)
        } catch {
            errorMessage = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }

    @discardableResult
    func upload(data: Data, fileName: String, fileType: String) async -> AttachmentMeta? {
        errorMessage = nil
        guard data.count <= AttachmentFileType.maxBytes else {
            errorMessage = AttachmentFileType.tooLargeMessage
            return nil
        }
        isUploading = true
        defer { isUploading = false }
        do {
            let meta = try await client.uploadAttachment(
                deviceId: deviceId, fileName: fileName, fileType: fileType,
                data: data, description: nil
            )
            attachments.insert(meta, at: 0)
            return meta
        } catch {
            errorMessage = (error as? APIError)?.localizedDescription ?? error.localizedDescription
            return nil
        }
    }

    /// Upload a picked photo. Declares the bytes' real type: iPhones shoot HEIC
    /// by default, and Go rejects an upload whose Content-Type disagrees with
    /// its magic bytes.
    func uploadPhoto(item: PhotosPickerItem) async {
        errorMessage = nil
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { return }
            guard let type = AttachmentFileType.detect(data) else {
                errorMessage = AttachmentFileType.unsupportedMessage
                return
            }
            let name = "photo-\(Int(Date().timeIntervalSince1970)).\(type.fileExtension)"
            await upload(data: data, fileName: name, fileType: type.mimeType)
        } catch {
            errorMessage = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }

    func importPDF(result: Result<[URL], Error>) async {
        errorMessage = nil
        do {
            let urls = try result.get()
            guard let url = urls.first else { return }
            let needsScope = url.startAccessingSecurityScopedResource()
            defer { if needsScope { url.stopAccessingSecurityScopedResource() } }
            let data = try Data(contentsOf: url)
            // The importer is restricted to `.pdf`, but sniff anyway so a
            // renamed file can't produce a declared/actual mismatch.
            guard let type = AttachmentFileType.detect(data) else {
                errorMessage = AttachmentFileType.unsupportedMessage
                return
            }
            await upload(data: data, fileName: url.lastPathComponent, fileType: type.mimeType)
        } catch {
            errorMessage = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }
}

// MARK: - Hero strip

/// Horizontal receipt strip for the device hero: one 64 pt tile per
/// attachment, plus an "add receipt" ghost tile while there is room.
///
/// Reads only for viewing; deleting and writing descriptions stay in the full
/// section below, where each receipt gets a row of its own and one menu.
struct ReceiptStrip: View {
    let client: APIClient
    @ObservedObject var model: DeviceAttachmentsModel

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @State private var previewing: AttachmentMeta?
    @State private var photoItem: PhotosPickerItem?
    @State private var showPhotoPicker = false
    @State private var showFileImporter = false

    private let tile = 64.0

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(model.attachments) { att in
                        Button {
                            previewing = att
                        } label: {
                            AttachmentThumbnailImage(
                                client: client,
                                attachment: att,
                                size: tile,
                                cornerRadius: 12
                            )
                            .overlay {
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .strokeBorder(WVColor.sep, lineWidth: 0.5)
                            }
                        }
                        .buttonStyle(WVPressableStyle())
                        .accessibilityLabel(att.fileName)
                        .accessibilityHint(L.t("Mở tệp"))
                        .accessibilityIdentifier("receipt-thumb-\(att.id)")
                    }

                    if model.canUpload { addTile }
                }
                .padding(.horizontal, WVSpacing.gutter)
                .padding(.vertical, 2)
            }

            if let error = model.errorMessage {
                Text(error)
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.red)
                    .padding(.horizontal, WVSpacing.gutter)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .fullScreenCover(item: $previewing) { att in
            QLPreviewSheet(client: client, attachment: att)
        }
        .photosPicker(
            isPresented: $showPhotoPicker,
            selection: $photoItem,
            matching: .images
        )
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            photoItem = nil
            Task { await model.uploadPhoto(item: item) }
        }
        .fileImporter(
            isPresented: $showFileImporter,
            allowedContentTypes: [.pdf],
            allowsMultipleSelection: false
        ) { result in
            Task { await model.importPDF(result: result) }
        }
    }

    /// The empty slot at the end of the strip. A menu rather than a photos
    /// picker directly, because a receipt can be a photo or a PDF and both
    /// paths already exist below.
    private var addTile: some View {
        Menu {
            Button {
                showPhotoPicker = true
            } label: {
                Label(L.t("Thêm ảnh"), systemImage: "photo")
            }
            Button {
                showFileImporter = true
            } label: {
                Label(L.t("Thêm PDF"), systemImage: "doc")
            }
        } label: {
            VStack(spacing: 3) {
                if model.isUploading {
                    ProgressView().controlSize(.small)
                } else {
                    WVIcon("plus", size: 20, weight: .semibold)
                        .foregroundStyle(WVColor.tint)
                }
                if !dynamicTypeSize.isAccessibilitySize {
                    Text(L.t("Thêm"))
                        .wvFont(.caption2Emphasis)
                        .foregroundStyle(WVColor.tint)
                        .lineLimit(1)
                }
            }
            .frame(width: tile, height: tile)
            .background(WVColor.tint.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(
                        WVColor.tint.opacity(0.55),
                        style: StrokeStyle(lineWidth: 1, dash: [4, 3])
                    )
            }
            .contentShape(Rectangle())
        }
        .disabled(model.isUploading)
        .accessibilityLabel(L.t("Thêm hoá đơn"))
        .accessibilityIdentifier("receipt-add")
    }
}

// MARK: - Full section

struct DeviceAttachmentsSection: View {
    let client: APIClient
    @ObservedObject var model: DeviceAttachmentsModel

    @State private var photoItem: PhotosPickerItem?
    @State private var showFileImporter = false
    @State private var previewing: AttachmentMeta?
    /// The attachment whose description is being edited. Non-nil presents the
    /// one-field sheet (`PATCH /api/v1/attachments/{id}`).
    @State private var editingAttachment: AttachmentMeta?

    // MARK: - Body

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if model.isLoading && model.attachments.isEmpty {
                // The loading vocabulary is fixed (§9.4): a spinner for a read
                // that has not answered yet, never an empty group.
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, WVSpacing.lg)
                    .padding(.horizontal, WVSpacing.gutter)
            } else {
                WVGroup {
                    // One row per receipt. The 176 pt tile with two floating
                    // circular buttons is gone: a receipt is one item among
                    // peers, and its two actions belong in one menu (§8.2).
                    ForEach(Array(model.attachments.enumerated()), id: \.element.id) { idx, att in
                        if idx > 0 { WVDivider() }
                        AttachmentRow(
                            client: client,
                            att: att,
                            isDeleting: model.pendingDeleteId == att.id,
                            onOpen: { previewing = att },
                            onDelete: { Task { await model.delete(att) } },
                            onEditDescription: { editingAttachment = att }
                        )
                    }

                    // The add rows. Neutral text and neutral glyphs: the one
                    // coral action on this screen is the dashed "Thêm" tile in
                    // the hero strip (§5.1).
                    if model.canUpload {
                        if !model.attachments.isEmpty { WVDivider() }
                        uploadRow
                        WVDivider()
                        pdfRow
                    }
                }
            }

            // Error
            if let errorMessage = model.errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.red)
                    .padding(.horizontal, WVSpacing.gutter)
                    .padding(.top, WVSpacing.sm)
            }
        }
        .task { await model.loadIfNeeded() }
        .onChange(of: photoItem) { _, newItem in
            guard let newItem else { return }
            photoItem = nil
            Task { await model.uploadPhoto(item: newItem) }
        }
        .fileImporter(
            isPresented: $showFileImporter,
            allowedContentTypes: [.pdf],
            allowsMultipleSelection: false
        ) { result in
            Task { await model.importPDF(result: result) }
        }
        .sheet(item: $editingAttachment) { att in
            AttachmentDescriptionSheet(client: client, attachment: att) { updated in
                model.apply(updated)
            }
        }
        .fullScreenCover(item: $previewing) { att in
            QLPreviewSheet(client: client, attachment: att)
        }
    }

    // MARK: - Add rows

    /// Pick a photo. Images only: the server's MIME whitelist is
    /// JPG/PNG/WEBP/GIF/HEIC + PDF, so offering videos here just produced a
    /// rejected upload.
    private var uploadRow: some View {
        PhotosPicker(selection: $photoItem, matching: .images) {
            HStack(spacing: WVSpacing.md) {
                WVLeadingIcon(icon: "upload", size: 28)
                VStack(alignment: .leading, spacing: 1) {
                    Text(L.t("Tải file mới lên"))
                        .wvFont(.bodyEmphasis)
                        .foregroundStyle(WVColor.label)
                    Text(L.t("Ảnh hoặc PDF, ≤5MB"))
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                }
                Spacer(minLength: WVSpacing.sm)
                if model.isUploading {
                    ProgressView()
                } else {
                    WVIcon("arrowRight", size: 13)
                        .foregroundStyle(WVColor.label4)
                }
            }
            .padding(.horizontal, WVSpacing.gutter)
            .frame(minHeight: 44)
            .padding(.vertical, WVSpacing.sm)
            .contentShape(Rectangle())
        }
        .disabled(model.isUploading)
        .buttonStyle(WVRowButtonStyle())
    }

    private var pdfRow: some View {
        Button {
            showFileImporter = true
        } label: {
            HStack(spacing: WVSpacing.md) {
                WVLeadingIcon(icon: "paperclip", size: 28)
                Text(L.t("Thêm PDF"))
                    .wvFont(.bodyEmphasis)
                    .foregroundStyle(WVColor.label)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, WVSpacing.gutter)
            .frame(minHeight: 44)
            .padding(.vertical, WVSpacing.sm)
            .contentShape(Rectangle())
        }
        .disabled(model.isUploading)
        .buttonStyle(WVRowButtonStyle())
    }
}

// MARK: - Attachment row

/// One receipt as a row: 56 pt thumbnail (12 pt radius), filename in the
/// `rowTitle` role, the description as `meta`, and a single `...` menu holding
/// Sửa mô tả / Xoá.
///
/// The whole row is the preview target (`QLPreviewSheet`), because the byte
/// stream is bearer-gated and a `Link` would hand Safari a request with no
/// Authorization header. Deleting shows a spinner in the menu's place instead
/// of removing the row optimistically.
private struct AttachmentRow: View {
    let client: APIClient
    let att: AttachmentMeta
    let isDeleting: Bool
    let onOpen: () -> Void
    let onDelete: () -> Void
    let onEditDescription: () -> Void

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    /// §8.2: 56 pt thumbnail, 12 pt radius. 56 is also the row's divider inset,
    /// so the hairlines between receipts stay the one list constant.
    private let thumbnail = 56.0

    /// What the row prints under the filename. A description set on the web or
    /// Android used to be decoded and then shown nowhere.
    private var description: String? {
        guard let text = att.description?.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty else { return nil }
        return text
    }

    var body: some View {
        HStack(spacing: WVSpacing.md) {
            // Tap to open — inside the app, through the authenticated client.
            Button(action: onOpen) {
                HStack(spacing: WVSpacing.md) {
                    AttachmentThumbnailImage(
                        client: client,
                        attachment: att,
                        size: thumbnail,
                        cornerRadius: WVRadius.list
                    )
                    VStack(alignment: .leading, spacing: 1) {
                        Text(att.fileName)
                            .wvFont(.bodyEmphasis)
                            .foregroundStyle(WVColor.label)
                            .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
                            .fixedSize(horizontal: false, vertical: true)
                        if let description {
                            Text(description)
                                .wvFont(.footnote)
                                .foregroundStyle(WVColor.label3)
                                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    // The filename is what must survive the width, not the menu.
                    .layoutPriority(1)
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(WVRowButtonStyle())
            .accessibilityLabel(L.t("Mở tệp"))
            .accessibilityValue(att.fileName)

            if isDeleting {
                ProgressView()
                    .controlSize(.small)
                    .frame(width: 44, height: 44)
            } else {
                menu
            }
        }
        .padding(.horizontal, WVSpacing.gutter)
        .frame(minHeight: 44)
        .padding(.vertical, WVSpacing.sm)
        .contentShape(Rectangle())
    }

    private var menu: some View {
        Menu {
            Button {
                onEditDescription()
            } label: {
                Label(L.t("Sửa mô tả"), systemImage: "pencil")
            }
            Button(role: .destructive) {
                onDelete()
            } label: {
                Label(L.t("Xoá"), systemImage: "trash")
            }
        } label: {
            WVIcon("more", size: 20, weight: .regular)
                .foregroundStyle(WVColor.label2)
                // A 44 pt tap target around a 20 pt glyph.
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(L.t("Tuỳ chọn"))
    }
}
