import Foundation
import XCTest
@testable import WarrantyVaultKit

final class ModelsTests: KitTestCase {

    private func decode<T: Decodable>(_ type: T.Type, from json: String) throws -> T {
        try APIClient.decoder.decode(T.self, from: Data(json.utf8))
    }

    private func encode<T: Encodable>(_ value: T) throws -> [String: Any] {
        let data = try APIClient.encoder.encode(value)
        let object = try JSONSerialization.jsonObject(with: data)
        return try XCTUnwrap(object as? [String: Any])
    }

    // MARK: - Device

    func testDeviceRoundTripPreservesEveryField() throws {
        let device = try decode(Device.self, from: Fixtures.device)

        XCTAssertEqual(device.id, "dev_1")
        XCTAssertEqual(device.userId, "usr_1")
        XCTAssertEqual(device.name, "MacBook Pro 14")
        XCTAssertEqual(device.category, "LAPTOP")
        XCTAssertEqual(device.brand, "Apple")
        XCTAssertEqual(device.serialNumber, "SN-12345")
        XCTAssertEqual(device.purchasePrice, 49_990_000)
        XCTAssertEqual(device.purchasePlace, "FPT Shop")
        XCTAssertEqual(device.status, .ACTIVE)
        XCTAssertEqual(device.notes, "Mua kèm AppleCare")
        XCTAssertEqual(device.purchaseDate, makeDate("2025-03-12T00:00:00Z",
                                                      format: "yyyy-MM-dd'T'HH:mm:ssZZZZZ",
                                                      timeZone: TimeZone(identifier: "UTC")))
        XCTAssertEqual(device.createdAt, makeDate("2025-03-12T09:30:00Z",
                                                  format: "yyyy-MM-dd'T'HH:mm:ssZZZZZ",
                                                  timeZone: TimeZone(identifier: "UTC")))

        // Encode -> decode must be loss-less (dates included).
        let encoded = try APIClient.encoder.encode(device)
        let redecoded = try APIClient.decoder.decode(Device.self, from: encoded)
        XCTAssertEqual(redecoded, device)
    }

