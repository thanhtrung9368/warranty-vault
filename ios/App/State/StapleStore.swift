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

    func create(_ input: StapleInput) async throws {
        _ = try await client.createStaple(input)
        await load()
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
