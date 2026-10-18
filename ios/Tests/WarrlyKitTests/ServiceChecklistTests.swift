import Foundation
import XCTest
@testable import WarrlyKit

// The checklist is client-only copy plus two rules: the order of the steps, and
// which device facts get injected into them. Both are pinned here without a
// simulator. The screen itself (tick-boxes, session store) is not testable in
// this target and is not claimed to be.

final class ServiceChecklistTests: XCTestCase {

    private let fullDevice = ServiceChecklistDevice(
        name: "iPhone 15",
        category: "PHONE",
        serialNumber: "356789012345678",
        warrantyEndText: "12/03/2027",
        purchasePlace: "CellphoneS",
        attachmentCount: 2
    )

    private let bareDevice = ServiceChecklistDevice(
        name: "Máy cũ",
        category: "OTHER"
    )

    // MARK: - Ordering

    func testSectionsAndItemsKeepTheIntendedOrder() {
        L.withLanguage(.vi) {
            let sections = ServiceChecklist.sections(for: fullDevice)

            XCTAssertEqual(sections.map(\.id), ["data", "paperwork", "handover", "pickup"])
            XCTAssertEqual(sections.map(\.title), [
                "Dữ liệu và tài khoản",
                "Giấy tờ và bằng chứng",
                "Đóng gói và bàn giao",
                "Khi nhận lại máy",
            ])

            XCTAssertEqual(sections[0].items.map(\.id), [
                "account.signOut",
                "security.removeLock",
                "data.backup",
                "data.removeSim",
            ])
            XCTAssertEqual(sections[1].items.map(\.id), [
                "paperwork.invoiceBox",
                "paperwork.warrantyEnd",
                "paperwork.purchasePlace",
                "evidence.condition",
                "evidence.fault",
            ])
            XCTAssertEqual(sections[2].items.map(\.id), [
                "handover.accessories",
                "handover.removePersonal",
                "handover.writtenReceipt",
                "handover.dataWipe",
                "handover.quote",
            ])
            XCTAssertEqual(sections[3].items.map(\.id), [
                "pickup.verifySerial",
                "pickup.inspect",
                "pickup.testFunctions",
                "pickup.accessories",
                "pickup.repairWarranty",
                "pickup.dataRestore",
            ])
        }
    }

    func testRequiredHandoverStepsAreActuallyInTheCopy() {
        // The briefing's non-negotiables: accounts, passcode/biometrics, backup,
        // invoice + box/IMEI, condition photos, accessories and the warranty end
        // date. A refactor that drops one of these should fail here, not in a
        // user's trip to the service centre.
        L.withLanguage(.vi) {
            let all = ServiceChecklist.items(for: fullDevice)
                .map { $0.title + " " + $0.detail }
                .joined(separator: " ")
            for phrase in ["iCloud", "Google", "Mi", "mật khẩu", "Face ID",
                           "sao lưu", "hoá đơn", "IMEI", "ảnh", "phụ kiện",
                           "hạn bảo hành"] {
                XCTAssertTrue(all.localizedCaseInsensitiveContains(phrase),
                              "missing \(phrase)")
            }
        }
        L.withLanguage(.en) {
            let all = ServiceChecklist.items(for: fullDevice)
                .map { $0.title + " " + $0.detail }
                .joined(separator: " ")
            for phrase in ["iCloud", "Google", "Mi", "passcode", "Face ID",
                           "back up", "invoice", "IMEI", "photograph",
                           "accessories", "warranty end"] {
                XCTAssertTrue(all.localizedCaseInsensitiveContains(phrase),
                              "missing \(phrase)")
            }
        }
    }

    func testEveryItemHasAUniqueStableIDAndNonEmptyCopy() {
        for language in AppLanguage.allCases {
            L.withLanguage(language) {
                let items = ServiceChecklist.items(for: fullDevice)
                XCTAssertEqual(items.count, 20)
                XCTAssertEqual(ServiceChecklist.itemCount(for: fullDevice), 20)
                XCTAssertEqual(Set(items.map(\.id)).count, items.count)

                for item in items {
                    XCTAssertFalse(item.id.isEmpty)
                    XCTAssertFalse(item.title.trimmingCharacters(in: .whitespaces).isEmpty,
                                   "\(item.id) has an empty title in \(language.rawValue)")
                    XCTAssertFalse(item.detail.trimmingCharacters(in: .whitespaces).isEmpty,
                                   "\(item.id) has an empty detail in \(language.rawValue)")
                    XCTAssertFalse(item.icon.isEmpty)
                }
            }
        }
    }

    func testItemIDsDoNotChangeWithTheSelectedLanguage() {
        let vi = L.withLanguage(.vi) { ServiceChecklist.items(for: fullDevice).map(\.id) }
        let en = L.withLanguage(.en) { ServiceChecklist.items(for: fullDevice).map(\.id) }
        XCTAssertEqual(vi, en)
    }

    // MARK: - Device facts

    func testKnownSerialIsInjectedIntoBothTheBoxAndThePickupItem() {
        L.withLanguage(.vi) {
            let items = ServiceChecklist.items(for: fullDevice)
            let box = items.first { $0.id == "paperwork.invoiceBox" }
            let pickup = items.first { $0.id == "pickup.verifySerial" }

            XCTAssertTrue(box?.detail.contains("356789012345678") == true)
            XCTAssertTrue(pickup?.detail.contains("356789012345678") == true)
            XCTAssertTrue(pickup?.detail.contains("Cài đặt > Giới thiệu") == true)
        }
    }

