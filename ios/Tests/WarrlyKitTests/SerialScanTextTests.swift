import XCTest
@testable import WarrlyKit

// Camera/OCR cleanup is the one part of the scan feature that can be tested on
// this machine. The camera itself (DataScannerViewController) cannot be run in
// `swift test`, and no simulator session was available, so these tests make no
// claim about what the viewfinder shows — only about what a recognised string
// becomes before it is offered as a draft.

final class SerialScanTextTests: XCTestCase {

    func testTrimsWhitespaceAndNewlines() {
        XCTAssertEqual(SerialScanText.normalize("  356789012345678  \n"), "356789012345678")
    }

    func testStripsCommonPrintedLabels() {
        XCTAssertEqual(SerialScanText.normalize("IMEI: 356789012345678"), "356789012345678")
        XCTAssertEqual(SerialScanText.normalize("IMEI 356789012345678"), "356789012345678")
        XCTAssertEqual(SerialScanText.normalize("IMEI 1: 356789012345678"), "356789012345678")
        XCTAssertEqual(SerialScanText.normalize("S/N: ABC-123"), "ABC-123")
        XCTAssertEqual(SerialScanText.normalize("SN: ABC123"), "ABC123")
        XCTAssertEqual(SerialScanText.normalize("Serial No. ABC123"), "ABC123")
        XCTAssertEqual(SerialScanText.normalize("Serial Number: ABC123"), "ABC123")
        XCTAssertEqual(SerialScanText.normalize("Số sê-ri: ABC123"), "ABC123")
        XCTAssertEqual(SerialScanText.normalize("số serial: ABC123"), "ABC123")
    }

    func testALabelWithoutASeparatorIsNotStripped() {
        // `SNABC123` is a serial that happens to start with the label's letters.
        XCTAssertEqual(SerialScanText.normalize("SNABC123"), "SNABC123")
        XCTAssertEqual(SerialScanText.normalize("SERIALABC"), "SERIALABC")
    }

    func testCompactsADigitOnlyValueBrokenUpByOcr() {
        XCTAssertEqual(SerialScanText.normalize("356 789 012 345 678"), "356789012345678")
        XCTAssertEqual(SerialScanText.normalize("356-789-012-345-678"), "356789012345678")
        XCTAssertEqual(SerialScanText.normalize("IMEI: 356 789 012 345 678"), "356789012345678")
    }

    func testPreservesSeparatorsInAnAlphanumericSerial() {
        // A dash in an alphanumeric serial can be data; only all-digit values are
        // compacted. Runs of whitespace are collapsed rather than removed.
        XCTAssertEqual(SerialScanText.normalize("ABC-123"), "ABC-123")
        XCTAssertEqual(SerialScanText.normalize("ABC   123"), "ABC 123")
    }

    func testStripsWrappingQuotesAndTrailingPunctuation() {
        XCTAssertEqual(SerialScanText.normalize("\"ABC123\""), "ABC123")
        XCTAssertEqual(SerialScanText.normalize("“ABC123”"), "ABC123")
        XCTAssertEqual(SerialScanText.normalize("`ABC123`"), "ABC123")
        XCTAssertEqual(SerialScanText.normalize("ABC123."), "ABC123")
        XCTAssertEqual(SerialScanText.normalize("ABC123,;:"), "ABC123")
        // A quote inside the value is data, not decoration.
        XCTAssertEqual(SerialScanText.normalize("AB\"C123"), "AB\"C123")
    }

    func testRemovesZeroWidthCharacters() {
        XCTAssertEqual(SerialScanText.normalize("ABC\u{200B}123"), "ABC123")
        XCTAssertEqual(SerialScanText.normalize("ABC\u{FEFF}123"), "ABC123")
    }

    func testReturnsNilWhenThereIsNoDraft() {
        XCTAssertNil(SerialScanText.normalize(""))
        XCTAssertNil(SerialScanText.normalize("   \n"))
        XCTAssertNil(SerialScanText.normalize(".:;"))
        XCTAssertNil(SerialScanText.normalize("IMEI:"))
        XCTAssertNil(SerialScanText.normalize("S/N"))
    }

    func testNormalisationIsIdempotent() {
        let raw = "  S/N: “356 789 012 345 678”.  "
        guard let once = SerialScanText.normalize(raw) else {
            return XCTFail("expected a serial draft")
        }
        XCTAssertEqual(once, "356789012345678")
        XCTAssertEqual(SerialScanText.normalize(once), once)
    }
}
