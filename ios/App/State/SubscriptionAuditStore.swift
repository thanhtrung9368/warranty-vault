import Foundation
import SwiftUI
import WarrantyVaultKit

/// `GET /api/v1/subscriptions/audit` — the advisory self-audit.
///
/// Read-only by construction: the store has no write method because the endpoint
/// has no write path, and the screen offers no cancel or disable-auto-renew
/// affordance. `nil` after a failed read is deliberate — the screen says "không
/// tải được" instead of showing an empty panel that would read as "nothing found".
@MainActor
public final class SubscriptionAuditStore: ObservableObject {
    public enum LoadState: Equatable {
        case idle, loading, loaded, error(String)
    }

    @Published public private(set) var audit: SubscriptionAudit?
    @Published public private(set) var state: LoadState = .idle

    private let client: APIClient
    public init(client: APIClient) { self.client = client }

    public func load() async {
        state = .loading
        do {
            audit = try await client.subscriptionAudit()
            state = .loaded
        } catch let err as APIError {
            state = .error(err.localizedDescription)
        } catch {
            state = .error(error.localizedDescription)
        }
    }
}
