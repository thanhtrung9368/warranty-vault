import Foundation
import XCTest
@testable import WarrlyKit

/// Pins the pure half of the insurance PDF pack: the optional query string, the
/// share-sheet filename and the `%PDF-` guard. The actual PDF is rendered by the
/// Go service and is always Vietnamese — nothing here should try to translate it
/// or infer its contents.
final class InsurancePackTests: XCTestCase {

    // MARK: - Query

    func testQueryOmitsBothOptionalParametersForTheDefaults() {
        // "All devices, owned only" is the server default. Sending an empty
        // `deviceIds=` would be a different thing, so the key is omitted.
        XCTAssertEqual(InsurancePackRules.queryItems(), [])
        XCTAssertEqual(InsurancePackRules.queryItems(deviceIds: [], includeSold: false), [])
        XCTAssertEqual(
            InsurancePackRules.queryItems(deviceIds: ["", "   ", "\n"], includeSold: false),
            []
        )
    }

    func testQueryTrimsDeduplicatesAndJoinsDeviceIds() {
        let items = InsurancePackRules.queryItems(
            deviceIds: [" dev_1 ", "", "dev_2", "dev_1", "  dev_2  "],
            includeSold: false
        )

        XCTAssertEqual(pairs(items), ["deviceIds=dev_1,dev_2"])
    }

    func testQuerySendsIncludeSoldOnlyWhenTrue() {
        XCTAssertEqual(
            pairs(InsurancePackRules.queryItems(deviceIds: [], includeSold: true)),
            ["includeSold=true"]
        )
        XCTAssertEqual(
            pairs(InsurancePackRules.queryItems(deviceIds: ["dev_1"], includeSold: true)),
            ["deviceIds=dev_1", "includeSold=true"],
            "deviceIds stays first, matching the contract's parameter order"
        )
    }

    func testQueryLeavesPercentEncodingToURLComponents() {
        // The value is a single comma-joined item; IDs with reserved characters
        // must stay one query value, not become extra parameters.
        let items = InsurancePackRules.queryItems(
            deviceIds: ["dev&1", "dev=2", "dev/3"],
            includeSold: false
        )
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items.first?.name, "deviceIds")
        XCTAssertEqual(items.first?.value, "dev&1,dev=2,dev/3")

        var components = URLComponents()
        components.queryItems = items
        let query = components.percentEncodedQuery ?? ""
        XCTAssertFalse(query.contains("&deviceIds="), "an id must not split the query")
        XCTAssertEqual(
            URLComponents(string: "https://x.test/?\(query)")?
                .queryItems?.first?.value,
            "dev&1,dev=2,dev/3"
        )
    }

    // MARK: - Filename

    func testFilenameIsTheAsciiTimestampedFallback() {
        let date = Date(timeIntervalSince1970: 1_772_375_400) // 2026-03-01T14:30:00Z
        XCTAssertEqual(
            InsurancePackRules.filename(on: date, timeZone: TimeZone(secondsFromGMT: 0)!),
            "warrly-insurance-pack-20260301-1430.pdf"
        )
    }

    func testFilenameZeroPadsEveryComponent() {
        let date = Date(timeIntervalSince1970: 1_767_603_900) // 2026-01-05T09:05:00Z
        XCTAssertEqual(
            InsurancePackRules.filename(on: date, timeZone: TimeZone(secondsFromGMT: 0)!),
            "warrly-insurance-pack-20260105-0905.pdf"
        )
    }

    func testFilenameUsesTheCallersWallClockNotUTC() {
        // 18:30 UTC is already 01:30 on the NEXT day in Vietnam. The filename
        // should read like the user's clock, the same rule the website uses.
        let date = Date(timeIntervalSince1970: 1_772_389_800) // 2026-03-01T18:30:00Z
        let vietnam = TimeZone(identifier: "Asia/Ho_Chi_Minh")!
        XCTAssertEqual(
            InsurancePackRules.filename(on: date, timeZone: vietnam),
            "warrly-insurance-pack-20260302-0130.pdf"
        )
    }

    func testFilenameHasNoSpacesOrDiacritics() {
        let name = InsurancePackRules.filename(
            on: Date(timeIntervalSince1970: 1_772_375_400),
            timeZone: TimeZone(secondsFromGMT: 0)!
        )
        XCTAssertTrue(name.hasSuffix(".pdf"))
        XCTAssertTrue(name.allSatisfy { $0.isASCII })
        XCTAssertFalse(name.contains(" "))
    }

    func testFilenameIsStableWithinTheSameMinute() {
        let first = Date(timeIntervalSince1970: 1_772_375_400)
        let sameMinute = first.addingTimeInterval(42)
        let zone = TimeZone(secondsFromGMT: 0)!
        XCTAssertEqual(
            InsurancePackRules.filename(on: first, timeZone: zone),
            InsurancePackRules.filename(on: sameMinute, timeZone: zone)
        )
    }

    // MARK: - PDF header

    func testPDFHeaderDetectionAcceptsARealPDFAndRejectsEverythingElse() {
        XCTAssertTrue(InsurancePackRules.hasPDFHeader(Data("%PDF-1.7\n".utf8)))
        XCTAssertTrue(InsurancePackRules.hasPDFHeader(Data("%PDF-".utf8)))

        XCTAssertFalse(InsurancePackRules.hasPDFHeader(Data()), "empty body")
        XCTAssertFalse(InsurancePackRules.hasPDFHeader(Data("%PDF".utf8)), "truncated magic")
        XCTAssertFalse(
            InsurancePackRules.hasPDFHeader(Data("<html>upstream error</html>".utf8))
        )
        XCTAssertFalse(
            InsurancePackRules.hasPDFHeader(Data(#"{"error":"internal"}"#.utf8))
        )
        XCTAssertFalse(
            InsurancePackRules.hasPDFHeader(Data("\n%PDF-1.7\n".utf8)),
            "a leading newline is not the ISO 32000 header (same rule as the website)"
        )
    }

    // MARK: - Helpers

    /// `name=value` strings so assertions read like the wire rather than like
    /// `URLQueryItem` debug output.
    private func pairs(_ items: [URLQueryItem]) -> [String] {
        items.map { "\($0.name)=\($0.value ?? "<nil>")" }
    }
}
