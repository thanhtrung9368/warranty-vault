import Foundation

// MARK: - Device CSV export
//
// Pure, UI-free CSV building for the "Xuất dữ liệu CSV" row in the iOS app's
// Thêm tab. No network, no SwiftUI — the app fetches `[Device]` from
// `GET /api/v1/devices` and hands it to `DeviceCSVExport.data(for:)`, then
// writes the bytes through `.fileExporter`.
//
// Why the pieces below exist:
//
// * BOM — the file is UTF-8, but Excel on Windows/macOS only auto-detects
//   UTF-8 when the stream starts with EF BB BF; without it Vietnamese
//   diacritics render as mojibake. `data(for:)` always prefixes it.
// * RFC 4180 quoting — a device named `Tai nghe, "xịn"` must not break the
//   row structure, so any field containing the delimiter, a double quote or a
//   line break is wrapped in quotes with inner quotes doubled.
// * Plain numbers — money is written as bare digits (`49990000`), never the
//   app's on-screen `49.990.000 ₫`, so a spreadsheet parses it as a number.
//   The on-screen Vietnamese formatting is unchanged and lives in the app.
public enum DeviceCSVExport {

    // MARK: Constants

    /// UTF-8 BOM bytes, prefixed to every produced file.
    public static let byteOrderMark: [UInt8] = [0xEF, 0xBB, 0xBF]

    /// RFC 4180 record separator. Excel accepts both, but CRLF is the spec.
    public static let recordSeparator = "\r\n"

    /// RFC 4180 field delimiter.
    public static let delimiter = ","

    /// Column headers, in export order. Vietnamese, like every user-facing
    /// string in the app. `Giá mua (VND)` names the unit so the value itself
    /// can stay a bare number.
    public static let header: [String] = [
        L.t("Tên"),
        L.t("Danh mục"),
        L.t("Hãng"),
        "Model",
        L.t("Số seri"),
        L.t("Ngày mua"),
        L.t("Giá mua (VND)"),
        L.t("Hết bảo hành"),
        L.t("Trạng thái"),
    ]

    // MARK: Field escaping

    /// Escapes one field per RFC 4180.
    ///
    /// `nil` and `""` both become an empty (unquoted) field — there is no way
    /// to distinguish "absent" from "empty" in CSV, and spreading `nil` as the
    /// literal "nil" would be a bug.
    public static func field(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "" }
        // Scalar comparison, not `contains("\n")`: Swift's `Character` treats a
        // CRLF pair as a *single* grapheme, so a character-wise test would miss
        // `"a\r\nb"` entirely and emit a broken row.
        let needsQuoting = value.contains(delimiter)
            || value.contains("\"")
            || value.unicodeScalars.contains { $0 == "\n" || $0 == "\r" }
        guard needsQuoting else { return value }
        // Double every inner quote, then wrap the whole field.
        return "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }

    /// Joins already-escaped-aware values into one CSV record (no line break).
    public static func record(_ values: [String?]) -> String {
        values.map(field).joined(separator: delimiter)
    }

    // MARK: Document

    /// The full CSV text: header row + one row per device, CRLF-terminated.
    ///
    /// - Parameter categoryLabel: code → display name. Defaults to the shared
    ///   `CategoryLabels` table (`LAPTOP` → `Laptop`); injectable so tests
    ///   don't depend on that table's contents.
    public static func csv(
        for devices: [Device],
        categoryLabel: (String?) -> String = { CategoryLabels.label(for: $0) }
    ) -> String {
        var lines: [String] = [record(header.map { Optional($0) })]
        for device in devices {
            lines.append(record([
                device.name,
                categoryLabel(device.category),
                device.brand,
                device.model,
                device.serialNumber,
                day(device.purchaseDate),
                String(device.purchasePrice),
                device.effectiveWarrantyEnd.map { day($0) },
                device.status.label,
            ]))
        }
        return lines.joined(separator: recordSeparator) + recordSeparator
    }

    /// The bytes to write: UTF-8 BOM followed by `csv(for:)`.
    ///
    /// Callers must write these bytes verbatim (no `String` round-trip) or the
    /// BOM is lost.
    public static func data(
        for devices: [Device],
        categoryLabel: (String?) -> String = { CategoryLabels.label(for: $0) }
    ) -> Data {
        var out = Data(byteOrderMark)
        out.append(Data(csv(for: devices, categoryLabel: categoryLabel).utf8))
        return out
    }

    /// `yyyy-MM-dd` — a plain, locale-independent calendar date. Spreadsheets
    /// parse it natively and it sorts correctly, unlike `dd/MM/yyyy`.
    ///
    /// The zone is the **device's own**, via `WireDay`, which is the point: this
    /// used to be pinned to `Asia/Ho_Chi_Minh` "to match `WVFormat.isoDay` in the
    /// app", and both were wrong the same way. A `Device` reaches this function
    /// with `purchaseDate` / `effectiveWarrantyEnd` already decoded, and the
    /// decoder reads those Z-less wire values in the device's zone — so a
    /// Vietnam-pinned format re-exported the day *before* the one the app draws on
    /// screen for every device east of UTC+7 (`"2026-03-02"` → `"2026-03-01"`).
    /// The file must say what the user is looking at.
    ///
    /// `timeZone` is a parameter only so the rule can be pinned in tests; every
    /// caller in the app takes the default.
    public static func day(_ date: Date, in timeZone: TimeZone = .current) -> String {
        WireDay.string(from: date, in: timeZone)
    }
}
