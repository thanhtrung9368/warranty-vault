import Foundation
import WarrlyKit

/// State for the essentials/restock screen. Kept separate from
/// `WishlistStore`: the two lists have different write semantics (a wishlist
/// PURCHASED creates a Device; a staple restock must not).
@MainActor
final class StapleStore: ObservableObject {
    enum LoadState: Equatable {
        case idle, loading, loaded, error(String)
    }

    @Published private(set) var items: [Staple] = []
    @Published private(set) var state: LoadState = .idle

    private let client: APIClient

    /// The id of a staple this store already created whose first purchase did
    /// not save. The form stays open after that failure; keeping the id here is
    /// what makes the retry send only the missing purchase instead of creating a
    /// duplicate staple.
    private var pendingFirstPurchaseItemId: String?
    /// The draft name that owns the pending id. A later create for a different
    /// name must not attach its purchase to the abandoned row.
    private var pendingFirstPurchaseName: String?

    init(client: APIClient) { self.client = client }

    func load() async {
        state = .loading
        do {
            items = try await client.listStaples()
            state = .loaded
            StapleNotifications.sync(items)
        } catch let err as APIError {
            state = .error(err.localizedDescription)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    func create(
        _ input: StapleInput,
        firstPurchase: StaplePurchaseInput? = nil
    ) async throws {
        // A previous attempt may already have inserted the staple and only lost
        // the purchase. Reusing that id is the difference between a retry that
        // completes the write and a retry that adds a second identical staple.
        let itemId: String
        if let pending = pendingFirstPurchaseItemId,
           pendingFirstPurchaseName == input.name {
            itemId = pending
        } else {
            pendingFirstPurchaseItemId = nil
            pendingFirstPurchaseName = nil
            itemId = try await client.createStaple(input).id
        }

        guard let firstPurchase else {
            // There is no purchase left to write (the user cleared the price
            // before retrying): the staple itself is already saved.
            pendingFirstPurchaseItemId = nil
            pendingFirstPurchaseName = nil
            await load()
            return
        }

        do {
            _ = try await client.createStaplePurchase(id: itemId, firstPurchase)
            pendingFirstPurchaseItemId = nil
            pendingFirstPurchaseName = nil
            await load()
        } catch {
            // Two writes, two outcomes: the staple exists, the purchase does
            // not. Keep the id for the retry and say exactly that instead of
            // claiming nothing was saved.
            pendingFirstPurchaseItemId = itemId
            pendingFirstPurchaseName = input.name
            await load()
            throw StapleCreatePartialError(itemName: input.name)
        }
    }

    func update(id: String, _ input: StapleInput) async throws {
        _ = try await client.updateStaple(id: id, input)
        await load()
    }

    func delete(id: String) async throws {
        try await client.deleteStaple(id: id)
        await load()
    }

    /// Quick action: mark a staple as running low/out without opening the form.
    func mark(_ item: Staple, state: StapleState) async throws {
        var input = input(for: item)
        input.state = state
        try await update(id: item.id, input)
    }

    /// Records a purchase. The server inserts the row, moves `lastBoughtAt`
    /// forward (only when the purchase day is later) and sets `state = ENOUGH`
    /// in one transaction; reloading afterwards shows the new price summary.
    func addPurchase(id: String, _ input: StaplePurchaseInput) async throws {
        _ = try await client.createStaplePurchase(id: id, input)
        await load()
    }

    /// Purchase history for one essential, newest first.
    func purchases(id: String) async throws -> [StaplePurchase] {
        try await client.listStaplePurchases(id: id)
    }

    /// Reuse everything the user already saved when a quick action changes only
    /// `state`. The API PATCH is a full replacement, so dropping a field here
    /// would silently clear it — including the `lastBoughtAt` a purchase set.
    func input(for item: Staple) -> StapleInput {
        var input = StapleInput(name: item.name)
        input.category = item.category
        input.unit = item.unit
        input.cadenceDays = item.cadenceDays
        input.lastBoughtAt = item.lastBoughtAt.map(Self.apiDay)
        input.state = item.state
        input.notes = item.notes
        return input
    }

    static func apiDay(_ date: Date) -> String {
        apiDayFormatter.string(from: date)
    }

    private static let apiDayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}

/// The first purchase failed after the staple itself was inserted.
///
/// A plain `throw` from `StapleStore.create` used to reach the form as the
/// server's purchase error, and the generic "Không lưu được." made it look as
/// if the staple had not been saved either. This error carries the split
/// outcome; the form leaves the user on the same screen, and a retry with the
/// same name completes only the missing purchase.
struct StapleCreatePartialError: LocalizedError {
    let itemName: String

    var errorDescription: String? {
        L.t("Đã lưu \"%@\" nhưng chưa lưu được lần mua đầu tiên. Thử lại để chỉ lưu lần mua này.",
            itemName)
    }
}
