import SwiftUI
import VisionKit
import UIKit
import WarrlyKit

// ============================================================
// SerialScannerSheet — scan a serial / IMEI instead of typing it
//
// `DataScannerViewController` (VisionKit, iOS 16+) is used for BOTH barcodes and
// plain printed text. The serial is usually printed as text on the box, not
// encoded in a barcode, so text recognition is not a fallback here — it is half
// the feature.
//
// The scan never writes anything by itself. A barcode can be picked up
// automatically (it is unambiguous, and the review screen still asks for
// confirmation); printed text is selected by tapping the highlight. Either way
// the next screen holds the recognised string in an editable field, and only
// "Dùng serial này" hands a draft back to the form. The form's save is still a
// separate, explicit tap.
//
// Camera permission is requested by `DeviceFormView` before this sheet is
// presented, so this file does not own the "denied" alert. It does own the
// "startScanning threw" state, because a camera can become unavailable after the
// permission check (another app takes it, Guided Access, …).
// ============================================================

/// Availability probes for the scan button.
enum SerialScannerSupport {
    /// Hardware + OS support. False on every simulator, so the scan button is
    /// feature-gated there rather than opening a black rectangle.
    @MainActor static var isSupported: Bool {
        DataScannerViewController.isSupported
    }

    /// Camera is free to use right now. Checked again when the button is tapped.
    @MainActor static var isAvailable: Bool {
        DataScannerViewController.isAvailable
    }
}

struct SerialScannerSheet: View {
    /// Called with the confirmed draft. The caller puts it into the form; it must
    /// not save.
    let onUse: (String) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var reviewing = false
    @State private var reviewText = ""
    @State private var startFailed = false
    @State private var scannerID = UUID()
    @FocusState private var reviewFocused: Bool

    private var trimmedReview: String {
        reviewText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        NavigationStack {
            Group {
                if reviewing {
                    reviewBody
                } else {
                    scannerBody
                }
            }
            .navigationTitle(L.t("Quét serial / IMEI"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(L.t("Huỷ")) { dismiss() }
                        .foregroundStyle(WVColor.tint)
                }
            }
        }
    }

    // MARK: - Viewfinder

    private var scannerBody: some View {
        ZStack(alignment: .bottom) {
            Color.black.ignoresSafeArea()

            if startFailed {
                startFailedBody
            } else {
                SerialScannerRepresentable(
                    onSelect: accept,
                    onFailure: { startFailed = true }
                )
                .id(scannerID)
                .ignoresSafeArea()
            }

            if !startFailed {
                VStack(alignment: .leading, spacing: 6) {
                    Text(L.t("Đưa camera vào mã vạch hoặc dòng chữ in serial/IMEI trên hộp hoặc mặt máy."))
                        .wvFont(.subheadlineEmphasis)
                        .foregroundStyle(.white)
                    Text(L.t("Chạm vào dòng chữ hoặc mã vạch được đánh dấu để chọn. Mã vạch có thể tự nhận; kết quả luôn là bản nháp để bạn kiểm tra lại."))
                        .wvFont(.caption)
                        .foregroundStyle(.white.opacity(0.85))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(.black.opacity(0.58), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }
        }
    }

    private var startFailedBody: some View {
        VStack(spacing: 12) {
            Image(systemName: "camera.fill")
                .font(.system(size: 44, weight: .regular))
                .foregroundStyle(WVColor.label3)
            Text(L.t("Không mở được camera quét."))
                .wvFont(.title3Emphasis)
                .foregroundStyle(WVColor.label)
                .multilineTextAlignment(.center)
            Text(L.t("Thử đóng màn hình này rồi mở lại. Nếu một ứng dụng khác đang dùng camera, hãy đóng ứng dụng đó trước."))
                .wvFont(.subheadline)
                .foregroundStyle(WVColor.label3)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            WVButton(L.t("Thử lại"), icon: "refresh", kind: .primary, fullWidth: false) {
                startFailed = false
                scannerID = UUID()
            }
            .padding(.top, 4)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WVColor.bg.ignoresSafeArea())
    }

    // MARK: - Review

    private var reviewBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(L.t("Kết quả quét"))
                    .wvFont(.title2Emphasis)
                    .foregroundStyle(WVColor.label)
                    .padding(.top, 20)

                Text(L.t("Đây là chuỗi camera đọc được. Sửa lại nếu thiếu hoặc thừa ký tự, rồi bấm dùng. Ứng dụng chỉ điền vào biểu mẫu — chưa lưu gì."))
                    .wvFont(.subheadline)
                    .foregroundStyle(WVColor.label2)
                    .fixedSize(horizontal: false, vertical: true)

                TextField("Serial / IMEI", text: $reviewText)
                    .wvFont(.title3Emphasis)
                    .foregroundStyle(WVColor.label)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .keyboardType(.asciiCapable)
                    .focused($reviewFocused)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 52)
                    .background(WVColor.fill3)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                Text(L.t("Kết quả có thể là cả dòng chữ in trên hộp. Hãy xoá phần nhãn còn sót lại nếu có."))
                    .wvFont(.caption)
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)