    func testMissingSerialIsSaidOutLoudRatherThanLeftBlank() {
        L.withLanguage(.vi) {
            let items = ServiceChecklist.items(for: bareDevice)
            let box = items.first { $0.id == "paperwork.invoiceBox" }
            let pickup = items.first { $0.id == "pickup.verifySerial" }

            XCTAssertTrue(box?.detail.contains("chưa lưu serial/IMEI") == true)
            XCTAssertTrue(pickup?.detail.contains("Cài đặt > Giới thiệu") == true)
            XCTAssertFalse(pickup?.detail.contains("phải là") == true)
        }
    }

    func testWarrantyPlaceAndAttachmentCountAreInjected() {
        L.withLanguage(.vi) {
            let items = ServiceChecklist.items(for: fullDevice)

            let warranty = items.first { $0.id == "paperwork.warrantyEnd" }
            let place = items.first { $0.id == "paperwork.purchasePlace" }
            let box = items.first { $0.id == "paperwork.invoiceBox" }

            XCTAssertTrue(warranty?.detail.contains("12/03/2027") == true)
            XCTAssertTrue(place?.detail.contains("CellphoneS") == true)
            XCTAssertTrue(box?.detail.contains("2 tệp") == true)
        }
    }

    func testUnknownWarrantyPlaceAndNoAttachmentsGetHonestFallbacks() {
        L.withLanguage(.vi) {
            let items = ServiceChecklist.items(for: bareDevice)

            let warranty = items.first { $0.id == "paperwork.warrantyEnd" }
            let place = items.first { $0.id == "paperwork.purchasePlace" }
            let box = items.first { $0.id == "paperwork.invoiceBox" }

            XCTAssertTrue(warranty?.detail.contains("Chưa ghi ngày hết hạn bảo hành") == true)
            XCTAssertTrue(place?.detail.hasPrefix("Gọi trước") == true)
            XCTAssertTrue(box?.detail.contains("Chưa có ảnh hoá đơn") == true)
        }
    }

    func testNegativeAttachmentCountCannotBecomeNegativeCopy() {
        let device = ServiceChecklistDevice(name: "X", category: "PHONE", attachmentCount: -3)
        let box = L.withLanguage(.vi) {
            ServiceChecklist.items(for: device).first { $0.id == "paperwork.invoiceBox" }
        }
        XCTAssertTrue(box?.detail.contains("Chưa có ảnh hoá đơn") == true)
    }

    // MARK: - Category-specific pickup test

    func testPickupTestFollowsTheDeviceCategory() {
        L.withLanguage(.vi) {
            func detail(_ category: String) -> String? {
                let device = ServiceChecklistDevice(name: "X", category: category)
                return ServiceChecklist.items(for: device)
                    .first { $0.id == "pickup.testFunctions" }?.detail
            }

            XCTAssertTrue(detail("PHONE")?.contains("camera") == true)
            XCTAssertTrue(detail("tablet")?.contains("camera") == true)
            XCTAssertTrue(detail("LAPTOP")?.contains("bàn phím") == true)
            XCTAssertTrue(detail("watch")?.contains("nhịp tim") == true)
            XCTAssertTrue(detail("audio")?.contains("Bluetooth") == true)
            XCTAssertTrue(detail("tv")?.contains("HDMI") == true)
            XCTAssertTrue(detail("console")?.contains("HDMI") == true)
            XCTAssertTrue(detail("appliance")?.contains("rò nước") == true)
            XCTAssertTrue(detail("OTHER")?.contains("đúng chức năng") == true)
            XCTAssertTrue(detail("")?.contains("đúng chức năng") == true)
        }
    }

    // MARK: - Progress

    func testProgressTogglesAndCountsOnlyChecklistIDs() {
        let ids = L.withLanguage(.vi) { ServiceChecklist.items(for: fullDevice).map(\.id) }
        var progress = ServiceChecklistProgress()

        XCTAssertEqual(progress.completedCount(in: ids), 0)
        progress.toggle("data.backup")
        progress.toggle("handover.quote")
        progress.toggle("not.a.checklist.item")

        XCTAssertTrue(progress.isChecked("data.backup"))
        XCTAssertTrue(progress.isChecked("handover.quote"))
        XCTAssertFalse(progress.isChecked("security.removeLock"))
        XCTAssertEqual(progress.completedCount(in: ids), 2)

        progress.toggle("data.backup")
        XCTAssertFalse(progress.isChecked("data.backup"))
        XCTAssertEqual(progress.completedCount(in: ids), 1)

        progress.reset()
        XCTAssertTrue(progress.checkedIDs.isEmpty)
        XCTAssertEqual(progress.completedCount(in: ids), 0)
    }

    func testProgressIsPerDeviceByConstruction() {
        // `ServiceChecklistProgress` itself is just a set. The app keys one per
        // device, and this pins that the same item id is independently tickable
        // in two separate values — the structure the session store relies on.
        var first = ServiceChecklistProgress()
        var second = ServiceChecklistProgress()
        first.toggle("data.backup")

        XCTAssertTrue(first.isChecked("data.backup"))
        XCTAssertFalse(second.isChecked("data.backup"))
        second.toggle("data.backup")
        XCTAssertTrue(second.isChecked("data.backup"))
        XCTAssertEqual(first, second) // same ids checked in two independent values
        first.toggle("data.backup")
        XCTAssertNotEqual(first, second)
    }
}
