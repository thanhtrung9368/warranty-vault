import SwiftUI
import UIKit
import QuickLook
import WarrlyKit

// ============================================================
// AttachmentSearchPreviewSheet — open a receipt hit from global search
//
// The attachment byte stream is bearer-gated (`GET /api/files/{id}`), so a bare
// URL cannot be opened by Safari or `AsyncImage`. The sheet downloads the
// decrypted bytes through the authenticated client, writes them to a temporary
// file that only this sheet knows about, and hands that file to Quick Look. The
// temp file is removed when the sheet goes away.
//
// It also renders the OCR transcript — the text that made the file a search
// hit — and the same filed-vs-inbox decision the inbox uses. Nothing here can
// edit, file or delete the attachment: search is a read surface.
// ============================================================

struct AttachmentSearchPreviewSheet: View {
    let client: APIClient
    let hit: AttachmentSearchHit
    /// The device this file is filed to, when the presenting screen already
    /// holds it. Only used for the label and the category glyph: the row itself
    /// works from `hit.deviceId`, because "where is this receipt?" must be
    /// answerable even when the device did not match the query.
    var device: Device?

    @Environment(\.dismiss) private var dismiss
    /// Opening the owning device is the same navigation a Spotlight hit, a
    /// `warrly://device/<id>` URL and a tapped push use: it brings the Thiết bị
    /// tab forward and pushes that device's detail, receipt strip included.
    @EnvironmentObject private var router: AppRouter

    @State private var phase: Phase = .loading
    @State private var image: UIImage?
    @State private var fileURL: URL?
    @State private var showQuickLook = false

    private enum Phase: Equatable {
        case loading
        case loaded
        case failed(String)
    }

    private var isImage: Bool { hit.attachment.fileType.hasPrefix("image/") }

    private var transcript: String? {
        guard let text = hit.attachment.extractedText,
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return nil }
        return text
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    if let deviceId = hit.deviceId { deviceSection(deviceId) }
                    fileSection
                    if let transcript { transcriptSection(transcript) }
                }
                .padding(.vertical, 8)
            }
            .wvScreen()
            .navigationTitle(L.t("Tệp đính kèm"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L.t("Xong")) { dismiss() }
                        .foregroundStyle(WVColor.tint)
                }
            }
            .task { await load() }
            .onDisappear { removeTemporaryFile() }
            .fullScreenCover(isPresented: $showQuickLook) {
                if let fileURL {
                    QuickLookFileView(url: fileURL)
                }
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(hit.attachment.fileName)
                .wvFont(.title3Emphasis)
                .foregroundStyle(WVColor.label)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                Text(WVFormat.dateTime(hit.attachment.uploadedAt))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
                WVChip(hit.filing.label, tone: hit.isInInbox ? .orange : .blue)
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, WVSpacing.gutter)
    }

    // MARK: - Owning device

    /// Where the file lives — one tap, not a dead end.
    ///
    /// A receipt is searchable by its own text (`extractedText`, `fileName`,
    /// `description`), and none of those strings is the device's name, so the
    /// hit is the one search result whose owner the row cannot show. Without
    /// this the sheet printed "Đã gắn thiết bị" and the only way to reach that
    /// device was to close, switch tab and find it again.
    ///
    /// The row is drawn exactly like every other row (`WVLeadingIcon` +
    /// name + chevron), so this is not a second drawing of a search result.
    private func deviceSection(_ deviceId: String) -> some View {
        let icon = device.map { WVCategory.icon(for: $0.category) } ?? "shippingbox"
        return WVGroup {
            Button {
                // The device detail belongs to the Thiết bị tab's stack, not to
                // this sheet, so the sheet closes first and the router pushes
                // the destination — leaving a modal on top of it would hide the
                // thing the tap asked for.
                dismiss()
                router.openDevice(id: deviceId)
            } label: {
                HStack(spacing: WVSpacing.md) {
                    WVLeadingIcon(icon: icon, size: 28)
                    VStack(alignment: .leading, spacing: WVSpacing.xs) {
                        Text(device?.name ?? L.t("Thiết bị đã gắn tệp này"))
                            .wvFont(.bodyEmphasis)
                            .foregroundStyle(WVColor.label)
                            .lineLimit(1)
                        // The affordance is a second line of text, not a filled
                        // pill: the name is the identity, and this line says
                        // what the row does. Same grammar as the search rows'
                        // value column.
                        Text(L.t("Mở thiết bị"))
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.label3)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    WVIcon("arrowRight", size: 13)
                        .foregroundStyle(WVColor.label4)
                }
                .padding(.horizontal, WVSpacing.gutter)
                .padding(.vertical, WVSpacing.sm)
                .contentShape(Rectangle())
            }
            .buttonStyle(WVRowButtonStyle())
        }
    }

    // MARK: - File

    @ViewBuilder
    private var fileSection: some View {
        switch phase {
        case .loading:
            HStack(spacing: 8) {
                ProgressView()
                Text(L.t("Đang tải tệp…"))
                    .wvFont(.subheadline)
                    .foregroundStyle(WVColor.label3)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 40)

        case .loaded:
            VStack(spacing: 10) {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(maxHeight: 280)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .strokeBorder(WVColor.sep, lineWidth: 0.5)
                        }
                }
                WVButton(L.t("Mở tệp"), icon: "receipt") {
                    showQuickLook = true
                }
                .padding(.horizontal, WVSpacing.gutter)
            }

        case .failed(let message):
            VStack(spacing: 8) {
                Text(message)
                    .wvFont(.subheadline)
                    .foregroundStyle(WVColor.red)
                    .multilineTextAlignment(.center)
                WVButton(L.t("Thử lại"), kind: .secondary) {
                    Task { await load() }
                }
                .frame(maxWidth: 220)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 24)
        }
    }

    // MARK: - Transcript

    private func transcriptSection(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            WVSectionHeader(L.t("Nội dung OCR"))
            WVGroup {
                Text(text)
                    .wvFont(.subheadline)
                    .foregroundStyle(WVColor.label)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
            }
        }
    }

    // MARK: - Loading

    private func load() async {
        phase = .loading
        do {
            let data = try await client.attachmentData(id: hit.attachment.id)
            guard !Task.isCancelled else { return }

            if isImage { image = UIImage(data: data) }

            // Quick Look needs a real file URL with an extension it recognises.
            // The bytes are decrypted here and never persisted anywhere else.
            let detected = AttachmentFileType.detect(data)
            let fileExtension = detected?.fileExtension
                ?? (hit.attachment.fileName as NSString).pathExtension
            let name = fileExtension.isEmpty
                ? "warrly-\(hit.id)"
                : "warrly-\(hit.id).\(fileExtension)"
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent(name)
            try data.write(to: url, options: .atomic)
            fileURL = url
            phase = .loaded
        } catch {
            phase = .failed(
                (error as? APIError)?.localizedDescription ?? L.t("Không tải được tệp.")
            )
        }
    }

    /// These bytes are decrypted receipt content, so they must not outlive the
    /// sheet. Quick Look reads the file while the cover is up; this runs when
    /// the sheet itself is dismissed.
    private func removeTemporaryFile() {
        guard let fileURL else { return }
        try? FileManager.default.removeItem(at: fileURL)
        self.fileURL = nil
    }
}

// The Quick Look host itself lives in `App/DesignSystem/AttachmentPreview.swift`,
// together with the device detail's preview sheet: one file type for a
// bearer-gated receipt, used by every surface that opens one.
