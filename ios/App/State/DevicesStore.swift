import Foundation
import SwiftUI
import WarrantyVaultKit

@MainActor
public final class DevicesStore: ObservableObject {
    public enum LoadState: Equatable {
        case idle, loading, loaded, error(String)
    }

    @Published public private(set) var devices: [Device] = []
    @Published public private(set) var state: LoadState = .idle

    private let client: APIClient
    public init(client: APIClient) { self.client = client }

    public func load() async {
        state = .loading
        do {
            let rows = try await client.listDevices()
            devices = rows
            state = .loaded
        } catch let err as APIError {
            state = .error(err.localizedDescription)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    public func create(_ input: DeviceInput) async throws -> Device {
        let device = try await client.createDevice(input)
        devices.insert(device, at: 0)
        await refreshProjection()
        return device
    }

    public func update(id: String, _ input: DeviceInput) async throws -> Device {
        let updated = try await client.updateDevice(id: id, input)
        if let idx = devices.firstIndex(where: { $0.id == id }) {
            devices[idx] = updated
        }
        await refreshProjection()
        return updated
    }

    public func delete(_ id: String) async throws {
        try await client.deleteDevice(id: id)
        devices.removeAll { $0.id == id }
    }

    /// Re-reads the list without touching `state`.
    ///
    /// `POST`/`PATCH /api/v1/devices` return the bare `Device`, but the list
    /// endpoint returns a richer row (`effectiveWarrantyEnd` + `attachmentCount`
    /// — see `services.DeviceListItem`). Without this the warranty pill on the
    /// list row would stay blank until the next full reload.
    private func refreshProjection() async {
        if let rows = try? await client.listDevices() {
            devices = rows
        }
    }
}
