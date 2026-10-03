import Foundation

// MARK: - Auth

public struct AuthSuccess: Decodable, Sendable {
    public let accessToken: String
    public let expiresAt: Date
    public let user: User
}

public struct User: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let email: String
    public let name: String?
    public let aiOptIn: Bool?

    public init(id: String, email: String, name: String?, aiOptIn: Bool? = nil) {
        self.id = id; self.email = email; self.name = name; self.aiOptIn = aiOptIn
    }
}

public struct RegisterInput: Encodable, Sendable {
    public var email: String
    public var password: String
    public var name: String?
    public var deviceLabel: String?
    public var platform: String? // "ios"

    public init(email: String, password: String, name: String? = nil,
                deviceLabel: String? = nil, platform: String? = "ios") {
        self.email = email; self.password = password; self.name = name
        self.deviceLabel = deviceLabel; self.platform = platform
    }
}

public struct LoginInput: Encodable, Sendable {
    public var email: String
    public var password: String
    public var deviceLabel: String?
    public var platform: String?

    public init(email: String, password: String,
                deviceLabel: String? = nil, platform: String? = "ios") {
        self.email = email; self.password = password
        self.deviceLabel = deviceLabel; self.platform = platform
    }
}

public struct ChangePasswordInput: Encodable, Sendable {
    public var currentPassword: String
    public var newPassword: String
    public var confirmPassword: String

    public init(currentPassword: String, newPassword: String, confirmPassword: String) {
        self.currentPassword = currentPassword
        self.newPassword = newPassword
        self.confirmPassword = confirmPassword
    }
}

public struct ChangePasswordResult: Decodable, Sendable {
    public let ok: Bool
    public let message: String?
}

// MARK: - Domain enums

public enum DeviceStatus: String, Codable, CaseIterable, Sendable {
    case ACTIVE, EXPIRED, SOLD, BROKEN, LOST

    public var label: String {
        switch self {
        case .ACTIVE:  return "Đang dùng"
        case .EXPIRED: return "Hết bảo hành"
        case .SOLD:    return "Đã bán"
        case .BROKEN:  return "Hỏng"
        case .LOST:    return "Mất"
        }
    }
}

public enum WarrantyType: String, Codable, CaseIterable, Sendable {
    case STANDARD, EXTENDED, THIRD_PARTY

    public var label: String {
        switch self {
        case .STANDARD:    return "Tiêu chuẩn"
        case .EXTENDED:    return "Mở rộng"
        case .THIRD_PARTY: return "Bên thứ ba"
        }
    }
}

public enum BillingCycle: String, Codable, CaseIterable, Sendable {
    case MONTHLY, QUARTERLY, YEARLY, LIFETIME, CUSTOM

    public var label: String {
        switch self {
        case .MONTHLY:   return "Hàng tháng"
        case .QUARTERLY: return "Hàng quý"
        case .YEARLY:    return "Hàng năm"
        case .LIFETIME:  return "Lifetime / Trọn đời"
        case .CUSTOM:    return "Tuỳ chỉnh"
        }
    }
}

public enum SubscriptionStatus: String, Codable, CaseIterable, Sendable {
    case ACTIVE, PAUSED, CANCELED, EXPIRED

    public var label: String {
        switch self {
        case .ACTIVE:   return "Đang hoạt động"
        case .PAUSED:   return "Tạm dừng"
        case .CANCELED: return "Đã huỷ"
        case .EXPIRED:  return "Hết hạn"
        }
    }
}

public enum WishlistPriority: String, Codable, CaseIterable, Sendable {
    case MUST, WANT, MAYBE

    public var label: String {
        switch self {
        case .MUST:  return "Phải mua"
        case .WANT:  return "Muốn"
        case .MAYBE: return "Cân nhắc"
        }
    }
}

public enum WishlistStatus: String, Codable, CaseIterable, Sendable {
    case WATCHING, DECIDED, SKIPPED, PURCHASED

    public var label: String {
        switch self {
        case .WATCHING:  return "Đang theo dõi"
        case .DECIDED:   return "Quyết mua"
        case .SKIPPED:   return "Bỏ qua"
        case .PURCHASED: return "Đã mua"
        }
    }
}

public enum PushPlatform: String, Codable, CaseIterable, Sendable {
    case web, apns, fcm
}

// MARK: - Device

public struct Device: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let userId: String?
    public let name: String
    public let category: String
    public let brand: String?
    public let model: String?
    public let serialNumber: String?
    public let purchaseDate: Date
    public let purchasePrice: Int
    public let purchasePlace: String?
    public let status: DeviceStatus
    public let notes: String?
    public let createdAt: Date?
    public let updatedAt: Date?

    // List-row projection only (`GET /api/v1/devices`). The Go service returns
    // `DeviceListItem` = `store.Device` + these two counts — see
    // `api/internal/services/devices.go` and `website/src/lib/api/devices.ts`.
    // Both are absent on create/update/detail responses, hence optional.
    //
    // NOTE: these two fields are missing from the `Device` schema in
    // `openapi.yaml` even though the server emits them; the web client already
    // relies on them.
    public let attachmentCount: Int?
    public let effectiveWarrantyEnd: Date?
}

