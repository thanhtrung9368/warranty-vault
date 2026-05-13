import Foundation
import SwiftUI
import WarrantyVaultKit

@MainActor
public final class CatalogStore: ObservableObject {
    @Published public private(set) var categories: [CategoryOption] = []
    @Published public private(set) var brands: [BrandOption] = []
    @Published public private(set) var stores: [StoreOption] = []
    @Published public private(set) var warrantyProviders: [WarrantyProviderOption] = []
    @Published public private(set) var isLoaded = false

    private let client: APIClient
    private var inFlight: Task<Void, Never>?

    public init(client: APIClient) { self.client = client }

    /// Load once. Subsequent calls are a no-op while a load is in flight.
    public func loadIfNeeded() async {
        if isLoaded { return }
        if let inFlight {
            await inFlight.value
            return
        }
        let task = Task { await loadForce() }
        inFlight = task
        await task.value
        inFlight = nil
    }

    public func loadForce() async {
        do {
            let cat = try await client.catalog()
            categories = cat.categories
            brands = cat.brands
            stores = cat.stores
            warrantyProviders = cat.warrantyProviders
            isLoaded = true
        } catch {
            // Silent fail — catalog is best-effort. UI keeps existing values
            // (or empty arrays) so the form doesn't block.
        }
    }

    // MARK: - Filters used by autocomplete components

    public func brands(matching query: String, category: String? = nil) -> [BrandOption] {
        let pool: [BrandOption]
        if let category, !category.isEmpty {
            pool = brands.filter { $0.categoryCodes.contains(category) }
        } else {
            pool = brands
        }
        return filtered(pool, query: query) { $0.name }
    }

    public func stores(matching query: String) -> [StoreOption] {
        filtered(stores, query: query) { $0.name }
    }

    public func warrantyProviders(matching query: String) -> [WarrantyProviderOption] {
        filtered(warrantyProviders, query: query) { $0.name }
    }

    private func filtered<T>(_ items: [T], query: String, name: (T) -> String) -> [T] {
        let trimmed = query.trimmingCharacters(in: .whitespaces).lowercased()
        if trimmed.isEmpty { return items }
        return items.filter { name($0).lowercased().contains(trimmed) }
    }
}
