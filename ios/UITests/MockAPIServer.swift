import Foundation
import Network

// MARK: - UI-test fixtures

/// The values every UI test can rely on. The mock server serves these and the
/// tests assert them, so they live in exactly one place.
enum UITestFixtures {
    static let userID = "usr_qa"
    static let userEmail = "qa@warrly.test"
    static let userName = "Warrly QA"
    /// The mock login accepts any non-empty password for `userEmail`; this is
    /// the one the tests type.
    static let password = "qa-password"
    static let accessToken = "qa-access-token"

    static let deviceID = "dev_qa_1"
    static let deviceName = "MacBook Pro QA"
    static let deviceCategory = "LAPTOP"
    static let deviceBrand = "Apple"
    static let deviceModel = "MacBook Pro 14"
    static let deviceCurrency = "USD"
    static let devicePurchasePrice = 999
    static let deviceFxRate = 26_130
    static let devicePurchasePriceVnd = 26_103_870

    /// Market rate returned by `GET /fx/rates?base=USD`. Deliberately
    /// different from `deviceFxRate`, which is locked at purchase time: a test
    /// can prove the app shows the locked rate for history and the market rate
    /// only as a reference.
    static let marketUsdVnd = 26_500
}

/// Fixture selection for one test run. The app never reads this — it is a
/// test-side switch over which deterministic payloads the mock server serves.
/// Named raw values match the `-ui-testing-scenario` argument the test helpers
/// pass, although the app ignores that argument.
enum UITestScenario: String, CaseIterable {
    case loggedOut = "logged-out"
    case dashboard
    case deviceUsdFx = "device-usd-fx"
    case settingsFree = "settings-free"
    case premiumIneligible = "premium-ineligible"
    case premiumEligible = "premium-eligible"

    /// `GET /auth/me`'s `user.premium` bit. The paywall's StoreKit products and
    /// intro-eligibility are not part of this mock (see README).
    var isPremium: Bool { self == .premiumEligible }
}

// MARK: - Mock server

/// A tiny HTTP/1.1 server that runs **inside the UI-test runner** and answers
/// the endpoints the launch screens call. The app under test reaches it over
/// loopback, so the same code works on a simulator and on a physical iPhone:
/// both processes run on the same device and share the loopback interface.
///
/// The listener binds `127.0.0.1` on an ephemeral port and the test passes
/// `http://localhost:<port>` to the app through `WV_API_BASE_URL`; the app's
/// existing ATS exception covers `localhost` (an IP literal is deliberately not
/// used because the info.plist exception is keyed by hostname and production is
/// not loosened for tests).
///
/// Responses are static, deterministic JSON matching `openapi.yaml`. No request
/// leaves the device, no real account is used, and nothing is written to the
/// production API.
final class MockAPIServer {

    enum ServerError: Error, CustomStringConvertible {
        case failedToStart(String)
        case timedOut

        var description: String {
            switch self {
            case .failedToStart(let reason): return "Mock API failed to start: \(reason)"
            case .timedOut: return "Mock API did not become ready within 10 seconds."
            }
        }
    }

    let scenario: UITestScenario

    private let queue = DispatchQueue(label: "com.warrly.uitests.mock-api")
    private var listener: NWListener?
    private let ready = DispatchSemaphore(value: 0)
    private var startFailure: String?

    /// `http://localhost:<port>`, valid only after ``start()`` returned.
    private(set) var baseURL = URL(string: "http://localhost:0")!
    private(set) var port: UInt16 = 0

    init(scenario: UITestScenario = .dashboard) {
        self.scenario = scenario
    }

    deinit {
        listener?.cancel()
    }

    // MARK: Lifecycle

    /// Starts listening and blocks until the kernel has assigned the port.
    func start() throws {
        stop()

        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        // Loopback only: the mock is not reachable from the LAN, which is the
        // point — this is a test double, not a service.
        parameters.requiredLocalEndpoint = NWEndpoint.hostPort(
            host: "127.0.0.1", port: .any
        )

        let listener: NWListener
        do {
            listener = try NWListener(using: parameters)
        } catch {
            throw ServerError.failedToStart(error.localizedDescription)
        }

        listener.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                self.ready.signal()
            case .failed(let error):
                self.startFailure = error.localizedDescription
                self.ready.signal()
            default:
                break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }

