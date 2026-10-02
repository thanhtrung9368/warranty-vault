package com.warrantyvault.app.export

import com.warrantyvault.app.network.Device
import com.warrantyvault.app.network.DeviceStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime

/**
 * `CsvExport` — the client-side CSV writer behind Settings → "Xuất CSV (Excel)".
 *
 * The assertions are byte/char level on purpose: a CSV that "looks fine" in a
 * text editor still lands all in column A in Excel (wrong delimiter), turns
 * "Máy giặt" into "MÃ¡y giáº·t" (missing BOM) or splits a row in two (unquoted
 * newline). Each of those regressions has an explicit test below.
 */
class CsvExportTest {

    private fun device(
        name: String = "iPhone 15 Pro",
        category: String = "PHONE",
        brand: String? = "Apple",
        model: String? = "A2848",
        serialNumber: String? = "SN-001",
        purchaseDate: String = "2024-03-01",
        purchasePrice: Int = 30_000_000,
        purchasePlace: String? = "CellphoneS",
        status: DeviceStatus = DeviceStatus.ACTIVE,
        effectiveWarrantyEnd: String? = "2026-03-01",
        notes: String? = null,
    ) = Device(
        id = "dev-1",
        name = name,
        category = category,
        brand = brand,
        model = model,
        serialNumber = serialNumber,
        purchaseDate = purchaseDate,
        purchasePrice = purchasePrice,
        purchasePlace = purchasePlace,
        status = status,
        notes = notes,
        effectiveWarrantyEnd = effectiveWarrantyEnd,
    )

    // ---- Escaping: delimiter ------------------------------------------------

    @Test
    fun fieldContainingTheActiveDelimiterIsQuoted() {
        // `;` is the default, so a semicolon inside a value must be quoted.
        assertEquals("\"Loa; 2 loa\"", escapeCsvField("Loa; 2 loa", CsvDelimiter.SEMICOLON))
        // The same value is harmless when the active delimiter is `,`.
        assertEquals("Loa; 2 loa", escapeCsvField("Loa; 2 loa", CsvDelimiter.COMMA))
        // ...and vice versa.
        assertEquals("\"Chuột, không dây\"", escapeCsvField("Chuột, không dây", CsvDelimiter.COMMA))
        assertEquals("Chuột, không dây", escapeCsvField("Chuột, không dây", CsvDelimiter.SEMICOLON))
    }

    @Test
    fun delimiterInsideANameDoesNotSplitTheRow() {
        val csv = devicesCsv(listOf(device(name = "Loa; 2 loa")), CsvDelimiter.SEMICOLON)

        // The name's own `;` stays inside the quotes, so the record still has
        // exactly 11 columns when a reader that honours RFC 4180 parses it.
        assertEquals(
            "\uFEFF" +
                "Tên thiết bị;Danh mục;Hãng;Model;Số seri;Ngày mua;Giá mua;Nơi mua;" +
                "Trạng thái;Hết bảo hành;Ghi chú\r\n" +
                "\"Loa; 2 loa\";Điện thoại;Apple;A2848;SN-001;01/03/2024;30000000;" +
                "CellphoneS;Đang dùng;01/03/2026;\r\n",
            csv,
        )
    }

    // ---- Escaping: double quote ---------------------------------------------

    @Test
    fun fieldContainingADoubleQuoteIsQuotedAndInnerQuotesDoubled() {
        assertEquals("\"Màn 15\"\"\"", escapeCsvField("Màn 15\"", CsvDelimiter.SEMICOLON))
        assertEquals("\"\"\"\"", escapeCsvField("\"", CsvDelimiter.SEMICOLON))
        // A quote needs quoting regardless of the delimiter.
        assertEquals("\"Màn 15\"\"\"", escapeCsvField("Màn 15\"", CsvDelimiter.COMMA))
    }

    // ---- Escaping: newline --------------------------------------------------

