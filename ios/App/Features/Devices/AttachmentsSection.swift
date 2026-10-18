import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import WarrlyKit

// ============================================================
// DeviceAttachmentsSection — inline attachments inside device detail
//
// Keeps all upload/download/delete wiring from the old
// AttachmentsSection.swift and rebuilds the UI to match the
// prototype (thumbnail grid + "Tải file mới lên" row).
// ============================================================

struct DeviceAttachmentsSection: View {
    let client: APIClient
    let deviceId: String
    let initialAttachments: [AttachmentMeta]

    @State private var attachments: [AttachmentMeta]
    @State private var downloadURLs: [String: URL] = [:]
    @State private var hasLoadedInitial = false
    @State private var isLoading = false
    @State private var pendingDeleteId: String?
    @State private var pendingUpload = false
    @State private var photoItem: PhotosPickerItem?
    @State private var showFileImporter = false
    @State private var errorMessage: String?
    @State private var showPreviewURL: URL?
    /// The attachment whose description is being edited. Non-nil presents the
    /// one-field sheet (`PATCH /api/v1/attachments/{id}`).
    @State private var editingAttachment: AttachmentMeta?

    init(client: APIClient, deviceId: String, initialAttachments: [AttachmentMeta]) {
        self.client = client
        self.deviceId = deviceId
        self.initialAttachments = initialAttachments
        _attachments = State(initialValue: initialAttachments)
    }

    private var canUpload: Bool { attachments.count < 5 }

