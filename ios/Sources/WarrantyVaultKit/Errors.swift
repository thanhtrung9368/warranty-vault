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
}
