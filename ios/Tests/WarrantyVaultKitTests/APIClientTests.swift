import Foundation
import XCTest
@testable import WarrantyVaultKit

/// Exercises `APIClient`'s request pipeline (headers, status handling, JSON
/// decoding, date parsing, multipart) against `StubURLProtocol` — no real
/// network traffic.
final class APIClientTests: KitTestCase {

    func testSuccessfulRequestDecodesBodyAndSendsJSONHeaders() async throws {
        StubURLProtocol.install(.json(#"{"categories": [], "brands": [], "stores": [], "warrantyProviders": []}"#))
        let client = makeStubbedClient(token: "tok_abc")

        let catalog = try await client.catalog()

        XCTAssertTrue(catalog.categories.isEmpty)
        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "application/json")
        XCTAssertNil(request.value(forHTTPHeaderField: "Content-Type"),
                     "GET without a body must not declare a content type")
    }

    func testServerErrorAndUnauthorizedResponsesMapToTypedErrors() async throws {
        let client = makeStubbedClient(token: "tok_abc")

        StubURLProtocol.install(.json(#"""
        {"error": "validation_error", "message": "Dữ liệu không hợp lệ",
         "fieldErrors": {"price": ["Giá phải lớn hơn 0"]}}
        """#, statusCode: 422))
        var error = await captureAPIError { try await client.deleteDevice(id: "dev_1") }
        guard case .server(let status, let envelope) = error else {
            return XCTFail("Expected .server, got \(String(describing: error))")
        }
        XCTAssertEqual(status, 422)
        XCTAssertEqual(envelope.error, "validation_error")
        XCTAssertEqual(error?.errorDescription, "Dữ liệu không hợp lệ")
        XCTAssertEqual(error?.fieldErrors, ["price": ["Giá phải lớn hơn 0"]])
        XCTAssertFalse(error?.isUnauthorized ?? true)

        StubURLProtocol.install(.json(#"""
        {"error": "unauthorized", "message": "Phiên đăng nhập đã hết hạn"}
        """#, statusCode: 401))
        error = await captureAPIError { try await client.me() }
        XCTAssertTrue(error?.isUnauthorized ?? false)
        XCTAssertEqual(error?.errorDescription, "Phiên đăng nhập đã hết hạn")
    }

    func testNonJSONErrorBodyFallsBackToUnknownEnvelope() async throws {
        StubURLProtocol.install(.raw(Data("<html>502 Bad Gateway</html>".utf8),
                                     statusCode: 502,
                                     contentType: "text/html"))
        let client = makeStubbedClient(token: "tok_abc")

        let error = await captureAPIError { try await client.getStats() }

        guard case .server(let status, let envelope) = error else {
            return XCTFail("Expected .server, got \(String(describing: error))")
        }
        XCTAssertEqual(status, 502)
        XCTAssertEqual(envelope.error, "unknown")
        XCTAssertNil(envelope.message)
        XCTAssertEqual(error?.errorDescription, "unknown")
    }

    func testMalformedSuccessBodyThrowsDecodingError() async throws {
        StubURLProtocol.install(.json(#"{"devices": "not-an-array"}"#))
        let client = makeStubbedClient(token: "tok_abc")

        let error = await captureAPIError { try await client.listDevices() }

        guard case .decoding(let message) = error else {
            return XCTFail("Expected .decoding, got \(String(describing: error))")
        }
        XCTAssertFalse(message.isEmpty)
        XCTAssertEqual(error?.errorDescription, "Lỗi giải mã: \(message)")
    }

    func testDateDecodingAcceptsEveryAPIShape() throws {
        func purchaseDate(_ raw: String) throws -> Date {
            let device = try APIClient.decoder.decode(Device.self, from: Data(#"""
            {"id": "dev_1", "name": "Thiết bị", "category": "HOME",
             "purchaseDate": "\#(raw)", "purchasePrice": 0, "status": "ACTIVE"}
            """#.utf8))
            return device.purchaseDate
        }

        let utc = TimeZone(identifier: "UTC")
        XCTAssertEqual(try purchaseDate("2025-03-12T00:00:00Z"),
                       makeDate("2025-03-12T00:00:00Z", format: "yyyy-MM-dd'T'HH:mm:ssZZZZZ",
                                timeZone: utc))
        XCTAssertEqual(try purchaseDate("2025-03-12T07:00:00+07:00"),
                       makeDate("2025-03-12T00:00:00Z", format: "yyyy-MM-dd'T'HH:mm:ssZZZZZ",
                                timeZone: utc))
        XCTAssertEqual(try purchaseDate("2025-03-12T00:00:00.500Z"),
                       makeDate("2025-03-12T00:00:00.500Z", format: "yyyy-MM-dd'T'HH:mm:ss.SSSZZZZZ",
                                timeZone: utc))
        XCTAssertEqual(try purchaseDate("2025-03-12T00:00:00.500"),
                       makeDate("2025-03-12T00:00:00.500", format: "yyyy-MM-dd'T'HH:mm:ss.SSS"))
        XCTAssertEqual(try purchaseDate("2025-03-12T00:00:00"),
                       makeDate("2025-03-12T00:00:00", format: "yyyy-MM-dd'T'HH:mm:ss"))
        XCTAssertEqual(try purchaseDate("2025-03-12"), makeDate("2025-03-12", format: "yyyy-MM-dd"))

        // The Go API can emit nanosecond precision; the ladder clamps to millis.
        XCTAssertEqual(APIClient.DateFormatters.parse("2025-03-12T00:00:00.123456789Z"),
                       makeDate("2025-03-12T00:00:00.123Z", format: "yyyy-MM-dd'T'HH:mm:ss.SSSZZZZZ",
                                timeZone: utc))
        XCTAssertNil(APIClient.DateFormatters.parse("12/03/2025"))
        XCTAssertNil(APIClient.DateFormatters.parse(""))
    }

    func testTransportFailurePropagatesURLError() async throws {
        StubURLProtocol.install(.failure(URLError(.notConnectedToInternet)))
        let client = makeStubbedClient(token: "tok_abc")

        do {
            _ = try await client.listDevices()
            XCTFail("Expected the request to fail")
        } catch let error as URLError {
            XCTAssertEqual(error.code, .notConnectedToInternet)
        } catch {
            XCTFail("Expected URLError, got \(type(of: error)): \(error)")
        }
    }

    func testEmptyResponseSkipsDecodingOfEmptyBody() async throws {
        StubURLProtocol.install(.empty(statusCode: 204))
        let client = makeStubbedClient(token: "tok_abc")

        try await client.logout()

        XCTAssertEqual(StubURLProtocol.lastRequest?.url?.path, "/api/v1/auth/logout")
    }

    func testRawDataRequestForwardsBodyVerbatimWithCustomContentType() async throws {
        let payload = Data([0x50, 0x4B, 0x03, 0x04, 0xFF, 0x00])  // arbitrary binary bytes
        StubURLProtocol.install(.raw(Data(#"{"ok": true}"#.utf8)))
        let client = makeStubbedClient(token: "tok_abc")

        let response = try await client.rawDataRequest(
            "PUT", "/api/v1/backup/import",
            query: [URLQueryItem(name: "mode", value: "replace")],
            rawBody: payload,
            contentType: "application/octet-stream"
        )

        XCTAssertEqual(response, Data(#"{"ok": true}"#.utf8))
        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "PUT")
        XCTAssertEqual(queryItems(of: request), ["mode": "replace"])
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/octet-stream")
        XCTAssertEqual(request.capturedBody, payload, "raw bytes must not be re-encoded")
    }

    func testMultipartUploadSendsFilePartAndMapsServerError() async throws {
        let client = makeStubbedClient(token: "tok_abc")
        let fileBytes = Data("hoa-don-noi-dung".utf8)

        StubURLProtocol.install(.json(#"""
        {"attachment": {"id": "att_9", "fileName": "hoa-don.jpg", "fileType": "image/jpeg",
                        "fileSize": 16, "description": "Hoá đơn", "uploadedAt": "2025-03-13T08:00:00Z"}}
        """#))
        let attachment = try await client.uploadAttachment(
            deviceId: "dev_1", fileName: "hoa-don.jpg", fileType: "image/jpeg",
            data: fileBytes, description: "Hoá đơn"
        )

        XCTAssertEqual(attachment.id, "att_9")
        XCTAssertEqual(attachment.fileName, "hoa-don.jpg")
        var request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/v1/devices/dev_1/attachments")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok_abc")

        let contentType = try XCTUnwrap(request.value(forHTTPHeaderField: "Content-Type"))
        XCTAssertTrue(contentType.hasPrefix("multipart/form-data; boundary=----WV-"),
                      "unexpected content type: \(contentType)")
        let boundary = String(contentType.dropFirst("multipart/form-data; boundary=".count))

        let body = request.capturedBody
        let bodyText = try XCTUnwrap(String(data: body, encoding: .utf8))
        XCTAssertTrue(bodyText.contains("--\(boundary)\r\n"))
        XCTAssertTrue(bodyText.contains(#"Content-Disposition: form-data; name="description""#))
        XCTAssertTrue(bodyText.contains("Hoá đơn"))
        XCTAssertTrue(bodyText.contains(#"Content-Disposition: form-data; name="file"; filename="hoa-don.jpg""#))
        XCTAssertTrue(bodyText.contains("Content-Type: image/jpeg"))
        XCTAssertTrue(bodyText.contains("--\(boundary)--\r\n"), "multipart body must be terminated")
        XCTAssertTrue(body.range(of: fileBytes) != nil, "file bytes must appear verbatim in the body")

        // A failed upload surfaces the standard error envelope.
        StubURLProtocol.install(.json(#"{"error": "payload_too_large", "message": "Tệp vượt quá 5 MB"}"#,
                                      statusCode: 413))
        let error = await captureAPIError {
            try await client.uploadAttachment(deviceId: "dev_1", fileName: "to.pdf",
                                              fileType: "application/pdf", data: fileBytes)
        }
        guard case .server(let status, let envelope) = error else {
            return XCTFail("Expected .server, got \(String(describing: error))")
        }
        XCTAssertEqual(status, 413)
        XCTAssertEqual(envelope.error, "payload_too_large")
        XCTAssertEqual(error?.errorDescription, "Tệp vượt quá 5 MB")
    }
}
