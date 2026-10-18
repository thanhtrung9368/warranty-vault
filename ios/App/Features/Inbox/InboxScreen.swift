import SwiftUI
import UIKit
import WarrlyKit

// ============================================================
// InboxScreen — attachments with no device yet.
//
// The list is `GET /api/v1/inbox` (newest first, server-ordered). Each row can
// be filed with `POST /api/v1/attachments/{id}/file`; a 409 `limit_reached`
// keeps the row here and the picker explains the two ways out. Thumbnails go
// through the authenticated `GET /api/files/{id}` route — the stream is
// bearer-gated, so `AsyncImage(url:)` would render an anonymous 404.
// ============================================================

struct InboxScreen: View {
    let client: APIClient

    @EnvironmentObject private var inbox: InboxStore
    @StateObject private var devicesStore: DevicesStore

    @State private var sheet: InboxSheet?
    @State private var pendingDelete: AttachmentMeta?
    @State private var deleteError: String?
    @State private var loadError: String?

    init(client: APIClient) {
        self.client = client
        _devicesStore = StateObject(wrappedValue: DevicesStore(client: client))
    }

    private enum InboxSheet: Identifiable {
        case capture
        case assign(AttachmentMeta)

        var id: String {
            switch self {
            case .capture: return "capture"
            case .assign(let attachment): return "assign-\(attachment.id)"
            }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Spacer().frame(height: 8)

                content
            }
        }
        .wvScreen()
        .navigationTitle(L.t("Hộp thư đến"))
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { sheet = .capture } label: {
                    Image(systemName: "camera.fill")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(WVColor.tint)
                }
                .accessibilityLabel(L.t("Thêm hoá đơn"))
            }
        }
        .sheet(item: $sheet) { sheet in
            switch sheet {
            case .capture:
                InboxCaptureSheet(client: client) { _ in
                    Task { await inbox.load() }
                }
            case .assign(let attachment):
                InboxDevicePickerSheet(
                    inbox: inbox,
                    devicesStore: devicesStore,
                    attachment: attachment
                )
            }
        }
        .confirmationDialog(
            L.t("Xoá tệp"),
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ),
            presenting: pendingDelete
        ) { attachment in
            Button(L.t("Xoá"), role: .destructive) {
                Task { await delete(attachment) }
            }
            Button(L.t("Huỷ"), role: .cancel) { pendingDelete = nil }
        } message: { _ in
            Text(L.t("Tệp sẽ bị xoá vĩnh viễn và không thể hoàn tác."))
        }
        .alert(
            L.t("Không xoá được"),
            isPresented: Binding(
                get: { deleteError != nil },
                set: { if !$0 { deleteError = nil } }
            )
        ) {
            Button("OK", role: .cancel) { deleteError = nil }
        } message: {
            Text(deleteError ?? "")
        }
        .task { await load() }
        .refreshable { await load() }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if inbox.attachments.isEmpty {
            switch inbox.state {
            case .idle, .loading:
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 60)
            case .error(let message):
                WVEmpty(
                    icon: "alert",
                    title: L.t("Không tải được danh sách"),
                    description: message
                ) {
                    WVButton(L.t("Thử lại"), kind: .secondary) {
                        Task { await load() }
                    }
                }
            case .loaded:
                WVEmpty(
                    icon: "receipt",
                    title: L.t("Hộp thư đến đang trống"),
                    description: L.t("Ảnh hoá đơn hoặc PDF chưa gán thiết bị sẽ nằm ở đây.")
                ) {
                    WVButton(L.t("Thêm hoá đơn"), icon: "camera") {
                        sheet = .capture
                    }
                }
            }
        } else {
            WVSectionHeader(L.t("Tệp chưa gán thiết bị"))

            if let loadError {
                Text(loadError)
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.red)
                    .padding(.horizontal, 32)
                    .padding(.bottom, 6)
            }

            WVGroup {
                ForEach(Array(inbox.attachments.enumerated()), id: \.element.id) { index, attachment in
                    if index > 0 { WVDivider(inset: 76) }
                    InboxAttachmentRow(
                        client: client,
                        attachment: attachment,
                        onAssign: { sheet = .assign(attachment) },
                        onDelete: { pendingDelete = attachment }
                    )
                }
            }

            WVSectionFooter(L.t("Gán tệp vào thiết bị để nó không còn trong hộp thư."))
        }
    }

    // MARK: - Actions

    private func load() async {
        loadError = nil
        await inbox.load()
        if case let .error(message) = inbox.state, !inbox.attachments.isEmpty {
            loadError = message
        }
        await devicesStore.load()
    }

    private func delete(_ attachment: AttachmentMeta) async {
        pendingDelete = nil
        deleteError = nil
        do {
            try await inbox.delete(attachment)
        } catch {
            deleteError = (error as? APIError)?.localizedDescription
                ?? error.localizedDescription
        }
    }
}

// MARK: - Row

private struct InboxAttachmentRow: View {
    let client: APIClient
    let attachment: AttachmentMeta
    let onAssign: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            InboxThumbnail(client: client, attachment: attachment)

            VStack(alignment: .leading, spacing: 3) {
                Text(attachment.fileName)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(WVColor.label)
                    .lineLimit(1)
                Text(WVFormat.dateTime(attachment.uploadedAt))
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.label3)

                Button(action: onAssign) {
                    Text(L.t("Gán vào thiết bị"))
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(WVColor.tint)
                }
                .buttonStyle(.plain)
                .padding(.top, 2)
            }

            Spacer(minLength: 4)

            Menu {
                Button(L.t("Gán vào thiết bị")) { onAssign() }
                Button(L.t("Xoá"), role: .destructive) { onDelete() }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.system(size: 20))
                    .foregroundStyle(WVColor.label3)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel(L.t("Tuỳ chọn"))
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 60)
        .padding(.vertical, 10)
    }
}

// MARK: - Thumbnail

private struct InboxThumbnail: View {
    let client: APIClient
    let attachment: AttachmentMeta

    @State private var image: UIImage?

    private var isImage: Bool { attachment.fileType.hasPrefix("image/") }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(WVColor.fill3)
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                WVIcon(isImage ? "camera" : "receipt", size: 20, weight: .regular)
                    .foregroundStyle(WVColor.label3)
            }
        }
        .frame(width: 52, height: 52)
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .strokeBorder(WVColor.sep, lineWidth: 0.5)
        }
        .task(id: attachment.id) { await loadThumbnail() }
        .accessibilityHidden(true)
    }

    private func loadThumbnail() async {
        guard isImage else { return }
        if let cached = InboxThumbnailCache.image(for: attachment.id) {
            image = cached
            return
        }
        guard let data = try? await client.attachmentData(id: attachment.id),
              let decoded = UIImage(data: data) else { return }
        guard !Task.isCancelled else { return }
        InboxThumbnailCache.store(decoded, for: attachment.id)
        image = decoded
    }
}

/// Small in-memory cache so scrolling the inbox does not re-download every
/// receipt photo each time a row is recycled. Deliberately not persisted: these
/// are decrypted bytes, and the disk copy stays encrypted on the server.
@MainActor
private enum InboxThumbnailCache {
    private static let cache = NSCache<NSString, UIImage>()

    static func image(for id: String) -> UIImage? {
        cache.object(forKey: id as NSString)
    }

    static func store(_ image: UIImage, for id: String) {
        cache.setObject(image, forKey: id as NSString)
    }
}
