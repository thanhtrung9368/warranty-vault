import Foundation
import XCTest
@testable import WarrantyVaultKit

/// `CategoryLabels` must stay byte-for-byte in sync with `CATEGORY_LABELS` in
/// `website/src/lib/types.ts` (and the Android copy). The map is duplicated per
/// client because list/chart payloads only carry the category *code*.
final class CategoryLabelsTests: KitTestCase {

    func testEveryCatalogCodeHasTheWebVietnameseLabel() {
        let expected: [String: String] = [
            "PHONE": "Điện thoại",
            "LAPTOP": "Laptop",
            "TABLET": "Máy tính bảng",
            "SMARTWATCH": "Đồng hồ thông minh",
            "HEADPHONE": "Tai nghe",
            "SPEAKER": "Loa",
            "CAMERA": "Máy ảnh / Quay phim",
            "TV": "Tivi",
            "MONITOR": "Màn hình",
            "KEYBOARD": "Bàn phím",
            "MOUSE": "Chuột",
            "GAMING_CONSOLE": "Máy chơi game",
            "AC": "Điều hòa",
            "FRIDGE": "Tủ lạnh",
            "WASHING": "Máy giặt / Sấy",
            "KITCHEN": "Đồ nhà bếp",
            "APPLIANCE": "Đồ gia dụng khác",
            "ELECTRONICS": "Điện tử khác",
            "FURNITURE": "Nội thất",
            "OTHER": "Khác",
        ]

        XCTAssertEqual(CategoryLabels.table, expected)
        for (code, label) in expected {
            XCTAssertEqual(CategoryLabels.label(for: code), label, "code \(code)")
        }
    }

    func testLookupIsCaseInsensitiveForLegacyLowercaseCodes() {
        XCTAssertEqual(CategoryLabels.label(for: "laptop"), "Laptop")
        XCTAssertEqual(CategoryLabels.label(for: "gaming_console"), "Máy chơi game")
    }

    func testUnknownCodeFallsBackToTheRawCode() {
        XCTAssertEqual(CategoryLabels.label(for: "DRONE"), "DRONE")
    }

    func testMissingOrEmptyCodeFallsBackToKhac() {
        XCTAssertEqual(CategoryLabels.label(for: nil), "Khác")
        XCTAssertEqual(CategoryLabels.label(for: ""), "Khác")
    }
}
