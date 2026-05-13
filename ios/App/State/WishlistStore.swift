import Foundation
import SwiftUI
import WarrantyVaultKit

@MainActor
public final class WishlistStore: ObservableObject {
    public enum LoadState: Equatable {
        case idle, loading, loaded, error(String)
    }

    @Published public private(set) var items: [WishlistItem] = []
    @Published public private(set) var state: LoadState = .idle

    private let client: APIClient
    public init(client: APIClient) { self.client = client }

    public func load() async {
        state = .loading
        do {
            let rows = try await client.listWishlist()
            items = rows
            state = .loaded
        } catch let err as APIError {
            state = .error(err.localizedDescription)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    public func create(_ input: WishlistInput) async throws -> WishlistItem {
        let item = try await client.createWishlistItem(input)
        items.insert(item, at: 0)
        return item
    }

    public func update(id: String, _ input: WishlistInput) async throws {
        try await client.updateWishlistItem(id: id, input)
        // PATCH returns empty — reload to pick up server-derived fields.
        await load()
    }

    public func delete(id: String) async throws {
        try await client.deleteWishlistItem(id: id)
        items.removeAll { $0.id == id }
    }

    public func logPrice(id: String, _ input: PriceLogInput) async throws {
        try await client.logWishlistPrice(id: id, input)
        await load()
    }
}
