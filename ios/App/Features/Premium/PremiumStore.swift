import Combine
import Foundation
import StoreKit
import WarrlyKit

/// Product identifiers. These are created in App Store Connect and can never be
/// renamed; they are part of the purchase contract, not copy. The same strings
/// are the allowlist on the Go side (`services/premium.go`).
enum PremiumProductID {
    static let monthly = "com.warrly.premium.monthly"
    static let yearly = "com.warrly.premium.yearly"
    static let all = [monthly, yearly]

    static func title(for id: String) -> String {
        id == yearly ? L.t("Hàng năm") : L.t("Hàng tháng")
    }
}

/// StoreKit 2 + the backend entitlement.
///
/// The app never decides "is this user premium?" from a local flag. Every
/// transaction it can see is sent to `POST /api/v1/billing/verify`, which
/// verifies Apple's JWS and writes the server-side entitlement; the server's
/// answer is what hides the ad banner and what raises the quota on every write
/// path. `isPremium` here is a cached view of that answer for the UI, refreshed
/// on launch, on foreground, after a purchase and after Restore.
@MainActor
final class PremiumStore: ObservableObject {
    @Published private(set) var products: [Product] = []
    @Published private(set) var isPremium = false
    @Published private(set) var isLoadingProducts = false
    @Published private(set) var isPurchasing = false
    @Published private(set) var isRestoring = false
    @Published var errorMessage: String?

    private let client: APIClient
    private var updatesTask: Task<Void, Never>?

    init(client: APIClient) {
        self.client = client
        // Renewals and refunds arrive here even when the app was not the one
        // that initiated them. Handle each one through the same verifier and
        // finish it only after the server has seen it.
        updatesTask = Task { [weak self] in
            for await result in Transaction.updates {
                guard let self else { return }
                await self.handle(result)
            }
        }
    }

    /// Initial state from the authenticated `/auth/me` response; no network.
    /// `WarrlyApp` calls this on every identity change so a sign-out cannot
    /// leave a previous account's premium state on screen.
    func apply(user: User) {
        isPremium = user.premium ?? false
    }

    func reset() {
        isPremium = false
        errorMessage = nil
    }

    /// Load the two product definitions. The price is always StoreKit's
    /// localized `displayPrice`; it is never hardcoded in the app.
    func loadProducts() async {
        guard !isLoadingProducts else { return }
        isLoadingProducts = true
        defer { isLoadingProducts = false }
        do {
            let fetched = try await Product.products(for: Set(PremiumProductID.all))
            products = fetched.sorted { lhs, rhs in
                // Monthly before yearly, so the shorter commitment is not the
                // one below the fold.
                if lhs.id == PremiumProductID.monthly { return true }
                if rhs.id == PremiumProductID.monthly { return false }
                return lhs.id < rhs.id
            }
            if products.isEmpty {
                errorMessage = L.t("Chưa tải được gói Premium. Kiểm tra kết nối rồi thử lại.")
            }
        } catch {
            errorMessage = L.t("Không tải được gói Premium: %@", error.localizedDescription)
        }
    }

    /// Reconcile local StoreKit state with the server. Called on launch and on
    /// every foreground: it sends each currently-entitled transaction to the
    /// backend, then reads the authoritative bit from `/auth/me`.
    func syncEntitlement() async {
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result else { continue }
            // Finish only after the server has accepted the transaction. A
            // failed verify (offline, 409) must leave it pending so StoreKit
            // redelivers on the next sync instead of silently swallowing a
            // purchase the backend never recorded.
            if (try? await client.verifyPremium(jws: result.jwsRepresentation)) != nil {
                await transaction.finish()
            }
        }
        // `/auth/me` is the final word: it reflects a server-side expiry, a
        // refund seen by another device, or a transaction the app cannot see
        // yet. Keep the previous value if the request itself fails — a network
        // error must not silently downgrade a paying user.
        if let user = try? await client.me() {
            isPremium = user.premium ?? false
        }
    }

    func purchase(_ product: Product) async {
        guard !isPurchasing else { return }
        isPurchasing = true
        errorMessage = nil
        defer { isPurchasing = false }
        do {
            switch try await product.purchase() {
            case .success(let verification):
                switch verification {
                case .verified(let transaction):
                    let result = try await client.verifyPremium(jws: verification.jwsRepresentation)
                    isPremium = result.premium
                    await transaction.finish()
                    if !result.premium {
                        errorMessage = L.t("Giao dịch đã được xác minh nhưng chưa kích hoạt Premium. Thử Khôi phục mua hàng.")
                    }
                case .unverified:
                    errorMessage = L.t("Không xác minh được giao dịch App Store.")
                }
            case .pending:
                errorMessage = L.t("Giao dịch đang chờ xử lý. Premium sẽ bật khi Apple xác nhận.")
            case .userCancelled:
                break
            @unknown default:
                break
            }
        } catch let APIError.server(_, envelope) {
            errorMessage = envelope.message ?? L.t("Không kích hoạt được Premium.")
        } catch {
            errorMessage = L.t("Không kích hoạt được Premium: %@", error.localizedDescription)
        }
    }

    func restore() async {
        guard !isRestoring else { return }
        isRestoring = true
        errorMessage = nil
        defer { isRestoring = false }
        do {
            try await AppStore.sync()
            await syncEntitlement()
            if !isPremium {
                errorMessage = L.t("Không tìm thấy giao dịch Premium nào để khôi phục.")
            }
        } catch {
            errorMessage = L.t("Khôi phục mua hàng thất bại: %@", error.localizedDescription)
        }
    }

    /// The system's subscription-management screen. Required by App Review:
    /// the paywall has to offer a way to manage/cancel, not only to buy.
    var manageSubscriptionURL: URL? {
        URL(string: "https://apps.apple.com/account/subscriptions")
    }

    private func handle(_ result: VerificationResult<Transaction>) async {
        guard case .verified(let transaction) = result else { return }
        if let answer = try? await client.verifyPremium(jws: result.jwsRepresentation) {
            isPremium = answer.premium
            await transaction.finish()
        }
    }
}