public struct DeviceDetail: Decodable, Sendable {
    public let device: DeviceDetailBody
}

public struct DeviceDetailBody: Decodable, Sendable {
    public let id: String
    public let name: String
    public let category: String
    public let brand: String?
    public let model: String?
    public let serialNumber: String?
    public let purchaseDate: Date
    public let purchasePrice: Int
    public let status: DeviceStatus
    public let notes: String?
    public let attachments: [AttachmentMeta]?
    public let warranties: [Warranty]?
}

public struct DeviceInput: Encodable, Sendable {
    public var name: String
    public var category: String
    public var brand: String?
    public var model: String?
    public var serialNumber: String?
    public var purchaseDate: String  // YYYY-MM-DD
    public var purchasePrice: Int = 0
    public var purchasePlace: String?
    public var status: DeviceStatus = .ACTIVE
    public var notes: String?
    public var warrantyMonths: Int = 0
    public var warrantyProvider: String?
    public var warrantyAddress: String?
    public var warrantyPhone: String?
    public var warrantyNotes: String?
    public var fromWishlistId: String?

    public init(name: String, category: String, purchaseDate: String) {
        self.name = name; self.category = category; self.purchaseDate = purchaseDate
    }
}

// MARK: - AI receipt draft

/// Draft returned by `POST /api/v1/ai/extract-receipt`. Mirrors the Go
/// `DraftDevice` / openapi schema. Every field is optional — the model returns
/// null for anything it can't read. This is NEVER persisted directly; the form
/// pre-fills from it and the user confirms before saving.
public struct DraftDevice: Decodable, Sendable {
    public let name: String?
    public let category: String?
    public let brand: String?
    public let brandId: String?
    public let model: String?
    public let serialNumber: String?
    public let purchaseDate: String?
    public let purchasePrice: Int?
    public let purchasePlace: String?
    public let storeId: String?
    public let warrantyMonths: Int?
    public let warrantyProviderId: String?
    public let confidence: String
    public let unmatched: [String]
    /// Advisories about values that were **kept** in the draft (openapi:
    /// `draft.warnings`, always present, `[]` when nothing looks wrong).
    ///
    /// Not to be confused with `unmatched`, which lists fields the extractor
    /// could not use. Optional only so a server that omits the array can't fail
    /// the whole scan; read it through `warningsOrEmpty`.
    public let warnings: [DeviceWarning]?

    /// Never-nil view for the scan result UI.
    public var warningsOrEmpty: [DeviceWarning] { warnings ?? [] }
}

// MARK: - Warranty

public struct Warranty: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let deviceId: String
    public let type: WarrantyType
    public let provider: String?
    public let startDate: Date
    public let endDate: Date
    public let months: Int
    public let cost: Int?
    public let address: String?
    public let phone: String?
    public let notes: String?
    /// Present on `GET /devices/:id` (nested), absent on create/update responses.
    public let reminders: [Reminder]?

    /// True if every reminder row for this warranty is dismissed (or there is one and it's dismissed).
    /// Mirrors the web's per-warranty "đã ẩn nhắc" state.
    public var isReminderDismissed: Bool {
        guard let reminders, !reminders.isEmpty else { return false }
        return reminders.allSatisfy { $0.isDismissed }
    }
}

public struct Reminder: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let warrantyId: String
    public let isDismissed: Bool
    public let createdAt: Date?
}

public struct WarrantyInput: Encodable, Sendable {
    public var type: WarrantyType
    public var provider: String?
    public var startDate: String
    public var months: Int
    public var cost: Int?
    public var address: String?
    public var phone: String?
    public var notes: String?

    public init(type: WarrantyType, startDate: String, months: Int) {
        self.type = type; self.startDate = startDate; self.months = months
    }
}

// MARK: - Attachment

public struct AttachmentMeta: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let fileName: String
    public let fileType: String
    public let fileSize: Int
    public let description: String?
    public let uploadedAt: Date
}

// MARK: - Subscription

public struct Subscription: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let category: String?
    public let brand: String?
    public let plan: String?
    public let billingCycle: BillingCycle
    public let intervalDays: Int?
    public let price: Int
    public let currency: String?
    public let startedAt: Date
    public let renewalDate: Date
    public let autoRenew: Bool
    public let status: SubscriptionStatus
    public let accountEmail: String?
    public let paymentMethod: String?
    public let manageUrl: String?
    public let cancelUrl: String?
    public let notes: String?
}

public struct SubscriptionInput: Encodable, Sendable {
    public var name: String
    public var category: String?
    public var brand: String?
    public var plan: String?
    public var billingCycle: BillingCycle
    public var intervalDays: Int?
    public var price: Int
    public var startedAt: String
    public var renewalDate: String?
    public var autoRenew: Bool = true
    public var status: SubscriptionStatus = .ACTIVE
    public var accountEmail: String?
    public var paymentMethod: String?
    public var manageUrl: String?
    public var cancelUrl: String?
    public var notes: String?

