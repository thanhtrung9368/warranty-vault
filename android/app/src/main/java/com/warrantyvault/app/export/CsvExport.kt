package com.warrantyvault.app.export

import com.warrantyvault.app.network.Device
import com.warrantyvault.app.ui.components.CategoryLabels
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

// Client-side CSV export.
//
// Everything here is a pure function over the plain `Device` rows the app
// already fetches (`GET /api/v1/devices`, the same call the "Thiết bị" tab
// makes) — no HTTP, no Android / Compose types, no clock reads except the
// injectable file-name default. That keeps it JVM-testable in
// `app/src/test/java/com/warrantyvault/app/export/CsvExportTest.kt` and means
// the export adds no API surface whatsoever: the data never leaves the device
// except through the file the user picks.
//
// Mirrors the web export (`website/src/lib/csv.ts` + `csv-export.ts`) so the
// same account produces the same spreadsheet from either client; the column
// labels are the Vietnamese ones the UI already shows.
//
// DECISIONS (the parts that are easy to get wrong):
//
// 1. DELIMITER — `;` by default ([CsvDelimiter.SEMICOLON]), configurable
//    per call. Excel derives its list separator from the system locale and
//    vi-VN uses `;`, so a comma-delimited file double-clicked on a Vietnamese
//    Windows machine dumps every field into column A. This app is
//    Vietnamese-only and the web export defaults to `;` too, so `;` is the
//    default here. `,` (RFC 4180) stays available via the parameter for Google
//    Sheets / en-locale Excel users. A field containing the *active* delimiter
//    is quoted, so both choices round-trip.
//    We deliberately do NOT emit Excel's `sep=;` magic first line: Excel
//    honours it, every other parser shows it as a literal first row.
//
// 2. BOM — always prefixed. Excel reads a `.csv` as the machine's legacy ANSI
//    codepage unless the file starts with U+FEFF, which arrives as the three
//    bytes EF BB BF in UTF-8; without it "Máy giặt" shows up as "MÃ¡y giáº·t".
//    `csvBytes()` is the only writer used by the UI, and the tests assert
//    `bytes[0..2] == EF BB BF` on the *actual* bytes, not just the string.
//
// 3. MONEY — `csvNumber()` writes a bare number (`15000000`), never
//    `15.000.000đ`. A spreadsheet must see a number to sum or sort it; the
//    Vietnamese currency formatting stays in the UI (`formatVnd`).
//
// 4. QUOTING — RFC 4180 minimal quoting: a field is wrapped in `"` (inner `"`
//    doubled) only when it contains the active delimiter, a `"`, CR or LF.
//    Plain fields stay bare so the file is readable in a text editor.
//
// 5. LINE ENDINGS — CRLF (RFC 4180) with a trailing CRLF after the last
//    record; Excel, Sheets and LibreOffice all accept it.
//
// 6. FORMULA INJECTION — values are written verbatim. Prefixing a leading
//    `=`, `+`, `-` or `@` with an apostrophe is the usual defence, but it
//    corrupts legitimate values (a device name starting with `-`) and the file
//    only ever contains the signed-in user's own records, which they open
//    themselves. Round-trip fidelity wins, same call as the web export.
//
// 7. NO warranty-package sheet: `GET /api/v1/devices` returns the list
//    projection, which carries `effectiveWarrantyEnd` but not the individual
//    `Warranty` rows (`services.DeviceListItem` in Go). Emitting one row per
//    warranty package would mean N extra `GET /api/v1/devices/{id}` calls —
//    the brief says build from what the app already fetches, so the export
//    sticks to devices and the effective warranty end.

/**
 * Delimiter used between fields.
 *
 * @property symbol the literal character written between cells and the one a
 *   field must contain to be quoted.
 */
enum class CsvDelimiter(val symbol: Char) {
    /** `,` — RFC 4180, the portable choice (Google Sheets, Numbers, en Excel). */
    COMMA(','),

    /** `;` — what Excel expects on a `vi-VN` machine; the app default. */
    SEMICOLON(';'),
}

/** Constants shared by the two public builders. */
object Csv {
    /** U+FEFF. Encoded as the UTF-8 bytes `EF BB BF` — see `csvBytes()`. */
    const val BOM: Char = '\uFEFF'

    /** RFC 4180 record separator. */
    const val LINE_ENDING: String = "\r\n"

    /** Vietnamese-Excel-friendly default — see decision 1 in the file header. */
    val DEFAULT_DELIMITER: CsvDelimiter = CsvDelimiter.SEMICOLON
}

/** A header row plus the data rows, both already in field order. */
data class CsvTable(
    val header: List<String>,
    val rows: List<List<String>>,
)

// ---- Field helpers ----------------------------------------------------------

/** Nullable text field: `null` becomes an empty cell, never the string "null". */
fun csvText(value: String?): String = value ?: ""

/**
 * Numeric field: bare digits, no grouping separator and no currency symbol, so
 * a spreadsheet treats the cell as a number. `0` stays `0` (an empty cell would
 * read as "unknown"), while `null` becomes empty.
 */
fun csvNumber(value: Number?): String = value?.toString() ?: ""

private val ISO_DATE = Regex("""^(\d{4})-(\d{2})-(\d{2})""")

/**
 * Date field as `dd/MM/yyyy` — the format the UI shows and what vi-VN Excel
 * parses as a real date.
 *
 * The ISO string is sliced rather than parsed into a `LocalDate` / re-formatted
 * through a time zone: the server serialises `timestamp without time zone`
 * columns as RFC3339, and a round-trip through an instant would shift the
 * calendar day for anyone west of the server. `null` or an unrecognised value
 * becomes an empty cell rather than a guess.
 */
