import Foundation
import XCTest
@testable import WarrlyKit

// `ImportResult.warnings` — non-fatal caveats about a backup that WAS restored.
//
// The decoding half is what these tests can prove: the key is optional (the API
// omits it for an ordinary import), an empty/blank array must be treated as
// "nothing to show", and unknown response keys must not break the result.
//
// The visual half — that the notice card is actually inserted above the restore
// screen and is absent for a clean import — lives in the App target, which
// `swift test` does not build. It can only be verified by running the app and
// looking at it (see the screenshot note in the feature's report).
final class ImportWarningsTests: KitTestCase {

    private static let legacyWarning =
        "This backup does not record the time zone of its timestamps. " +
        "Some instants may be 7 hours off; calendar dates are unaffected."

    private func decode(_ json: String) throws -> ImportResult {
        try APIClient.decoder.decode(ImportResult.self, from: Data(json.utf8))
    }

    // MARK: - Decoding

    func testResultWithWarningsKeepsTheServerSentenceVerbatim() throws {
        let result = try decode(#"""
        {
          "imported": 12, "skipped": 3,
          "wishlistImported": 4, "wishlistSkipped": 1,
          "subImported": 5, "subSkipped": 2,
          "warnings": ["This backup does not record the time zone of its timestamps. Some instants may be 7 hours off; calendar dates are unaffected."]
        }
        """#)

        // The client displays this exact string: the API has no warning code, so
        // there is nothing else to render. No re-wrapping, trimming or mapping.
        XCTAssertEqual(result.warnings, [Self.legacyWarning])
        XCTAssertEqual(result.warningsOrEmpty, [Self.legacyWarning])
        XCTAssertTrue(result.hasWarnings)
        // Adding `warnings` must not disturb the counters the existing alert uses.
        XCTAssertEqual(result.imported, 12)
        XCTAssertEqual(result.skipped, 3)
        XCTAssertEqual(result.subImported, 5)
    }

    func testResultWithoutTheKeyIsAnOrdinaryImport() throws {
        // This is the wire shape for an ordinary import: Go's `omitempty` drops
        // the key entirely, and the old payloads never had it. It must decode,
        // and it must read as "show nothing".
        let result = try decode(#"""
        {"imported": 1, "skipped": 0, "wishlistImported": 0,
         "wishlistSkipped": 0, "subImported": 0, "subSkipped": 0}
        """#)

        XCTAssertNil(result.warnings)
        XCTAssertEqual(result.warningsOrEmpty, [])
        XCTAssertFalse(result.hasWarnings)
    }

    func testExplicitEmptyWarningsArrayIsAlsoSilent() throws {
        let result = try decode(#"""
        {"imported": 0, "skipped": 0, "wishlistImported": 0,
         "wishlistSkipped": 0, "subImported": 0, "subSkipped": 0, "warnings": []}
        """#)

        XCTAssertEqual(result.warnings, [])
        XCTAssertEqual(result.warningsOrEmpty, [])
        XCTAssertFalse(result.hasWarnings)
    }

    func testBlankWarningsCannotProduceAnEmptyNotice() throws {
        // Defensive, not hypothetical-as-contract: the banner title carries the
        // meaning, so a whitespace-only entry would otherwise be a blank card
        // that says "there is something wrong" without saying what. The raw
        // field still reflects the server; the display accessor filters.
        let result = try decode(#"""
        {"imported": 0, "skipped": 0, "wishlistImported": 0,
         "wishlistSkipped": 0, "subImported": 0, "subSkipped": 0,
         "warnings": ["   ", "\n", "  real caveat  "]}
        """#)

        XCTAssertEqual(result.warnings?.count, 3)
        XCTAssertEqual(result.warningsOrEmpty, ["  real caveat  "],
                       "only non-blank entries are displayable")
        XCTAssertTrue(result.hasWarnings)
    }

    func testUnknownResponseKeysAreIgnored() throws {
        // `JSONDecoder` ignores keys the model does not declare (no custom
        // `init(from:)`, no `CodingKeys` whitelist). Pinned because this is what
        // lets a newer server add response fields without breaking this build —
        // and because the additive `instantTimeZone` marker is exactly that kind
        // of forward-compatibility change on the request side.
        let result = try decode(#"""
        {
          "imported": 2, "skipped": 0,
          "wishlistImported": 0, "wishlistSkipped": 0,
          "subImported": 0, "subSkipped": 0,
          "attachmentsImported": 7,
          "attachmentsUnreadable": 0,
          "someFutureWarningShape": {"code": "FUTURE"},
          "warnings": ["a caveat"]
        }
        """#)

        XCTAssertEqual(result.imported, 2)
        XCTAssertEqual(result.warningsOrEmpty, ["a caveat"])
    }

    // MARK: - Bilingual banner title

    func testRestoreWarningTitleIsBilingual() {
        // The API provides the warning body in the request's language; the one
        // piece of copy the app owns is the heading that says the import
        // succeeded. Both halves must exist, and English is the product default
        // (the app ships English unless the user chose Vietnamese).
        //
        // The explicit-language overload is used instead of mutating the global
        // `L.language`, so this test is deterministic even if another suite runs
        // concurrently.
        XCTAssertEqual(L.t("Đã khôi phục dữ liệu — có lưu ý", language: .en),
                       "Data restored — with a caveat")
        XCTAssertEqual(L.t("Đã khôi phục dữ liệu — có lưu ý", language: .vi),
                       "Đã khôi phục dữ liệu — có lưu ý")
        XCTAssertEqual(AppLanguage.productDefault, .en)
    }
}
