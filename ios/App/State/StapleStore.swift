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

    /// Quick action: bought it again. Resets the cadence clock from today and
    /// puts it back in the "Đủ dùng" group.
    func restock(_ item: Staple) async throws {
        var input = input(for: item)
        input.state = .ENOUGH
        input.lastBoughtAt = Self.apiDay(Date())
        try await update(id: item.id, input)
    }

    /// Reuse everything the user already saved when a quick action changes only
    /// `state` (or `lastBoughtAt`). The API PATCH is a full replacement, so
    /// dropping a field here would silently clear it.
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
