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
    /// The signed-in account, for its inbound receipt address (`inboxAddress`).
    @EnvironmentObject private var auth: AuthStore
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
        case address
        case assign(AttachmentMeta)

        var id: String {
            switch self {
            case .capture: return "capture"
            case .address: return "address"
            case .assign(let attachment): return "assign-\(attachment.id)"
            }
        }
    }

    /// The account's own forwarding address, or `nil` when this deployment has
    /// no mail provider (`inboxAddress` is omitted from `/auth/me`). `nil` must
    /// render nothing: a button that opens an empty address is worse than no
    /// button at all.
    private var inboxAddress: String? {
        guard case let .authenticated(user) = auth.status,
              let address = user.inboxAddress?.trimmingCharacters(in: .whitespacesAndNewlines),
              !address.isEmpty else { return nil }
        return address
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Spacer().frame(height: 8)

                sharedImportBanner

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
            case .address:
                if let inboxAddress {
                    InboxAddressSheet(address: inboxAddress)
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
                    VStack(spacing: 10) {
                        WVButton(L.t("Thêm hoá đơn"), icon: "camera") {
                            sheet = .capture
                        }
                        // The zero-tap path, offered next to the capture one.
                        // Only when the account actually has an address this
                        // deployment can receive mail on.
                        if inboxAddress != nil {
                            WVButton(L.t("Nhận hoá đơn qua email"), icon: "mail",
                                     kind: .secondary) {
                                sheet = .address
                            }
                        }
                    }
                }
            }
        } else {
            WVSectionHeader(L.t("Tệp chưa gán thiết bị"))

            if let loadError {
                Text(loadError)
                    .wvFont(.footnote)
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

    // MARK: - Shared import

    /// The Share Extension queue is invisible to the server until the app drains
    /// it, so this card is where a pending/failed hand-off becomes visible.
    /// The file is still on disk — "not in the inbox yet" must never look like
    /// "lost".
    @ViewBuilder
    private var sharedImportBanner: some View {
        if inbox.pendingSharedCount > 0 || inbox.isImportingShared
            || inbox.sharedImportError != nil {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    if inbox.isImportingShared {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "tray.and.arrow.down.fill")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(WVColor.tint)
                    }
                    Text(sharedImportTitle)
                        .wvFont(.subheadlineEmphasis)
                        .foregroundStyle(WVColor.label)
                    Spacer(minLength: 4)
                }

                if let error = inbox.sharedImportError {
                    Text(error)
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.red)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(L.t("Tệp vẫn được giữ lại trên máy và sẽ thử lại."))
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !inbox.isImportingShared {
                    Button(L.t("Thử lại")) {
                        Task { await load() }
                    }
                    .wvFont(.subheadlineEmphasis)
                    .foregroundStyle(WVColor.tint)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(WVColor.bg2)
            .clipShape(RoundedRectangle(cornerRadius: WVRadius.list, style: .continuous))
            .padding(.horizontal, WVSpacing.gutter)
            .padding(.bottom, 12)
        }
    }

    private var sharedImportTitle: String {
        if inbox.isImportingShared {
            return L.t("Đang tải tệp được chia sẻ lên Hộp thư đến…")
        }
        if inbox.pendingSharedCount > 0 {
            return L.p("%d tệp được chia sẻ đang chờ tải lên.", inbox.pendingSharedCount)
        }
        return L.t("Không tải lên được tệp được chia sẻ.")
    }

    // MARK: - Actions

    private func load() async {
        loadError = nil
        // Drain the App Group queue first: a retry after a failed upload belongs
        // on the same pull-to-refresh / appearance that reloads the list.
        await inbox.importSharedFiles()
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
                    .wvFont(.callout, weight: .medium)
                    .foregroundStyle(WVColor.label)
                    .lineLimit(1)
                Text(WVFormat.dateTime(attachment.uploadedAt))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)

                Button(action: onAssign) {
                    Text(L.t("Gán vào thiết bị"))
                        .wvFont(.subheadlineEmphasis)
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

// MARK: - The inbound receipt address

/// The account's own forwarding address (`GET /auth/me` → `inboxAddress`,
/// migration 0020) as a group row with a copy button.
///
/// This is the inbound half of the capture flow, and the cheapest path in the
/// app: forward a receipt email to this address and its attachment lands in the
/// inbox with **zero** taps of manual entry (`POST /api/v1/inbox/email`).
/// `openapi.yaml` tells clients to show it in Settings; iOS showed it nowhere.
///
/// It is a **write-only capability**, and the footer that accompanies this row
/// says so: knowing the address lets someone send mail into the inbox, never
/// read, list, download or delete anything from it. It is not a password and not
/// part of a backup.
///
/// Shared by `InboxScreen`'s empty state and `AccountView`, so the copy button
/// behaves identically in both and there is one place to change the wording.
struct InboxAddressRow: View {
    let address: String

    @State private var copied = false

    var body: some View {
        HStack(spacing: 12) {
            WVLeadingIcon(icon: "mail", color: WVColor.blue)

            VStack(alignment: .leading, spacing: 2) {
                Text(L.t("Địa chỉ nhận hoá đơn"))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
                Text(address)
                    .wvFont(.subheadline, weight: .medium, design: .monospaced)
                    .foregroundStyle(WVColor.label)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .textSelection(.enabled)
            }

            Spacer(minLength: 8)

            Button {
                UIPasteboard.general.string = address
                withAnimation(.easeOut(duration: 0.15)) { copied = true }
                Task {
                    // Transient confirmation only: the address itself stays on
                    // screen, so nothing is lost when the label reverts.
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                    withAnimation(.easeOut(duration: 0.15)) { copied = false }
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 11, weight: .bold))
                    Text(copied ? L.t("Đã sao chép") : L.t("Sao chép"))
                        .wvFont(.captionEmphasis)
                }
                .foregroundStyle(WVColor.tint)
                .padding(.horizontal, 10)
                .frame(height: 26)
                .background(WVColor.tint.opacity(0.14))
                .clipShape(Capsule())
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L.t("Sao chép địa chỉ nhận hoá đơn"))
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .padding(.vertical, 10)
    }
}

/// Sheet wrapper for `InboxAddressRow`, reached from the inbox's empty state.
struct InboxAddressSheet: View {
    let address: String

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    Spacer().frame(height: 12)
                    WVGroup {
                        InboxAddressRow(address: address)
                    }
                    WVSectionFooter(L.t("Địa chỉ này chỉ nhận thư. Ai biết địa chỉ cũng chỉ gửi được email vào hộp thư đến — không đọc, tải hay xoá được gì."))
                    WVSectionFooter(L.t("Chuyển tiếp email hoá đơn (PDF hoặc ảnh đính kèm) tới địa chỉ này — tệp sẽ nằm trong Hộp thư đến để gán vào thiết bị."))
                    Spacer().frame(height: 24)
                }
            }
            .wvScreen()
            .navigationTitle(L.t("Hoá đơn qua email"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L.t("Xong")) { dismiss() }
                        .wvFont(.bodyEmphasis)
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
