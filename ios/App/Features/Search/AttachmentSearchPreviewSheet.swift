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

    @Environment(\.dismiss) private var dismiss

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

// MARK: - Quick Look host

/// Hosts `QLPreviewController` for a single local file. Used instead of a
/// `Link` because the authenticated route cannot be opened by an external app.
private struct QuickLookFileView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: QLPreviewController, context: Context) {
        controller.reloadData()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(url: url)
    }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL

        init(url: URL) {
            self.url = url
        }

        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

        func previewController(_ controller: QLPreviewController,
                               previewItemAt index: Int) -> QLPreviewItem {
            url as NSURL
        }
    }
}
