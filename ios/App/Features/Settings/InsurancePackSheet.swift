import SwiftUI
import UIKit
import WarrlyKit

// ============================================================
// InsurancePackSheet — "Bảng kê cho bảo hiểm (tiếng Việt)"
//
// Lives in Settings → Dữ liệu because the pack is an ACCOUNT-WIDE export, not a
// property of one device: the insurer asks for a schedule of everything the
// household owns, and the existing Data section is where every other
// "get my data out of the app" control already lives (JSON backup, restore).
//
// The PDF is always Vietnamese by design — the reader is the insurer or the
// loss adjuster, not the app user — so the screen says that before the tap and
// never translates the document. The UI chrome still follows the app language.
//
// Delivery is the system share sheet, fed by a temporary file: a PDF held only
// in memory cannot be sent to an insurer. `InsurancePackRules` supplies the
// filename and the `%PDF-` guard; the temp directory is removed in the activity
// controller's completion handler, after the receiving app has finished with it.
// ============================================================

struct InsurancePackSheet: View {
    let client: APIClient

    @Environment(\.dismiss) private var dismiss

    /// Server default: sold devices are excluded.
    @State private var includeSold = false
    @State private var isBuilding = false
    @State private var errorMessage: String?
    @State private var shareFile: ShareFile?

    /// The in-flight download. Cancelled when the sheet goes away, so a slow
    /// generation cannot finish after the user left and leave a temp file with
    /// no share sheet to delete it.
    @State private var buildTask: Task<Void, Never>?