                WVButton(L.t("Dùng serial này"), icon: "check", kind: .primary) {
                    useDraft()
                }
                .disabled(trimmedReview.isEmpty)
                .padding(.top, 4)

                Button {
                    reviewing = false
                    reviewText = ""
                    startFailed = false
                    scannerID = UUID()
                } label: {
                    Text(L.t("Quét lại"))
                        .wvFont(.calloutEmphasis)
                        .foregroundStyle(WVColor.tint)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                }
                .buttonStyle(WVPressableStyle())
            }
            .padding(.horizontal, WVSpacing.gutter)
            .padding(.bottom, 24)
        }
        .wvScreen()
        .task {
            // The review field is the reason this screen exists; put the cursor
            // there so a wrong digit can be corrected without an extra tap.
            reviewFocused = true
        }
    }

    // MARK: - Actions

    private func accept(_ raw: String) {
        let draft = SerialScanText.normalize(raw)
            ?? raw.trimmingCharacters(in: .whitespacesAndNewlines)
        reviewText = draft
        startFailed = false
        reviewing = true
    }

    private func useDraft() {
        let value = SerialScanText.normalize(reviewText) ?? trimmedReview
        guard !value.isEmpty else { return }
        onUse(value)
        dismiss()
    }
}

// MARK: - DataScanner bridge

/// Hosts the scanner and starts it only once the controller is actually on
/// screen. `DataScannerViewController.startScanning()` expects a visible view
/// controller; calling it straight from `makeUIViewController` can run before
/// SwiftUI has inserted the view and throw, which would have turned into the
/// "camera unavailable" state on launch.
private final class ScannerHostViewController: UIViewController {
    let scanner: DataScannerViewController
    var onFailure: (() -> Void)?

    private var started = false

    init(scanner: DataScannerViewController) {
        self.scanner = scanner
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        addChild(scanner)
        scanner.view.frame = view.bounds
        scanner.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(scanner.view)
        scanner.didMove(toParent: self)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !started else { return }
        started = true
        do {
            try scanner.startScanning()
        } catch {
            // Restricted, in use by another app, or unsupported hardware. The
            // sheet shows a retry rather than a silent black screen.
            onFailure?()
        }
    }
}

private struct SerialScannerRepresentable: UIViewControllerRepresentable {
    let onSelect: (String) -> Void
    let onFailure: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> ScannerHostViewController {
        let types: Set<DataScannerViewController.RecognizedDataType> = [
            .text(languages: ["en", "vi"]),
            .barcode(symbologies: [
                .code128, .code39, .code93, .ean8, .ean13, .upce,
                .qr, .dataMatrix, .pdf417, .itf14, .aztec,
            ]),
        ]
        let scanner = DataScannerViewController(
            recognizedDataTypes: types,
            qualityLevel: .balanced,
            // One item at a time keeps the tap target unambiguous; the serial is a
            // single value anyway.
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: true,
            isPinchToZoomEnabled: true,
            isGuidanceEnabled: true,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        context.coordinator.scanner = scanner

        let host = ScannerHostViewController(scanner: scanner)
        host.onFailure = { [weak coordinator = context.coordinator] in
            coordinator?.parent.onFailure()
        }
        return host
    }

    func updateUIViewController(_ uiViewController: ScannerHostViewController, context: Context) {
        // SwiftUI rebuilds this struct; the coordinator must call the newest
        // closures, not the ones captured at make time.
        context.coordinator.parent = self
    }

    static func dismantleUIViewController(_ uiViewController: ScannerHostViewController,
                                          coordinator: Coordinator) {
        uiViewController.scanner.stopScanning()
        uiViewController.scanner.delegate = nil
        uiViewController.onFailure = nil
    }

    @MainActor
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        var parent: SerialScannerRepresentable
        weak var scanner: DataScannerViewController?
        /// The scanner can report the same barcode on several frames. One
        /// delivery is enough; the sheet stops scanning immediately after it.
        private var delivered = false

        init(_ parent: SerialScannerRepresentable) {
            self.parent = parent
        }

        func dataScanner(_ dataScanner: DataScannerViewController,
                         didAdd addedItems: [RecognizedItem],
                         allItems: [RecognizedItem]) {
            guard !delivered else { return }
            for item in addedItems {
                guard case let .barcode(barcode) = item,
                      let payload = barcode.payloadStringValue else { continue }
                deliver(payload, from: dataScanner)
                return
            }
        }

        func dataScanner(_ dataScanner: DataScannerViewController,
                         didTapOn item: RecognizedItem) {
            guard !delivered else { return }
            switch item {
            case let .barcode(barcode):
                if let payload = barcode.payloadStringValue {
                    deliver(payload, from: dataScanner)
                }
            case let .text(text):
                deliver(text.transcript, from: dataScanner)
            @unknown default:
                break
            }
        }

        func dataScanner(_ dataScanner: DataScannerViewController,
                         becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
            parent.onFailure()
        }

        private func deliver(_ raw: String, from scanner: DataScannerViewController) {
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return }
            delivered = true
            scanner.stopScanning()
            parent.onSelect(trimmed)
        }
    }
}
