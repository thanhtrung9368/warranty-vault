package com.warrantyvault.app.i18n

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Pins the ONE rule that decides which language the app renders in.
 *
 * It is a pure function precisely so it can be tested here: `LanguageStore` and
 * `MainActivity.attachBaseContext` are Android glue around it, and the failure
 * this guards against — an English app for a Vietnamese user, or the reverse —
 * is invisible in a build and easy to get backwards in a refactor.
 *
 * The precedence under test is `docs/I18N_PLAN.md` §2.2/§2.4 for the UI half:
 * an explicit choice wins, then the system language, then English.
 */
class AppLanguageTest {

    // ---- Explicit choice wins ----

    @Test
    fun storedChoiceBeatsTheSystemLanguage() {
        assertEquals(AppLanguage.Vi, AppLanguage.resolve("vi", "en"))
        assertEquals(AppLanguage.En, AppLanguage.resolve("en", "vi"))
    }

    @Test
    fun storedTagIsTrimmedAndCaseInsensitive() {
        assertEquals(AppLanguage.Vi, AppLanguage.resolve("  VI ", "en"))
        assertEquals(AppLanguage.En, AppLanguage.resolve("EN", "vi"))
        assertEquals(AppLanguage.Vi, AppLanguage.resolve("vi-VN", "en"))
    }

    // ---- System language is the fallback, NOT the product default ----

    @Test
    fun vietnameseSystemGetsVietnameseWithoutAnyChoice() {
        // §2.4: "điện thoại họ đặt tiếng Việt → nhận tiếng Việt". A phone is a
        // signal the user gave us, and values-vi/ exists to honour it.
        assertEquals(AppLanguage.Vi, AppLanguage.resolve(null, "vi"))
        assertEquals(AppLanguage.Vi, AppLanguage.resolve(null, "vi-VN"))
        assertEquals(AppLanguage.Vi, AppLanguage.resolve("", "vi"))
    }

    @Test
    fun anyOtherSystemLanguageFallsBackToEnglish() {
        // The product default (the repo owner's decision), and the same answer
        // Android's own resource resolution gives for a values/-only match.
        assertEquals(AppLanguage.En, AppLanguage.resolve(null, "en"))
        assertEquals(AppLanguage.En, AppLanguage.resolve(null, "fr"))
        assertEquals(AppLanguage.En, AppLanguage.resolve(null, "ja-JP"))
        assertEquals(AppLanguage.En, AppLanguage.resolve(null, null))
        assertEquals(AppLanguage.En, AppLanguage.resolve(null, ""))
    }

    /**
     * An unsupported language must DEGRADE, never throw: a stored `"fr"` (a web
     * phase-4 value, a hand-edited pref, a future third language) falls through
     * to the system language rather than raising from `attachBaseContext` — which
     * would be a crash on every launch, with no way back through the UI.
     */
    @Test
    fun unsupportedStoredValueFallsThroughInsteadOfFailing() {
        assertEquals(AppLanguage.En, AppLanguage.resolve("fr", "en"))
        assertEquals(AppLanguage.Vi, AppLanguage.resolve("fr", "vi"))
        assertEquals(AppLanguage.En, AppLanguage.resolve("klingon", null))
    }

    @Test
    fun fromTagOnlyAcceptsTheTwoShippedLanguages() {
        assertEquals(AppLanguage.Vi, AppLanguage.fromTag("vi"))
        assertEquals(AppLanguage.En, AppLanguage.fromTag("en"))
        assertEquals(null, AppLanguage.fromTag("fr"))
        assertEquals(null, AppLanguage.fromTag(null))
        assertEquals(null, AppLanguage.fromTag("   "))
    }

    @Test
    fun tagsAreTheOnesTheApiAcceptsAndSends() {
        // `User.locale` is CHECK-constrained to two lowercase letters server-side
        // and `Accept-Language` is parsed by golang.org/x/text/language, so these
        // two values are contract, not cosmetics.
        assertEquals("en", AppLanguage.En.tag)
        assertEquals("vi", AppLanguage.Vi.tag)
        assertEquals(AppLanguage.En, AppLanguage.DEFAULT)
    }
}