fun csvDate(value: String?): String {
    val iso = value?.trim() ?: return ""
    val m = ISO_DATE.find(iso) ?: return ""
    return "${m.groupValues[3]}/${m.groupValues[2]}/${m.groupValues[1]}"
}

/**
 * Escape one field per RFC 4180, quoting only when required:
 *
 * ```
 * escapeCsvField("Máy giặt")             -> "Máy giặt"
 * escapeCsvField("Loa; 2 loa", SEMICOLON)-> "\"Loa; 2 loa\""
 * escapeCsvField("Màn 15\"", SEMICOLON)  -> "\"Màn 15\"\"\""
 * escapeCsvField("a\nb", SEMICOLON)      -> "\"a\nb\""
 * ```
 */
fun escapeCsvField(
    value: String?,
    delimiter: CsvDelimiter = Csv.DEFAULT_DELIMITER,
): String {
    val text = value ?: ""
    val needsQuoting = text.indexOf(delimiter.symbol) >= 0 ||
        text.indexOf('"') >= 0 ||
        text.indexOf('\n') >= 0 ||
        text.indexOf('\r') >= 0
    if (!needsQuoting) return text
    return '"' + text.replace("\"", "\"\"") + '"'
}

// ---- Serialisation ----------------------------------------------------------

/**
 * Serialise rows to CSV text, BOM first and a trailing CRLF after the last
 * record. Rows are written positionally, so callers keep every row the same
 * length as the header (asserted in `CsvExportTest`).
 */
fun serializeCsv(
    rows: List<List<String>>,
    delimiter: CsvDelimiter = Csv.DEFAULT_DELIMITER,
    bom: Boolean = true,
): String {
    val body = rows.joinToString(Csv.LINE_ENDING) { row ->
        row.joinToString(delimiter.symbol.toString()) { escapeCsvField(it, delimiter) }
    }
    return (if (bom) Csv.BOM.toString() else "") + body + Csv.LINE_ENDING
}

/** [serializeCsv] over a table, header included. */
fun CsvTable.toCsv(
    delimiter: CsvDelimiter = Csv.DEFAULT_DELIMITER,
    bom: Boolean = true,
): String = serializeCsv(listOf(header) + rows, delimiter, bom)

/**
 * The exact bytes handed to `ContentResolver.openOutputStream`.
 *
 * UTF-8 is what makes Vietnamese diacritics survive; the leading BOM character
 * becomes `EF BB BF`, which is what tells Excel the file is UTF-8 at all.
 */
fun csvBytes(text: String): ByteArray = text.toByteArray(Charsets.UTF_8)

// ---- Devices ----------------------------------------------------------------

/**
 * Device columns. Identical wording and order to the web export
 * (`DEVICE_CSV_HEADER` in `website/src/lib/csv-export.ts`) so a spreadsheet
 * exported from the app lines up with one exported from the site.
 */
val DEVICE_CSV_HEADER: List<String> = listOf(
    "Tên thiết bị",
    "Danh mục",
    "Hãng",
    "Model",
    "Số seri",
    "Ngày mua",
    "Giá mua",
    "Nơi mua",
    "Trạng thái",
    "Hết bảo hành",
    "Ghi chú",
)

/**
 * One device → one row, in [DEVICE_CSV_HEADER] order.
 *
 * The category goes through [CategoryLabels] (the single Android copy of the
 * web's `CATEGORY_LABELS`, which a Go test keeps in sync) — never a local
 * label map — and the status comes from [com.warrantyvault.app.network.DeviceStatus.label],
 * so the spreadsheet says "Điện thoại" / "Đang dùng" exactly like the list does.
 */
fun deviceCsvRow(device: Device): List<String> = listOf(
    csvText(device.name),
    CategoryLabels.label(device.category),
    csvText(device.brand),
    csvText(device.model),
    csvText(device.serialNumber),
    csvDate(device.purchaseDate),
    csvNumber(device.purchasePrice),
    csvText(device.purchasePlace),
    device.status.label,
    csvDate(device.effectiveWarrantyEnd),
    csvText(device.notes),
)

/** The devices table, header first. */
fun devicesCsvTable(devices: List<Device>): CsvTable = CsvTable(
    header = DEVICE_CSV_HEADER,
    rows = devices.map(::deviceCsvRow),
)

/** Ready-to-write CSV text for the device list (BOM included). */
fun devicesCsv(
    devices: List<Device>,
    delimiter: CsvDelimiter = Csv.DEFAULT_DELIMITER,
): String = devicesCsvTable(devices).toCsv(delimiter, bom = true)

/** Ready-to-write UTF-8 bytes for the device list — what the SAF row writes. */
fun devicesCsvBytes(
    devices: List<Device>,
    delimiter: CsvDelimiter = Csv.DEFAULT_DELIMITER,
): ByteArray = csvBytes(devicesCsv(devices, delimiter))

/**
 * Export file name, e.g. `warrantyvault-thiet-bi-20250115-1030.csv`.
 *
 * The slug is ASCII on purpose: Vietnamese diacritics are legal in a file name
 * but get mangled by some mail / cloud round-trips. `now` is injectable so the
 * name is deterministic under test.
 */
fun csvFileName(now: LocalDateTime = LocalDateTime.now()): String =
    "warrantyvault-thiet-bi-${now.format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmm"))}.csv"