    func testDeviceDecodesWithOnlyRequiredFields() throws {
        let device = try decode(Device.self, from: #"""
        {
          "id": "dev_2",
          "name": "Nồi chiên không dầu",
          "category": "KITCHEN",
          "purchaseDate": "2024-11-02",
          "purchasePrice": 0,
          "status": "BROKEN"
        }
        """#)

        XCTAssertEqual(device.status, .BROKEN)
        XCTAssertNil(device.userId)
        XCTAssertNil(device.brand)
        XCTAssertNil(device.model)
        XCTAssertNil(device.serialNumber)
        XCTAssertNil(device.purchasePlace)
        XCTAssertNil(device.notes)
        XCTAssertNil(device.createdAt)
        XCTAssertNil(device.updatedAt)
        XCTAssertEqual(device.purchaseDate, makeDate("2024-11-02", format: "yyyy-MM-dd"))
    }

    func testDeviceDecodingFailsOnMissingKeyUnknownStatusAndBadDate() {
        assertDecodingFails(Device.self, from: #"""
        {"id": "dev_3", "category": "LAPTOP", "purchaseDate": "2024-11-02",
         "purchasePrice": 100, "status": "ACTIVE"}
        """#) { error in
            guard case .keyNotFound(let key, _) = error else {
                return XCTFail("Expected keyNotFound, got \(error)")
            }
            XCTAssertEqual(key.stringValue, "name")
        }

        assertDecodingFails(Device.self, from: #"""
        {"id": "dev_4", "name": "Máy giặt", "category": "HOME",
         "purchaseDate": "2024-11-02", "purchasePrice": 100, "status": "REPAIRING"}
        """#) { error in
            guard case .dataCorrupted(let context) = error else {
                return XCTFail("Expected dataCorrupted, got \(error)")
            }
            XCTAssertTrue(context.debugDescription.contains("REPAIRING"),
                          "debugDescription should mention the bad value, got: \(context.debugDescription)")
        }

        assertDecodingFails(Device.self, from: #"""
        {"id": "dev_5", "name": "Máy ảnh", "category": "CAMERA",
         "purchaseDate": "02/11/2024", "purchasePrice": 100, "status": "ACTIVE"}
        """#) { error in
            guard case .dataCorrupted(let context) = error else {
                return XCTFail("Expected dataCorrupted, got \(error)")
            }
            XCTAssertEqual(context.debugDescription, "Unrecognized date: 02/11/2024")
        }
    }

    func testDeviceDetailRoundTripsNestedAttachmentsAndWarranties() throws {
        let detail = try decode(DeviceDetail.self, from: #"""
        {
          "device": {
            "id": "dev_1",
            "name": "MacBook Pro 14",
            "category": "LAPTOP",
            "purchaseDate": "2025-03-12T00:00:00Z",
            "purchasePrice": 49990000,
            "status": "ACTIVE",
            "attachments": [
              {
                "id": "att_1",
                "fileName": "hoa-don.pdf",
                "fileType": "application/pdf",
                "fileSize": 20480,
                "description": "Hoá đơn FPT",
                "uploadedAt": "2025-03-13T08:00:00Z"
              }
            ],
            "warranties": [
              {
                "id": "war_1",
                "deviceId": "dev_1",
                "type": "EXTENDED",
                "provider": "Apple",
                "startDate": "2025-03-12T00:00:00Z",
                "endDate": "2027-03-12T00:00:00Z",
                "months": 24,
                "cost": 5000000,
                "address": "1 Nguyễn Huệ, Q.1",
                "phone": "19001234",
                "notes": null
              }
            ]
          }
        }
        """#)

        XCTAssertEqual(detail.device.id, "dev_1")
        XCTAssertEqual(detail.device.warranties?.first?.type, .EXTENDED)
        XCTAssertEqual(detail.device.warranties?.first?.months, 24)
        XCTAssertEqual(detail.device.warranties?.first?.address, "1 Nguyễn Huệ, Q.1")
        XCTAssertNil(detail.device.warranties?.first?.reminders)

        let attachment = try XCTUnwrap(detail.device.attachments?.first)
        XCTAssertEqual(attachment.fileName, "hoa-don.pdf")
        XCTAssertEqual(attachment.fileSize, 20_480)
        XCTAssertEqual(attachment.description, "Hoá đơn FPT")
        XCTAssertEqual(try APIClient.decoder.decode(
            AttachmentMeta.self, from: try APIClient.encoder.encode(attachment)), attachment)
    }

    func testDeviceInputEncodesDateAsStringAndStatusAsRawValue() throws {
        var input = DeviceInput(name: "iPhone 16", category: "PHONE", purchaseDate: "2025-05-20")
        input.brand = "Apple"
        input.purchasePrice = 22_990_000
        input.warrantyMonths = 12
        input.warrantyProvider = "Apple"
        input.status = .SOLD

        let payload = try encode(input)

        XCTAssertEqual(payload["name"] as? String, "iPhone 16")
        XCTAssertEqual(payload["purchaseDate"] as? String, "2025-05-20")
        XCTAssertEqual(payload["purchasePrice"] as? Int, 22_990_000)
        XCTAssertEqual(payload["status"] as? String, "SOLD")
        XCTAssertEqual(payload["warrantyMonths"] as? Int, 12)
        XCTAssertEqual(payload["warrantyProvider"] as? String, "Apple")
        XCTAssertNil(payload["model"], "nil optionals must be omitted, not encoded as null")
        XCTAssertNil(payload["notes"])
    }

    // MARK: - Domain enums: raw values + exact Vietnamese labels

    func testDeviceStatusAndWarrantyTypeLabels() {
        XCTAssertEqual(DeviceStatus.allCases.map(\.rawValue),
                       ["ACTIVE", "EXPIRED", "SOLD", "BROKEN", "LOST"])
        XCTAssertEqual(DeviceStatus.ACTIVE.label, "Đang dùng")
        XCTAssertEqual(DeviceStatus.EXPIRED.label, "Hết bảo hành")
        XCTAssertEqual(DeviceStatus.SOLD.label, "Đã bán")
        XCTAssertEqual(DeviceStatus.BROKEN.label, "Hỏng")
        XCTAssertEqual(DeviceStatus.LOST.label, "Mất")
        XCTAssertEqual(DeviceStatus(rawValue: "ACTIVE"), .ACTIVE)
        XCTAssertNil(DeviceStatus(rawValue: "active"), "raw values are case-sensitive")

        XCTAssertEqual(WarrantyType.allCases.map(\.rawValue), ["STANDARD", "EXTENDED", "THIRD_PARTY"])
        XCTAssertEqual(WarrantyType.STANDARD.label, "Tiêu chuẩn")
        XCTAssertEqual(WarrantyType.EXTENDED.label, "Mở rộng")
        XCTAssertEqual(WarrantyType.THIRD_PARTY.label, "Bên thứ ba")
    }

    func testBillingCycleAndSubscriptionStatusLabels() {
        XCTAssertEqual(BillingCycle.allCases.map(\.rawValue),
                       ["MONTHLY", "QUARTERLY", "YEARLY", "LIFETIME", "CUSTOM"])
        XCTAssertEqual(BillingCycle.MONTHLY.label, "Hàng tháng")
        XCTAssertEqual(BillingCycle.QUARTERLY.label, "Hàng quý")
        XCTAssertEqual(BillingCycle.YEARLY.label, "Hàng năm")
        XCTAssertEqual(BillingCycle.LIFETIME.label, "Lifetime / Trọn đời")
        XCTAssertEqual(BillingCycle.CUSTOM.label, "Tuỳ chỉnh")

        XCTAssertEqual(SubscriptionStatus.allCases.map(\.rawValue),
                       ["ACTIVE", "PAUSED", "CANCELED", "EXPIRED"])
        XCTAssertEqual(SubscriptionStatus.ACTIVE.label, "Đang hoạt động")
        XCTAssertEqual(SubscriptionStatus.PAUSED.label, "Tạm dừng")
        XCTAssertEqual(SubscriptionStatus.CANCELED.label, "Đã huỷ")
        XCTAssertEqual(SubscriptionStatus.EXPIRED.label, "Hết hạn")
    }

    func testWishlistLabelsAndPushPlatformRawValues() {
        XCTAssertEqual(WishlistStatus.allCases.map(\.rawValue),
                       ["WATCHING", "DECIDED", "SKIPPED", "PURCHASED"])
        XCTAssertEqual(WishlistStatus.WATCHING.label, "Đang theo dõi")
        XCTAssertEqual(WishlistStatus.DECIDED.label, "Quyết mua")
        XCTAssertEqual(WishlistStatus.SKIPPED.label, "Bỏ qua")
        XCTAssertEqual(WishlistStatus.PURCHASED.label, "Đã mua")

        XCTAssertEqual(WishlistPriority.allCases.map(\.rawValue), ["MUST", "WANT", "MAYBE"])
        XCTAssertEqual(WishlistPriority.MUST.label, "Phải mua")
        XCTAssertEqual(WishlistPriority.WANT.label, "Muốn")
        XCTAssertEqual(WishlistPriority.MAYBE.label, "Cân nhắc")

        XCTAssertEqual(PushPlatform.allCases.map(\.rawValue), ["web", "apns", "fcm"])
    }

    // MARK: - Warranty + reminders

    func testWarrantyRoundTripWithNestedReminders() throws {
        let warranty = try decode(Warranty.self, from: #"""
        {
          "id": "war_7",
          "deviceId": "dev_1",
          "type": "THIRD_PARTY",
          "provider": "CellphoneS",
          "startDate": "2024-08-01T00:00:00Z",
          "endDate": "2026-08-01T00:00:00Z",
          "months": 24,
          "cost": 1200000,
          "address": null,
          "phone": "18002097",
          "notes": "Bảo hành rơi vỡ",
          "reminders": [
            {"id": "rem_1", "warrantyId": "war_7", "isDismissed": false,
             "createdAt": "2026-07-01T00:00:00Z"}
          ]
        }
        """#)

        XCTAssertEqual(warranty.type, .THIRD_PARTY)
        XCTAssertEqual(warranty.provider, "CellphoneS")
        XCTAssertEqual(warranty.months, 24)
        XCTAssertEqual(warranty.cost, 1_200_000)
        XCTAssertNil(warranty.address)
        XCTAssertEqual(warranty.reminders?.first?.warrantyId, "war_7")
        XCTAssertFalse(warranty.isReminderDismissed)

        let redecoded = try APIClient.decoder.decode(
            Warranty.self, from: try APIClient.encoder.encode(warranty))
        XCTAssertEqual(redecoded, warranty)

        // Unknown warranty types must not silently decode.
        assertDecodingFails(Warranty.self, from: #"""
        {"id": "war_1", "deviceId": "dev_1", "type": "LIFETIME",
         "startDate": "2025-01-01", "endDate": "2026-01-01", "months": 12}
        """#)

        // WarrantyInput mirrors the create/update payload.
        var input = WarrantyInput(type: .STANDARD, startDate: "2025-06-01", months: 12)
        input.provider = "FPT Shop"
        input.cost = 0
        var payload = try encode(input)
        XCTAssertEqual(payload["type"] as? String, "STANDARD")
        XCTAssertEqual(payload["startDate"] as? String, "2025-06-01")
        XCTAssertEqual(payload["months"] as? Int, 12)
        XCTAssertEqual(payload["cost"] as? Int, 0)
        XCTAssertNil(payload["notes"])

        payload = try encode(Reminder(id: "rem_1", warrantyId: "war_7",
                                      isDismissed: true, createdAt: nil))
        XCTAssertEqual(payload["isDismissed"] as? Bool, true)
        XCTAssertNil(payload["createdAt"])
    }

    func testWarrantyIsReminderDismissedReflectsReminderRows() throws {
        func warranty(reminders: String) throws -> Warranty {
            try decode(Warranty.self, from: #"""
            {
              "id": "war_1",
              "deviceId": "dev_1",
              "type": "STANDARD",
              "startDate": "2025-01-01T00:00:00Z",
              "endDate": "2026-01-01T00:00:00Z",
              "months": 12,
              "reminders": \#(reminders)
            }
            """#)
        }

        XCTAssertFalse(try warranty(reminders: "null").isReminderDismissed,
                       "no reminder rows at all -> not dismissed")
        XCTAssertFalse(try warranty(reminders: "[]").isReminderDismissed,
                       "empty reminder list -> not dismissed")
        XCTAssertTrue(try warranty(reminders: #"""
        [{"id": "rem_1", "warrantyId": "war_1", "isDismissed": true, "createdAt": null}]
        """#).isReminderDismissed)
        XCTAssertFalse(try warranty(reminders: #"""
        [{"id": "rem_1", "warrantyId": "war_1", "isDismissed": false, "createdAt": null}]
        """#).isReminderDismissed)
        XCTAssertTrue(try warranty(reminders: #"""
        [{"id": "rem_1", "warrantyId": "war_1", "isDismissed": true, "createdAt": null},
         {"id": "rem_2", "warrantyId": "war_1", "isDismissed": true, "createdAt": null}]
        """#).isReminderDismissed)
        XCTAssertFalse(try warranty(reminders: #"""
        [{"id": "rem_1", "warrantyId": "war_1", "isDismissed": true, "createdAt": null},
         {"id": "rem_2", "warrantyId": "war_1", "isDismissed": false, "createdAt": null}]
        """#).isReminderDismissed, "one live reminder keeps the warranty visible")
    }

    // MARK: - Subscription / payments

    func testSubscriptionRoundTripAndDefaults() throws {
        let subscription = try decode(Subscription.self, from: Fixtures.subscription)

        XCTAssertEqual(subscription.id, "sub_1")
        XCTAssertEqual(subscription.billingCycle, .MONTHLY)
        XCTAssertEqual(subscription.price, 59_000)
        XCTAssertEqual(subscription.currency, "VND")
        XCTAssertTrue(subscription.autoRenew)
        XCTAssertEqual(subscription.status, .ACTIVE)
        XCTAssertNil(subscription.intervalDays)
        XCTAssertNil(subscription.cancelUrl)
        XCTAssertEqual(subscription.manageUrl, "https://appleid.apple.com")

        let redecoded = try APIClient.decoder.decode(
            Subscription.self, from: try APIClient.encoder.encode(subscription))
        XCTAssertEqual(redecoded, subscription)

        assertDecodingFails(Subscription.self, from: #"""
        {"id": "sub_9", "name": "Netflix", "billingCycle": "WEEKLY", "price": 260000,
         "startedAt": "2025-01-05", "renewalDate": "2025-06-05",
         "autoRenew": true, "status": "ACTIVE"}
        """#)

        let payload = try encode(SubscriptionInput(name: "Spotify Premium",
                                                   billingCycle: .YEARLY,
                                                   price: 1_590_000,
                                                   startedAt: "2025-02-01"))
        XCTAssertEqual(payload["billingCycle"] as? String, "YEARLY")
        XCTAssertEqual(payload["price"] as? Int, 1_590_000)
        XCTAssertEqual(payload["autoRenew"] as? Bool, true)
        XCTAssertEqual(payload["status"] as? String, "ACTIVE")
        XCTAssertNil(payload["renewalDate"])
        XCTAssertNil(payload["accountEmail"])
    }

    func testPaymentAndWishlistPriceRoundTrips() throws {
        let payment = try decode(Payment.self, from: #"""
        {"id": "pay_1", "subscriptionId": "sub_1", "amount": 59000,
         "paidAt": "2025-05-05T00:00:00Z", "note": "Thanh toán Apple ID"}
        """#)
        XCTAssertEqual(payment.amount, 59_000)
        XCTAssertEqual(payment.note, "Thanh toán Apple ID")
        XCTAssertEqual(try APIClient.decoder.decode(
            Payment.self, from: try APIClient.encoder.encode(payment)), payment)

        let price = try decode(WishlistPrice.self, from: #"""
        {"id": "wp_1", "itemId": "wish_1", "price": 5290000,
         "note": "Sale 12/12", "recordedAt": "2025-12-12T03:00:00Z"}
        """#)
        XCTAssertEqual(price.itemId, "wish_1")
        XCTAssertEqual(price.price, 5_290_000)
        XCTAssertEqual(price.note, "Sale 12/12")

        var payload = try encode(PaymentInput(amount: 59_000, paidAt: "2025-05-05"))
        XCTAssertEqual(payload["paidAt"] as? String, "2025-05-05")
        XCTAssertNil(payload["note"])

        payload = try encode(PriceLogInput(price: 5_290_000))
        XCTAssertEqual(payload["price"] as? Int, 5_290_000)
        XCTAssertNil(payload["note"])
    }

    // MARK: - Wishlist

    func testWishlistItemRoundTripAndInputDefaults() throws {
        let item = try decode(WishlistItem.self, from: Fixtures.wishlistItem)

        XCTAssertEqual(item.priority, .WANT)
        XCTAssertEqual(item.status, .WATCHING)
        XCTAssertEqual(item.initialPrice, 6_190_000)
        XCTAssertEqual(item.currentPrice, 5_490_000)
        XCTAssertEqual(item.reminderIntervalDays, 7)
        XCTAssertNil(item.imageUrl)
        XCTAssertNil(item.purchasedDeviceId)

        let redecoded = try APIClient.decoder.decode(
            WishlistItem.self, from: try APIClient.encoder.encode(item))
        XCTAssertEqual(redecoded, item)

        let payload = try encode(WishlistInput(name: "Bàn phím cơ"))
        XCTAssertEqual(payload["name"] as? String, "Bàn phím cơ")
        XCTAssertEqual(payload["priority"] as? String, "WANT")
        XCTAssertEqual(payload["status"] as? String, "WATCHING")
        XCTAssertEqual(payload.keys.count, 3, "unset optionals must not be encoded")
    }

    // MARK: - Catalog / stats

    func testCatalogAndUserStatsDecode() throws {
        let catalog = try decode(Catalog.self, from: #"""
        {
          "categories": [
            {"code": "LAPTOP", "name": "Laptop"},
            {"code": "PHONE", "name": "Điện thoại"}
          ],
          "brands": [{"id": "br_1", "name": "Apple", "categoryCodes": ["LAPTOP", "PHONE"]}],
          "stores": [{"id": "st_1", "name": "FPT Shop", "type": "RETAIL"}],
          "warrantyProviders": [
            {"id": "wpv_1", "name": "Apple Việt Nam", "phone": "18001127",
             "address": "TP.HCM", "websiteUrl": "https://apple.com/vn", "notes": null}
          ]
        }
        """#)

        XCTAssertEqual(catalog.categories.map(\.code), ["LAPTOP", "PHONE"])
        XCTAssertEqual(catalog.categories.first?.name, "Laptop")
        XCTAssertEqual(catalog.categories.first?.id, "LAPTOP", "CategoryOption.id is its code")
        XCTAssertEqual(catalog.brands.first?.categoryCodes, ["LAPTOP", "PHONE"])
        XCTAssertEqual(catalog.stores.first?.type, "RETAIL")
        XCTAssertEqual(catalog.warrantyProviders.first?.phone, "18001127")
        XCTAssertNil(catalog.warrantyProviders.first?.notes)

        let stats = try decode(UserStats.self, from: #"""
        {
          "devices": {"total": 12, "byStatus": {"ACTIVE": 9, "SOLD": 2, "BROKEN": 1},
                      "totalPurchasePrice": 320000000},
          "subscriptions": {"total": 4, "byStatus": {"ACTIVE": 3, "PAUSED": 1},
                            "totalMonthlyVnd": 389000},
          "wishlist": {"total": 6, "byStatus": {"WATCHING": 5, "PURCHASED": 1},
                       "totalCurrentPriceWatching": 15000000}
        }
        """#)

        XCTAssertEqual(stats.devices.total, 12)
        XCTAssertEqual(stats.devices.byStatus["ACTIVE"], 9)
        XCTAssertEqual(stats.devices.totalPurchasePrice, 320_000_000)
        XCTAssertEqual(stats.subscriptions.totalMonthlyVnd, 389_000)
        XCTAssertEqual(stats.wishlist.byStatus["PURCHASED"], 1)
        XCTAssertEqual(stats.wishlist.totalCurrentPriceWatching, 15_000_000)
    }

    func testUpcomingReminderDecodesNestedDevice() throws {
        let reminder = try decode(UpcomingReminder.self, from: #"""
        {
          "id": "war_1",
          "deviceId": "dev_1",
          "device": {"id": "dev_1", "name": "Tủ lạnh Samsung", "category": "HOME"},
          "type": "STANDARD",
          "provider": "Samsung",
          "startDate": "2024-09-09T00:00:00Z",
          "endDate": "2026-09-09T00:00:00Z",
          "months": 24
        }
        """#)

        XCTAssertEqual(reminder.id, "war_1")
        XCTAssertEqual(reminder.device.name, "Tủ lạnh Samsung")
        XCTAssertEqual(reminder.device.category, "HOME")
        XCTAssertEqual(reminder.type, .STANDARD)
        XCTAssertEqual(reminder.provider, "Samsung")
        XCTAssertEqual(reminder.months, 24)
        XCTAssertEqual(reminder.endDate, makeDate("2026-09-09T00:00:00Z",
                                                  format: "yyyy-MM-dd'T'HH:mm:ssZZZZZ",
                                                  timeZone: TimeZone(identifier: "UTC")))
    }

    // MARK: - AI draft / auth / misc payloads

    func testDraftDeviceDecodesPartialPayloadAndRequiresConfidence() throws {
        let draft = try decode(DraftDevice.self, from: #"""
        {
          "name": "Máy hút bụi Dyson V12",
          "category": null,
          "brand": "Dyson",
          "purchaseDate": "2025-04-18",
          "purchasePrice": 12990000,
          "confidence": "medium",
          "unmatched": ["Dyson V12 Detect Slim"]
        }
        """#)

        XCTAssertEqual(draft.name, "Máy hút bụi Dyson V12")
        XCTAssertEqual(draft.brand, "Dyson")
        XCTAssertEqual(draft.purchaseDate, "2025-04-18")
        XCTAssertEqual(draft.purchasePrice, 12_990_000)
        XCTAssertEqual(draft.confidence, "medium")
        XCTAssertEqual(draft.unmatched, ["Dyson V12 Detect Slim"])
        XCTAssertNil(draft.category)
        XCTAssertNil(draft.brandId)
        XCTAssertNil(draft.warrantyMonths)

        assertDecodingFails(DraftDevice.self, from: #"{"unmatched": []}"#)
    }

    func testAuthSuccessUserAndImportResultDecode() throws {
        let success = try decode(AuthSuccess.self, from: #"""
        {
          "accessToken": "eyJhbGciOiJIUzI1NiJ9.token",
          "expiresAt": "2026-04-01T00:00:00Z",
          "user": {"id": "usr_1", "email": "trung@example.vn", "name": "Trung", "aiOptIn": true}
        }
        """#)

        XCTAssertEqual(success.accessToken, "eyJhbGciOiJIUzI1NiJ9.token")
        XCTAssertEqual(success.user.id, "usr_1")
        XCTAssertEqual(success.user.name, "Trung")
        XCTAssertTrue(success.user.aiOptIn ?? false)
        XCTAssertEqual(success.expiresAt, makeDate("2026-04-01T00:00:00Z",
                                                   format: "yyyy-MM-dd'T'HH:mm:ssZZZZZ",
                                                   timeZone: TimeZone(identifier: "UTC")))

        let anonymous = User(id: "usr_2", email: "moi@example.vn", name: nil)
        let userPayload = try encode(anonymous)
        XCTAssertEqual(userPayload["email"] as? String, "moi@example.vn")
        XCTAssertNil(userPayload["name"])
        XCTAssertNil(userPayload["aiOptIn"])
        XCTAssertEqual(try APIClient.decoder.decode(
            User.self, from: try APIClient.encoder.encode(anonymous)), anonymous)

        let result = try decode(ImportResult.self, from: #"""
        {"imported": 12, "skipped": 3, "wishlistImported": 4,
         "wishlistSkipped": 1, "subImported": 5, "subSkipped": 2}
        """#)
        XCTAssertEqual(result.imported, 12)
        XCTAssertEqual(result.skipped, 3)
        XCTAssertEqual(result.wishlistImported, 4)
        XCTAssertEqual(result.wishlistSkipped, 1)
        XCTAssertEqual(result.subImported, 5)
        XCTAssertEqual(result.subSkipped, 2)

        let change = try decode(ChangePasswordResult.self, from: #"{"ok": true}"#)
        XCTAssertTrue(change.ok)
        XCTAssertNil(change.message)
    }

    func testRegisterLoginPushAndPasswordInputsEncode() throws {
        var payload = try encode(RegisterInput(email: "a@b.vn", password: "matkhau123",
                                               name: "Trung"))
        XCTAssertEqual(payload["email"] as? String, "a@b.vn")
        XCTAssertEqual(payload["password"] as? String, "matkhau123")
        XCTAssertEqual(payload["platform"] as? String, "ios")
        XCTAssertNil(payload["deviceLabel"])

        payload = try encode(LoginInput(email: "a@b.vn", password: "matkhau123"))
        XCTAssertEqual(payload["platform"] as? String, "ios")
        XCTAssertEqual(payload.keys.count, 3, "deviceLabel is omitted when nil")

        payload = try encode(ChangePasswordInput(currentPassword: "cu123456",
                                                 newPassword: "moi123456",
                                                 confirmPassword: "moi123456"))
        XCTAssertEqual(payload["currentPassword"] as? String, "cu123456")
        XCTAssertEqual(payload["newPassword"] as? String, "moi123456")
        XCTAssertEqual(payload["confirmPassword"] as? String, "moi123456")

        payload = try encode(NativePushInput(platform: .fcm, token: "fcm-token"))
        XCTAssertEqual(payload["platform"] as? String, "fcm")
        XCTAssertEqual(payload["token"] as? String, "fcm-token")
        XCTAssertNil(payload["userAgent"])

        let meta = try decode(PushSubscriptionMeta.self, from: #"""
        {"id": "push_1", "endpoint": "apns-token-abc", "platform": "apns",
         "userAgent": "iPhone 16 Pro", "createdAt": "2026-01-02T03:04:05Z"}
        """#)
        XCTAssertEqual(meta.platform, .apns)
        XCTAssertEqual(meta.endpoint, "apns-token-abc")
        XCTAssertEqual(meta.userAgent, "iPhone 16 Pro")
    }
}