    @Test
    fun fieldContainingANewlineIsQuoted() {
        assertEquals("\"a\nb\"", escapeCsvField("a\nb", CsvDelimiter.SEMICOLON))
        assertEquals("\"a\r\nb\"", escapeCsvField("a\r\nb", CsvDelimiter.SEMICOLON))
        assertEquals("\"a\rb\"", escapeCsvField("a\rb", CsvDelimiter.SEMICOLON))
        // The embedded newline survives verbatim — only records are CRLF-joined.
        assertTrue(serializeCsv(listOf(listOf("a\nb"))).contains("\"a\nb\"\r\n"))
    }

    @Test
    fun plainFieldIsLeftUnquoted() {
        assertEquals("Máy giặt", escapeCsvField("Máy giặt", CsvDelimiter.SEMICOLON))
        assertEquals("Tủ lạnh", escapeCsvField("Tủ lạnh", CsvDelimiter.SEMICOLON))
        assertEquals("", escapeCsvField(null, CsvDelimiter.SEMICOLON))
    }

    // ---- BOM ---------------------------------------------------------------

    @Test
    fun theProducedBytesStartWithTheUtf8Bom() {
        val bytes = devicesCsvBytes(listOf(device()))

        // Raw bytes, not the string: this is literally what Excel sniffs.
        assertEquals(0xEF, bytes[0].toInt() and 0xFF)
        assertEquals(0xBB, bytes[1].toInt() and 0xFF)
        assertEquals(0xBF, bytes[2].toInt() and 0xFF)
        assertEquals(
            listOf(0xEF, 0xBB, 0xBF),
            bytes.copyOfRange(0, 3).map { it.toInt() and 0xFF },
        )
        // Byte 4 is 'T' of "Tên thiết bị" — UTF-8, no other preamble.
        assertEquals('T'.code, bytes[3].toInt())
        // And the string form puts U+FEFF exactly once, at index 0.
        val text = devicesCsv(listOf(device()))
        assertEquals(0, text.indexOf(Csv.BOM))
        assertEquals(0, text.lastIndexOf(Csv.BOM))

        println(
            "BOM bytes = " + bytes.copyOfRange(0, 8).joinToString(" ") { "%02X".format(it) },
        )
    }

    @Test
    fun vietnameseDiacriticsSurviveTheUtf8RoundTrip() {
        val bytes = devicesCsvBytes(listOf(device(name = "Máy giặt")))
        val decoded = String(bytes.copyOfRange(3, bytes.size), Charsets.UTF_8)
        assertTrue(decoded.startsWith("Tên thiết bị;Danh mục;Hãng;Model;Số seri;Ngày mua"))
        assertTrue(decoded.contains("Máy giặt"))
        // What a legacy-ANSI reader would have shown — the BOM is the fix.
        assertTrue(!decoded.contains("MÃ¡y"))
    }

    // ---- Numbers / empty / nullable ----------------------------------------

    @Test
    fun zeroIsWrittenAsTheDigitZeroNotAnEmptyCell() {
        assertEquals("0", csvNumber(0))
        assertEquals("0", csvNumber(0L))
        val row = deviceCsvRow(device(purchasePrice = 0))
        assertEquals("0", row[DEVICE_CSV_HEADER.indexOf("Giá mua")])
    }

    @Test
    fun numbersArePlainDigitsWithoutSymbolsOrSeparators() {
        assertEquals("30000000", csvNumber(30_000_000))
        assertEquals("1500000", csvNumber(1_500_000L))
        // No "đ", no "15.000.000", no "15,000,000" anywhere in the file.
        val csv = devicesCsv(listOf(device(purchasePrice = 30_000_000)))
        assertTrue(csv.contains(";30000000;"))
        assertTrue(!csv.contains("30.000.000"))
        assertTrue(!csv.contains("đ"))
    }

    @Test
    fun nullNumbersAndTextBecomeEmptyCellsNeverTheWordNull() {
        assertEquals("", csvNumber(null))
        assertEquals("", csvText(null))
        assertEquals("", csvText(""))
    }

