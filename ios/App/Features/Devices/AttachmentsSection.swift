import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import WarrantyVaultKit

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
                    // Thumbnail grid (if any)
                    if !attachments.isEmpty {
                        LazyVGrid(
                            columns: [
                                GridItem(.flexible(), spacing: 8),
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
                                    onDelete: { Task { await delete(att) } }
                                )
                            }
                        }
                        .padding(12)
                        WVDivider()
                    }

                    // Upload row
                    if canUpload {
                        PhotosPicker(selection: $photoItem, matching: .any(of: [.images, .videos])) {
                            HStack(spacing: 12) {
                                WVLeadingIcon(icon: "upload", color: WVColor.blue, size: 30)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text("Tải file mới lên")
                                        .font(.system(size: 17))
                                        .foregroundStyle(WVColor.tint)
                                    Text("Ảnh hoặc PDF, ≤5MB")
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
                                Text("Thêm PDF")
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
    }

    // MARK: - Actions

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
            let (mime, ext): (String, String)
            if data.starts(with: [0x89, 0x50, 0x4E, 0x47]) {
                mime = "image/png"; ext = "png"
            } else {
                mime = "image/jpeg"; ext = "jpg"
            }
            let name = "photo-\(Int(Date().timeIntervalSince1970)).\(ext)"
            let meta = try await client.uploadAttachment(
                deviceId: deviceId, fileName: name, fileType: mime, data: data, description: nil
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
            let fileName = url.lastPathComponent
            let meta = try await client.uploadAttachment(
                deviceId: deviceId, fileName: fileName, fileType: "application/pdf",
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

    private var isImage: Bool { att.fileType.hasPrefix("image/") }

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
                    // Icon
                    VStack(spacing: 4) {
                        WVIcon(isImage ? "camera" : "receipt", size: 24, weight: .regular)
                            .foregroundStyle(WVColor.label3)
                        Text(att.fileName)
                            .font(.system(size: 9))
                            .foregroundStyle(WVColor.label3)
                            .lineLimit(2)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 4)
                    }
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
        }
    }
}
