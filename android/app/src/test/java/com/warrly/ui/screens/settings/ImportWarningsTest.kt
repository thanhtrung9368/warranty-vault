package com.warrly.ui.screens.settings

import com.warrly.R
import com.warrly.i18n.ResCatalog
import com.warrly.network.ApiClient
import com.warrly.network.ImportResultResponse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The presence/absence rule for the backup-restore provenance warning, plus the
 * two frame strings in both languages.
 *
 * What is genuinely covered here:
 *  - the API's `warnings[]` decodes into [com.warrly.network.ImportResult] and
 *    survives verbatim (it is display-ready text, not a code);
 *  - a clean import decodes to no warnings and therefore produces NO card;
 *  - blank entries are dropped instead of drawing an empty orange box;
 *  - the title/reassurance frame exists in English and Vietnamese.
 *
 * What is NOT covered: whether the card is actually visible on the Settings
 * screen, pinned above the scrolling content, with the right colour and contrast.
 * There is no Compose UI-test dependency in this module (see
 * app/build.gradle.kts), so that is screenshot/manual territory only.
 */
class ImportWarningsTest {

    private val json = ApiClient.json

    private fun decode(resultJson: String): ImportResultResponse =
        json.decodeFromString(ImportResultResponse.serializer(), """{"ok":true,"result":$resultJson}""")

    @Test
    fun aCleanImportHasNothingToShow() {
        // Exactly what a v5 payload WITH `instantTimeZone: "UTC"` (or a v6 ZIP)
        // produces: ImportResult.Warnings is `omitempty`, so the key is absent.
        val result = decode("""{"imported":3,"skipped":0,"subImported":1}""").result

        assertTrue("the wire omits warnings on a clean import", result.warnings.isEmpty())
        assertTrue(
            "no warnings must render no card — this is the normal path",
            importWarningsForDisplay(result.warnings).isEmpty(),
        )
    }

    @Test
    fun theApiWarningIsShownByteForByte() {
        val warning = "Bản sao lưu này không ghi múi giờ cho các mốc thời gian. " +
            "Nếu file được xuất trước khi Warrly sửa lỗi múi giờ, một số mốc có thể lệch 7 giờ. " +
            "Warrly giữ nguyên các mốc đã nhập; ngày tháng như ngày mua không bị ảnh hưởng."

        val shown = importWarningsForDisplay(decode("""{"imported":1,"warnings":["$warning"]}""").result.warnings)

        assertEquals(
            "the API sentence is the copy — the app must not trim/reword/reformat it",
            listOf(warning),
            shown,
        )
    }

    @Test
    fun allWarningsKeepTheServerOrder() {
        val first = "Cảnh báo một."
        val second = "Cảnh báo hai."
        val shown = importWarningsForDisplay(
            decode("""{"imported":1,"warnings":["$first","$second"]}""").result.warnings,
        )

        assertEquals(listOf(first, second), shown)
    }

    @Test
    fun blankEntriesDoNotDrawAnEmptyCard() {
        assertTrue(importWarningsForDisplay(listOf("", "   ")).isEmpty())
        assertEquals(
            "only the real sentence survives, so a blank entry cannot become an empty bullet",
            listOf("Cảnh báo thật."),
            importWarningsForDisplay(listOf("", "Cảnh báo thật.", "  ")),
        )
    }

    @Test
    fun theCardFrameIsBilingualWithEnglishAsTheDefault() {
        val en = ResCatalog.english()
        val vi = ResCatalog.vietnamese()

        // `values/` is Android's default folder (= English here); `values-vi/`
        // is the translation. Pinning both exact strings catches a copy-paste
        // that leaves English in the Vietnamese catalog (or vice versa).
        assertEquals("Restored, but worth a look", en.get(R.string.set_import_warning_title))
        assertEquals("Đã khôi phục, nhưng nên xem lại", vi.get(R.string.set_import_warning_title))
        assertEquals(
            "Your data is restored — this is a warning, not an error.",
            en.get(R.string.set_import_warning_body),
        )
        assertEquals(
            "Dữ liệu đã được khôi phục — đây là cảnh báo, không phải lỗi.",
            vi.get(R.string.set_import_warning_body),
        )
        assertNotEquals(
            "an untranslated frame would silently render English on a Vietnamese screen",
            en.get(R.string.set_import_warning_body),
            vi.get(R.string.set_import_warning_body),
        )
    }
}