    @Test
    fun nullableDeviceFieldsBecomeEmptyCellsNotTheStringNull() {
        val row = deviceCsvRow(
            device(brand = null, model = null, serialNumber = null, notes = null),
        )
        assertEquals("", row[DEVICE_CSV_HEADER.indexOf("Hãng")])
        assertEquals("", row[DEVICE_CSV_HEADER.indexOf("Model")])
        assertEquals("", row[DEVICE_CSV_HEADER.indexOf("Số seri")])
        assertEquals("", row[DEVICE_CSV_HEADER.indexOf("Ghi chú")])

        val csv = devicesCsv(
            listOf(device(brand = null, model = null, serialNumber = null, notes = null)),
        )
        assertTrue("must not leak the literal word: $csv", !csv.contains("null"))
    }

    @Test
    fun aDeviceWithNoWarrantyShowsAnEmptyWarrantyEnd() {
        // `effectiveWarrantyEnd == null` means "no warranty row at all", which is
        // NOT the same as expired — the cell stays empty instead of guessing.
        val row = deviceCsvRow(device(effectiveWarrantyEnd = null))
        assertEquals("", row[DEVICE_CSV_HEADER.indexOf("Hết bảo hành")])
    }

    // ---- Dates --------------------------------------------------------------

    @Test
    fun datesAreReformattedToVietnameseDayMonthYear() {
        assertEquals("01/03/2024", csvDate("2024-03-01"))
        // RFC3339 (what Go sends for the effective end) is sliced, not shifted.
        assertEquals("01/03/2026", csvDate("2026-03-01T00:00:00Z"))
        assertEquals("31/12/2025", csvDate("2025-12-31T23:59:59+07:00"))
    }

    @Test
    fun missingOrUnparseableDatesBecomeEmptyCells() {
        assertEquals("", csvDate(null))
        assertEquals("", csvDate(""))
        assertEquals("", csvDate("   "))
        assertEquals("", csvDate("hôm qua"))
        assertEquals("", csvDate("01/03/2024"))
    }

    // ---- Device table -------------------------------------------------------

    @Test
    fun categoryComesFromTheSharedCategoryLabelsTable() {
        assertEquals("Điện thoại", deviceCsvRow(device(category = "PHONE"))[1])
        assertEquals("Máy ảnh / Quay phim", deviceCsvRow(device(category = "CAMERA"))[1])
        assertEquals("Tivi", deviceCsvRow(device(category = "TV"))[1])
        // No private label map: unknown / blank codes degrade exactly like the UI.
        assertEquals("DRONE", deviceCsvRow(device(category = "DRONE"))[1])
        assertEquals("Khác", deviceCsvRow(device(category = ""))[1])
        // Legacy lowercase codes still resolve (the drift regression).
        assertEquals("Laptop", deviceCsvRow(device(category = "laptop"))[1])
    }

    @Test
    fun statusUsesTheVietnameseLabelTheListShows() {
        for (status in DeviceStatus.entries) {
            assertEquals(status.label, deviceCsvRow(device(status = status))[8])
        }
        assertEquals("Đang dùng", deviceCsvRow(device())[8])
    }

    @Test
    fun headerMatchesTheWebExportColumnOrder() {
        assertEquals(
            listOf(
                "Tên thiết bị", "Danh mục", "Hãng", "Model", "Số seri",
                "Ngày mua", "Giá mua", "Nơi mua", "Trạng thái", "Hết bảo hành", "Ghi chú",
            ),
            DEVICE_CSV_HEADER,
        )
    }

    @Test
    fun everyRowCarriesExactlyTheHeaderFieldCount() {
        val devices = listOf(
            device(),
            device(name = "Loa; 2 loa", brand = null, category = ""),
            device(name = "Màn 15\"", model = null, effectiveWarrantyEnd = null),
        )
        val table = devicesCsvTable(devices)
        assertEquals(3, table.rows.size)
        for ((i, row) in table.rows.withIndex()) {
            assertEquals("row $i", DEVICE_CSV_HEADER.size, row.size)
        }
    }

