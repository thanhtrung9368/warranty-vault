import SwiftUI
import UIKit
import QuickLook
import WarrlyKit

// ============================================================
// Warrly iOS — authenticated attachment thumbnails + full-screen preview
//
// A receipt is the product's central promise, and the byte stream is
// bearer-gated (`GET /api/files/{id}` calls `auth.VerifyBearer`). That rules
// out two tempting shortcuts:
//
//   * `AsyncImage(url:)` — fetches without the Authorization header, gets a
//     404, and renders a blank tile;
//   * `Link(destination: attachmentDownloadURL)` — hands the URL to Safari,
//     which has no bearer token either. Tapping a receipt opened a 404 page
//     in another app.
//
// Everything here goes through `APIClient.attachmentData(id:)`, keeps the
// decrypted bytes in memory (never on disk except the temporary file Quick
// Look needs), and shows them inside the app.
// ============================================================

// MARK: - Thumbnail

/// Decrypted-image thumbnail for an attachment, loaded through the
/// authenticated client and cached in memory.
///
/// The cache is deliberately not persisted: these are decrypted receipt
/// bytes, and the only durable copy stays encrypted on the server. It exists
/// so scrolling a list does not re-download every photo each time a row is
/// recycled.
@MainActor
enum AttachmentThumbnailCache {
    private static let cache = NSCache<NSString, UIImage>()

    static func image(for id: String) -> UIImage? {
        cache.object(forKey: id as NSString)
    }

    static func store(_ image: UIImage, for id: String) {
        cache.setObject(image, forKey: id as NSString)
    }

    /// Drops one entry after a delete, so a re-used id can never show the
    /// wrong receipt.
    static func remove(for id: String) {
        cache.removeObject(forKey: id as NSString)
    }
}

/// A square thumbnail of an attachment. Images render their decrypted bytes;
/// PDFs and anything else keep the file-type glyph.
///
/// The view is decorative on its own (`accessibilityHidden`), because the
/// tappable wrapper supplies the label — a thumbnail that is also a button
/// should be announced as one control, not as an image plus a button.
struct AttachmentThumbnailImage: View {
    let client: APIClient
    let attachment: AttachmentMeta
    var size: CGFloat = 52
    var cornerRadius: CGFloat = 9

    @State private var image: UIImage?

    private var isImage: Bool { attachment.fileType.hasPrefix("image/") }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(WVColor.fill3)
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                WVIcon(isImage ? "camera" : "receipt", size: size * 0.38, weight: .regular)
                    .foregroundStyle(WVColor.label3)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .strokeBorder(WVColor.sep, lineWidth: 0.5)
        }
        .task(id: attachment.id) { await load() }
        .accessibilityHidden(true)
    }

    private func load() async {
        guard isImage else { return }
        if let cached = AttachmentThumbnailCache.image(for: attachment.id) {
            image = cached
            return
        }
        guard let data = try? await client.attachmentData(id: attachment.id),
              let decoded = UIImage(data: data) else { return }
        guard !Task.isCancelled else { return }
        AttachmentThumbnailCache.store(decoded, for: attachment.id)
        image = decoded
    }
}

// MARK: - Authenticated full-screen preview

/// Full-screen preview of one attachment.
///
/// This is the viewing half of the receipt promise: it downloads the
/// decrypted bytes through the authenticated client, writes them to a
/// temporary file whose name is derived from the *detected* type (a HEIC
/// upload whose filename says `.jpg` still opens), and hands that file to
/// Quick Look.
///
/// The temp file is deleted when the sheet goes away — these bytes are
/// decrypted receipt content, so they must not outlive the view that showed
/// them. It is also why there is no share sheet here: sharing would copy the
/// decrypted file out of the app's sandbox, which is a separate decision.
struct QLPreviewSheet: View {
    let client: APIClient
    let attachment: AttachmentMeta

    @Environment(\.dismiss) private var dismiss

    @State private var phase: Phase = .loading
    @State private var fileURL: URL?

    private enum Phase: Equatable {
        case loading
        case ready
        case failed(String)
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch phase {
            case .loading:
                HStack(spacing: 8) {
                    ProgressView().tint(.white)
                    Text(L.t("Đang tải tệp…"))
                        .wvFont(.subheadline)
                        .foregroundStyle(.white.opacity(0.85))
                }
            case .ready:
                if let fileURL {
                    QuickLookFileView(url: fileURL)
                        .ignoresSafeArea()
                }
            case .failed(let message):
                VStack(spacing: 12) {
                    WVIcon("alert", size: 28)
                        .foregroundStyle(.white.opacity(0.85))
                    Text(message)
                        .wvFont(.subheadline)
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                    Button(L.t("Thử lại")) { Task { await load() } }
                        .wvFont(.bodyEmphasis)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 18)
                        .frame(minHeight: 44)
                        .background(Color.white.opacity(0.18))
                        .clipShape(Capsule())
                }
                .padding(.horizontal, 32)
            }

            // The filename is the one piece of context Quick Look does not
            // reliably show when it is embedded, and "which receipt is this?"
            // is the question this screen exists to answer.
            VStack(spacing: 0) {
                HStack(alignment: .top, spacing: 12) {
                    Text(attachment.fileName)
                        .wvFont(.footnoteEmphasis)
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                    Button { dismiss() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 28))
                            .foregroundStyle(.white.opacity(0.85))
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L.t("Đóng"))
                    .accessibilityIdentifier("attachment-preview-close")
                }
                .padding(.horizontal, 16)
                .padding(.top, 10)
                .padding(.bottom, 8)
                .background(.black.opacity(0.35))

                Spacer(minLength: 0)
            }
            .ignoresSafeArea(edges: .bottom)
        }
        .task { await load() }
        .onDisappear { removeTemporaryFile() }
    }

    // MARK: - Loading

    private func load() async {
        phase = .loading
        do {
            let data = try await client.attachmentData(id: attachment.id)
            guard !Task.isCancelled else { return }

            // Quick Look needs a real file URL with an extension it
            // recognises. Prefer what the bytes actually are over the
            // filename, which can be stale or renamed.
            let detected = AttachmentFileType.detect(data)
            let fileExtension = detected?.fileExtension
                ?? (attachment.fileName as NSString).pathExtension
            let name = fileExtension.isEmpty
                ? "warrly-\(attachment.id)"
                : "warrly-\(attachment.id).\(fileExtension)"
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent(name)
            try data.write(to: url, options: .atomic)
            fileURL = url
            phase = .ready
        } catch {
            phase = .failed(
                (error as? APIError)?.localizedDescription ?? L.t("Không tải được tệp.")
            )
        }
    }

    private func removeTemporaryFile() {
        guard let fileURL else { return }
        try? FileManager.default.removeItem(at: fileURL)
        self.fileURL = nil
    }
}

// MARK: - Quick Look host

/// Hosts `QLPreviewController` for a single local file. Used instead of a
/// `Link` because the authenticated route cannot be opened by an external app.
struct QuickLookFileView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        // The sheet draws its own black chrome and close button; Quick Look's
        // navigation bar would otherwise sit on top of the filename header.
        controller.navigationItem.title = url.lastPathComponent
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
