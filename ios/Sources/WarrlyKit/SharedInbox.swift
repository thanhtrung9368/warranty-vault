import Foundation

// MARK: - SharedInbox

/// The App Group hand-off between the Share Extension and the app.
///
/// ## Why a queue and not a direct upload
///
/// A share extension gets roughly 30 seconds and no guaranteed network. Uploading
/// from the extension would also mean putting the bearer token into the
/// extension: `KeychainStore` writes `service = com.warrly`,
/// `account = session.token` into the app's *default* access group, so the
/// extension would need a Keychain Sharing access group added to both targets
/// and a migration for tokens already stored without one (plus the API base URL
/// that only the app's Info.plist has). Even then, a failed request inside the
/// 30-second budget would have nowhere to go. The app already owns the
/// authenticated client, the retry path and the inbox badge, so the extension
/// only writes bytes into the App Group container and the app drains that queue
/// on its next launch/foreground. The extension needs no credentials, no
/// network and no clock.
///
/// The cost is latency (the file reaches the inbox after the user opens the app)
/// and at-least-once delivery: if the process dies after a successful upload but
/// before the item is removed, the next drain uploads it again. A duplicate
/// inbox row is recoverable; a lost receipt is not.
///
/// ## Layout
///
/// `.../ShareInbox/<uuid>/payload` + `.../ShareInbox/<uuid>/meta.json`.
///
/// An item is written into a hidden staging directory and then renamed into
/// place, so the drainer never reads a half-written payload. Anything without
/// complete metadata and payload is ignored rather than treated as a file.
public enum SharedInbox {

    /// The App Group both targets are entitled to (see `ios/project.yml`).
    ///
    /// It must be enabled for both bundle identifiers in the developer portal;
    /// `containerURL(forSecurityApplicationGroupIdentifier:)` returns `nil`
    /// otherwise, which is why every entry point treats a missing container as
    /// "nothing to do" rather than crashing.
    public static let appGroupIdentifier = "group.com.warrly"

    static let directoryName = "ShareInbox"
    static let payloadFileName = "payload"
    static let metadataFileName = "meta.json"

    /// The receipt formats the Share Extension accepts.
    ///
    /// Deliberately narrower than the server's attachment whitelist
    /// (`AttachmentFileType` also knows WEBP and GIF): those are valid
    /// attachments, but they are not what someone shares from Mail or Photos as
    /// a receipt, and the rejection copy below names exactly these four formats.
    /// The sniffing and the 5 MB cap are reused from `AttachmentFileType`, not
    /// reimplemented.
    public static let acceptedMIMEs: Set<String> = [
        "image/jpeg", "image/png", "image/heic", "application/pdf",
    ]

    /// Key mirrored into the App Group defaults so the extension renders in the
    /// language the user picked in the app (`LocalizationStore` owns the app's
    /// copy of the same value).
    public static let languageDefaultsKey = "wv.selectedLanguage"

    /// Builds the file name stored in the inbox.
    ///
    /// The name is not cosmetic: `APIClient.uploadMultipart` interpolates it into
    /// a `Content-Disposition` header, so path separators, quotes, CR/LF and
    /// control characters are replaced instead of trusted. The extension is
    /// forced to the *sniffed* extension — an iPhone writes HEIC even when the
    /// provider suggests a `.jpg` name.
    public static func displayFileName(
        _ raw: String?,
        fileExtension: String,
        now: Date = Date()
    ) -> String {
        var name = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        name = (name as NSString).lastPathComponent

        let forbidden = CharacterSet(charactersIn: "/\\\":\r\n\t")
            .union(.controlCharacters)
        name = String(String.UnicodeScalarView(name.unicodeScalars.map { scalar in
            forbidden.contains(scalar) ? "-" : scalar
        }))

        if name.isEmpty || name == "." || name == ".." {
            name = "shared-\(Int(now.timeIntervalSince1970))"
        }

        let wanted = fileExtension.lowercased()
        // JPEG is the one alias worth honouring: camera files are often named
        // `.jpeg` while the sniffed extension is `.jpg`, and appending a second
        // suffix would read like a corrupted name in the inbox.
        let aliases: Set<String> = wanted == "jpg" ? ["jpg", "jpeg"] : [wanted]
        let lower = name.lowercased()
        if !aliases.contains(where: { lower.hasSuffix("." + $0) }) {
            name += "." + wanted
        }

        if name.count > 120 {
            let suffix = "." + wanted
            let keep = max(1, 120 - suffix.count)
            name = String(name.prefix(keep)) + suffix
        }
        return name
    }
}

// MARK: - SharedInboxItem

/// One file waiting in the App Group queue.
///
/// `attempts` / `lastError` are diagnostics, not a retry limit: the app keeps
/// trying on every open until an upload succeeds. A file is never dropped
/// because a previous attempt failed.
public struct SharedInboxItem: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let fileName: String
    public let mimeType: String
    public let fileExtension: String
    public let byteCount: Int
    public let createdAt: Date
    public var attempts: Int
    public var lastError: String?
    public var lastAttemptAt: Date?
}

