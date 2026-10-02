import Foundation
import XCTest
@testable import WarrantyVaultKit

final class ErrorsTests: KitTestCase {

    private func envelope(_ json: String) throws -> APIErrorEnvelope {
        try APIClient.decoder.decode(APIErrorEnvelope.self, from: Data(json.utf8))
    }

    func testEnvelopeDecodesAllFieldsAndOptionals() throws {
        let full = try envelope(#"""
        {
          "error": "validation_error",
          "message": "Dữ liệu không hợp lệ",
          "fieldErrors": {
            "email": ["Email không hợp lệ"],
            "password": ["Mật khẩu tối thiểu 8 ký tự", "Mật khẩu quá yếu"]
          }
        }
        """#)

        XCTAssertEqual(full.error, "validation_error")
        XCTAssertEqual(full.message, "Dữ liệu không hợp lệ")
        XCTAssertEqual(full.fieldErrors?["email"], ["Email không hợp lệ"])
        XCTAssertEqual(full.fieldErrors?["password"]?.count, 2)
        XCTAssertEqual(full.fieldErrors?["password"]?.last, "Mật khẩu quá yếu")

        let minimal = try envelope(#"{"error": "unauthorized"}"#)
        XCTAssertEqual(minimal.error, "unauthorized")
        XCTAssertNil(minimal.message)
        XCTAssertNil(minimal.fieldErrors)

        assertDecodingFails(APIErrorEnvelope.self, from: #"{"message": "Thiếu mã lỗi"}"#) { error in
            guard case .keyNotFound(let key, _) = error else {
                return XCTFail("Expected keyNotFound, got \(error)")
            }
            XCTAssertEqual(key.stringValue, "error")
        }
    }

    func testErrorDescriptionsCoverEveryCase() throws {
        XCTAssertEqual(APIError.invalidURL.errorDescription, "URL không hợp lệ")
        XCTAssertEqual(APIError.transport("Không kết nối được máy chủ").errorDescription,
                       "Không kết nối được máy chủ")
        XCTAssertEqual(APIError.decoding("The data couldn’t be read").errorDescription,
                       "Lỗi giải mã: The data couldn’t be read")

        let withMessage = APIError.server(
            status: 409,
            envelope: try envelope(#"{"error": "conflict", "message": "Đã đạt giới hạn 50 thiết bị"}"#)
        )
        XCTAssertEqual(withMessage.errorDescription, "Đã đạt giới hạn 50 thiết bị")

        let withoutMessage = APIError.server(
            status: 500,
            envelope: try envelope(#"{"error": "internal_error"}"#)
        )
        XCTAssertEqual(withoutMessage.errorDescription, "internal_error")
    }

    func testFieldErrorsAreOnlyPopulatedForServerErrors() throws {
        let server = APIError.server(
            status: 422,
            envelope: try envelope(#"""
            {"error": "validation_error", "fieldErrors": {"price": ["Giá phải lớn hơn 0"]}}
            """#)
        )
        XCTAssertEqual(server.fieldErrors, ["price": ["Giá phải lớn hơn 0"]])

        XCTAssertTrue(APIError.invalidURL.fieldErrors.isEmpty)
        XCTAssertTrue(APIError.transport("timeout").fieldErrors.isEmpty)
        XCTAssertTrue(APIError.decoding("bad json").fieldErrors.isEmpty)
        XCTAssertTrue(try APIError.server(
            status: 500,
            envelope: envelope(#"{"error": "internal_error"}"#)
        ).fieldErrors.isEmpty)
    }

    func testIsUnauthorizedMatchesOnlyStatus401() throws {
        let unauthorized = APIError.server(
            status: 401,
            envelope: try envelope(#"{"error": "unauthorized", "message": "Phiên đăng nhập đã hết hạn"}"#)
        )
        XCTAssertTrue(unauthorized.isUnauthorized)

        let forbidden = APIError.server(status: 403, envelope: try envelope(#"{"error": "forbidden"}"#))
        XCTAssertFalse(forbidden.isUnauthorized)
        XCTAssertFalse(APIError.invalidURL.isUnauthorized)
        XCTAssertFalse(APIError.transport("offline").isUnauthorized)
        XCTAssertFalse(APIError.decoding("bad json").isUnauthorized)
    }
}
