import Foundation
import SwiftUI
import WarrlyKit

@MainActor
public final class WarrantiesStore: ObservableObject {
    public enum LoadState: Equatable {
        case idle, loading, loaded, error(String)
    }

    @Published public private(set) var device: DeviceDetailBody?
    @Published public private(set) var warranties: [Warranty] = []
    /// This device's repair claims ("Sửa chữa & bảo hành").
    ///
    /// The detail read carries `claims` (the contract put them there so the
    /// device screen is the anchor), and the dedicated `GET /api/v1/claims`
    /// read is the fallback for a server that answers detail without them. The
    /// screen never calls the list endpoint directly: every mutation goes
    /// through this store and reloads, so the section, the BROKEN nudge and the
    /// 409 lookup all read one array.
    @Published public private(set) var claims: [Claim] = []
    @Published public private(set) var state: LoadState = .idle

    private let client: APIClient
    public let deviceId: String

    public init(client: APIClient, deviceId: String) {
        self.client = client
        self.deviceId = deviceId
    }

    /// The claim that blocks a second open repair, if there is one. `ClaimRules`
    /// owns the open-vs-closed decision.
    public var openClaim: Claim? { ClaimRules.openClaim(in: claims) }

    public func load() async {
        state = .loading
        do {
            let body = try await client.getDevice(id: deviceId)
            device = body
            warranties = body.warranties ?? []
            if let detailClaims = body.claims {
                claims = detailClaims
            } else {
                // A server that has not shipped `claims` on the detail read (or
                // that omitted the key) still has the dedicated endpoint. This
                // fallback is what keeps the section from looking empty when the
                // claims really exist — `nil` means "not returned", never "none".
                claims = (try? await client.listClaims(
                    filter: .init(deviceId: deviceId)
                )) ?? []
            }
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

    // MARK: - Claims

    /// Creates a repair claim and re-reads the device so the section (and the
    /// BROKEN nudge) reflect it. The 409 `limit_reached` is thrown untouched —
    /// the form maps it with `ClaimRules.saveFailure`.
    @discardableResult
    public func createClaim(_ input: ClaimInput) async throws -> Claim? {
        let claim = try await client.createClaim(input)
        await load()
        return claim
    }

    @discardableResult
    public func updateClaim(id: String, _ input: ClaimInput) async throws -> Claim? {
        let claim = try await client.updateClaim(id: id, input)
        await load()
        return claim
    }

    public func deleteClaim(id: String) async throws {
        try await client.deleteClaim(id: id)
        // A full reload keeps the detail's `claims` and this array in sync; the
        // local removal is only the optimistic half.
        claims.removeAll { $0.id == id }
        await load()
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
