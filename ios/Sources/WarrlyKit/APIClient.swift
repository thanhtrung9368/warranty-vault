import Foundation

// Async/await HTTP client. Stateless w.r.t. auth — pass the token in via
// `tokenProvider` so the AuthStore in the app layer can swap it on
// login/logout without rebuilding the client.

public actor APIClient {
    /// Where the API lives. `nonisolated` because it is an immutable `Sendable`
    /// value: SwiftUI views read it synchronously while rendering (the share-link
    /// flow builds the buyer's absolute URL from `baseURL` + `sharePath`), exactly
    /// like `attachmentDownloadURL` does.
    public nonisolated let baseURL: URL
    private let session: URLSession
    private let tokenProvider: @Sendable () async -> String?
    private let languageProvider: @Sendable () -> AppLanguage?

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        tokenProvider: @escaping @Sendable () async -> String? = { nil },
        languageProvider: @escaping @Sendable () -> AppLanguage? = { L.language }
    ) {
        self.baseURL = baseURL
        self.session = session
        self.tokenProvider = tokenProvider
        self.languageProvider = languageProvider
    }

    /// Attaches `Accept-Language` so the Go server answers in the language the
    /// UI is currently rendering.
    ///
    /// Without this header the server would fall back to `User.locale` and then
    /// to English, so a Vietnamese user on a Vietnamese phone would read
    /// Vietnamese labels with English validation errors attached.
    ///
    /// A `nil` language sends **no header at all** rather than `en`: that leaves
    /// the server's own chain intact (`?lang=` → `Accept-Language` →
    /// `User.locale` → `en`), which is what the library and its tests want. The
    /// app always has a language by the time it makes a request.
    private func applyLanguage(to req: inout URLRequest) {
        guard let language = languageProvider() else { return }
        req.setValue(language.rawValue, forHTTPHeaderField: "Accept-Language")
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

    // MARK: - URL building

    /// Builds a request URL.
    ///
    /// `percentEncodedPath` selects a path whose segments are **already** escaped
    /// (see `Endpoints.actionSnoozePath`). The default branch escapes every
    /// segment for us, which would turn a deliberate `%3A` into `%253A`; the
    /// escaped branch hands the string through untouched so a single path segment
    /// can carry a reserved character without creating a new segment.
    nonisolated static func url(
        baseURL: URL,
        path: String,
        query: [URLQueryItem],
        percentEncodedPath: Bool = false
    ) throws -> URL {
        guard var components = URLComponents(
            url: baseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        ) else { throw APIError.invalidURL }

        if percentEncodedPath {
            guard var encoded = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
                throw APIError.invalidURL
            }
            var base = encoded.percentEncodedPath
            if base.hasSuffix("/") { base.removeLast() }
            encoded.percentEncodedPath = base + path
            components = encoded
        }

        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw APIError.invalidURL }
        return url
    }

    // MARK: - Core request

    func request<Out: Decodable>(
        _ method: String,
        _ path: String,
        query: [URLQueryItem] = [],
        body: Encodable? = nil,
        authenticated: Bool = true,
        percentEncodedPath: Bool = false,
        as outType: Out.Type = Out.self
    ) async throws -> Out {
        let data = try await rawRequest(
            method, path, query: query, body: body, authenticated: authenticated,
            percentEncodedPath: percentEncodedPath
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
        authenticated: Bool = true,
        percentEncodedPath: Bool = false
    ) async throws -> Data {
        let url = try Self.url(baseURL: baseURL, path: path, query: query,
                               percentEncodedPath: percentEncodedPath)

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        applyLanguage(to: &req)

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

    /// POSTs an already-serialized body verbatim (no re-encoding) and returns
    /// the raw response bytes. Used for backup import, where the payload is a
    /// JSON file the user picked — we forward its bytes as-is rather than
    /// decoding+re-encoding through `Encodable`.
    func rawDataRequest(
        _ method: String,
        _ path: String,
        query: [URLQueryItem] = [],
        rawBody: Data? = nil,
        contentType: String? = nil,
        authenticated: Bool = true
    ) async throws -> Data {
        let url = try Self.url(baseURL: baseURL, path: path, query: query)

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        applyLanguage(to: &req)
        if let rawBody {
            req.setValue(contentType ?? "application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = rawBody
        }
        if authenticated, let token = await tokenProvider() {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.transport("Invalid response")
        }
        if (200...299).contains(http.statusCode) { return data }
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
        applyLanguage(to: &req)
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