        self.listener = listener
        listener.start(queue: queue)

        guard ready.wait(timeout: .now() + 10) == .success else {
            listener.cancel()
            self.listener = nil
            throw ServerError.timedOut
        }
        if let failure = startFailure {
            listener.cancel()
            self.listener = nil
            throw ServerError.failedToStart(failure)
        }
        guard let assignedPort = listener.port?.rawValue else {
            listener.cancel()
            self.listener = nil
            throw ServerError.failedToStart("the listener reported no port")
        }
        port = assignedPort
        baseURL = URL(string: "http://localhost:\(assignedPort)")!
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    // MARK: Connection handling

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(on: connection, buffer: Data())
    }

    private func receive(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) {
            [weak self] chunk, _, isComplete, error in
            guard let self else {
                connection.cancel()
                return
            }
            var accumulated = buffer
            if let chunk { accumulated.append(chunk) }

            if let request = HTTPRequest.parse(accumulated) {
                let response = self.response(for: request)
                connection.send(content: response,
                                completion: .contentProcessed { _ in connection.cancel() })
                return
            }

            // A request is incomplete. Give up on a closed/garbage connection
            // rather than looping forever on a client that never sends the
            // terminating blank line.
            if isComplete || error != nil || accumulated.count > 1_000_000 {
                connection.cancel()
                return
            }
            self.receive(on: connection, buffer: accumulated)
        }
    }

    // MARK: Routing

    private func response(for request: HTTPRequest) -> Data {
        let route = request.path

        switch (request.method, route) {
        case ("POST", "/api/v1/auth/login"):
            return json(200, "OK", loginResponse())

        case ("GET", "/api/v1/auth/me"):
            return json(200, "OK", "{\"user\":\(userJSON())}")

        case ("POST", "/api/v1/auth/logout"):
            return json(200, "OK", "{}")

        case ("GET", "/api/v1/devices"):
            return json(200, "OK", "{\"devices\":[\(deviceJSON())]}")

        case ("GET", "/api/v1/devices/\(UITestFixtures.deviceID)"):
            return json(200, "OK", "{\"device\":\(deviceDetailJSON())}")

        case ("GET", "/api/v1/stats"):
            return json(200, "OK", statsJSON())

        case ("GET", "/api/v1/reminders"):
            return json(200, "OK", "{\"reminders\":[\(reminderJSON())]}")

        case ("GET", "/api/v1/subscriptions"):
            return json(200, "OK", "{\"subscriptions\":[]}")

        case ("GET", "/api/v1/wishlist"):
            return json(200, "OK", "{\"items\":[]}")

        case ("GET", "/api/v1/staples"):
            return json(200, "OK", "{\"items\":[]}")

        case ("GET", "/api/v1/fx/rates"):
            let base = request.query["base"]?.uppercased() ?? "USD"
            return json(200, "OK", fxRatesJSON(base: base))

        case ("GET", "/api/v1/ai/opt-in"):
            return json(200, "OK", "{\"aiOptIn\":false}")

        case ("GET", "/api/v1/catalog"):
            return json(200, "OK",
                        "{\"categories\":[],\"brands\":[],\"stores\":[],"
                        + "\"warrantyProviders\":[]}")

        case ("GET", "/api/v1/actions"):
            return json(200, "OK", actionsJSON())

        case ("GET", "/api/v1/inbox"):
            return json(200, "OK", "{\"attachments\":[]}")

        case ("GET", "/api/v1/push"):
            return json(200, "OK", "{\"subscriptions\":[]}")

        case ("POST", "/api/v1/push/register"):
            return json(200, "OK", "{}")

        default:
            return json(404, "Not Found",
                        "{\"error\":\"not_found\",\"message\":\"No mock route for "
                        + "\(escape("\(request.method) \(route)"))\")}")
        }
    }

    // MARK: Response envelope

    private func json(_ status: Int, _ reason: String, _ body: String) -> Data {
        let payload = Data(body.utf8)
        var head = "HTTP/1.1 \(status) \(reason)\r\n"
        head += "Content-Type: application/json; charset=utf-8\r\n"
        head += "Content-Length: \(payload.count)\r\n"
        head += "Connection: close\r\n"
        head += "\r\n"
        var data = Data(head.utf8)
        data.append(payload)
        return data
    }

    // MARK: Fixtures

    private func userJSON() -> String {
        """
        {"id":"\(UITestFixtures.userID)","email":"\(UITestFixtures.userEmail)","name":"\(UITestFixtures.userName)","aiOptIn":false,"reminderEmailFallback":false,"premium":\(scenario.isPremium),"locale":"vi"}
        """
    }

    private func loginResponse() -> String {
        """
        {"accessToken":"\(UITestFixtures.accessToken)","expiresAt":"\(wireDate(Date().addingTimeInterval(3600)))","user":\(userJSON())}
        """
    }

    /// Dates are relative to the request so the dashboard always has one
    /// deadline inside its window, no matter when the suite runs.
    private func warrantyEnd() -> Date { Date().addingTimeInterval(20 * 24 * 60 * 60) }
    private func warrantyStart() -> Date { Date().addingTimeInterval(-345 * 24 * 60 * 60) }

    private func warrantyJSON() -> String {
        """
        {"id":"war_qa_1","deviceId":"\(UITestFixtures.deviceID)","type":"STANDARD","provider":"Apple","startDate":"\(wireDate(warrantyStart()))","endDate":"\(wireDate(warrantyEnd()))","months":12,"cost":0}
        """
    }

    private func deviceJSON() -> String {
        let purchased = "2026-01-15T00:00:00Z"
        return """
        {"id":"\(UITestFixtures.deviceID)","userId":"\(UITestFixtures.userID)","name":"\(UITestFixtures.deviceName)","category":"\(UITestFixtures.deviceCategory)","brand":"\(UITestFixtures.deviceBrand)","model":"\(UITestFixtures.deviceModel)","serialNumber":"QAX1234567","purchaseDate":"\(purchased)","purchasePrice":\(UITestFixtures.devicePurchasePrice),"purchasePlace":"QA Store","status":"ACTIVE","notes":"UI-test fixture","createdAt":"\(purchased)","updatedAt":"\(purchased)","currency":"\(UITestFixtures.deviceCurrency)","fxRate":\(UITestFixtures.deviceFxRate),"purchasePriceVnd":\(UITestFixtures.devicePurchasePriceVnd),"leadDays":[30,7],"warranties":[\(warrantyJSON())]}
        """
    }

    private func deviceDetailJSON() -> String {
        // The detail read embeds the device and its warranties plus the fields
        // the detail screen computes. Optional keys are omitted deliberately:
        // the app must keep decoding a payload that predates them.
        let purchased = "2026-01-15T00:00:00Z"
        return """
        {"id":"\(UITestFixtures.deviceID)","name":"\(UITestFixtures.deviceName)","category":"\(UITestFixtures.deviceCategory)","brand":"\(UITestFixtures.deviceBrand)","model":"\(UITestFixtures.deviceModel)","serialNumber":"QAX1234567","purchaseDate":"\(purchased)","purchasePrice":\(UITestFixtures.devicePurchasePrice),"purchasePlace":"QA Store","status":"ACTIVE","notes":"UI-test fixture","currency":"\(UITestFixtures.deviceCurrency)","fxRate":\(UITestFixtures.deviceFxRate),"purchasePriceVnd":\(UITestFixtures.devicePurchasePriceVnd),"leadDays":[30,7],"attachments":[],"warranties":[\(warrantyJSON())],"effectiveWarrantyEnd":"\(wireDate(warrantyEnd()))","repairExtensionDays":0,"entitledWarrantyEnd":"\(wireDate(warrantyEnd()))"}
        """
    }

    private func reminderJSON() -> String {
        """
        {"id":"rem_qa_1","deviceId":"\(UITestFixtures.deviceID)","device":{"id":"\(UITestFixtures.deviceID)","name":"\(UITestFixtures.deviceName)","category":"\(UITestFixtures.deviceCategory)","status":"ACTIVE"},"type":"STANDARD","provider":"Apple","startDate":"\(wireDate(warrantyStart()))","endDate":"\(wireDate(warrantyEnd()))","months":12,"repairExtensionDays":0,"entitledWarrantyEnd":"\(wireDate(warrantyEnd()))"}
        """
    }

    private func statsJSON() -> String {
        """
        {"devices":{"total":1,"byStatus":{"ACTIVE":1},"totalPurchasePrice":\(UITestFixtures.devicePurchasePrice),"totalWarrantyCost":0},"subscriptions":{"total":0,"byStatus":{},"totalMonthlyVnd":0},"wishlist":{"total":0,"byStatus":{},"totalCurrentPriceWatching":0}}
        """
    }

    private func fxRatesJSON(base: String) -> String {
        """
        {"base":"\(escape(base))","rates":{"VND":\(UITestFixtures.marketUsdVnd)},"fetchedAt":"2026-11-20T08:00:00Z","stale":false,"source":"qa.mock"}
        """
    }

    private func actionsJSON() -> String {
        """
        {"generatedAt":"\(wireDate(Date()))","items":[],"counts":{"total":0,"high":0,"medium":0,"low":0},"snoozedCount":0,"note":"UI-test mock"}
        """
    }

    // MARK: Helpers

    private func wireDate(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: date)
    }

    private func escape(_ value: String) -> String {
        var escaped = value
        escaped = escaped.replacingOccurrences(of: "\\", with: "\\\\")
        escaped = escaped.replacingOccurrences(of: "\"", with: "\\\"")
        return escaped
    }
}

