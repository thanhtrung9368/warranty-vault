import Foundation
import SwiftUI
import WarrlyKit

/// Account-level state for the capture-first inbox.
///
/// One instance lives in `MainTabView` and is shared by the "Thêm" badge, the
/// inbox screen, and the Devices capture flow. That is deliberate: filing or
/// deleting an item must move the badge immediately, without a second network
/// read or a stale count left on another tab.
@MainActor
public final class InboxStore: ObservableObject {
    public enum LoadState: Equatable {
        case idle, loading, loaded, error(String)
    }

    /// Only unfiled rows ever live here.
    ///
    /// **The endpoint is the authority, not the field.** The implemented
    /// `AttachmentMeta` DTO (`toAttachmentDTO` / openapi) does not include
    /// `deviceId` at all, so absence MUST mean "unfiled"; `InboxRules.isUnfiled`
    /// treats `nil` that way. The filter below is therefore a no-op when the
    /// field is absent and only removes a row if a future/foreign payload
    /// actually carries a device id — it can never hide a row just because the
    /// server omitted the key.
    @Published public private(set) var attachments: [AttachmentMeta] = []
    @Published public private(set) var state: LoadState = .idle

    /// Files the Share Extension has left in the App Group queue that the app
    /// has not uploaded yet.
    ///
    /// Kept separate from `attachments` on purpose: these rows do not exist on
    /// the server, so they must never be filed or deleted through the inbox API.
    /// They only become real inbox rows after `importSharedFiles()` succeeds.
    @Published public private(set) var pendingSharedCount = 0
    @Published public private(set) var isImportingShared = false
    @Published public private(set) var sharedImportError: String?

    private let client: APIClient
    /// `nil` when the App Group container is unavailable (missing entitlement).
    /// The app then simply has nothing to drain.
    private let sharedInbox: SharedInboxStore?
    /// In-flight guard, separate from the published `state`: a cancelled
    /// `URLSession` task must not leave the store permanently unable to load
    /// again. `defer` always clears it.
    private var isLoading = false

    public init(
        client: APIClient,
        sharedInbox: SharedInboxStore? = SharedInboxStore()
    ) {
        self.client = client
        self.sharedInbox = sharedInbox
    }

    /// The number the badge shows. Derived from the rows, never stored
    /// separately, so it cannot drift from the list.
    public var count: Int { InboxRules.unfiledCount(attachments) }

    /// Badge text, or `nil` when the inbox is empty (`InboxRules` owns the
    /// `99+` cap).
    public var badgeText: String? { InboxRules.badgeText(for: count) }

    public func load() async {
        // A screen may call load while the tab shell's launch load is already
        // in flight; do not race two reads. The flag — not `.loading` — is what
        // guards this, so a cancelled task cannot wedge the store.
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        state = .loading
        do {
            let rows = try await client.getInbox()
            attachments = rows.filter(InboxRules.isUnfiled)
            state = .loaded
        } catch let error as APIError {
            state = .error(error.localizedDescription)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    /// Uploads every file the Share Extension left in the App Group queue.
    ///
    /// Each file is uploaded with `deviceId: nil` — the whole point of the inbox
    /// — and a successful upload removes it from the queue and inserts the
    /// returned row into `attachments`, so the "Thêm" badge moves immediately.
    /// Callers still call `load()` afterwards to reconcile with the server.
    ///
    /// A failed upload is **kept**: `markFailure` records the message and the
    /// next open (or the banner's "Thử lại") tries again. Nothing is deleted
    /// except after the server accepted the bytes, so a shared receipt can only
    /// ever be duplicated (crash between upload and removal), never lost.
    ///
    /// The extension already validated the file. The checks below are repeated
    /// because the App Group container is shared state and the server enforces
    /// the same rules; walking through the type/size gate again is how a
    /// corrupted or foreign payload is caught before it becomes a 4xx.
    public func importSharedFiles() async {
        guard !isImportingShared else { return }
        guard let sharedInbox else { return }

        let items = sharedInbox.pendingItems()
        guard !items.isEmpty else {
            pendingSharedCount = 0
            sharedImportError = nil
            return
        }

        isImportingShared = true
        sharedImportError = nil
        pendingSharedCount = items.count
        defer { isImportingShared = false }

        for item in items {
            do {
                let data = try sharedInbox.payload(for: item)
                guard data.count <= AttachmentFileType.maxBytes else {
                    throw SharedInboxError.tooLarge
                }
                guard let detected = AttachmentFileType.detect(data),
                      SharedInbox.acceptedMIMEs.contains(detected.mimeType) else {
                    throw SharedInboxError.unsupportedType
                }

                let meta = try await client.uploadAttachment(
                    deviceId: nil,
                    fileName: item.fileName,
                    fileType: detected.mimeType,
                    data: data,
                    description: nil
                )

                // Only after the server answered 2xx. A crash between the upload
                // and this line re-uploads on the next drain (at-least-once).
                sharedInbox.remove(item)
                if !attachments.contains(where: { $0.id == meta.id }) {
                    attachments.insert(meta, at: 0)
                }
            } catch {
                let message = Self.sharedImportMessage(for: error)
                sharedInbox.markFailure(item, message: message)
                sharedImportError = message

                // A transport error means the network is down, not that this
                // particular file is bad: stop instead of waiting out one
                // timeout per queued file. The next open retries everything.
                if let apiError = error as? APIError, case .transport = apiError {
                    break
                }
            }
        }

        pendingSharedCount = sharedInbox.pendingCount()
        if pendingSharedCount == 0 { sharedImportError = nil }
    }

    private static func sharedImportMessage(for error: Error) -> String {
        if let sharedError = error as? SharedInboxError { return sharedError.message }
        if let apiError = error as? APIError { return apiError.localizedDescription }
        return error.localizedDescription
    }

    /// Files an inbox item under a device and removes it from the local list.
    ///
    /// A 409 `limit_reached` throws and the row stays put — the server did not
    /// move it, so pretending it left would make the inbox lie. Callers map the
    /// error through `InboxRules.fileFailure(_:)`.
    @discardableResult
    public func file(_ attachment: AttachmentMeta, to deviceId: String) async throws -> AttachmentMeta {
        let updated = try await client.fileAttachment(id: attachment.id, deviceId: deviceId)
        attachments.removeAll { $0.id == attachment.id }
        return updated
    }

    public func delete(_ attachment: AttachmentMeta) async throws {
        try await client.deleteAttachment(id: attachment.id)
        attachments.removeAll { $0.id == attachment.id }
    }

    /// Removes a row that the server says no longer exists (`404` on filing).
    /// Nothing is sent: the caller already knows the server has no such row.
    public func removeLocally(_ attachment: AttachmentMeta) {
        attachments.removeAll { $0.id == attachment.id }
    }
}
