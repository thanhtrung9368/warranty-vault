import SwiftUI
import PhotosUI
import AVFoundation
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
//
// Two extra entry conditions come from the Control Center control:
//  * `startWithCamera` — land on the camera instead of asking the user to find
//    it. If camera permission is missing or denied, the sheet says so and links
//    to Settings instead of silently bouncing back.
//  * offline — when the upload fails at the transport layer (no network), the
//    bytes go into the same App Group queue the Share Extension uses and the
//    sheet says the receipt will upload later. A 429 is a server answer, not a
//    network failure: it keeps the envelope's own message on screen.
// ============================================================

struct InboxCaptureSheet: View {
    let client: APIClient
    /// Called after a successful upload, before the sheet dismisses. The inbox
    /// store uses it to reload; the Devices screen uses it to announce where the
    /// file went.
    var onUploaded: (AttachmentMeta) -> Void = { _ in }
    /// Set by the Control Center hand-off: open the live camera immediately.
    var startWithCamera: Bool = false

    @Environment(\.dismiss) private var dismiss

    @State private var photoItem: PhotosPickerItem?
    @State private var showFileImporter = false
    @State private var showCamera = false
    @State private var isUploading = false
    @State private var errorMessage: String?
    /// Camera permission/liveness problem, shown with an "Open Settings" path.
    /// Kept apart from `errorMessage` because the fix is a system setting, not
    /// a retry.
    @State private var cameraError: String?
    @State private var uploadedName: String?
    /// The upload failed offline and the bytes are safe in the App Group queue.
    @State private var queuedNotice = false
    /// Auto-start runs once per sheet even if SwiftUI re-runs its task.
    @State private var didAttemptAutoCamera = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer().frame(height: 8)

                    if let uploadedName {
                        successCard(uploadedName)
                    } else if queuedNotice {
                        queuedCard
                    } else {
                        captureRows
                        if let cameraError {
                            cameraAccessCard(cameraError)
                        }
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
        .task {
            guard startWithCamera, !didAttemptAutoCamera else { return }
            didAttemptAutoCamera = true
            await openCamera()
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
                    Task { await openCamera() }
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

    /// Upload failed at the transport layer. The bytes went into the same App
    /// Group queue the Share Extension uses, so the receipt is **saved** but
    /// not yet in the inbox — say that, not "added".
    private var queuedCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "wifi.slash")
                    .font(.system(size: 22))
                    .foregroundStyle(WVColor.orange)
                Text(L.t("Đã lưu hoá đơn"))
                    .wvFont(.bodyEmphasis)
                    .foregroundStyle(WVColor.label)
            }
            Text(L.t("Sẽ tự tải lên khi có mạng."))
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

    /// Camera permission/liveness problem. The fix lives in iOS Settings, so
    /// offer the same `openSettingsURLString` deep link the push permission
    /// flow uses instead of a dead "try again".
    private func cameraAccessCard(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "camera.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(WVColor.orange)
                Text(message)
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label)
                    .fixedSize(horizontal: false, vertical: true)
            }
            WVButton(L.t("Mở Cài đặt"), icon: "settings", kind: .secondary, fullWidth: false) {
                openSettings()
            }
        }
        .padding(.horizontal, 32)
        .padding(.top, 10)
    }

    // MARK: - Camera permission

    /// Presenting the camera only after `AVCaptureDevice` says so keeps a denied
    /// permission from looking like a broken button: the system picker would
    /// simply bounce back with nothing on screen.
    private func openCamera() async {
        // No camera (simulator): the other capture rows are the honest path.
        guard CameraPicker.isAvailable else { return }

        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            cameraError = nil
            showCamera = true
        case .notDetermined:
            let granted: Bool = await withCheckedContinuation { continuation in
                AVCaptureDevice.requestAccess(for: .video) { granted in
                    continuation.resume(returning: granted)
                }
            }
            if granted {
                cameraError = nil
                showCamera = true
            } else {
                cameraError = L.t("Warrly không có quyền dùng camera. Mở Cài đặt để bật.")
            }
        case .denied, .restricted:
            cameraError = L.t("Warrly không có quyền dùng camera. Mở Cài đặt để bật.")
        @unknown default:
            cameraError = L.t("Warrly không có quyền dùng camera. Mở Cài đặt để bật.")
        }
    }

    private func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
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
            do {
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
            } catch let error as APIError {
                switch error {
                case .transport:
                    // No network. The bytes must not be lost, so hand them to
                    // the app's existing at-least-once queue — the same one the
                    // Share Extension fills — instead of discarding them behind
                    // an error banner. `InboxStore.importSharedFiles()` uploads
                    // them on the next launch/foreground.
                    queueOffline(data: data, fileName: fileName)
                case let .server(status, envelope) where status == 429:
                    // The server's envelope message is the only honest answer
                    // (a rate limit is not a network failure and retrying now
                    // cannot succeed). Never replace it with generic copy.
                    errorMessage = envelope.message ?? envelope.error
                default:
                    errorMessage = error.localizedDescription
                }
            } catch {
                errorMessage = error.localizedDescription
            }
        } catch let error as CaptureError {
            if let message = error.message { errorMessage = message }
        } catch let error as APIError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Saves an offline capture into the App Group queue. Synchronous and small
    /// (≤5 MB); the item is only removed there after a later upload succeeds.
    private func queueOffline(data: Data, fileName: String) {
        guard let queue = SharedInboxStore() else {
            errorMessage = L.t("Không lưu được tệp để tải lên sau.")
            return
        }
        do {
            try queue.enqueue(data: data, fileName: fileName)
            queuedNotice = true
            // Let the card be read before the sheet closes; the queue survives
            // even if the app is killed in the meantime.
            Task {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                dismiss()
            }
        } catch let error as SharedInboxError {
            errorMessage = error.message
        } catch {
            errorMessage = L.t("Không lưu được tệp để tải lên sau.")
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
struct CameraPicker: UIViewControllerRepresentable {
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