// MARK: - Minimal HTTP request parsing

private struct HTTPRequest {
    let method: String
    let path: String
    let query: [String: String]
    let body: Data

    /// Returns `nil` while the request is still incomplete; the caller reads
    /// more bytes and tries again.
    static func parse(_ data: Data) -> HTTPRequest? {
        let separator = Data("\r\n\r\n".utf8)
        guard let headerEnd = data.range(of: separator) else { return nil }

        let headerData = data.subdata(in: data.startIndex..<headerEnd.lowerBound)
        guard let headerText = String(data: headerData, encoding: .utf8) else {
            return nil
        }
        var lines = headerText.components(separatedBy: "\r\n")
        guard !lines.isEmpty, !lines[0].isEmpty else { return nil }

        let requestLine = lines.removeFirst()
        let parts = requestLine.split(separator: " ", maxSplits: 2,
                                      omittingEmptySubsequences: true)
        guard parts.count >= 2 else { return nil }
        let method = String(parts[0]).uppercased()
        let target = String(parts[1])

        var headers: [String: String] = [:]
        for line in lines {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = line[..<colon]
                .trimmingCharacters(in: .whitespaces)
                .lowercased()
            let value = line[line.index(after: colon)...]
                .trimmingCharacters(in: .whitespaces)
            headers[name] = value
        }

        let contentLength = Int(headers["content-length"] ?? "0") ?? 0
        let bodyStart = headerEnd.upperBound
        let available = data.count - (bodyStart - data.startIndex)
        guard available >= contentLength else { return nil }
        let body = data.subdata(in: bodyStart..<(bodyStart + contentLength))

        let targetParts = target.split(separator: "?", maxSplits: 1,
                                       omittingEmptySubsequences: false)
        let path = String(targetParts[0])
        var query: [String: String] = [:]
        if targetParts.count == 2 {
            for pair in targetParts[1].split(separator: "&") {
                let kv = pair.split(separator: "=", maxSplits: 1,
                                    omittingEmptySubsequences: false)
                guard let key = kv.first else { continue }
                let value = kv.count == 2 ? String(kv[1]) : ""
                query[String(key)] = value
            }
        }

        return HTTPRequest(method: method, path: path, query: query, body: body)
    }
}
