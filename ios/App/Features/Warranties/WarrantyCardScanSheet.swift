import SwiftUI
import PhotosUI
import AVFoundation
import UIKit
import UniformTypeIdentifiers
import WarrlyKit

// ============================================================
// WarrantyCardScanSheet — read the nine contract terms off a
// warranty card (`POST /api/v1/ai/extract-warranty-card`).
//
// This is the iOS half of FEATURE_RESEARCH_2026-11 §6.3. It is a DRAFT flow,
// exactly like the receipt scan: the card is uploaded as an **inbox item** (no
// device), the server reads it, and the form fills only the fields the user has
// not already typed. Nothing is saved from this sheet — no Warranty and no
// Device — and the user still taps save on the form.
//
// Upload first, extract second: the endpoint takes `{attachmentId}` only
// (no multipart), because the one write it performs is the OCR transcript on
// that attachment row. That is also why a failed extraction never deletes the
// upload: the photo is the thing the user cannot re-create, so it stays in the
// inbox and the sheet links there.
//
// Privacy: this is the surface that makes the AI opt-in a real decision. The
// card is decrypted and sent to Anthropic, so the sheet says so *before* the
// first capture, and a 403 `ai_optin_required` sends the user to Settings
// instead of silently enabling anything.
// ============================================================

struct WarrantyCardScanSheet: View {
    let client: APIClient
    /// Called when the user accepts the draft. The form merges only empty
    /// fields and renders "Trên thẻ: …" for any disagreement.
    var onApply: (WarrantyCardDraft) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var photoItem: PhotosPickerItem?
    @State private var showFileImporter = false
    @State private var showCamera = false
    @State private var isBusy = false
    @State private var errorMessage: String?
    @State private var cameraError: String?
    @State private var draft: WarrantyCardDraft?
    /// Set the moment the bytes land in the inbox; the review card uses it to
    /// say the file is safe even if the model call failed.
    @State private var uploadedName: String?
    /// `nil` until the opt-in read finishes. `false` shows the consent gate
    /// instead of the capture rows: uploading a card only to be refused with
    /// 403 `ai_optin_required` would be a wasted round trip and a confusing
    /// error, and this sheet never turns the switch on by itself.
    @State private var aiOptIn: Bool?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer().frame(height: 8)

                    if let draft {
                        reviewCard(draft)
                    } else if aiOptIn == false {
                        consentGateCard
                    } else {
                        captureRows
                        WVSectionFooter(L.t("Ảnh/PDF được lưu trong Hộp thư đến và có thể gán vào thiết bị sau. Bản nháp chỉ điền vào các ô bạn còn để trống — bạn vẫn phải bấm lưu."))
                    }

