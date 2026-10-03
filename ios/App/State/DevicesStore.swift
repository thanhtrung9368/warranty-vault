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

    /// Creates the device and hands back the server's advisory `warnings`
    /// together with it. A warning never means the save failed.
    public func create(_ input: DeviceInput) async throws -> DeviceSaveResult {
        let result = try await client.createDevice(input)
        devices.insert(result.device, at: 0)
        await refreshProjection()
        return result
    }

    public func update(id: String, _ input: DeviceInput) async throws -> DeviceSaveResult {
        let result = try await client.updateDevice(id: id, input)
        if let idx = devices.firstIndex(where: { $0.id == id }) {
            devices[idx] = result.device
        }
        await refreshProjection()
        return result
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