// MARK: - SharedInboxError

/// Why the queue refused or could not read a file.
///
/// Each case has user-facing copy; the extension shows it verbatim so a failed
/// share says what is wrong (unsupported format, over 5 MB, unreadable bytes)
/// instead of a generic failure. Vietnamese is the source language; `L.t`
/// translates it when the app is running in English.
public enum SharedInboxError: Error, Equatable, Sendable {
    /// Not one of `SharedInbox.acceptedMIMEs` according to the magic bytes.
    case unsupportedType
    /// Larger than `AttachmentFileType.maxBytes` (5 MB).
    case tooLarge
    /// The payload was missing, unreadable, or shorter than its metadata says.
    case unreadable
    /// Writing the item into the App Group container failed.
    case writeFailed
    /// The App Group container is unavailable (missing entitlement/provisioning).
    case appGroupUnavailable

    public var message: String {
        switch self {
        case .unsupportedType:
            return L.t("Chỉ chấp nhận ảnh JPG/PNG/HEIC hoặc PDF.")
        case .tooLarge:
            // Same cap and same catalog key as `AttachmentFileType`, looked up
            // per call: that constant is a `static let`, so it captures the
            // language that happened to be active at first access.
            return L.t("File vượt quá 5MB.")
        case .unreadable:
            return L.t("Không đọc được tệp được chia sẻ.")
        case .writeFailed:
            return L.t("Không lưu được tệp để tải lên sau.")
        case .appGroupUnavailable:
            return L.t("Warrly chưa sẵn sàng nhận tệp được chia sẻ.")
        }
    }
}

extension SharedInboxError: LocalizedError {
    public var errorDescription: String? { message }
}

// MARK: - SharedInboxStore

/// File-system queue for the Share Extension hand-off.
///
/// `init?(appGroupIdentifier:)` is what the app and the extension use;
/// `init(rootURL:)` exists so tests can run against a temporary directory. All
/// methods are synchronous and small (≤ 5 MB per item); the app calls them from
/// its main actor between `await`s, not in a tight loop.
public struct SharedInboxStore {
    public let rootURL: URL
    private let fileManager: FileManager

    public init(rootURL: URL, fileManager: FileManager = .default) {
        self.rootURL = rootURL
        self.fileManager = fileManager
    }

