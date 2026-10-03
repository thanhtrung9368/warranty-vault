import Foundation
import SwiftUI
import WarrantyVaultKit

/// The "Việc cần xử lý" queue (`GET /api/v1/actions`), shared by the dashboard
/// badge and the full screen.
///
/// The store keeps one payload and one flag. `snoozed: true` is an **opt-in that
/// only adds rows**, so the same read serves both the queue and the "Đang hoãn"
/// list, and `counts` keeps counting the actionable subset either way — which is
/// why the badge reads it rather than `items.count`.
@MainActor
public final class ActionQueueStore: ObservableObject {
    public enum LoadState: Equatable {
        case idle, loading, loaded, error(String)
    }

    @Published public private(set) var queue: ActionQueue?
    @Published public private(set) var state: LoadState = .idle

    /// True once a `?snoozed=true` read has succeeded, so the "Đang hoãn" view can
    /// show a spinner instead of an empty list on the first tap.
    @Published public private(set) var loadedSnoozed = false

    private let client: APIClient
    /// Sticky: a reload after a snooze keeps the rows the current view needs.
    private var includeSnoozed = false

    public init(client: APIClient) { self.client = client }

    /// The badge number — `counts.total`, never the row count. `nil` while no read
    /// has succeeded, so a failed load shows no number instead of a confident "0".
    public var badgeCount: Int? {
        queue.map { ActionQueueRules.badgeCount($0.counts) }
    }

    public func load(snoozed: Bool? = nil) async {
        if let snoozed { includeSnoozed = snoozed }
        state = .loading
        do {
            let result = try await client.listActionItems(snoozed: includeSnoozed)
            queue = result
            if includeSnoozed { loadedSnoozed = true }
            state = .loaded
        } catch let err as APIError {
            state = .error(err.localizedDescription)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    /// Snoozes one item and reloads so the row moves to where it now belongs.
    /// The returned `SnoozeResult` carries the duration the **server** applied.
    @discardableResult
    public func snooze(_ itemKey: String, days: Int) async throws -> SnoozeResult {
        let result = try await client.snoozeActionItem(itemKey, days: days)
        await load()
        return result
    }

    /// Bounces a 404 when another device already un-snoozed the item; the caller
    /// surfaces the server's own Vietnamese message rather than pretending it
    /// worked.
    public func unsnooze(_ itemKey: String) async throws {
        try await client.unsnoozeActionItem(itemKey)
        await load()
    }
}
