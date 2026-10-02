import Foundation

// Each method here mirrors one route in openapi.yaml. Group by tag for
// readability; the underlying APIClient handles auth + JSON.

extension APIClient {

    // MARK: - Auth

    public func register(_ input: RegisterInput) async throws -> AuthSuccess {
        try await request("POST", "/api/v1/auth/register", body: input, authenticated: false)
    }

    public func login(_ input: LoginInput) async throws -> AuthSuccess {
        try await request("POST", "/api/v1/auth/login", body: input, authenticated: false)
    }

    public func logout() async throws {
        let _: EmptyResponse = try await request("POST", "/api/v1/auth/logout")
    }

    public func me() async throws -> User {
        struct Wrapper: Decodable { let user: User }
        let w: Wrapper = try await request("GET", "/api/v1/auth/me")
        return w.user
    }

    public func forgotPassword(email: String) async throws {
        struct Body: Encodable { let email: String }
        let _: EmptyResponse = try await request(
            "POST", "/api/v1/auth/forgot", body: Body(email: email), authenticated: false
        )
    }

    public func changePassword(_ input: ChangePasswordInput) async throws -> ChangePasswordResult {
        try await request("POST", "/api/v1/auth/change-password", body: input)
    }

    /// Permanently deletes the signed-in account. The server requires the
    /// current password so a stolen bearer token can't nuke the account.
    public func deleteAccount(password: String) async throws {
        struct Body: Encodable { let password: String }
        let _: EmptyResponse = try await request(
            "DELETE", "/api/v1/auth/me", body: Body(password: password)
        )
    }

    // MARK: - Backup

    /// Downloads the full account backup as raw JSON bytes (v5 payload).
    public func exportBackup() async throws -> Data {
        try await rawDataRequest("GET", "/api/v1/backup/export")
    }

    /// Imports a previously-exported backup file. `mode` is "merge" or "replace".
    public func importBackup(_ json: Data, mode: String) async throws -> ImportResult {
        let data = try await rawDataRequest(
            "POST", "/api/v1/backup/import",
            query: [.init(name: "mode", value: mode)],
            rawBody: json
        )
        struct Wrapper: Decodable { let result: ImportResult }
        return try Self.decoder.decode(Wrapper.self, from: data).result
    }

    // MARK: - Catalog

    public func catalog() async throws -> Catalog {
        try await request("GET", "/api/v1/catalog")
    }

    // MARK: - Devices

    public struct DeviceListFilter: Sendable {
        public var q: String?
        public var category: String?
        public var status: DeviceStatus?
        public var sort: String?  // "purchaseDate" | "warrantyEndDate" | "price" | "name"
        public var dir: String?   // "asc" | "desc"

        public init(q: String? = nil, category: String? = nil,
                    status: DeviceStatus? = nil, sort: String? = nil, dir: String? = nil) {
            self.q = q; self.category = category; self.status = status
            self.sort = sort; self.dir = dir
        }

        var queryItems: [URLQueryItem] {
            var items: [URLQueryItem] = []
            if let q { items.append(.init(name: "q", value: q)) }
            if let category { items.append(.init(name: "category", value: category)) }
            if let status { items.append(.init(name: "status", value: status.rawValue)) }
            if let sort { items.append(.init(name: "sort", value: sort)) }
            if let dir { items.append(.init(name: "dir", value: dir)) }
            return items
        }
    }

    public func listDevices(filter: DeviceListFilter = .init()) async throws -> [Device] {
        struct Wrapper: Decodable { let devices: [Device] }
        let w: Wrapper = try await request(
            "GET", "/api/v1/devices", query: filter.queryItems
        )
        return w.devices
    }

    public func getDevice(id: String) async throws -> DeviceDetailBody {
        let w: DeviceDetail = try await request("GET", "/api/v1/devices/\(id)")
        return w.device
    }

    public func createDevice(_ input: DeviceInput) async throws -> Device {
        struct Wrapper: Decodable { let device: Device }
        let w: Wrapper = try await request("POST", "/api/v1/devices", body: input)
        return w.device
    }

    public func updateDevice(id: String, _ input: DeviceInput) async throws -> Device {
        struct Wrapper: Decodable { let device: Device }
        let w: Wrapper = try await request("PATCH", "/api/v1/devices/\(id)", body: input)
        return w.device
    }

    public func deleteDevice(id: String) async throws {
        let _: EmptyResponse = try await request("DELETE", "/api/v1/devices/\(id)")
    }

    // MARK: - Warranties