                    if isBusy {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text(L.t("Đang đọc thẻ bảo hành…"))
                                .wvFont(.footnote)
                                .foregroundStyle(WVColor.label3)
                        }
                        .padding(.horizontal, 32)
                        .padding(.top, 12)
                    }

                    if let cameraError {
                        cameraAccessCard(cameraError)
                    }

                    if let errorMessage {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.red)
                            .padding(.horizontal, 32)
                            .padding(.top, 12)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if let uploadedName, draft == nil, errorMessage != nil {
                        Text(L.t("Tệp “%@” vẫn nằm trong Hộp thư đến — mở Hộp thư để gán vào thiết bị.", uploadedName))
                            .wvFont(.caption)
                            .foregroundStyle(WVColor.label3)
                            .padding(.horizontal, 32)
                            .padding(.top, 6)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer().frame(height: 24)
                }
            }
            .wvScreen()
            .navigationTitle(L.t("Đọc thẻ bảo hành"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(L.t("Huỷ")) { dismiss() }
                        .foregroundStyle(WVColor.tint)
                        .disabled(isBusy)
                }
            }
        }
        .interactiveDismissDisabled(isBusy)
        .task {
            guard aiOptIn == nil else { return }
            aiOptIn = try? await client.getAIOptIn()
        }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task { await readPhoto(item) }
        }
        .fileImporter(
            isPresented: $showFileImporter,
            allowedContentTypes: [.pdf],
            allowsMultipleSelection: false
        ) { result in
            Task { await readFile(result) }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker(
                onCapture: { data in
                    showCamera = false
                    Task { await readCameraImage(data) }
                },
                onCancel: { showCamera = false }
            )
            .ignoresSafeArea()
        }
    }

    // MARK: - Capture rows

    private var captureRows: some View {
        WVGroup {
            if CameraPicker.isAvailable {
                Button {
                    Task { await openCamera() }
                } label: {
                    captureRow(icon: "camera", color: WVColor.red,
                               title: L.t("Chụp ảnh thẻ bảo hành"), subtitle: nil)
                }
                .disabled(isBusy)
                .buttonStyle(WVRowButtonStyle())

                WVDivider()
            }

            PhotosPicker(selection: $photoItem, matching: .images) {
                captureRow(icon: "camera", color: WVColor.blue,
                           title: L.t("Chọn ảnh thẻ bảo hành"),
                           subtitle: L.t("Ảnh hoặc PDF, ≤5MB"))
            }
            .disabled(isBusy)
            .buttonStyle(WVRowButtonStyle())

            WVDivider()

            Button {
                showFileImporter = true
            } label: {
                captureRow(icon: "paperclip", color: WVColor.orange,
                           title: L.t("Chọn tệp PDF"), subtitle: nil)
            }
            .disabled(isBusy)
            .buttonStyle(WVRowButtonStyle())
        }
    }

    private func captureRow(icon: String, color: Color, title: String, subtitle: String?) -> some View {
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
            if isBusy {
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

    // MARK: - Draft review

    /// What the model read, and the only button that moves it into the form.
    ///
    /// Deliberately not auto-applied: applying a wrong `exclusions` is the risk
    /// §6.3 names, so the user sees the terms first. The form then merges only
    /// empty fields and shows the card's value for any field already filled.
    private func reviewCard(_ draft: WarrantyCardDraft) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    WVIcon("sparkles", size: 16)
                        .foregroundStyle(WVColor.purple)
                    Text(draft.confidence == "high"
                         ? L.t("Đã đọc thẻ — kiểm tra lại trước khi lưu")
                         : L.t("Đã đọc thẻ — độ tin cậy chưa cao, kiểm tra kỹ"))
                        .wvFont(.bodyEmphasis)
                        .foregroundStyle(WVColor.label)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let uploadedName {
                    Text(L.t("Ảnh “%@” đã được lưu trong Hộp thư đến.", uploadedName))
                        .wvFont(.caption)
                        .foregroundStyle(WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 8)

            let rows = WarrantyCardRules.summary(from: draft)
            if rows.isEmpty {
                Text(L.t("Không đọc được điều khoản nào trên thẻ này. Bạn vẫn có thể tự nhập các ô bên dưới — ảnh đã được lưu trong Hộp thư."))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label2)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 10)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                ForEach(rows) { row in
                    HStack(alignment: .top, spacing: 12) {
                        Text(row.label)
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.label3)
                            .frame(width: 96, alignment: .leading)
                        Text(row.value)
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.label)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 7)
                }
            }

            if !draft.warnings.isEmpty {
                WVDivider()
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(draft.warnings) { warning in
                        Text(warning.message)
                            .wvFont(.caption)
                            .foregroundStyle(WVColor.orange)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            let unmatched = WarrantyCardRules.unmatchedLabels(from: draft)
            if !unmatched.isEmpty {
                WVDivider()
                Text(L.t("Không đọc được: %@ — bạn tự nhập các ô này.", unmatched.joined(separator: ", ")))
                    .wvFont(.caption)
                    .foregroundStyle(WVColor.label3)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }

            WVDivider()

            WVButton(L.t("Điền vào biểu mẫu"), icon: "check") {
                onApply(draft)
                dismiss()
            }
            .padding(.horizontal, WVSpacing.gutter)
            .padding(.vertical, 14)
        }
        .background(WVColor.bg2)
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.list, style: .continuous))
        .padding(.horizontal, WVSpacing.gutter)
    }

    /// Opt-in is off. Points at the Settings switch and says what turning it on
    /// sends, rather than a bare "permission denied"; no button here, because
    /// the consent must be given on the screen that carries the full disclosure.
    private var consentGateCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                WVIcon("sparkles", size: 18)
                    .foregroundStyle(WVColor.purple)
                Text(L.t("Cần bật Trợ lý AI để đọc thẻ bảo hành"))
                    .wvFont(.bodyEmphasis)
                    .foregroundStyle(WVColor.label)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(L.t("Mở Cài đặt → Trợ lý AI và bật. Khi bật, ảnh/PDF thẻ bảo hành đã giải mã sẽ được gửi tới Anthropic (dịch vụ AI ở Mỹ) để đọc; Anthropic xoá dữ liệu trong vòng 30 ngày và không dùng để huấn luyện. Mặc định tắt."))
                .wvFont(.footnote)
                .foregroundStyle(WVColor.label2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .background(WVColor.bg2)
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.list, style: .continuous))
        .padding(.horizontal, WVSpacing.gutter)
    }

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

    private func openCamera() async {
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

    // MARK: - Input handling

    private func readPhoto(_ item: PhotosPickerItem) async {
        defer { photoItem = nil }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                errorMessage = L.t("Không đọc được ảnh, thử lại sau")
                return
            }
            await scan(data: data, fileName: "")
        } catch {
            errorMessage = L.t("Không đọc được ảnh, thử lại sau")
        }
    }

    private func readCameraImage(_ data: Data) async {
        await scan(data: data, fileName: "")
    }

    private func readFile(_ result: Result<[URL], Error>) async {
        guard case let .success(urls) = result, let url = urls.first else {
            if case .failure = result { errorMessage = L.t("Không mở được file.") }
            return
        }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            await scan(data: data, fileName: url.lastPathComponent)
        } catch {
            errorMessage = L.t("Không đọc được file.")
        }
    }

    /// The single place bytes reach the server.
    ///
    /// 1. size/type validation against the same whitelist the endpoint accepts;
    /// 2. upload as an **inbox item** (`deviceId: nil`) — the file exists before
    ///    the paid model call, so a failed extraction leaves it in a real place;
    /// 3. extract with that id, which also persists the transcript for search.
    private func scan(data: Data, fileName: String) async {
        guard !isBusy else { return }
        errorMessage = nil
        cameraError = nil
        draft = nil

        guard data.count <= AttachmentFileType.maxBytes else {
            errorMessage = AttachmentFileType.tooLargeMessage
            return
        }
        // The bytes we actually send, and the MIME we declare for them. A HEIC
        // still is re-encoded as JPEG *before* the upload: declaring
        // image/jpeg over HEIC bytes would be rejected by the server's
        // magic-byte cross-check.
        let upload: (data: Data, mime: String, ext: String)? = {
            switch AttachmentFileType.ocrPayload(for: data) {
            case let .asIs(mimeType, fileExtension):
                return (data, mimeType, fileExtension)
            case .transcodeToJPEG:
                guard let image = UIImage(data: data),
                      let jpeg = image.jpegData(compressionQuality: 0.9) else { return nil }
                return (jpeg, "image/jpeg", "jpg")
            case .unsupported:
                return nil
            }
        }()
        guard let upload else {
            errorMessage = AttachmentFileType.ocrUnsupportedMessage
            return
        }

        isBusy = true
        defer { isBusy = false }
        do {
            let meta = try await client.uploadAttachment(
                deviceId: nil,
                fileName: fileName.isEmpty ? "warranty-card-\(Self.stamp()).\(upload.ext)" : fileName,
                fileType: upload.mime,
                data: upload.data,
                description: nil
            )
            uploadedName = meta.fileName
            let result = try await client.extractWarrantyCard(attachmentId: meta.id)
            draft = result
        } catch let error as APIError {
            errorMessage = Self.message(for: error)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// The documented refusals say what the user can actually do. A generic
    /// "request failed" on a consent gate is the bug §6.3 is fixing; the AI
    /// opt-in is turned on in Settings, and this sheet never turns it on behind
    /// the user's back.
    private static func message(for error: APIError) -> String {
        guard case let .server(status, envelope) = error else {
            return error.localizedDescription
        }
        switch (status, envelope.error.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()) {
        case (403, "ai_optin_required"):
            return L.t("Cần bật Trợ lý AI trong Cài đặt (Cài đặt → Trợ lý AI) rồi thử lại.")
        case (403, "premium_required"):
            return L.t("Đọc thẻ bảo hành là tính năng Premium — chưa mở cho tài khoản của bạn.")
        case (503, "feature_disabled"):
            return L.t("Tính năng đọc thẻ bảo hành chưa khả dụng.")
        default:
            return envelope.message ?? envelope.error
        }
    }

    private static func stamp() -> String {
        String(Int(Date().timeIntervalSince1970)) + "-" + UUID().uuidString.prefix(4)
    }
}
