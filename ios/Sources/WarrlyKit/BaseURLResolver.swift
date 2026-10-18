import Foundation

/// Resolves the API base URL from build-time configuration.
///
/// The value is supplied by the build configuration (`Config/Debug.xcconfig` or
/// `Config/Release.xcconfig`), expanded by Xcode into the generated Info.plist
/// key `WVAPIBaseURL`. That key — not an environment variable — is what makes a
/// TestFlight build point at production, because a shipped app has no launch
/// environment.
///
/// `WV_BASE_URL` in the process environment still wins when present: that is how
/// developers and QA point a simulator or device at another backend without
/// editing the project. An override that is set but malformed is an error
/// rather than a silent fallback — falling back would quietly send traffic to a
/// server other than the one the caller explicitly asked for.
///
/// Resolution is a pure function on purpose, so every failure mode (missing,
/// malformed, unresolved build setting) is unit-tested instead of only being
/// discovered on a TestFlight launch.
public enum BaseURLResolver {

    /// Info.plist key populated from `WV_API_BASE_URL` in the xcconfig.
    public static let infoPlistKey = "WVAPIBaseURL"

    /// Launch-environment override used for local development and QA.
    public static let environmentKey = "WV_BASE_URL"

    public enum ResolutionError: Error, Equatable, CustomStringConvertible {
        case missing(infoPlistKey: String, environmentKey: String)
        case malformed(source: String, value: String, reason: String)

        public var description: String {
            switch self {
            case let .missing(infoPlistKey, environmentKey):
                return """
                No API base URL is configured: Info.plist key "\(infoPlistKey)" is missing or empty and the "\(environmentKey)" environment variable is not set. Wire Config/Debug.xcconfig and Config/Release.xcconfig into the target, then run `xcodegen generate`.
                """
            case let .malformed(source, value, reason):
                return "Invalid API base URL from \(source): \"\(value)\" — \(reason)."
            }
        }
    }

    /// - Parameters:
    ///   - bundleValue: the Info.plist value for `WVAPIBaseURL`, or `nil` when absent.
    ///   - environmentValue: the `WV_BASE_URL` environment value, or `nil` when unset.
    /// - Throws: ``ResolutionError`` when neither source yields a usable URL, or
    ///   when the winning source is malformed. A malformed environment override
    ///   never falls through to the Info.plist value.
    public static func resolve(bundleValue: String?,
                               environmentValue: String? = nil) throws -> URL {
        // An empty/whitespace override is what Xcode passes when the variable is
        // declared but blank; treat it as "not set" rather than as an error.
        if let override = environmentValue?.trimmingCharacters(in: .whitespacesAndNewlines),
           !override.isEmpty {
            return try parse(override, source: "environment variable \(environmentKey)")
        }

        guard let raw = bundleValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty else {
            throw ResolutionError.missing(infoPlistKey: infoPlistKey,
                                          environmentKey: environmentKey)
        }
        return try parse(raw, source: "Info.plist \(infoPlistKey)")
    }

    private static func parse(_ raw: String, source: String) throws -> URL {
        // If the xcconfig is not wired into the target configuration, Xcode
        // leaves the build setting literal. `URL` would happily accept
        // `$(WV_API_BASE_URL)` as a relative path, so reject it explicitly
        // instead of requesting `$(WV_API_BASE_URL)/v1/...` forever.
        if raw.contains("$(") {
            throw ResolutionError.malformed(
                source: source,
                value: raw,
                reason: "the value still contains an unresolved build setting"
            )
        }

        guard let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = url.host,
              !host.isEmpty else {
            throw ResolutionError.malformed(
                source: source,
                value: raw,
                reason: "expected an absolute http(s) URL with a host"
            )
        }

        guard url.query == nil, url.fragment == nil else {
            throw ResolutionError.malformed(
                source: source,
                value: raw,
                reason: "a base URL cannot carry a query or fragment"
            )
        }

        return url
    }
}