    public func createWarranty(deviceId: String, _ input: WarrantyInput) async throws -> Warranty {
        struct Wrapper: Decodable { let warranty: Warranty }
        let w: Wrapper = try await request(
            "POST", "/api/v1/devices/\(deviceId)/warranties", body: input
        )
        return w.warranty
    }

    public func updateWarranty(id: String, _ input: WarrantyInput) async throws -> Warranty {
        struct Wrapper: Decodable { let warranty: Warranty }
        let w: Wrapper = try await request("PATCH", "/api/v1/warranties/\(id)", body: input)
        return w.warranty
    }

    public func deleteWarranty(id: String) async throws {
        let _: EmptyResponse = try await request("DELETE", "/api/v1/warranties/\(id)")
    }

    public func dismissReminder(warrantyId: String) async throws {
        let _: EmptyResponse = try await request(
            "POST", "/api/v1/warranties/\(warrantyId)/reminder"
        )
    }

    public func restoreReminder(warrantyId: String) async throws {
        let _: EmptyResponse = try await request(
            "DELETE", "/api/v1/warranties/\(warrantyId)/reminder"
        )
    }

    // MARK: - Attachments

    public func listAttachments(deviceId: String) async throws -> [AttachmentMeta] {
        struct Wrapper: Decodable { let attachments: [AttachmentMeta] }
        let w: Wrapper = try await request("GET", "/api/v1/devices/\(deviceId)/attachments")
        return w.attachments
    }

    public func uploadAttachment(
        deviceId: String, fileName: String, fileType: String, data: Data,
        description: String? = nil
    ) async throws -> AttachmentMeta {
        struct Wrapper: Decodable { let attachment: AttachmentMeta }
        let w: Wrapper = try await uploadMultipart(
            "/api/v1/devices/\(deviceId)/attachments",
            fileName: fileName, fileType: fileType, fileData: data,
            description: description
        )
        return w.attachment
    }

    public func deleteAttachment(id: String) async throws {
        let _: EmptyResponse = try await request("DELETE", "/api/v1/attachments/\(id)")
    }

    // MARK: - AI receipt OCR

    /// Sends a receipt / warranty-card image to the Go OCR endpoint and returns
    /// the extracted draft. The server decrypts/validates, calls the model,
    /// fuzzy-maps the catalog, and never persists — the caller pre-fills the
    /// device form and the user confirms before saving.
    public func extractReceipt(fileName: String, fileType: String, data: Data) async throws -> DraftDevice {
        struct Wrapper: Decodable { let draft: DraftDevice }
        let w: Wrapper = try await uploadMultipart(
            "/api/v1/ai/extract-receipt",
            fileName: fileName, fileType: fileType, fileData: data
        )
        return w.draft
    }

    /// Current AI opt-in state for the signed-in user.
    public func getAIOptIn() async throws -> Bool {
        struct Wrapper: Decodable { let aiOptIn: Bool }
        let w: Wrapper = try await request("GET", "/api/v1/ai/opt-in")
        return w.aiOptIn
    }

    /// Enable/disable the AI receipt-scan opt-in. Returns the new state.
    @discardableResult
    public func setAIOptIn(_ enabled: Bool) async throws -> Bool {
        struct Body: Encodable { let enabled: Bool }
        struct Wrapper: Decodable { let aiOptIn: Bool }
        let w: Wrapper = try await request("PUT", "/api/v1/ai/opt-in", body: Body(enabled: enabled))
        return w.aiOptIn
    }

    /// URL of the byte stream for an attachment. `nonisolated` because it only
    /// reads the immutable `baseURL` — callers (SwiftUI views) build these
    /// synchronously while rendering.
    nonisolated public func attachmentDownloadURL(id: String, download: Bool = false) -> URL {
        var components = URLComponents(
            url: baseURL.appendingPathComponent("/api/files/\(id)"),
            resolvingAgainstBaseURL: false
        )!
        if download { components.queryItems = [.init(name: "download", value: "1")] }
        return components.url!
    }

    // MARK: - Subscriptions

    public func listSubscriptions() async throws -> [Subscription] {
        struct Wrapper: Decodable { let subscriptions: [Subscription] }
        let w: Wrapper = try await request("GET", "/api/v1/subscriptions")
        return w.subscriptions
    }