    /// One share-sheet presentation. Identifiable so `.sheet(item:)` gets a
    /// fresh presentation for every generated file (and never reuses a URL that
    /// has just been deleted).
    private struct ShareFile: Identifiable {
        let id = UUID()
        let url: URL
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer().frame(height: 12)
                    introCard
                    options
                    if let errorMessage { errorBanner(errorMessage) }
                    actions
                    Spacer().frame(height: 24)
                }
            }
            .wvScreen()
            .navigationTitle(L.t("Bảng kê cho bảo hiểm"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(L.t("Huỷ")) {
                        buildTask?.cancel()
                        dismiss()
                    }
                    .foregroundStyle(WVColor.tint)
                }
            }
            .onDisappear { buildTask?.cancel() }
            .sheet(item: $shareFile) { file in
                // The completion handler is the reliable "the receiving app is
                // done with this file" signal. `ShareLink` has no completion
                // callback, and deleting on `onDisappear` could race the app
                // that is still reading it.
                ActivityView(activityItems: [file.url]) {
                    removeTemporary(file.url)
                    shareFile = nil
                }
            }
        }
    }

    // MARK: - Intro

    private var introCard: some View {
        WVCard(padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    WVLeadingIcon(icon: "shieldCheck", color: WVColor.blue, size: 34)
                    Text(L.t("Bảng kê cho bảo hiểm (tiếng Việt)"))
                        .wvFont(.bodyEmphasis)
                        .foregroundStyle(WVColor.label)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }

                Text(L.t("Tải một tệp PDF để gửi cho công ty bảo hiểm khi họ yêu cầu bảng kê tài sản: trang bìa, bảng kê giá trị và giá mua, từng thiết bị kèm điều khoản bảo hành và ảnh, cùng danh mục tệp đính kèm."))
                    .wvFont(.subheadline)
                    .foregroundStyle(WVColor.label2)
                    .fixedSize(horizontal: false, vertical: true)

                // The one line that stops "why is this Vietnamese?" from
                // reading as a bug. The document is an artifact for a third
                // party, so it does NOT follow the app's language setting.
                HStack(alignment: .top, spacing: 8) {
                    WVIcon("globe", size: 13)
                    Text(L.t("Tệp PDF luôn ở tiếng Việt vì người đọc là công ty bảo hiểm hoặc giám định viên, không phải người dùng ứng dụng."))
                        .wvFont(.footnote)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(WVColor.blue)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(WVColor.blue.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
    }

    // MARK: - Options

    private var options: some View {
        VStack(spacing: 0) {
            WVSectionHeader(L.t("Tuỳ chọn"))
            WVGroup {
                HStack(spacing: 12) {
                    WVLeadingIcon(icon: "tag", color: WVColor.orange)
                    Text(L.t("Bao gồm cả thiết bị đã bán"))
                        .wvFont(.body)
                        .foregroundStyle(WVColor.label)
                    Spacer(minLength: 8)
                    Toggle("", isOn: $includeSold)
                        .labelsHidden()
                        .tint(WVColor.tint)
                        .disabled(isBuilding)
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 52)
            }
            WVSectionFooter(L.t("Mặc định chỉ liệt kê thiết bị bạn đang sở hữu. Bật nếu hồ sơ bảo hiểm cần cả tài sản đã bán trong kỳ."))

            Text(includeSold
                 ? L.t("Phạm vi: tất cả thiết bị, kể cả đã bán.")
                 : L.t("Phạm vi: tất cả thiết bị đang sở hữu."))
                .wvFont(.footnote)
                .foregroundStyle(WVColor.label3)
                .padding(.horizontal, 32)
                .padding(.top, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Error

    /// Failures are never silent: no spinner-forever, no "nothing happened".
    /// The server's own message wins when it sent one (the sheet catches
    /// `APIError` first); the local sentences cover transport/write failures.
    private func errorBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            WVIcon("alert", size: 14)
            Text(message)
                .wvFont(.footnote)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .foregroundStyle(WVColor.red)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WVColor.red.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.top, 12)
    }

    // MARK: - Action

    private var actions: some View {
        VStack(spacing: 8) {
            WVButton(
                isBuilding ? L.t("Đang tạo bảng kê…") : L.t("Tạo và chia sẻ PDF"),
                icon: isBuilding ? nil : "download",
                kind: .primary
            ) {
                buildTask = Task { await buildAndShare() }
            }
            .disabled(isBuilding)

            Text(L.t("Tệp được chia sẻ qua bảng chia sẻ của iOS — bạn chọn nơi gửi."))
                .wvFont(.footnote)
                .foregroundStyle(WVColor.label3)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.top, 20)
    }

    @MainActor
    private func buildAndShare() async {
        guard !isBuilding else { return }
        errorMessage = nil
        isBuilding = true
        defer {
            isBuilding = false
            buildTask = nil
        }

        do {
            let data = try await client.insurancePack(includeSold: includeSold)
            guard !Task.isCancelled else { return }

            guard !data.isEmpty else {
                errorMessage = L.t("Tệp tải về trống — thử lại nhé.")
                return
            }
            guard InsurancePackRules.hasPDFHeader(data) else {
                // A 200 carrying an HTML/JSON error page must not be shared as
                // a .pdf: the insurer would receive an unopenable document.
                errorMessage = L.t("Máy chủ trả về một tệp không phải PDF — thử lại nhé.")
                return
            }

            let url: URL
            do {
                url = try writeTemporaryPDF(data)
            } catch {
                guard !Task.isCancelled else { return }
                errorMessage = L.t("Không ghi được tệp PDF tạm.")
                return
            }

            // The sheet may have been dismissed while the download was in
            // flight; do not leave a file behind that nothing will share.
            guard !Task.isCancelled else {
                removeTemporary(url)
                return
            }
            shareFile = ShareFile(url: url)
        } catch {
            guard !Task.isCancelled else { return }
            if let apiError = error as? APIError {
                // Includes 401/403/404/5xx and any server `message`; the whole
                // point is that the user sees why no PDF appeared.
                errorMessage = apiError.localizedDescription
            } else {
                errorMessage = L.t("Không tải được bảng kê cho bảo hiểm.")
            }
        }
    }

    // MARK: - Temporary file

    /// Writes the PDF into its own UUID-named temp directory, so two shares can
    /// never overwrite each other and cleanup can remove the folder wholesale.
    private func writeTemporaryPDF(_ data: Data) throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("WarrlyInsurancePack", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: nil
        )
        let url = directory.appendingPathComponent(InsurancePackRules.filename())
        do {
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }

    /// Removes the file AND its per-share directory. Called from the share
    /// sheet's completion handler after the receiving app is done reading — and
    /// from the cancellation path if the sheet went away between writing the
    /// file and presenting the share sheet.
    private func removeTemporary(_ url: URL) {
        try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
    }
}

// MARK: - System share sheet

/// `UIActivityViewController` rather than `ShareLink`: a temp file needs a
/// deterministic "sharing finished" callback so it can be deleted. `ShareLink`
/// provides none, and cleanup on `onDisappear` can remove the file while the
/// receiving app is still copying it.
private struct ActivityView: UIViewControllerRepresentable {
    let activityItems: [Any]
    let onComplete: () -> Void

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(
            activityItems: activityItems,
            applicationActivities: nil
        )
        controller.completionWithItemsHandler = { _, _, _, _ in onComplete() }
        return controller
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
