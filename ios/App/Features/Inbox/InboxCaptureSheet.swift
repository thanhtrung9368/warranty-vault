import SwiftUI
import PhotosUI
import UIKit
import UniformTypeIdentifiers
import WarrlyKit

// ============================================================
// InboxCaptureSheet — capture a receipt with NO device chosen.
//
// This is the feature's entry point: a photo or PDF can be dropped here
// straight from the Devices tab (or from the inbox itself) and lands in
// `GET /api/v1/inbox`. Nothing on this sheet asks which device it belongs to,
// and an inbox item does not consume any device's five attachment slots — that
// is what makes "photograph it now, file it later" safe at the counter.
//
// The upload path is the same `POST /api/v1/attachments` the device detail uses;
// the difference is that `deviceId` is nil, so the multipart form omits it.
// ============================================================

struct InboxCaptureSheet: View {
    let client: APIClient
    /// Called after a successful upload, before the sheet dismisses. The inbox
    /// store uses it to reload; the Devices screen uses it to announce where the
    /// file went.
    var onUploaded: (AttachmentMeta) -> Void = { _ in }

    @Environment(\.dismiss) private var dismiss

    @State private var photoItem: PhotosPickerItem?
    @State private var showFileImporter = false
    @State private var showCamera = false
    @State private var isUploading = false
    @State private var errorMessage: String?
    @State private var uploadedName: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer().frame(height: 8)

                    if let uploadedName {
                        successCard(uploadedName)
                    } else {
                        captureRows
                        WVSectionFooter(L.t("Tệp sẽ vào Hộp thư đến và chưa thuộc thiết bị nào. Bạn gán thiết bị sau."))
                    }