    public func getSubscription(id: String) async throws -> (Subscription, [Payment]) {
        // Server returns { subscription: { ...Subscription, payments: [...] } }.
        // Decode twice with two views over the same nested object.
        struct Outer: Decodable {
            struct Body: Decodable {
                let payments: [Payment]?
            }
            let subscription: Subscription
            let body: Body
            init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                self.subscription = try c.decode(Subscription.self, forKey: .subscription)
                self.body = try c.decode(Body.self, forKey: .subscription)
            }
            enum CodingKeys: String, CodingKey { case subscription }
        }
        let outer: Outer = try await request("GET", "/api/v1/subscriptions/\(id)")
        return (outer.subscription, outer.body.payments ?? [])
    }

    public func createSubscription(_ input: SubscriptionInput) async throws -> Subscription {
        struct Wrapper: Decodable { let subscription: Subscription }
        let w: Wrapper = try await request("POST", "/api/v1/subscriptions", body: input)
        return w.subscription
    }

    public func updateSubscription(id: String, _ input: SubscriptionInput) async throws -> Subscription {
        struct Wrapper: Decodable { let subscription: Subscription }
        let w: Wrapper = try await request("PATCH", "/api/v1/subscriptions/\(id)", body: input)
        return w.subscription
    }

    public func deleteSubscription(id: String) async throws {
        let _: EmptyResponse = try await request("DELETE", "/api/v1/subscriptions/\(id)")
    }

    public func logSubscriptionPayment(id: String, _ input: PaymentInput) async throws -> Payment {
        struct Wrapper: Decodable { let payment: Payment }
        let w: Wrapper = try await request(
            "POST", "/api/v1/subscriptions/\(id)/payments", body: input
        )
        return w.payment
    }

    public func renewSubscription(id: String) async throws {
        let _: EmptyResponse = try await request("POST", "/api/v1/subscriptions/\(id)/renew")
    }

    // MARK: - Wishlist

    public func listWishlist() async throws -> [WishlistItem] {
        struct Wrapper: Decodable { let items: [WishlistItem] }
        let w: Wrapper = try await request("GET", "/api/v1/wishlist")
        return w.items
    }

    public func getWishlistItem(id: String) async throws -> (WishlistItem, [WishlistPrice]) {
        struct Wrapper: Decodable {
            let item: WishlistItem
            let prices: [WishlistPrice]?
        }
        let w: Wrapper = try await request("GET", "/api/v1/wishlist/\(id)")
        return (w.item, w.prices ?? [])
    }

    public func createWishlistItem(_ input: WishlistInput) async throws -> WishlistItem {
        struct Wrapper: Decodable { let item: WishlistItem }
        let w: Wrapper = try await request("POST", "/api/v1/wishlist", body: input)
        return w.item
    }

    public func updateWishlistItem(id: String, _ input: WishlistInput) async throws {
        let _: EmptyResponse = try await request("PATCH", "/api/v1/wishlist/\(id)", body: input)
    }

    public func deleteWishlistItem(id: String) async throws {
        let _: EmptyResponse = try await request("DELETE", "/api/v1/wishlist/\(id)")
    }

    public func logWishlistPrice(id: String, _ input: PriceLogInput) async throws {
        let _: EmptyResponse = try await request(
            "POST", "/api/v1/wishlist/\(id)/prices", body: input
        )
    }

    // MARK: - Stats

    public func getStats() async throws -> UserStats {
        let stats: UserStats = try await request("GET", "/api/v1/stats")
        return stats
    }

    // MARK: - Reminders

    public func listUpcomingReminders(withinDays: Int = 30) async throws -> [UpcomingReminder] {
        struct Wrapper: Decodable { let reminders: [UpcomingReminder] }
        let w: Wrapper = try await request(
            "GET", "/api/v1/reminders",
            query: [.init(name: "withinDays", value: String(withinDays))]
        )
        return w.reminders
    }

    // MARK: - Push

    public func listPushSubscriptions() async throws -> [PushSubscriptionMeta] {
        struct Wrapper: Decodable { let subscriptions: [PushSubscriptionMeta] }
        let w: Wrapper = try await request("GET", "/api/v1/push")
        return w.subscriptions
    }

    public func registerPush(_ input: NativePushInput) async throws {
        let _: EmptyResponse = try await request(
            "POST", "/api/v1/push/register", body: input
        )
    }

    public func unregisterPush(id: String) async throws {
        let _: EmptyResponse = try await request("DELETE", "/api/v1/push/\(id)")
    }

    /// Sends a sample push to every subscription owned by the current user.
    /// Returns `(sent, failed)` so the UI can show a Vietnamese toast.
    public func sendTestPush() async throws -> (sent: Int, failed: Int) {
        struct Resp: Decodable { let sent: Int; let failed: Int }
        let r: Resp = try await request("POST", "/api/v1/push/test")
        return (r.sent, r.failed)
    }
}
