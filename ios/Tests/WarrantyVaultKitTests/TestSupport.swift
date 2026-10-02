import Foundation
import XCTest
@testable import WarrantyVaultKit

// Shared fixtures for the WarrantyVaultKit test target. Nothing here touches
// the network: every request goes through `StubURLProtocol`.

// MARK: - URLProtocol stub

/// Answers every request with a canned response and records the outgoing
/// request so tests can assert on method, path, query, headers and body.
final class StubURLProtocol: URLProtocol {

    struct Stub {
        var statusCode: Int
        var headers: [String: String]
        var body: Data
        var error: (any Error)?

        init(statusCode: Int = 200,
             headers: [String: String] = ["Content-Type": "application/json"],
             body: Data = Data(),
             error: (any Error)? = nil) {
            self.statusCode = statusCode
            self.headers = headers
            self.body = body
            self.error = error
        }

        static func json(_ raw: String, statusCode: Int = 200) -> Stub {
            Stub(statusCode: statusCode, body: Data(raw.utf8))
        }

        static func raw(_ data: Data,
                        statusCode: Int = 200,
                        contentType: String = "application/json") -> Stub {
            Stub(statusCode: statusCode, headers: ["Content-Type": contentType], body: data)
        }

        static func failure(_ error: any Error) -> Stub {
            Stub(statusCode: 0, headers: [:], body: Data(), error: error)
        }

        /// A successful response with no body (the `EmptyResponse` endpoints).
        static func empty(statusCode: Int = 204) -> Stub {
            Stub(statusCode: statusCode, body: Data())
        }
    }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var installedStub: Stub?
    nonisolated(unsafe) private static var capturedRequests: [URLRequest] = []

    /// Installs the response the next request(s) will receive.
    static func install(_ stub: Stub) {
        lock.lock()
        installedStub = stub
        lock.unlock()
    }

    /// Clears both the installed stub and the recorded requests.
    static func reset() {
        lock.lock()
        installedStub = nil
        capturedRequests = []
        lock.unlock()
    }

    static var requests: [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return capturedRequests
    }

    static var lastRequest: URLRequest? { requests.last }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        StubURLProtocol.lock.lock()
        StubURLProtocol.capturedRequests.append(request)
        let stub = StubURLProtocol.installedStub
        StubURLProtocol.lock.unlock()

        guard let stub else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        if let error = stub.error {
            client?.urlProtocol(self, didFailWithError: error)
            return
        }
        guard let url = request.url,
              let response = HTTPURLResponse(url: url,
                                             statusCode: stub.statusCode,
                                             httpVersion: "HTTP/1.1",
                                             headerFields: stub.headers) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if !stub.body.isEmpty {
            client?.urlProtocol(self, didLoad: stub.body)
        }
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

// MARK: - Helpers

/// Builds an `APIClient` backed by an ephemeral session wired to `StubURLProtocol`.
func makeStubbedClient(token: String? = nil,
                       baseURL: String = "https://api.example.test") -> APIClient {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StubURLProtocol.self]
    let session = URLSession(configuration: configuration)
    return APIClient(baseURL: URL(string: baseURL)!,
                     session: session,
                     tokenProvider: { token })
}

/// Runs `operation`, requiring that it throws an `APIError`, and returns it.
@discardableResult
func captureAPIError<T>(file: StaticString = #filePath,
                        line: UInt = #line,
                        _ operation: () async throws -> T) async -> APIError? {
    do {
        _ = try await operation()
        XCTFail("Expected an APIError to be thrown, but the call succeeded", file: file, line: line)
        return nil
    } catch let error as APIError {
        return error
    } catch {
        XCTFail("Expected APIError, got \(Swift.type(of: error)): \(error)", file: file, line: line)
        return nil
    }
}

