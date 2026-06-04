import Foundation

// Async/await HTTP client. Stateless w.r.t. auth — pass the token in via
// `tokenProvider` so the AuthStore in the app layer can swap it on
// login/logout without rebuilding the client.

public actor APIClient {
    public let baseURL: URL
    private let session: URLSession
    private let tokenProvider: @Sendable () async -> String?

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        tokenProvider: @escaping @Sendable () async -> String? = { nil }
    ) {
        self.baseURL = baseURL
        self.session = session
        self.tokenProvider = tokenProvider
    }

    // MARK: - JSON encoders/decoders (shared, ISO-8601 with fractional seconds)

    nonisolated static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .useDefaultKeys
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    nonisolated static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .useDefaultKeys
        d.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let str = try container.decode(String.self)
            if let date = DateFormatters.parse(str) { return date }
            throw DecodingError.dataCorruptedError(
                in: container, debugDescription: "Unrecognized date: \(str)"
            )
        }
        return d
    }()

    // Cached date parsers. The Go API emits timestamps in several shapes —
    // RFC3339 with a `Z` (`2026-03-12T00:00:00Z`), offset-less local time
    // (`2025-03-12T00:00:00`, `2026-05-22T21:05:12.687`), and bare dates
    // (`2025-03-12`). ISO8601DateFormatter rejects the offset-less forms, so
    // we use a fixed-format DateFormatter ladder instead. Built once; each
    // formatter is immutable after setup and safe for concurrent reads.
    enum DateFormatters {
        // Widest-first. en_US_POSIX keeps parsing locale-independent; no
        // timeZone is set, so offset-less strings parse in the device zone —
        // the same lenient behavior as the web's `new Date(...)`.
        private static let formatters: [DateFormatter] = [
            "yyyy-MM-dd'T'HH:mm:ss.SSSZZZZZ",
            "yyyy-MM-dd'T'HH:mm:ssZZZZZ",
            "yyyy-MM-dd'T'HH:mm:ss.SSS",
            "yyyy-MM-dd'T'HH:mm:ss",
            "yyyy-MM-dd",
        ].map { pattern in
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.dateFormat = pattern
            return f
        }

        /// Parses an API date string. Fractional seconds are first clamped to
        /// 3 digits because `DateFormatter` rejects longer precision.
        static func parse(_ raw: String) -> Date? {
            let str = raw.replacingOccurrences(
                of: #"\.(\d{3})\d+"#, with: ".$1", options: .regularExpression)
            for formatter in formatters {
                if let date = formatter.date(from: str) { return date }
            }
            return nil
        }
    }

    // MARK: - Core request

    func request<Out: Decodable>(
        _ method: String,
        _ path: String,
        query: [URLQueryItem] = [],
        body: Encodable? = nil,
        authenticated: Bool = true,
        as outType: Out.Type = Out.self
    ) async throws -> Out {
        let data = try await rawRequest(
            method, path, query: query, body: body, authenticated: authenticated
        )
        if Out.self == EmptyResponse.self {
            return EmptyResponse() as! Out
        }
        do {
            return try Self.decoder.decode(Out.self, from: data)
        } catch {
            throw APIError.decoding(error.localizedDescription)
        }
    }

    func rawRequest(
        _ method: String,
        _ path: String,
        query: [URLQueryItem] = [],
        body: Encodable? = nil,
        authenticated: Bool = true
    ) async throws -> Data {
        var components = URLComponents(
            url: baseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )!
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw APIError.invalidURL }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")

        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try Self.encoder.encode(AnyEncodable(body))
        }

        if authenticated, let token = await tokenProvider() {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.transport("Invalid response")
        }

        if (200...299).contains(http.statusCode) { return data }

        // Try to parse our standard error envelope.
        if let envelope = try? Self.decoder.decode(APIErrorEnvelope.self, from: data) {
            throw APIError.server(status: http.statusCode, envelope: envelope)
        }
        throw APIError.server(
            status: http.statusCode,
            envelope: APIErrorEnvelope(error: "unknown", message: nil, fieldErrors: nil)
        )
    }

    // MARK: - Multipart upload (for attachments)

    func uploadMultipart<Out: Decodable>(
        _ path: String,
        fileName: String,
        fileType: String,
        fileData: Data,
        description: String? = nil,
        as outType: Out.Type = Out.self
    ) async throws -> Out {
        let url = baseURL.appendingPathComponent(path)
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        let boundary = "----WV-\(UUID().uuidString)"
        req.setValue("multipart/form-data; boundary=\(boundary)",
                     forHTTPHeaderField: "Content-Type")
        if let token = await tokenProvider() {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        var body = Data()
        let crlf = "\r\n".data(using: .utf8)!
        if let description, !description.isEmpty {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"description\"\r\n\r\n"
                .data(using: .utf8)!)
            body.append(description.data(using: .utf8)!)
            body.append(crlf)
        }
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\n"
            .data(using: .utf8)!)
        body.append("Content-Type: \(fileType)\r\n\r\n".data(using: .utf8)!)
        body.append(fileData)
        body.append(crlf)
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        req.httpBody = body

        let (data, response) = try await session.upload(for: req, from: body)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.transport("Invalid response")
        }
        if (200...299).contains(http.statusCode) {
            if Out.self == EmptyResponse.self { return EmptyResponse() as! Out }
            return try Self.decoder.decode(Out.self, from: data)
        }
        if let envelope = try? Self.decoder.decode(APIErrorEnvelope.self, from: data) {
            throw APIError.server(status: http.statusCode, envelope: envelope)
        }
        throw APIError.server(
            status: http.statusCode,
            envelope: APIErrorEnvelope(error: "unknown", message: nil, fieldErrors: nil)
        )
    }
}

// Type-erased Encodable wrapper so we can store heterogeneous body types.
private struct AnyEncodable: Encodable {
    let value: Encodable
    init(_ value: Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}

public struct EmptyResponse: Decodable, Sendable {}
