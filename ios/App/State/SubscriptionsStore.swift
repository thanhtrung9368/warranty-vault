import Foundation
import SwiftUI
import WarrantyVaultKit

@MainActor
public final class SubscriptionsStore: ObservableObject {
    public enum LoadState: Equatable {
        case idle, loading, loaded, error(String)
    }

    @Published public private(set) var subscriptions: [Subscription] = []
    @Published public private(set) var state: LoadState = .idle

    private let client: APIClient
    public init(client: APIClient) { self.client = client }

    public func load() async {
        state = .loading
        do {
            let rows = try await client.listSubscriptions()
            subscriptions = rows
            state = .loaded
        } catch let err as APIError {
            state = .error(err.localizedDescription)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    public func create(_ input: SubscriptionInput) async throws -> Subscription {
        let sub = try await client.createSubscription(input)
        subscriptions.insert(sub, at: 0)
        return sub
    }

    public func update(id: String, _ input: SubscriptionInput) async throws {
        let updated = try await client.updateSubscription(id: id, input)
        if let idx = subscriptions.firstIndex(where: { $0.id == id }) {
            subscriptions[idx] = updated
        }
    }

    public func delete(id: String) async throws {
        try await client.deleteSubscription(id: id)
        subscriptions.removeAll { $0.id == id }
    }

    /// Force-bills the current cycle and advances renewalDate to the next one.
    public func renewNow(id: String) async throws {
        try await client.renewSubscription(id: id)
        // Reload the row so renewalDate / status reflect server state.
        await load()
    }

    public func setStatus(id: String, status: SubscriptionStatus) async throws {
        guard let current = subscriptions.first(where: { $0.id == id }) else { return }
        // A status tap is still a FULL replacement, so both dates are re-sent.
        // They came from the shared decoder, which read the Z-less wire value in
        // the device's own zone, so they are written back in that same zone —
        // `WireDay` is the exact inverse. A zone-pinned format would move the
        // date by a day here, which is a status change the user never asked for.
        var input = SubscriptionInput(
            name: current.name,
            billingCycle: current.billingCycle,
            price: current.price,
            startedAt: WireDay.string(from: current.startedAt)
        )
        input.category = current.category
        input.brand = current.brand
        input.plan = current.plan
        input.intervalDays = current.intervalDays
        input.renewalDate = WireDay.string(from: current.renewalDate)
        input.autoRenew = current.autoRenew
        input.status = status
        input.accountEmail = current.accountEmail
        input.paymentMethod = current.paymentMethod
        input.manageUrl = current.manageUrl
        input.cancelUrl = current.cancelUrl
        input.notes = current.notes
        try await update(id: id, input)
    }
}