                    if isUploading {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text(L.t("Đang tải…"))
                                .wvFont(.footnote)
                                .foregroundStyle(WVColor.label3)
                        }
                        .padding(.horizontal, 32)
                        .padding(.top, 12)
                    }

                    if let errorMessage {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.red)
                            .padding(.horizontal, 32)
                            .padding(.top, 12)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer().frame(height: 24)
                }
            }
            .wvScreen()
            .navigationTitle(L.t("Thêm hoá đơn"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(L.t("Huỷ")) { dismiss() }
                        .foregroundStyle(WVColor.tint)
                        .disabled(isUploading)
                }
            }
        }
        .interactiveDismissDisabled(isUploading)
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
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker(
                onCapture: { data in
                    showCamera = false
                    Task { await uploadCameraImage(data) }
                },
                onCancel: { showCamera = false }
            )
            .ignoresSafeArea()
        }
    }

    // MARK: - Rows

    private var captureRows: some View {
        WVGroup {
            // Live camera first: at the counter the receipt is in front of the
            // user, not in the photo library. The row is hidden on a device
            // with no camera (the simulator), never shown as a dead control.
            if CameraPicker.isAvailable {
                Button {
                    showCamera = true
                } label: {
                    captureRow(
                        icon: "camera", color: WVColor.red,
                        title: L.t("Chụp ảnh hoá đơn"),
                        subtitle: nil
                    )
                }
                .disabled(isUploading)
                .buttonStyle(WVRowButtonStyle())

                WVDivider()
            }

            // Images only: the server's MIME whitelist accepts
            // JPG/PNG/WEBP/GIF/HEIC + PDF, but offering videos here would only
            // produce a rejected upload.
            PhotosPicker(selection: $photoItem, matching: .images) {
                captureRow(
                    icon: "camera", color: WVColor.blue,
                    title: L.t("Chọn ảnh hoá đơn"),
                    subtitle: L.t("Ảnh hoặc PDF, ≤5MB")
                )
            }
            .disabled(isUploading)
            .buttonStyle(WVRowButtonStyle())

            WVDivider()

            Button {
                showFileImporter = true
            } label: {
                captureRow(
                    icon: "paperclip", color: WVColor.orange,
                    title: L.t("Chọn tệp PDF"),
                    subtitle: nil
                )
            }
            .disabled(isUploading)
            .buttonStyle(WVRowButtonStyle())
        }
    }

    private func captureRow(icon: String, color: Color,
                            title: String, subtitle: String?) -> some View {
        HStack(spacing: 12) {
            WVLeadingIcon(icon: icon, color: color, size: 30)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .wvFont(.body)
                    .foregroundStyle(WVColor.label)
                if let subtitle {
                    Text(subtitle)
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                }
            }
            Spacer(minLength: 8)
            if isUploading {
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

    /// The upload succeeded but the sheet has not dismissed yet. Saying *where*
    /// the file went is the whole point of a capture-first flow — otherwise the
    /// receipt appears to vanish from the device screen.
    private func successCard(_ fileName: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(WVColor.green)
                Text(L.t("Đã thêm vào Hộp thư đến"))
                    .wvFont(.bodyEmphasis)
                    .foregroundStyle(WVColor.label)
            }
            Text(fileName)
                .wvFont(.footnote)
                .foregroundStyle(WVColor.label3)
                .lineLimit(2)
            Text(L.t("Gán tệp vào thiết bị để nó không còn trong hộp thư."))
                .wvFont(.footnote)
                .foregroundStyle(WVColor.label3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WVColor.bg2)
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.list, style: .continuous))
        .padding(.horizontal, WVSpacing.gutter)
    }

    // MARK: - Upload

    /// File-type detection. Shared by the photo and PDF paths so the size/type
    /// checks cannot drift apart.
    private func validatedType(_ data: Data) throws -> AttachmentFileType.Detected {
        guard data.count <= AttachmentFileType.maxBytes else {
            throw CaptureError.message(AttachmentFileType.tooLargeMessage)
        }
        // The server rejects an upload whose declared Content-Type disagrees
        // with the magic bytes, so sniff instead of trusting the picker.
        guard let type = AttachmentFileType.detect(data) else {
            throw CaptureError.message(AttachmentFileType.unsupportedMessage)
        }
        return type
    }

    private func uploadPhoto(item: PhotosPickerItem) async {
        defer { photoItem = nil }
        await upload {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                throw CaptureError.message(L.t("Không đọc được ảnh, thử lại sau"))
            }
            let type = try validatedType(data)
            // The extension follows the sniffed bytes, not the picker: iPhones
            // shoot HEIC, so a hard-coded `.jpg` would lie about the payload.
            return (data, "receipt-\(Self.stamp()).\(type.fileExtension)", type)
        }
    }

    /// The camera hands back a JPEG-encoded still, but it still goes through
    /// the same magic-byte check as every other input — the bytes are the
    /// authority, not the source.
    private func uploadCameraImage(_ data: Data) async {
        await upload {
            let type = try validatedType(data)
            return (data, "receipt-\(Self.stamp()).\(type.fileExtension)", type)
        }
    }

    private func handleFileImport(result: Result<[URL], Error>) async {
        guard case let .success(urls) = result, let url = urls.first else {
            if case .failure = result { errorMessage = L.t("Không mở được file.") }
            return
        }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        await upload {
            let data = try Data(contentsOf: url)
            let type = try validatedType(data)
            return (data, url.lastPathComponent, type)
        }
    }

    private func upload(
        _ build: () async throws -> (Data, String, AttachmentFileType.Detected)
    ) async {
        guard !isUploading else { return }
        errorMessage = nil
        isUploading = true
        defer { isUploading = false }
        do {
            let (data, fileName, type) = try await build()
            // `deviceId: nil` is the entire feature: the multipart form omits
            // that field and the file waits in the inbox.
            let meta = try await client.uploadAttachment(
                deviceId: nil,
                fileName: fileName,
                fileType: type.mimeType,
                data: data,
                description: nil
            )
            uploadedName = meta.fileName
            onUploaded(meta)
            // Leave the confirmation on screen briefly, then close. The user
            // reads where it went; the list behind it already refreshed.
            try? await Task.sleep(nanoseconds: 900_000_000)
            dismiss()
        } catch let error as CaptureError {
            if let message = error.message { errorMessage = message }
        } catch {
            errorMessage = (error as? APIError)?.localizedDescription ?? error.localizedDescription
        }
    }

    private static func stamp() -> String {
        String(Int(Date().timeIntervalSince1970)) + "-" + UUID().uuidString.prefix(4)
    }

    private enum CaptureError: Error {
        case message(String)
        var message: String? {
            if case let .message(text) = self { return text }
            return nil
        }
    }
}

// MARK: - Camera

/// Minimal `UIImagePickerController` bridge for the capture row.
///
/// `PhotosPicker` only reaches the photo library; at the counter the receipt is
/// in front of the user. The camera writes JPEG bytes, which still go through
/// the same magic-byte check (`AttachmentFileType.detect`) as a picked file.
/// The app already declares `NSCameraUsageDescription` for the serial scanner.
private struct CameraPicker: UIViewControllerRepresentable {
    let onCapture: (Data) -> Void
    let onCancel: () -> Void

    static var isAvailable: Bool {
        UIImagePickerController.isSourceTypeAvailable(.camera)
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate,
                            UINavigationControllerDelegate {
        private let parent: CameraPicker

        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            guard let image = info[.originalImage] as? UIImage,
                  let data = image.jpegData(compressionQuality: 0.9) else {
                parent.onCancel()
                return
            }
            parent.onCapture(data)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.onCancel()
        }
    }
}