    @Test
    fun emptyDeviceListStillProducesABomAndHeaderOnlyFile() {
        val csv = devicesCsv(emptyList())
        assertEquals(Csv.BOM + DEVICE_CSV_HEADER.joinToString(";") + "\r\n", csv)
        val table = devicesCsvTable(emptyList())
        assertEquals(DEVICE_CSV_HEADER, table.header)
        assertTrue(table.rows.isEmpty())
    }

    // ---- Whole-file output --------------------------------------------------

    @Test
    fun trickyValuesLandInExactlyThisEscapedCsv() {
        val csv = devicesCsv(
            listOf(
                device(
                    // delimiter + double quote + newline in one value
                    name = "Loa \"Sony\"; 2 loa\nloại nhỏ",
                    category = "SPEAKER",
                    brand = null,
                    model = "SRS-XB100",
                    serialNumber = null,
                    purchaseDate = "2024-03-01",
                    purchasePrice = 0,
                    purchasePlace = "Shopee",
                    status = DeviceStatus.ACTIVE,
                    effectiveWarrantyEnd = null,
                    notes = null,
                ),
            ),
            CsvDelimiter.SEMICOLON,
        )

        val expected =
            "\uFEFF" +
                "Tên thiết bị;Danh mục;Hãng;Model;Số seri;Ngày mua;Giá mua;Nơi mua;" +
                "Trạng thái;Hết bảo hành;Ghi chú\r\n" +
                "\"Loa \"\"Sony\"\"; 2 loa\nloại nhỏ\";Loa;;SRS-XB100;;01/03/2024;0;Shopee;" +
                "Đang dùng;;\r\n"

        assertEquals(expected, csv)
        println("exact CSV = " + csv.replace("\r\n", "⏎\n").replace(Csv.BOM.toString(), "<BOM>"))
    }

    @Test
    fun recordsAreCrlfTerminatedIncludingTheLastOne() {
        val csv = devicesCsv(listOf(device(), device(name = "Tủ lạnh")))
        assertTrue(csv.endsWith("\r\n"))
        assertEquals(3, csv.split("\r\n").size - 1) // header + 2 rows, trailing empty
        // The only bare LFs would be ones embedded in quoted values; none here.
        assertEquals(0, csv.count { it == '\n' } - csv.count { it == '\r' })
    }

    @Test
    fun commaDelimiterIsAvailableForSpreadsheetsThatWantRfc4180() {
        val csv = devicesCsv(listOf(device(name = "Chuột, không dây")), CsvDelimiter.COMMA)
        assertEquals(
            "\uFEFF" +
                "Tên thiết bị,Danh mục,Hãng,Model,Số seri,Ngày mua,Giá mua,Nơi mua," +
                "Trạng thái,Hết bảo hành,Ghi chú\r\n" +
                "\"Chuột, không dây\",Điện thoại,Apple,A2848,SN-001,01/03/2024,30000000," +
                "CellphoneS,Đang dùng,01/03/2026,\r\n",
            csv,
        )
    }

    @Test
    fun bomCanBeTurnedOffForRoundTripTesting() {
        val csv = serializeCsv(listOf(listOf("a")), CsvDelimiter.SEMICOLON, bom = false)
        assertEquals("a\r\n", csv)
        assertEquals(-1, csv.indexOf(Csv.BOM))
    }

    // ---- File name ----------------------------------------------------------

    @Test
    fun fileNameIsAnAsciiSlugWithAMinuteTimestamp() {
        assertEquals(
            "warrantyvault-thiet-bi-20250115-1030.csv",
            csvFileName(LocalDateTime.of(2025, 1, 15, 10, 30)),
        )
        // Slug is ASCII so no OS / mail round-trip mangles it.
        assertTrue(csvFileName(LocalDateTime.of(2025, 1, 15, 10, 30)).all { it.code < 128 })
        assertTrue(csvFileName().endsWith(".csv"))
    }
}