/// Requires that decoding `json` as `type` fails, then hands the `DecodingError`
/// to `inspect` for finer assertions.
func assertDecodingFails<T: Decodable>(_ type: T.Type,
                                       from json: String,
                                       file: StaticString = #filePath,
                                       line: UInt = #line,
                                       _ inspect: (DecodingError) -> Void = { _ in }) {
    do {
        _ = try APIClient.decoder.decode(T.self, from: Data(json.utf8))
        XCTFail("Expected decoding \(T.self) to fail", file: file, line: line)
    } catch let error as DecodingError {
        inspect(error)
    } catch {
        XCTFail("Expected DecodingError, got \(Swift.type(of: error)): \(error)", file: file, line: line)
    }
}

/// A date built with the same lenient, locale-independent rules the client's
/// parser uses, so assertions stay correct in any time zone.
func makeDate(_ string: String, format: String, timeZone: TimeZone? = nil) -> Date {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = format
    if let timeZone { formatter.timeZone = timeZone }
    return formatter.date(from: string)!
}

/// Query items of the last recorded request, keyed by name.
func queryItems(of request: URLRequest) -> [String: String] {
    guard let url = request.url,
          let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
        return [:]
    }
    var result: [String: String] = [:]
    for item in components.queryItems ?? [] {
        result[item.name] = item.value
    }
    return result
}

extension URLRequest {
    /// Body bytes, whether the request carried them inline (`httpBody`) or as
    /// an upload stream (`httpBodyStream`, used by `URLSession.upload`).
    var capturedBody: Data {
        if let httpBody { return httpBody }
        guard let stream = httpBodyStream else { return Data() }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: buffer.count)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }

    /// Decoded JSON object of the request body.
    func jsonBody() throws -> [String: Any] {
        let object = try JSONSerialization.jsonObject(with: capturedBody)
        return try XCTUnwrap(object as? [String: Any])
    }
}

/// Base class so every test starts with a clean stub and no recorded requests.
class KitTestCase: XCTestCase {
    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
    }

    override func tearDown() {
        StubURLProtocol.reset()
        super.tearDown()
    }
}

// MARK: - Shared JSON fixtures

enum Fixtures {
    static let device = #"""
    {
      "id": "dev_1",
      "userId": "usr_1",
      "name": "MacBook Pro 14",
      "category": "LAPTOP",
      "brand": "Apple",
      "model": "M3 Pro",
      "serialNumber": "SN-12345",
      "purchaseDate": "2025-03-12T00:00:00Z",
      "purchasePrice": 49990000,
      "purchasePlace": "FPT Shop",
      "status": "ACTIVE",
      "notes": "Mua kèm AppleCare",
      "createdAt": "2025-03-12T09:30:00Z",
      "updatedAt": "2025-04-01T10:00:00Z"
    }
    """#

    static let subscription = #"""
    {
      "id": "sub_1",
      "name": "iCloud+ 200GB",
      "category": "CLOUD",
      "brand": "Apple",
      "plan": "200GB",
      "billingCycle": "MONTHLY",
      "intervalDays": null,
      "price": 59000,
      "currency": "VND",
      "startedAt": "2025-01-05T00:00:00Z",
      "renewalDate": "2025-06-05T00:00:00Z",
      "autoRenew": true,
      "status": "ACTIVE",
      "accountEmail": "trung@example.vn",
      "paymentMethod": "Apple ID",
      "manageUrl": "https://appleid.apple.com",
      "cancelUrl": null,
      "notes": null
    }
    """#

    static let wishlistItem = #"""
    {
      "id": "wish_1",
      "name": "AirPods Pro 2",
      "category": "AUDIO",
      "brand": "Apple",
      "initialPrice": 6190000,
      "currentPrice": 5490000,
      "buyUrl": "https://shopee.vn/airpods",
      "imageUrl": null,
      "targetDate": "2025-12-31T00:00:00Z",
      "priority": "WANT",
      "status": "WATCHING",
      "notes": "Chờ sale 12/12",
      "reminderIntervalDays": 7,
      "purchasedDeviceId": null
    }
    """#
}
