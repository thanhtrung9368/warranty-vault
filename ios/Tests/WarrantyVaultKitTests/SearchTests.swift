import Foundation
import XCTest
@testable import WarrantyVaultKit

/// Cross-entity search (`GET /api/v1/search`): the client-side mirror of
/// `api/internal/services/search.go` — the 200-rune cap, the per-group `limit`,
/// the grouping the screen renders, and the state machine that decides what the
/// surface shows. The HTTP shape itself is asserted in `EndpointsTests`.
final class SearchTests: KitTestCase {

    // MARK: - Query rules

    func testBlankQueriesAreNotErrors() {
        for raw in ["", " ", "\n", "\t  \n"] {
            XCTAssertTrue(SearchQueryRules.isBlank(raw), "\(raw.debugDescription) is blank")
            XCTAssertEqual(SearchQueryRules.trimmed(raw), "")
            XCTAssertFalse(SearchQueryRules.exceedsMaxRunes(raw),
                           "a blank query is 0 runes, not a 400")
        }
        XCTAssertFalse(SearchQueryRules.isBlank(" samsung "))
        XCTAssertEqual(SearchQueryRules.trimmed("  samsung  "), "samsung")
    }

    /// Go counts runes (`utf8.RuneCountInString`), so the cap has to be counted
    /// the same way — including for multi-byte Vietnamese text.
    func testMaxRunesCountsCodePointsNotGraphemes() {
        let vietnamese = String(repeating: "đ", count: 200)  // 1 rune each
        XCTAssertEqual(SearchQueryRules.runeCount(vietnamese), 200)
        XCTAssertFalse(SearchQueryRules.exceedsMaxRunes(vietnamese),
                       "200 runes is still accepted")
        XCTAssertTrue(SearchQueryRules.exceedsMaxRunes(vietnamese + "a"),
                      "201 runes is the paste accident the server 400s")

        // Counting is on the trimmed value, exactly like the server.
        XCTAssertFalse(SearchQueryRules.exceedsMaxRunes("  " + vietnamese + "  "))

        // A combining sequence is 1 grapheme but several code points; the server
        // counts code points, so this must too.
        let combining = "e\u{0301}"  // é as e + combining acute
        XCTAssertEqual(combining.count, 1)
        XCTAssertEqual(SearchQueryRules.runeCount(combining), 2)
        XCTAssertEqual(SearchQueryRules.runeCount(String(repeating: combining, count: 100)), 200)
    }

    func testTooLongMessageIsVietnamese() {
        XCTAssertEqual(SearchQueryRules.tooLongMessage,
                       "Từ khoá tìm kiếm quá dài (tối đa 200 ký tự).")
    }

    func testLimitIsClampedLikeTheServer() {
        XCTAssertEqual(SearchQueryRules.defaultLimit, 20)
        XCTAssertEqual(SearchQueryRules.maxLimit, 50)
        XCTAssertEqual(SearchQueryRules.clampedLimit(0), 20)
        XCTAssertEqual(SearchQueryRules.clampedLimit(-5), 20)
        XCTAssertEqual(SearchQueryRules.clampedLimit(1), 1)
        XCTAssertEqual(SearchQueryRules.clampedLimit(35), 35)
        XCTAssertEqual(SearchQueryRules.clampedLimit(50), 50)
        XCTAssertEqual(SearchQueryRules.clampedLimit(51), 50)
        XCTAssertEqual(SearchQueryRules.clampedLimit(10_000), 50)
    }

    // MARK: - Decoding

    func testEmptyGroupsDecodeAsEmptyArrays() throws {
        let json = #"{"query":"","devices":[],"subscriptions":[],"wishlist":[]}"#
        let results = try APIClient.decoder.decode(SearchResults.self, from: Data(json.utf8))

        XCTAssertEqual(results.query, "")
        XCTAssertTrue(results.isEmpty)
        XCTAssertEqual(results.totalCount, 0)
        XCTAssertTrue(results.sections.isEmpty)
    }

    /// The contract says the groups are always arrays. If that ever regresses,
    /// the screen must show "no results" rather than throw a decoding error.
    func testMissingOrNullGroupsDecodeAsEmpty() throws {
        for json in [#"{"query":"x"}"#,
                     #"{"query":"x","devices":null,"subscriptions":null,"wishlist":null}"#] {
            let results = try APIClient.decoder.decode(SearchResults.self, from: Data(json.utf8))
            XCTAssertEqual(results.query, "x")
            XCTAssertTrue(results.isEmpty, json)
        }
    }

