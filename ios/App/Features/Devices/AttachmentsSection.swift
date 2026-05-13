import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import WarrantyVaultKit

struct AttachmentsSection: View {
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

    init(client: APIClient, deviceId: String, initialAttachments: [AttachmentMeta]) {
        self.client = client
        self.deviceId = deviceId
        self.initialAttachments = initialAttachments
        _attachments = State(initialValue: initialAttachments)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: WV.Spacing.md) {
            HStack {
                Text("Tài liệu / Ảnh đính kèm")
                    .font(.system(size: 17, weight: .semibold))
                Spacer()
                Text("\(attachments.count) tệp")
                    .font(.system(size: 12))
                    .foregroundStyle(WV.Tokens.mutedFg)
            }
            .padding(.horizontal, WV.Spacing.lg)

            if isLoading && attachments.isEmpty {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, WV.Spacing.lg)
            } else if attachments.isEmpty {
                emptyState
            } else {
                VStack(spacing: WV.Spacing.sm) {
                    ForEach(attachments) { att in
                        attachmentRow(att)
                    }
                }
                .padding(.horizontal, WV.Spacing.lg)
            }

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(WV.Tokens.destructive)
                    .font(.system(size: 13))
                    .padding(.horizontal, WV.Spacing.lg)
            }

            HStack(spacing: WV.Spacing.md) {
                PhotosPicker(selection: $photoItem, matching: .images) {
                    if pendingUpload {
                        ProgressView()
                    } else {
                        Label("Thêm ảnh", systemImage: "photo")
                    }
                }
                .buttonStyle(SecondaryButtonStyle(fullWidth: true))
                .disabled(pendingUpload)

                Button {
                    showFileImporter = true
                } label: {
                    Label("Thêm PDF", systemImage: "doc")
                }
                .buttonStyle(SecondaryButtonStyle(fullWidth: true))
                .disabled(pendingUpload)
            }
            .padding(.horizontal, WV.Spacing.lg)
        }
        .task {
            // The detail body already gives us attachments; refresh once on appear
            // to pick up changes made on another device.
            guard !hasLoadedInitial else { return }
            hasLoadedInitial = true
            await rebuildURLs()
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

    // MARK: - Rows

    private var emptyState: some View {
        VStack(spacing: WV.Spacing.sm) {
            Image(systemName: "paperclip")
                .font(.system(size: 32, weight: .light))
                .foregroundStyle(WV.Tokens.mutedFg)
            Text("Chưa có tệp đính kèm")
                .font(.system(size: 13))
                .foregroundStyle(WV.Tokens.mutedFg)
        }
        .padding(WV.Spacing.lg)
        .frame(maxWidth: .infinity)
    }

    private func attachmentRow(_ att: AttachmentMeta) -> some View {
        WVCard {
            HStack(alignment: .center, spacing: WV.Spacing.md) {
                Image(systemName: iconFor(fileType: att.fileType))
                    .font(.system(size: 22))
                    .foregroundStyle(WV.Tokens.primary)
                    .frame(width: 40, height: 40)
                    .background(WV.Tokens.primary.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: WV.Radius.md))
                VStack(alignment: .leading, spacing: 4) {
                    Text(att.fileName)
                        .font(.system(size: 14, weight: .medium))
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Text(formatBytes(att.fileSize))
                        .font(.system(size: 12))
                        .foregroundStyle(WV.Tokens.mutedFg)
                }
                Spacer()
                if let url = downloadURLs[att.id] {
                    Link(destination: url) {
                        Image(systemName: "arrow.up.right.square")
                            .font(.system(size: 18))
                            .foregroundStyle(WV.Tokens.primary)
                    }
                }
                Button {
                    Task { await delete(att) }
                } label: {
                    if pendingDeleteId == att.id {
                        ProgressView()
                    } else {
                        Image(systemName: "trash")
                            .font(.system(size: 16))
                            .foregroundStyle(WV.Tokens.destructive)
                    }
                }
                .disabled(pendingDeleteId != nil)
            }
        }
    }

    // MARK: - Actions

    private func refresh() async {
        isLoading = true
        defer { isLoading = false }
        do {
            attachments = try await client.listAttachments(deviceId: deviceId)
            await rebuildURLs()
        } catch {
            errorMessage = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }

    /// `attachmentDownloadURL` is actor-isolated; pre-resolve URLs once per refresh
    /// so the rows can use them synchronously.
    private func rebuildURLs() async {
        var map: [String: URL] = [:]
        for att in attachments {
            map[att.id] = await client.attachmentDownloadURL(id: att.id)
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
            // Try to detect PNG vs JPEG from magic bytes; default to JPEG.
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
            downloadURLs[meta.id] = await client.attachmentDownloadURL(id: meta.id)
        } catch {
            errorMessage = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }

    private func handleFileImport(result: Result<[URL], Error>) async {
        errorMessage = nil
        do {
            let urls = try result.get()
            guard let url = urls.first else { return }
            // Security-scoped resource — required for files outside the app sandbox.
            let needsScope = url.startAccessingSecurityScopedResource()
            defer { if needsScope { url.stopAccessingSecurityScopedResource() } }
            pendingUpload = true
            defer { pendingUpload = false }
            let data = try Data(contentsOf: url)
            let name = url.lastPathComponent
            let meta = try await client.uploadAttachment(
                deviceId: deviceId, fileName: name, fileType: "application/pdf",
                data: data, description: nil
            )
            attachments.insert(meta, at: 0)
            downloadURLs[meta.id] = await client.attachmentDownloadURL(id: meta.id)
        } catch {
            errorMessage = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }

    // MARK: - Helpers

    private func iconFor(fileType: String) -> String {
        if fileType.hasPrefix("image/") { return "photo" }
        if fileType == "application/pdf" { return "doc.text" }
        return "doc"
    }

    private func formatBytes(_ bytes: Int) -> String {
        let f = ByteCountFormatter()
        f.countStyle = .file
        return f.string(fromByteCount: Int64(bytes))
    }
}
