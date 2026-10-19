import Foundation

public struct APIErrorEnvelope: Decodable, Sendable {
    public let error: String
    public let message: String?
    public let fieldErrors: [String: [String]]?
}

public enum APIError: Error, LocalizedError, Sendable {
    case invalidURL
    case transport(String)
    case decoding(String)
    case server(status: Int, envelope: APIErrorEnvelope)

    public var errorDescription: String? {
        switch self {
        case .invalidURL:                 return L.t("URL không hợp lệ")
        case .transport(let m):           return m
        case .decoding(let m):            return L.t("Lỗi giải mã: %@", m)
        case .server(_, let envelope):    return envelope.message ?? envelope.error
        }
    }

    /// Field-level validation errors from the server (Zod -> Vietnamese).
    public var fieldErrors: [String: [String]] {
        if case let .server(_, envelope) = self {
            return envelope.fieldErrors ?? [:]
        }
        return [:]
    }

    public var isUnauthorized: Bool {
        if case .server(let status, _) = self { return status == 401 }
        return false
    }

    /// The HTTP status behind a `.server` error, or `nil` for a transport or
    /// decoding failure. Used where a specific status changes the copy — the
    /// FX endpoint's documented 503 is "the user types the rate", not an
    /// error screen.
    public var statusCode: Int? {
        if case .server(let status, _) = self { return status }
        return nil
    }

    /// The server is available but this feature cannot run right now — the FX
    /// lookup is the current example (provider down / cache cold). Callers
    /// degrade to manual entry instead of surfacing a raw error.
    public var isServiceUnavailable: Bool { statusCode == 503 }
}