    /// Opens the queue inside the App Group container.
    ///
    /// Returns `nil` when the entitlement is missing — the extension then shows
    /// `SharedInboxError.appGroupUnavailable`, and the app simply has nothing to
    /// drain. That is a provisioning/configuration bug, not a file error.
    public init?(
        appGroupIdentifier: String = SharedInbox.appGroupIdentifier,
        fileManager: FileManager = .default
    ) {
        guard let container = fileManager.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupIdentifier
        ) else { return nil }
        self.init(
            rootURL: container.appendingPathComponent(
                SharedInbox.directoryName, isDirectory: true
            ),
            fileManager: fileManager
        )
    }

    // MARK: Enqueue

    /// Validates and stores one shared file.
    ///
    /// This is the single validation point for both directions: the extension
    /// calls it before telling the user the file was saved, and the app reuses
    /// the same `detect` / `maxBytes` rules right before upload (the shared
    /// container is outside the app's direct control, so trust it twice).
    @discardableResult
    public func enqueue(
        data: Data,
        fileName: String?,
        now: Date = Date()
    ) throws -> SharedInboxItem {
        guard data.count <= AttachmentFileType.maxBytes else {
            throw SharedInboxError.tooLarge
        }
        guard let detected = AttachmentFileType.detect(data),
              SharedInbox.acceptedMIMEs.contains(detected.mimeType) else {
            throw SharedInboxError.unsupportedType
        }

        do {
            try fileManager.createDirectory(at: rootURL, withIntermediateDirectories: true)
        } catch {
            throw SharedInboxError.writeFailed
        }

        let id = UUID().uuidString.lowercased()
        let item = SharedInboxItem(
            id: id,
            fileName: SharedInbox.displayFileName(
                fileName, fileExtension: detected.fileExtension, now: now
            ),
            mimeType: detected.mimeType,
            fileExtension: detected.fileExtension,
            byteCount: data.count,
            createdAt: now,
            attempts: 0,
            lastError: nil,
            lastAttemptAt: nil
        )

        let staging = rootURL.appendingPathComponent(".staging-\(id)", isDirectory: true)
        let destination = itemURL(for: id)
        do {
            try fileManager.createDirectory(at: staging, withIntermediateDirectories: true)
            try data.write(
                to: staging.appendingPathComponent(SharedInbox.payloadFileName),
                options: .atomic
            )
            // Metadata is written second and the directory is renamed last: a
            // reader can only ever see the complete pair.
            try Self.encoder.encode(item).write(
                to: staging.appendingPathComponent(SharedInbox.metadataFileName),
                options: .atomic
            )
            try fileManager.moveItem(at: staging, to: destination)
        } catch {
            try? fileManager.removeItem(at: staging)
            throw SharedInboxError.writeFailed
        }
        return item
    }

    // MARK: Read

    /// Every complete item, oldest first.
    ///
    /// Incomplete staging directories, a metadata file without its payload, and
    /// a payload shorter than its metadata all stay invisible — they are not
    /// silently dropped (the bytes are still on disk), just not claimed as a
    /// ready item.
    public func pendingItems() -> [SharedInboxItem] {
        guard let names = try? fileManager.contentsOfDirectory(atPath: rootURL.path) else {
            return []
        }
        var items: [SharedInboxItem] = []
        for name in names where !name.hasPrefix(".") {
            let directory = rootURL.appendingPathComponent(name, isDirectory: true)
            guard let item = item(at: directory), item.id == name else { continue }
            items.append(item)
        }
        return items.sorted {
            if $0.createdAt != $1.createdAt { return $0.createdAt < $1.createdAt }
            return $0.id < $1.id
        }
    }

    public func pendingCount() -> Int {
        pendingItems().count
    }

    /// Reads an item's bytes and verifies the length recorded at enqueue time.
    public func payload(for item: SharedInboxItem) throws -> Data {
        guard let data = try? Data(contentsOf: payloadURL(for: item.id)),
              data.count == item.byteCount else {
            throw SharedInboxError.unreadable
        }
        return data
    }

    // MARK: Failure / removal

    /// Records a failed attempt **without deleting the payload**.
    ///
    /// A metadata rewrite failure is ignored on purpose: the payload is the part
    /// that cannot be recreated, and the next drain still finds it (the attempt
    /// count is only diagnostics).
    @discardableResult
    public func markFailure(
        _ item: SharedInboxItem,
        message: String,
        now: Date = Date()
    ) -> SharedInboxItem {
        var updated = item
        updated.attempts += 1
        updated.lastError = message
        updated.lastAttemptAt = now
        if let data = try? Self.encoder.encode(updated) {
            try? data.write(
                to: itemURL(for: item.id)
                    .appendingPathComponent(SharedInbox.metadataFileName),
                options: .atomic
            )
        }
        return updated
    }

    /// Removes an item **after** its upload succeeded (or after the payload is
    /// known to be unrecoverable). Never call this from a failure path.
    public func remove(_ item: SharedInboxItem) {
        try? fileManager.removeItem(at: itemURL(for: item.id))
    }

    // MARK: Private

    private func itemURL(for id: String) -> URL {
        rootURL.appendingPathComponent(id, isDirectory: true)
    }

    private func payloadURL(for id: String) -> URL {
        itemURL(for: id).appendingPathComponent(SharedInbox.payloadFileName)
    }

    private func item(at directory: URL) -> SharedInboxItem? {
        let metadata = directory.appendingPathComponent(SharedInbox.metadataFileName)
        let payload = directory.appendingPathComponent(SharedInbox.payloadFileName)
        guard let data = try? Data(contentsOf: metadata),
              let item = try? Self.decoder.decode(SharedInboxItem.self, from: data),
              fileManager.fileExists(atPath: payload.path),
              item.byteCount > 0,
              item.byteCount <= AttachmentFileType.maxBytes
        else { return nil }
        return item
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        // Seconds-since-1970 keeps the ordering precision the queue needs; ISO
        // 8601 without fractional seconds makes two files shared in the same
        // second sort by UUID.
        encoder.dateEncodingStrategy = .secondsSince1970
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return decoder
    }()
}

// MARK: - SharedInboxLanguage

/// The language bridge for the extension's own process.
///
/// `LocalizationStore` resolves the app language (stored choice → server →
/// device → English) and mirrors the stored choice into the App Group defaults.
/// The extension cannot run that store — it has no account and no network — so
/// it reads the mirrored value, then falls back to the device language and
/// finally to English, which is the product default.
public enum SharedInboxLanguage {

    public static func resolved(
        appGroupIdentifier: String = SharedInbox.appGroupIdentifier,
        defaults: UserDefaults? = nil,
        preferredLanguages: [String] = Locale.preferredLanguages
    ) -> AppLanguage {
        let shared = defaults ?? UserDefaults(suiteName: appGroupIdentifier)
        if let stored = AppLanguage.parse(
            shared?.string(forKey: SharedInbox.languageDefaultsKey)
        ) {
            return stored
        }
        for identifier in preferredLanguages {
            if let match = AppLanguage.parse(identifier) { return match }
        }
        return AppLanguage.productDefault
    }

    /// Mirrors the app's explicit choice (or `nil` when it has none) into the
    /// App Group defaults. Called by `LocalizationStore` on every change.
    public static func publish(
        _ language: AppLanguage?,
        appGroupIdentifier: String = SharedInbox.appGroupIdentifier,
        defaults: UserDefaults? = nil
    ) {
        let shared = defaults ?? UserDefaults(suiteName: appGroupIdentifier)
        if let language {
            shared?.set(language.rawValue, forKey: SharedInbox.languageDefaultsKey)
        } else {
            shared?.removeObject(forKey: SharedInbox.languageDefaultsKey)
        }
    }
}