    func testGroupsDecodeAndReportCounts() throws {
        let json = #"""
        {"query":"apple","devices":[\#(Fixtures.device)],
         "subscriptions":[\#(Fixtures.subscription)],"wishlist":[\#(Fixtures.wishlistItem)]}
        """#
        let results = try APIClient.decoder.decode(SearchResults.self, from: Data(json.utf8))

        XCTAssertEqual(results.query, "apple")
        XCTAssertEqual(results.devices.first?.name, "MacBook Pro 14")
        XCTAssertEqual(results.subscriptions.first?.name, "iCloud+ 200GB")
        XCTAssertEqual(results.wishlist.first?.name, "AirPods Pro 2")
        XCTAssertEqual(results.totalCount, 3)
        XCTAssertFalse(results.isEmpty)

        // Search rows are plain `SELECT *` rows: the list-only projection fields
        // are absent, which must stay optional rather than fail the whole group.
        XCTAssertNil(results.devices.first?.attachmentCount)
        XCTAssertNil(results.devices.first?.effectiveWarrantyEnd)
    }

    // MARK: - Grouping

    func testSectionsListOnlyNonEmptyGroupsInTabOrder() throws {
        let devicesOnly = try APIClient.decoder.decode(SearchResults.self, from: Data(#"""
        {"query":"mac","devices":[\#(Fixtures.device)],"subscriptions":[],"wishlist":[]}
        """#.utf8))
        XCTAssertEqual(devicesOnly.sections.map(\.kind), [.devices])
        XCTAssertEqual(devicesOnly.sections.map(\.title), ["Thiết bị"])
        XCTAssertEqual(devicesOnly.sections.map(\.count), [1])

        let all = try APIClient.decoder.decode(SearchResults.self, from: Data(#"""
        {"query":"a","devices":[\#(Fixtures.device)],
         "subscriptions":[\#(Fixtures.subscription)],"wishlist":[\#(Fixtures.wishlistItem)]}
        """#.utf8))
        XCTAssertEqual(all.sections.map(\.kind), [.devices, .subscriptions, .wishlist],
                       "sections follow the tab order the user already knows")
        XCTAssertEqual(all.sections.map(\.title), ["Thiết bị", "Đăng ký", "Wishlist"])
        XCTAssertEqual(all.sections.map(\.id), ["devices", "subscriptions", "wishlist"])
    }

    func testSectionKindTitlesMatchTheTabLabels() {
        XCTAssertEqual(SearchSection.Kind.devices.title, "Thiết bị")
        XCTAssertEqual(SearchSection.Kind.subscriptions.title, "Đăng ký")
        XCTAssertEqual(SearchSection.Kind.wishlist.title, "Wishlist")
    }

    // MARK: - Phase

    private func results(_ count: Int) throws -> SearchResults {
        let devices = count == 0 ? "[]" : "[\(Fixtures.device)]"
        return try APIClient.decoder.decode(SearchResults.self, from: Data(#"""
        {"query":"mac","devices":\#(devices),"subscriptions":[],"wishlist":[]}
        """#.utf8))
    }

    func testBlankQueryIsIdleAndClearsErrorsAndStaleResults() throws {
        // The requirement that matters: deleting the last character of the box
        // must not keep an error (or a stale "no results") on screen.
        XCTAssertEqual(SearchPhase.resolve(query: "", isLoading: true,
                                           results: try results(1), error: "Mất kết nối"), .idle)
        XCTAssertEqual(SearchPhase.resolve(query: "   ", isLoading: true,
                                           results: nil, error: "Mất kết nối"), .idle)
    }

    func testOverlongQueryNeverBecomesARequest() throws {
        XCTAssertEqual(SearchPhase.resolve(query: String(repeating: "a", count: 201),
                                           isLoading: false, results: nil, error: nil), .tooLong)
        XCTAssertEqual(SearchPhase.resolve(query: String(repeating: "a", count: 201),
                                           isLoading: false, results: try results(1),
                                           error: "Mất kết nối"), .tooLong,
                       "the length check outranks the previous error")
        XCTAssertEqual(SearchPhase.resolve(query: String(repeating: "a", count: 200),
                                           isLoading: false, results: try results(1), error: nil),
                       .results)
    }

    func testLoadingResultsAndNoResults() throws {
        XCTAssertEqual(SearchPhase.resolve(query: "mac", isLoading: true,
                                           results: nil, error: nil), .loading)
        XCTAssertEqual(SearchPhase.resolve(query: "mac", isLoading: false,
                                           results: nil, error: nil), .loading,
                       "nothing has come back yet — not 'no results'")
        XCTAssertEqual(SearchPhase.resolve(query: "mac", isLoading: false,
                                           results: try results(1), error: nil), .results)
        XCTAssertEqual(SearchPhase.resolve(query: "mac", isLoading: false,
                                           results: try results(0), error: nil), .noResults)
    }

    func testServerErrorsWinOverStaleResults() throws {
        XCTAssertEqual(SearchPhase.resolve(query: "mac", isLoading: false,
                                           results: try results(1), error: "Máy chủ lỗi"),
                       .failed("Máy chủ lỗi"))
    }
}
