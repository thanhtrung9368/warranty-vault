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

    private let client: APIClient
    /// In-flight guard, separate from the published `state`: a cancelled
    /// `URLSession` task must not leave the store permanently unable to load
    /// again. `defer` always clears it.
    private var isLoading = false

    public init(client: APIClient) { self.client = client }

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
