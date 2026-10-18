import UIKit
import UniformTypeIdentifiers
import WarrlyKit

// ============================================================
// ShareViewController — the OS-level entry point into the inbox.
//
// A receipt arrives inside Mail (PDF) or Photos (JPEG/PNG/HEIC). This controller
// does NOT upload anything: it reads the first shared item, validates it against
// the same `AttachmentFileType` rules the app uses, writes it into the App Group
// queue (`SharedInboxStore`) and tells the user where it went. The app drains
// that queue on its next open — see `SharedInbox.swift` for why.
//
// Consequences of that choice, all intentional:
//   • no bearer token and no Keychain access group in the extension;
//   • no network call inside the ~30 second extension budget;
//   • a file that cannot be read/validated never leaves the share sheet
//     silently: it shows the Vietnamese/English message and does not enqueue.
// ============================================================

final class ShareViewController: UIViewController {

    private let card = UIView()
    private let iconView = UIImageView()
    private let titleLabel = UILabel()
    private let messageLabel = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let actionButton = UIButton(type: .system)

    private var didFinish = false
    private var receiveTask: Task<Void, Never>?

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()

        // The extension is a separate process: adopt the language the app
        // mirrored into the App Group defaults (falling back to the device
        // language, then English) before building any copy.
        L.language = SharedInboxLanguage.resolved()

        configureView()
        showWorking()