    // MARK: - Body

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if isLoading && attachments.isEmpty {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, WVSpacing.lg)
                    .padding(.horizontal, WVSpacing.gutter)
            } else {
                WVGroup {
                    // Thumbnail grid (if any). Two columns rather than three:
                    // the tile now also carries the attachment's description
                    // (written on any client), which needs the width. Three
                    // columns only had room for a filename.
                    if !attachments.isEmpty {
                        LazyVGrid(
                            columns: [
                                GridItem(.flexible(), spacing: 8),
                                GridItem(.flexible(), spacing: 8),
                            ],
                            spacing: 8
                        ) {
                            ForEach(attachments) { att in
                                AttachmentThumbnail(
                                    att: att,
                                    downloadURL: downloadURLs[att.id],
                                    isDeleting: pendingDeleteId == att.id,
                                    onDelete: { Task { await delete(att) } },
                                    onEditDescription: { editingAttachment = att }
                                )
                            }
                        }
                        .padding(12)
                        WVDivider()
                    }

                    // Upload row
                    if canUpload {
                        // Images only: the server's MIME whitelist is
                        // JPG/PNG/WEBP/GIF/HEIC + PDF, so offering videos here
                        // just produced a rejected upload.
                        PhotosPicker(selection: $photoItem, matching: .images) {
                            HStack(spacing: 12) {
                                WVLeadingIcon(icon: "upload", color: WVColor.blue, size: 30)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(L.t("Tải file mới lên"))
                                        .font(.system(size: 17))
                                        .foregroundStyle(WVColor.tint)
                                    Text(L.t("Ảnh hoặc PDF, ≤5MB"))
                                        .font(.system(size: 13))
                                        .foregroundStyle(WVColor.label3)
                                }
                                Spacer()
                                if pendingUpload {
                                    ProgressView()
                                } else {
                                    WVIcon("arrowRight", size: 13)
                                        .foregroundStyle(WVColor.label4)
                                }
                            }
                            .padding(.horizontal, 16)
                            .frame(minHeight: 44)
                            .padding(.vertical, 7)
                            .contentShape(Rectangle())
                        }
                        .disabled(pendingUpload)
                        .buttonStyle(WVRowButtonStyle())

                        WVDivider()

                        // PDF picker row
                        Button {
                            showFileImporter = true
                        } label: {
                            HStack(spacing: 12) {
                                WVLeadingIcon(icon: "paperclip", color: WVColor.orange, size: 30)
                                Text(L.t("Thêm PDF"))
                                    .font(.system(size: 17))
                                    .foregroundStyle(WVColor.tint)
                                Spacer()
                            }
                            .padding(.horizontal, 16)
                            .frame(minHeight: 44)
                            .padding(.vertical, 7)
                            .contentShape(Rectangle())
                        }
                        .disabled(pendingUpload)
                        .buttonStyle(WVRowButtonStyle())
                    }
                }
            }

            // Error
            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.red)
                    .padding(.horizontal, 32)
                    .padding(.top, 8)
            }
        }
        .task {
            guard !hasLoadedInitial else { return }
            hasLoadedInitial = true
            rebuildURLs()
            await refresh()
        }
        .onChange(of: photoItem) { _, newItem in
            guard let newItem else { return }
            Task { await uploadPhoto(item: newItem) }
        }
        .fileImporter(
            isPresented: $showFileImporter,
            allowedContentTypes: [.pdf],
            allowsMultipleSelection: false
        ) { result in
            Task { await handleFileImport(result: result) }
        }
        .sheet(item: $editingAttachment) { att in
            AttachmentDescriptionSheet(client: client, attachment: att) { updated in
                replace(updated)
            }
        }
    }

    // MARK: - Actions

    /// Swaps one attachment's metadata after a PATCH, keeping its position in
    /// the grid and its cached download URL.
    private func replace(_ updated: AttachmentMeta) {
        guard let idx = attachments.firstIndex(where: { $0.id == updated.id }) else { return }
        attachments[idx] = updated
    }

    private func refresh() async {
        isLoading = true
        defer { isLoading = false }
        do {
            attachments = try await client.listAttachments(deviceId: deviceId)
            rebuildURLs()
        } catch {
            errorMessage = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }

    private func rebuildURLs() {
        var map: [String: URL] = [:]
        for att in attachments {
            map[att.id] = client.attachmentDownloadURL(id: att.id)
        }
        downloadURLs = map
    }

    private func delete(_ att: AttachmentMeta) async {
        errorMessage = nil
        pendingDeleteId = att.id
        defer { pendingDeleteId = nil }
        do {
            try await client.deleteAttachment(id: att.id)
            attachments.removeAll { $0.id == att.id }
            downloadURLs.removeValue(forKey: att.id)
        } catch {
            errorMessage = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }

    private func uploadPhoto(item: PhotosPickerItem) async {
        defer { photoItem = nil }
        errorMessage = nil
        pendingUpload = true
        defer { pendingUpload = false }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { return }
            guard data.count <= AttachmentFileType.maxBytes else {
                errorMessage = AttachmentFileType.tooLargeMessage
                return
            }
            // Declare what the bytes actually are. iPhones shoot HEIC by
            // default, and Go rejects an upload whose Content-Type disagrees
            // with its magic bytes.
            guard let type = AttachmentFileType.detect(data) else {
                errorMessage = AttachmentFileType.unsupportedMessage
                return
            }
            let name = "photo-\(Int(Date().timeIntervalSince1970)).\(type.fileExtension)"
            let meta = try await client.uploadAttachment(
                deviceId: deviceId, fileName: name, fileType: type.mimeType,
                data: data, description: nil
            )
            attachments.insert(meta, at: 0)
            downloadURLs[meta.id] = client.attachmentDownloadURL(id: meta.id)
        } catch {
            errorMessage = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }

    private func handleFileImport(result: Result<[URL], Error>) async {
        errorMessage = nil
        do {
            let urls = try result.get()
            guard let url = urls.first else { return }
            let needsScope = url.startAccessingSecurityScopedResource()
            defer { if needsScope { url.stopAccessingSecurityScopedResource() } }
            pendingUpload = true
            defer { pendingUpload = false }
            let data = try Data(contentsOf: url)
            guard data.count <= AttachmentFileType.maxBytes else {
                errorMessage = AttachmentFileType.tooLargeMessage
                return
            }
            // The importer is restricted to `.pdf`, but sniff anyway so a
            // renamed file can't produce a declared/actual mismatch.
            guard let type = AttachmentFileType.detect(data) else {
                errorMessage = AttachmentFileType.unsupportedMessage
                return
            }
            let fileName = url.lastPathComponent
            let meta = try await client.uploadAttachment(
                deviceId: deviceId, fileName: fileName, fileType: type.mimeType,
                data: data, description: nil
            )
            attachments.insert(meta, at: 0)
            downloadURLs[meta.id] = client.attachmentDownloadURL(id: meta.id)
        } catch {
            errorMessage = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }
}

// MARK: - Attachment thumbnail

private struct AttachmentThumbnail: View {
    let att: AttachmentMeta
    let downloadURL: URL?
    let isDeleting: Bool
    let onDelete: () -> Void
    let onEditDescription: () -> Void

    private var isImage: Bool { att.fileType.hasPrefix("image/") }

    /// What the tile prints under the filename. A description set on the web or
    /// Android used to be decoded and then shown nowhere.
    private var description: String? {
        guard let text = att.description?.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty else { return nil }
        return text
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            // Tile background
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [WVColor.fill3, WVColor.fill4],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .aspectRatio(1, contentMode: .fit)
                .overlay {
                    // Icon + filename + description
                    VStack(spacing: 4) {
                        WVIcon(isImage ? "camera" : "receipt", size: 24, weight: .regular)
                            .foregroundStyle(WVColor.label3)
                        Text(att.fileName)
                            .font(.system(size: 11))
                            .foregroundStyle(WVColor.label3)
                            .lineLimit(2)
                            .multilineTextAlignment(.center)
                        if let description {
                            Text(description)
                                .font(.system(size: 10))
                                .foregroundStyle(WVColor.label2)
                                .lineLimit(2)
                                .multilineTextAlignment(.center)
                        }
                    }
                    .padding(.horizontal, 6)
                }
                .overlay {
                    // Tap to open
                    if let url = downloadURL {
                        Link(destination: url) {
                            Color.clear
                        }
                    }
                }

            // Delete button
            Button(action: onDelete) {
                if isDeleting {
                    ProgressView()
                        .scaleEffect(0.7)
                        .frame(width: 22, height: 22)
                } else {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(WVColor.label2)
                        .background(WVColor.bg2.clipShape(Circle()))
                }
            }
            .offset(x: 6, y: -6)
            .disabled(isDeleting)
            .accessibilityLabel(L.t("Xoá"))
        }
        .overlay(alignment: .topLeading) {
            Button(action: onEditDescription) {
                Image(systemName: "pencil.circle.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(WVColor.label2)
                    .background(WVColor.bg2.clipShape(Circle()))
            }
            .offset(x: -6, y: -6)
            .accessibilityLabel(L.t("Sửa mô tả"))
        }
    }
}
