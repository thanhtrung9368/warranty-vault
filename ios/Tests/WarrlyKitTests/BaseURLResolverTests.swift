import Foundation
import XCTest
@testable import WarrlyKit

/// Covers the four states a shipped build can find itself in:
/// a valid configured URL, a malformed one, a missing one, and an explicit
/// environment override. The last state is what every developer uses locally,
/// so it must keep working after the move from a hard-coded fallback.
final class BaseURLResolverTests: XCTestCase {

    // MARK: - Valid values

    func testReleaseConfigurationResolvesProductionHTTPS() throws {
        let url = try BaseURLResolver.resolve(bundleValue: "https://api.warrly.com")

        XCTAssertEqual(url.scheme, "https")
        XCTAssertEqual(url.host, "api.warrly.com")
        XCTAssertEqual(url.absoluteString, "https://api.warrly.com")
    }

    func testDebugConfigurationResolvesLocalhost() throws {
        let url = try BaseURLResolver.resolve(bundleValue: "http://localhost:4000")

        XCTAssertEqual(url.scheme, "http")
        XCTAssertEqual(url.host, "localhost")
        XCTAssertEqual(url.port, 4000)
        XCTAssertEqual(url.absoluteString, "http://localhost:4000")
    }

    func testPortPathAndHTTPSchemeArePreserved() throws {
        let url = try BaseURLResolver.resolve(bundleValue: "https://api.warrly.com:8443/wv")

        XCTAssertEqual(url.scheme, "https")
        XCTAssertEqual(url.host, "api.warrly.com")
        XCTAssertEqual(url.port, 8443)
        XCTAssertEqual(url.path, "/wv")
    }

    func testSchemeComparisonIsCaseInsensitive() throws {
        let url = try BaseURLResolver.resolve(bundleValue: "HTTPS://api.warrly.com")

        XCTAssertEqual(url.host, "api.warrly.com")
    }

    // MARK: - Environment override precedence

    func testEnvironmentOverrideWinsOverInfoPlist() throws {
        let url = try BaseURLResolver.resolve(
            bundleValue: "https://api.warrly.com",
            environmentValue: "http://192.168.1.17:4000"
        )

        XCTAssertEqual(url.absoluteString, "http://192.168.1.17:4000")
    }

    func testEnvironmentOverrideIsTrimmed() throws {
        let url = try BaseURLResolver.resolve(
            bundleValue: "https://api.warrly.com",
            environmentValue: "  http://localhost:4000\n"
        )

        XCTAssertEqual(url.absoluteString, "http://localhost:4000")
    }

    func testBlankEnvironmentOverrideFallsBackToInfoPlist() throws {
        for blank in ["", "   ", "\n"] {
            let url = try BaseURLResolver.resolve(
                bundleValue: "https://api.warrly.com",
                environmentValue: blank
            )
            XCTAssertEqual(url.absoluteString, "https://api.warrly.com")
        }
    }

    // MARK: - Missing values

    func testBothSourcesMissingThrowsMissing() {
        XCTAssertThrowsError(try BaseURLResolver.resolve(bundleValue: nil)) { error in
            XCTAssertEqual(
                error as? BaseURLResolver.ResolutionError,
                .missing(infoPlistKey: BaseURLResolver.infoPlistKey,
                         environmentKey: BaseURLResolver.environmentKey)
            )
        }
    }

    func testBlankInfoPlistValueIsTreatedAsMissing() {
        for blank in ["", "   ", "\n"] {
            XCTAssertThrowsError(try BaseURLResolver.resolve(bundleValue: blank)) { error in
                guard case .missing? = error as? BaseURLResolver.ResolutionError else {
                    return XCTFail("expected .missing, got \(error)")
                }
            }
        }
    }

    // MARK: - Malformed values

    func testMalformedInfoPlistValuesThrow() {
        let malformed = [
            "not a url",
            "localhost:4000",          // parsed as scheme "localhost", no host
            "api.warrly.com",          // no scheme
            "https:///api",            // no host
            "ftp://api.warrly.com",    // not HTTP(S)
            "https://api.warrly.com?q=1",
            "https://api.warrly.com#frag",
        ]

        for value in malformed {
            XCTAssertThrowsError(try BaseURLResolver.resolve(bundleValue: value),
                                 "expected \"\(value)\" to be rejected") { error in
                guard case .malformed? = error as? BaseURLResolver.ResolutionError else {
                    return XCTFail("expected .malformed for \"\(value)\", got \(error)")
                }
            }
        }
    }

    func testUnresolvedBuildSettingIsRejected() {
        for value in ["$(WV_API_BASE_URL)", "https://api.warrly.com/$(API_PATH)"] {
            XCTAssertThrowsError(try BaseURLResolver.resolve(bundleValue: value)) { error in
                guard case .malformed(_, let bad, let reason)? =
                        error as? BaseURLResolver.ResolutionError else {
                    return XCTFail("expected .malformed, got \(error)")
                }
                XCTAssertEqual(bad, value)
                XCTAssertTrue(reason.contains("unresolved build setting"), reason)
            }
        }
    }

    func testMalformedEnvironmentOverrideDoesNotFallBackToInfoPlist() {
        XCTAssertThrowsError(
            try BaseURLResolver.resolve(
                bundleValue: "https://api.warrly.com",
                environmentValue: "http://"
            ),
            "a set-but-invalid override must fail loudly instead of silently using production"
        ) { error in
            guard case .malformed(let source, _, _)? =
                    error as? BaseURLResolver.ResolutionError else {
                return XCTFail("expected .malformed, got \(error)")
            }
            XCTAssertTrue(source.contains(BaseURLResolver.environmentKey), source)
        }
    }

    func testErrorDescriptionNamesTheConfigurationToFix() {
        XCTAssertTrue(
            BaseURLResolver.ResolutionError
                .missing(infoPlistKey: BaseURLResolver.infoPlistKey,
                         environmentKey: BaseURLResolver.environmentKey)
                .description
                .contains(BaseURLResolver.infoPlistKey)
        )
    }
}