        receiveTask = Task { [weak self] in
            await self?.receive()
        }
    }

    deinit {
        receiveTask?.cancel()
    }

    // MARK: - UI

    private func configureView() {
        view.backgroundColor = .systemGroupedBackground

        card.translatesAutoresizingMaskIntoConstraints = false
        card.backgroundColor = .secondarySystemGroupedBackground
        card.layer.cornerRadius = 16
        card.layer.cornerCurve = .continuous
        view.addSubview(card)

        iconView.image = UIImage(systemName: "tray.and.arrow.down.fill")
        iconView.tintColor = .systemBlue
        iconView.contentMode = .scaleAspectFit
        iconView.translatesAutoresizingMaskIntoConstraints = false
        iconView.heightAnchor.constraint(equalToConstant: 34).isActive = true

        titleLabel.font = .preferredFont(forTextStyle: .headline)
        titleLabel.textColor = .label
        titleLabel.textAlignment = .center
        titleLabel.numberOfLines = 0

        messageLabel.font = .preferredFont(forTextStyle: .subheadline)
        messageLabel.textColor = .secondaryLabel
        messageLabel.textAlignment = .center
        messageLabel.numberOfLines = 0
        messageLabel.isHidden = true

        spinner.color = .secondaryLabel

        actionButton.titleLabel?.font = .preferredFont(forTextStyle: .body)
        actionButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [
            iconView, titleLabel, messageLabel, spinner, actionButton,
        ])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        NSLayoutConstraint.activate([
            card.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            card.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -20),
        ])
    }

    private func showWorking() {
        iconView.image = UIImage(systemName: "tray.and.arrow.down.fill")
        iconView.tintColor = .systemBlue
        titleLabel.text = L.t("Đang xử lý…")
        messageLabel.isHidden = true
        spinner.startAnimating()
        actionButton.isHidden = false
        actionButton.setTitle(L.t("Huỷ"), for: .normal)
    }

    private func showSuccess(_ item: SharedInboxItem) {
        guard !didFinish else { return }
        spinner.stopAnimating()
        iconView.image = UIImage(systemName: "checkmark.circle.fill")
        iconView.tintColor = .systemGreen
        titleLabel.text = L.t("Đã thêm vào Hộp thư đến")
        messageLabel.text = item.fileName + "\n" + L.t("Tệp sẽ được tải lên khi bạn mở Warrly.")
        messageLabel.isHidden = false
        actionButton.setTitle(L.t("Xong"), for: .normal)

        // The file is already safely on disk at this point, so the sheet can
        // close itself. A failure stays up until the user has read it.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { [weak self] in
            self?.finish()
        }
    }

    private func showFailure(_ message: String) {
        guard !didFinish else { return }
        spinner.stopAnimating()
        iconView.image = UIImage(systemName: "exclamationmark.triangle.fill")
        iconView.tintColor = .systemOrange
        titleLabel.text = L.t("Không chia sẻ được tệp")
        messageLabel.text = message
        messageLabel.isHidden = false
        actionButton.setTitle(L.t("Đóng"), for: .normal)
    }

    @objc private func closeTapped() {
        finish()
    }

    private func finish() {
        guard !didFinish else { return }
        didFinish = true
        receiveTask?.cancel()
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }

    // MARK: - Receiving

    private func receive() async {
        do {
            let (data, suggestedName) = try await loadSharedPayload()
            guard let store = SharedInboxStore() else {
                throw SharedInboxError.appGroupUnavailable
            }
            let item = try store.enqueue(data: data, fileName: suggestedName)
            showSuccess(item)
        } catch let error as SharedInboxError {
            showFailure(error.message)
        } catch let error as ShareLoadError {
            showFailure(error.message)
        } catch {
            showFailure(L.t("Không đọc được tệp được chia sẻ."))
        }
    }

    /// Reads the first image/PDF/file attachment from the extension context.
    ///
    /// Provider order matters: an image should be loaded as an image (preserving
    /// HEIC bytes), a PDF as a PDF, and only then should the generic file URL
    /// fallback be used. A provider that offers none of those is not something
    /// this extension can read, so it fails with `noItem` rather than uploading
    /// a mystery payload.
    private func loadSharedPayload() async throws -> (Data, String?) {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            throw ShareLoadError.noItem
        }

        for item in items {
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                    return try await loadRepresentation(from: provider, type: .image)
                }
                if provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
                    return try await loadRepresentation(from: provider, type: .pdf)
                }
                if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                    return try await loadFileURL(from: provider)
                }
            }
        }
        throw ShareLoadError.noItem
    }

    /// Tries the file representation first (original bytes, original name), then
    /// falls back to a data representation for providers that only expose that.
    private func loadRepresentation(
        from provider: NSItemProvider,
        type: UTType
    ) async throws -> (Data, String?) {
        do {
            return try await loadFileRepresentation(from: provider, type: type)
        } catch let error as SharedInboxError {
            // Over-size is a real answer, not a reason to try another route.
            throw error
        } catch {
            return try await loadDataRepresentation(from: provider, type: type)
        }
    }

    private func loadFileRepresentation(
        from provider: NSItemProvider,
        type: UTType
    ) async throws -> (Data, String?) {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadFileRepresentation(
                forTypeIdentifier: type.identifier
            ) { url, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let url else {
                    continuation.resume(throwing: ShareLoadError.unreadable)
                    return
                }
                do {
                    // The URL is only valid inside this closure, so the bytes
                    // must be read here. Check the size before reading: a
                    // shared video can be far larger than the inbox's 5 MB cap.
                    let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                    if size > AttachmentFileType.maxBytes {
                        continuation.resume(throwing: SharedInboxError.tooLarge)
                        return
                    }
                    let data = try Data(contentsOf: url)
                    continuation.resume(
                        returning: (data, provider.suggestedName ?? url.lastPathComponent)
                    )
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private func loadDataRepresentation(
        from provider: NSItemProvider,
        type: UTType
    ) async throws -> (Data, String?) {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadDataRepresentation(
                forTypeIdentifier: type.identifier
            ) { data, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let data, !data.isEmpty else {
                    continuation.resume(throwing: ShareLoadError.unreadable)
                    return
                }
                continuation.resume(returning: (data, provider.suggestedName))
            }
        }
    }

    /// Generic `public.file-url` fallback (Files, some Mail attachments).
    ///
    /// Reads the URL with a security scope, checks the size before pulling the
    /// bytes into memory, and lets the queue's magic-byte check reject anything
    /// that is not an accepted receipt format.
    private func loadFileURL(
        from provider: NSItemProvider
    ) async throws -> (Data, String?) {
        let loaded: NSSecureCoding? = try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(
                forTypeIdentifier: UTType.fileURL.identifier,
                options: nil
            ) { item, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: item)
            }
        }

        let url: URL?
        if let nsurl = loaded as? NSURL {
            url = nsurl as URL
        } else if let data = loaded as? Data {
            url = URL(dataRepresentation: data, relativeTo: nil)
        } else if let loadedURL = loaded as? URL {
            url = loadedURL
        } else {
            url = nil
        }
        guard let url else { throw ShareLoadError.unreadable }

        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if size > AttachmentFileType.maxBytes {
            throw SharedInboxError.tooLarge
        }
        let data = try Data(contentsOf: url)
        return (data, provider.suggestedName ?? url.lastPathComponent)
    }

    // MARK: - Errors

    private enum ShareLoadError: Error {
        case noItem
        case unreadable

        var message: String {
            switch self {
            case .noItem:
                return L.t("Không tìm thấy tệp để chia sẻ.")
            case .unreadable:
                return L.t("Không đọc được tệp được chia sẻ.")
            }
        }
    }
}
