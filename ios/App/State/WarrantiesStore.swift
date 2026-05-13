import Foundation
import SwiftUI
import WarrantyVaultKit

@MainActor
public final class WarrantiesStore: ObservableObject {
    public enum LoadState: Equatable {
        case idle, loading, loaded, error(String)
    }

    @Published public private(set) var device: DeviceDetailBody?
    @Published public private(set) var warranties: [Warranty] = []
    @Published public private(set) var state: LoadState = .idle

    private let client: APIClient
    public let deviceId: String

    public init(client: APIClient, deviceId: String) {
        self.client = client
        self.deviceId = deviceId
    }

    public func load() async {
        state = .loading
        do {
            let body = try await client.getDevice(id: deviceId)
            device = body
            warranties = body.warranties ?? []
            state = .loaded
        } catch let err as APIError {
            state = .error(err.localizedDescription)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    public func create(_ input: WarrantyInput) async throws -> Warranty {
        let w = try await client.createWarranty(deviceId: deviceId, input)
        // Reload so we get the merged reminders[] state.
        await load()
        return w
    }

    public func update(id: String, _ input: WarrantyInput) async throws {
        _ = try await client.updateWarranty(id: id, input)
        await load()
    }

    public func delete(id: String) async throws {
        try await client.deleteWarranty(id: id)
        warranties.removeAll { $0.id == id }
    }

    public func dismissReminder(warrantyId id: String) async throws {
        try await client.dismissReminder(warrantyId: id)
        await load()
    }

    public func restoreReminder(warrantyId id: String) async throws {
        try await client.restoreReminder(warrantyId: id)
        await load()
    }
}
