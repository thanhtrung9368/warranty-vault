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

    /// Writes the device row's `status` when a claim write changes the device's
    /// open/closed state — the write half of
    /// `ClaimRules.deviceStatus(claimWasOpen:claimIsOpen:current:)`.
    ///
    /// Injected by the device detail, which is the only screen that owns both
    /// the `DevicesStore` and the device projection that a full-replacement
    /// `PATCH /api/v1/devices/{id}` has to be built from; this store owns the
    /// claim half only. `nil` means no device screen is driving this store — the
    /// claim still saves, the status is simply left alone, which is the honest
    /// answer for "there is no device row in front of me".
    public var writeDeviceStatus: ((DeviceStatus) async throws -> Void)?

    /// Set when a claim write landed but the device status that follows from it
    /// did not. The two records are then out of step, and the device detail says
    /// so with a retry: silently swallowing this is the defect the sync exists
    /// to remove, so the failure is a published fact rather than a log line.
    @Published public private(set) var statusSyncFailure: String?

    private let client: APIClient
    public let deviceId: String

    public init(client: APIClient, deviceId: String) {
        self.client = client
        self.deviceId = deviceId
    }

    /// The claim that blocks a second open repair, if there is one. `ClaimRules`
    /// owns the open-vs-closed decision.
    public var openClaim: Claim? { ClaimRules.openClaim(in: claims) }

    /// The device's `STANDARD` warranty row, which the legacy inline-warranty
    /// fields on `DeviceInput` stand for.
    ///
    /// Needed by the status write this store triggers: `PATCH /devices/{id}`
    /// deletes the standard warranty when `warrantyMonths` is not positive
    /// (`services/devices.go`), so the caller must carry the stored row back or
    /// the claim's status change removes the warranty. `nil` (no standard row)
    /// is the safe answer — `hasExisting` is false server-side and nothing is
    /// touched.
    public var standardWarranty: Warranty? {
        warranties.first { $0.type == .STANDARD }
    }

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
        DeadlineSurface.refreshSoon(client: client)
        return w
    }

    public func update(id: String, _ input: WarrantyInput) async throws {
        _ = try await client.updateWarranty(id: id, input)
        await load()
        DeadlineSurface.refreshSoon(client: client)
    }

    public func delete(id: String) async throws {
        try await client.deleteWarranty(id: id)
        // Drop the row immediately (a failed re-read below must not bring it
        // back), then re-read. The hero prefers the detail read's
        // `effectiveWarrantyEnd`, which is server-computed, so it must be
        // refreshed or it would keep pointing at the warranty that just left.
        warranties.removeAll { $0.id == id }
        await load()
        DeadlineSurface.refreshSoon(client: client)
    }

    // MARK: - Claims

    /// Creates a repair claim, re-reads the device, and then moves the device's
    /// status to whatever the new claim implies.
    ///
    /// The 409 `limit_reached` is thrown untouched — the form maps it with
    /// `ClaimRules.saveFailure` — and nothing after it runs, so a rejected
    /// create can never move a status.
    @discardableResult
    public func createClaim(_ input: ClaimInput) async throws -> Claim? {
        let claim = try await client.createClaim(input)
        await load()
        await writeImpliedDeviceStatus(claimWasOpen: false,
                                       claimIsOpen: ClaimRules.isOpen(input.status))
        return claim
    }

    /// Updates a claim, re-reads the device, and moves the device's status when
    /// the edit opened or closed the repair.
    ///
    /// `updateDeviceStatus: false` is for the one caller that already performs
    /// the write itself, in the same user action: the device screen's status
    /// control, which closes an open claim **and** sets the status it was
    /// tapped for. Two writers there would mean two PATCHes and a round trip
    /// where the device briefly holds a status nobody asked for.
    @discardableResult
    public func updateClaim(id: String,
                            _ input: ClaimInput,
                            updateDeviceStatus: Bool = true) async throws -> Claim? {
        // Read the previous lifecycle before the write: after `load()` the old
        // status is gone, and "was this open?" is exactly what decides whether
        // the device has to move.
        let previous = claims.first { $0.id == id }?.status
        let claim = try await client.updateClaim(id: id, input)
        await load()
        if updateDeviceStatus {
            await writeImpliedDeviceStatus(claimWasOpen: previous.map(ClaimRules.isOpen) ?? false,
                                           claimIsOpen: ClaimRules.isOpen(input.status))
        }
        return claim
    }

    public func deleteClaim(id: String) async throws {
        let previous = claims.first { $0.id == id }?.status
        try await client.deleteClaim(id: id)
        // A full reload keeps the detail's `claims` and this array in sync; the
        // local removal is only the optimistic half.
        claims.removeAll { $0.id == id }
        await load()
        // Deleting the open repair is the other way a repair ends: the device
        // must not stay marked broken with nothing to point at.
        await writeImpliedDeviceStatus(claimWasOpen: previous.map(ClaimRules.isOpen) ?? false,
                                       claimIsOpen: false)
    }

    /// Reconcile the two records by hand, after `statusSyncFailure`.
    ///
    /// Deliberately recomputed from the freshly loaded state rather than from a
    /// remembered intent: by the time a user taps "Thử lại" the truth is "does
    /// this device have an open repair?" and nothing else.
    public func retryDeviceStatusSync() async {
        guard let current = device?.status else { return }
        let open = ClaimRules.hasOpenClaim(in: claims)
        guard let next = ClaimRules.deviceStatus(claimWasOpen: !open,
                                                 claimIsOpen: open,
                                                 current: current) else {
            // Already in step — the earlier failure has nothing left to fix.
            statusSyncFailure = nil
            return
        }
        await writeStatus(next)
    }

    /// Runs the projection and, when it names a status, writes it.
    ///
    /// Called only after `load()`, so `device?.status` is the server's answer
    /// rather than this store's guess — a status PATCH is a full-row
    /// replacement and a stale base would clobber fields the server just wrote.
    private func writeImpliedDeviceStatus(claimWasOpen: Bool, claimIsOpen: Bool) async {
        guard let current = device?.status,
              let next = ClaimRules.deviceStatus(claimWasOpen: claimWasOpen,
                                                 claimIsOpen: claimIsOpen,
                                                 current: current) else { return }
        await writeStatus(next)
    }

    private func writeStatus(_ status: DeviceStatus) async {
        guard let writeDeviceStatus else { return }
        do {
            try await writeDeviceStatus(status)
            statusSyncFailure = nil
        } catch {
            statusSyncFailure = (error as? APIError)?.localizedDescription
                ?? error.localizedDescription
        }
    }

    public func dismissReminder(warrantyId id: String) async throws {
        try await client.dismissReminder(warrantyId: id)
        await load()
        DeadlineSurface.refreshSoon(client: client)
    }

    public func restoreReminder(warrantyId id: String) async throws {
        try await client.restoreReminder(warrantyId: id)
        await load()
        DeadlineSurface.refreshSoon(client: client)
    }
}