    public init(name: String, billingCycle: BillingCycle, price: Int, startedAt: String) {
        self.name = name; self.billingCycle = billingCycle
        self.price = price; self.startedAt = startedAt
    }
}

public struct Payment: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let subscriptionId: String
    public let amount: Int
    public let paidAt: Date
    public let note: String?
}

public struct PaymentInput: Encodable, Sendable {
    public var amount: Int
    public var paidAt: String
    public var note: String?

    public init(amount: Int, paidAt: String, note: String? = nil) {
        self.amount = amount; self.paidAt = paidAt; self.note = note
    }
}

// MARK: - Wishlist

public struct WishlistItem: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let category: String?
    public let brand: String?
    public let initialPrice: Int?
    public let currentPrice: Int?
    public let buyUrl: String?
    public let imageUrl: String?
    public let targetDate: Date?
    public let priority: WishlistPriority
    public let status: WishlistStatus
    public let notes: String?
    public let reminderIntervalDays: Int?
    public let purchasedDeviceId: String?
}

public struct WishlistInput: Encodable, Sendable {
    public var name: String
    public var category: String?
    public var brand: String?
    public var initialPrice: Int?
    public var currentPrice: Int?
    public var buyUrl: String?
    public var imageUrl: String?
    public var targetDate: String?
    public var priority: WishlistPriority = .WANT
    public var status: WishlistStatus = .WATCHING
    public var notes: String?
    public var reminderIntervalDays: Int?

    public init(name: String) { self.name = name }
}

public struct WishlistPrice: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let itemId: String
    public let price: Int
    public let note: String?
    public let recordedAt: Date
}

public struct PriceLogInput: Encodable, Sendable {
    public var price: Int
    public var note: String?

    public init(price: Int, note: String? = nil) {
        self.price = price; self.note = note
    }
}

// MARK: - Catalog

public struct Catalog: Decodable, Sendable {
    public let categories: [CategoryOption]
    public let brands: [BrandOption]
    public let stores: [StoreOption]
    public let warrantyProviders: [WarrantyProviderOption]
}

public struct CategoryOption: Codable, Sendable, Identifiable, Hashable {
    public var id: String { code }
    public let code: String
    public let name: String

    public init(code: String, name: String) {
        self.code = code
        self.name = name
    }
}

public struct BrandOption: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let categoryCodes: [String]
}

public struct StoreOption: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let type: String
}

public struct WarrantyProviderOption: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let phone: String?
    public let address: String?
    public let websiteUrl: String?
    public let notes: String?
}

// MARK: - Stats

public struct UserStats: Decodable, Sendable {
    public let devices: DeviceStats
    public let subscriptions: SubscriptionStats
    public let wishlist: WishlistStats
}

public struct DeviceStats: Decodable, Sendable {
    public let total: Int
    public let byStatus: [String: Int]
    public let totalPurchasePrice: Int
}

public struct SubscriptionStats: Decodable, Sendable {
    public let total: Int
    public let byStatus: [String: Int]
    public let totalMonthlyVnd: Int
}

public struct WishlistStats: Decodable, Sendable {
    public let total: Int
    public let byStatus: [String: Int]
    public let totalCurrentPriceWatching: Int
}

// MARK: - Backup import result

/// Counts returned by `POST /api/v1/backup/import` (mirrors services.ImportResult).
public struct ImportResult: Decodable, Sendable {
    public let imported: Int
    public let skipped: Int
    public let wishlistImported: Int
    public let wishlistSkipped: Int
    public let subImported: Int
    public let subSkipped: Int
}

// MARK: - Upcoming reminders

public struct UpcomingReminder: Decodable, Sendable, Identifiable {
    public let id: String
    public let deviceId: String
    public let device: ReminderDevice
    public let type: WarrantyType
    public let provider: String?
    public let startDate: Date
    public let endDate: Date
    public let months: Int
    /// True when the user hid this reminder ("Đã xem, ẩn đi").
    ///
    /// Only sent by the opt-in read (`includeDismissed=true`); the plain
    /// upcoming feed omits it, so `nil` means "not hidden". See
    /// `DismissedReminders` for the "Đã ẩn" rollup built on top of it.
    public let isDismissed: Bool?
}

public struct ReminderDevice: Decodable, Sendable {
    public let id: String
    public let name: String
    public let category: String
    /// Owning device's status, sent alongside `includeDismissed` rows so the
    /// "Đã ẩn" list can render its badge. Kept as a raw string (with an
    /// `ACTIVE` fallback) so an unknown status can't fail the whole feed.
    public let status: String?
}

// MARK: - Push

public struct PushSubscriptionMeta: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let endpoint: String
    public let platform: PushPlatform
    public let userAgent: String?
    public let createdAt: Date
}

public struct NativePushInput: Encodable, Sendable {
    public var platform: PushPlatform
    public var token: String
    public var userAgent: String?

    public init(platform: PushPlatform, token: String, userAgent: String? = nil) {
        self.platform = platform; self.token = token; self.userAgent = userAgent
    }
}
