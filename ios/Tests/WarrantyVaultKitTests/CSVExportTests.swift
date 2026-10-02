import Foundation
import XCTest
@testable import WarrantyVaultKit

/// Pure CSV building for "Xuất dữ liệu CSV".
///
/// The interesting assertions are the byte-level ones (UTF-8 BOM), the
/// RFC 4180 escaping round-trip (delimiter / quote / newline fields must
/// survive a parse), and the "money is a bare number" rule — a test that only
/// checked "a string came out" would pass on a completely broken file.
final class CSVExportTests: KitTestCase {

    // MARK: - Fixtures

    /// Builds a `Device` through the real decoder so the tests exercise exactly
    /// what the API response produces.
    private func device(_ json: String) throws -> Device {
        try APIClient.decoder.decode(Device.self, from: Data(json.utf8))
    }

    private func device(name: String = "MacBook Pro 14",
                        category: String = "LAPTOP",
                        brand: String? = "Apple",
                        model: String? = "M3 Pro",
                        serial: String? = "SN-1",
                        purchased: String = "2025-03-12T00:00:00Z",
                        price: Int = 49_990_000,
                        status: String = "ACTIVE",
                        warrantyEnd: String? = "2027-03-12T00:00:00Z") throws -> Device {
        func quoted(_ value: String?) -> String {
            guard let value else { return "null" }
            let escaped = value
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"")
                .replacingOccurrences(of: "\n", with: "\\n")
                .replacingOccurrences(of: "\r", with: "\\r")
            return "\"\(escaped)\""
        }
        let json = """
        {"id":"dev_1","name":\(quoted(name)),"category":"\(category)",
         "brand":\(quoted(brand)),"model":\(quoted(model)),"serialNumber":\(quoted(serial)),
         "purchaseDate":"\(purchased)","purchasePrice":\(price),"status":"\(status)",
         "effectiveWarrantyEnd":\(quoted(warrantyEnd))}
        """
        return try device(json)
    }

    /// Minimal RFC 4180 reader — enough to prove the writer's output parses
    /// back to the original fields, including quoted newlines.
    ///
    /// Works on UTF-8 bytes rather than `Character`s: Swift folds CRLF into a
    /// single grapheme, which would hide the very line breaks under test.
    private func parseCSV(_ text: String) -> [[String]] {
        var rows: [[String]] = []
        var row: [String] = []
        var field: [UInt8] = []
        var inQuotes = false
        let bytes = Array(text.utf8)
        var index = 0

        func endField() {
            row.append(String(decoding: field, as: UTF8.self))
            field = []
        }
        func endRow() {
            endField()
            rows.append(row)
            row = []
        }

        while index < bytes.count {
            let byte = bytes[index]
            if inQuotes {
                if byte == UInt8(ascii: "\"") {
                    if index + 1 < bytes.count, bytes[index + 1] == UInt8(ascii: "\"") {
                        field.append(UInt8(ascii: "\""))
                        index += 2
                        continue
                    }
                    inQuotes = false
                    index += 1
                    continue
                }
                field.append(byte)
                index += 1
                continue
            }
            switch byte {
            case UInt8(ascii: "\""):
                inQuotes = true
            case UInt8(ascii: ","):
                endField()
            case UInt8(ascii: "\r"):
                if index + 1 < bytes.count, bytes[index + 1] == UInt8(ascii: "\n") { index += 1 }
                endRow()
            case UInt8(ascii: "\n"):
                endRow()
            default:
                field.append(byte)
            }
            index += 1
        }
        if !field.isEmpty || !row.isEmpty { endRow() }
        return rows
    }

    // MARK: - BOM

    func testDataStartsWithUTF8ByteOrderMark() throws {
        let data = DeviceCSVExport.data(for: [try device()])
        XCTAssertEqual(Array(data.prefix(3)), [0xEF, 0xBB, 0xBF],
                       "Excel only auto-detects UTF-8 when the file starts with the BOM")
        XCTAssertEqual(Array(DeviceCSVExport.byteOrderMark), [0xEF, 0xBB, 0xBF])
    }

    func testBOMIsPresentEvenWhenThereAreNoDevices() {
        let data = DeviceCSVExport.data(for: [])
        XCTAssertEqual(Array(data.prefix(3)), [0xEF, 0xBB, 0xBF])
        // Header-only document: BOM + one CRLF-terminated header row.
        let body = String(decoding: data.dropFirst(3), as: UTF8.self)
        XCTAssertEqual(body, DeviceCSVExport.record(DeviceCSVExport.header.map { Optional($0) })
            + DeviceCSVExport.recordSeparator)
    }

    func testVietnameseDiacriticsRoundTripThroughUTF8() throws {
        let data = DeviceCSVExport.data(for: [try device(name: "Tai nghe chống ồn Đà Nẵng")])
        let text = String(decoding: data.dropFirst(3), as: UTF8.self)
        XCTAssertTrue(text.contains("Tai nghe chống ồn Đà Nẵng"))
    }

    // MARK: - Escaping

    func testFieldWithDelimiterIsQuoted() {
        XCTAssertEqual(DeviceCSVExport.field("MacBook Pro, 14 inch"), "\"MacBook Pro, 14 inch\"")
    }

    func testFieldWithDoubleQuoteIsQuotedAndQuoteIsDoubled() {
        XCTAssertEqual(DeviceCSVExport.field("Tai nghe \"xịn\""), "\"Tai nghe \"\"xịn\"\"\"")
    }

    func testFieldWithNewlineIsQuoted() {
        XCTAssertEqual(DeviceCSVExport.field("Dòng 1\nDòng 2"), "\"Dòng 1\nDòng 2\"")
        XCTAssertEqual(DeviceCSVExport.field("Dòng 1\r\nDòng 2"), "\"Dòng 1\r\nDòng 2\"")
        XCTAssertEqual(DeviceCSVExport.field("Dòng 1\rDòng 2"), "\"Dòng 1\rDòng 2\"")
    }

    func testPlainFieldIsNotQuoted() {
        XCTAssertEqual(DeviceCSVExport.field("MacBook Pro"), "MacBook Pro")
        XCTAssertEqual(DeviceCSVExport.field("Số seri: SN-1"), "Số seri: SN-1")
        XCTAssertEqual(DeviceCSVExport.field("49.990.000 ₫"), "49.990.000 ₫")
    }

    func testNilAndEmptyFieldsBecomeEmptyUnquotedFields() {
        XCTAssertEqual(DeviceCSVExport.field(nil), "")
        XCTAssertEqual(DeviceCSVExport.field(""), "")
        XCTAssertEqual(DeviceCSVExport.record(["a", nil, "", "b"]), "a,,,b")
    }

    func testHostileNameDoesNotCorruptTheRowStructure() throws {
        let nasty = "Laptop \"xịn\", loại\n2\r\nhàng mới"
        let devices = [
            try device(name: nasty, serial: "SN,1"),
            try device(name: "Máy ảnh"),
        ]
        let rows = parseCSV(DeviceCSVExport.csv(for: devices))
        XCTAssertEqual(rows.count, 3, "one header + two device rows, despite embedded newlines")
        XCTAssertEqual(rows[1][0], nasty)
        XCTAssertEqual(rows[1][4], "SN,1")
        XCTAssertEqual(rows[2][0], "Máy ảnh")
    }

    // MARK: - Columns

    func testHeaderAndRowShape() throws {
        let dev = try device()
        let rows = parseCSV(DeviceCSVExport.csv(for: [dev],
                                                categoryLabel: { _ in "Laptop" }))
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0], ["Tên", "Danh mục", "Hãng", "Model", "Số seri",
                                 "Ngày mua", "Giá mua (VND)", "Hết bảo hành", "Trạng thái"])
        XCTAssertEqual(rows[1], ["MacBook Pro 14", "Laptop", "Apple", "M3 Pro", "SN-1",
                                 "2025-03-12", "49990000", "2027-03-12", "Đang dùng"])
    }

    func testMoneyIsAPlainNumberWithoutCurrencySuffixOrGrouping() throws {
        let rows = parseCSV(DeviceCSVExport.csv(for: [try device(price: 49_990_000)]))
        XCTAssertEqual(rows[1][6], "49990000")
        XCTAssertFalse(rows[1][6].contains("₫"))
        XCTAssertFalse(rows[1][6].contains("."))
        XCTAssertFalse(rows[1][6].contains(","))
        XCTAssertEqual(Int(rows[1][6]), 49_990_000, "a spreadsheet can parse this as a number")
    }

    func testZeroPriceIsExportedAsZero() throws {
        let rows = parseCSV(DeviceCSVExport.csv(for: [try device(price: 0)]))
        XCTAssertEqual(rows[1][6], "0")
    }

    func testNullableColumnsBecomeEmptyFields() throws {
        let dev = try device(brand: nil, model: nil, serial: nil, warrantyEnd: nil)
        let rows = parseCSV(DeviceCSVExport.csv(for: [dev]))
        XCTAssertEqual(rows[1][2], "")   // Hãng
        XCTAssertEqual(rows[1][3], "")   // Model
        XCTAssertEqual(rows[1][4], "")   // Số seri
        XCTAssertEqual(rows[1][7], "")   // Hết bảo hành
        XCTAssertEqual(rows.count, 2)
    }

    func testStatusUsesTheVietnameseLabel() throws {
        let rows = parseCSV(DeviceCSVExport.csv(for: [
            try device(status: "ACTIVE"),
            try device(status: "SOLD"),
            try device(status: "EXPIRED"),
        ]))
        XCTAssertEqual(rows[1][8], DeviceStatus.ACTIVE.label)
        XCTAssertEqual(rows[1][8], "Đang dùng")
        XCTAssertEqual(rows[2][8], "Đã bán")
        XCTAssertEqual(rows[3][8], "Hết bảo hành")
    }

    func testCategoryFallsBackToTheSharedTableAndHonoursInjection() throws {
        let dev = try device(category: "LAPTOP")
        // Default mapper = the app-wide catalogue labels.
        XCTAssertEqual(parseCSV(DeviceCSVExport.csv(for: [dev]))[1][1],
                       CategoryLabels.label(for: "LAPTOP"))
        XCTAssertEqual(parseCSV(DeviceCSVExport.csv(for: [dev]))[1][1], "Laptop")
        // Injected mapper is used verbatim (unknown codes stay readable).
        XCTAssertEqual(parseCSV(DeviceCSVExport.csv(for: [dev],
                                                    categoryLabel: { $0 ?? "?" }))[1][1],
                       "LAPTOP")
    }

    // MARK: - Record separators

    func testRecordsAreCRLFTerminated() throws {
        let csv = DeviceCSVExport.csv(for: [try device(), try device()])
        XCTAssertTrue(csv.hasSuffix("\r\n"))
        XCTAssertEqual(csv.components(separatedBy: "\r\n").count, 4) // 3 rows + trailing ""
        XCTAssertEqual(parseCSV(csv).count, 3)
    }

    func testDateUsesTheVietnameseCalendarDayNotUTC() throws {
        // 23:30 UTC on the 31st is already the 1st in Asia/Ho_Chi_Minh.
        let dev = try device(purchased: "2025-03-31T23:30:00Z",
                             warrantyEnd: "2026-04-01T00:00:00Z")
        let rows = parseCSV(DeviceCSVExport.csv(for: [dev]))
        XCTAssertEqual(rows[1][5], "2025-04-01")
        XCTAssertEqual(rows[1][7], "2026-04-01")
    }

    // MARK: - Data integrity

    func testDataIsExactlyTheBOMPlusUTF8Text() throws {
        let devices = [try device(name: "Ổ cứng, \"SSD\"")]
        let data = DeviceCSVExport.data(for: devices)
        let csv = DeviceCSVExport.csv(for: devices)
        XCTAssertEqual(data, Data([0xEF, 0xBB, 0xBF]) + Data(csv.utf8))
        XCTAssertEqual(String(decoding: data.dropFirst(3), as: UTF8.self), csv)
    }
}
