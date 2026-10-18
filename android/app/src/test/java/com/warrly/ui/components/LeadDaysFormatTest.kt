package com.warrly.ui.components

import com.warrly.R
import com.warrly.i18n.ResCatalog
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The detail-card schedule (`leadDaysValue`), in both languages.
 *
 * The point of this test is the exact Vietnamese sentence the feature promises:
 * `"Nhắc trước 30 và 7 ngày"` is the row label plus this value. It also pins
 * the two easy-to-get-wrong cases — `0` is a real day (the expiry day), not
 * "unset", and a single `1` must read `"1 day"` in English where the other
 * counts read `"days"`.
 */
class LeadDaysFormatTest {

    private val vi = ResCatalog.vietnamese()
    private val en = ResCatalog.english()

    @Test
    fun vietnameseRendersTheExampleSentence() {
        assertEquals("Nhắc trước", vi.get(R.string.lead_days_label))
        assertEquals("30 và 7 ngày", leadDaysValue(vi, listOf(30, 7)))
    }

    @Test
    fun englishRendersTheSameSchedule() {
        assertEquals("Reminder lead time", en.get(R.string.lead_days_label))
        assertEquals("30 and 7 days", leadDaysValue(en, listOf(30, 7)))
    }

    @Test
    fun threeDaysUseAListAndTheFinalConjunction() {
        assertEquals("60, 30 và 7 ngày", leadDaysValue(vi, listOf(60, 30, 7)))
        assertEquals("60, 30 and 7 days", leadDaysValue(en, listOf(60, 30, 7)))
    }

    @Test
    fun aSingleDayUsesTheEnglishSingular() {
        assertEquals("1 ngày", leadDaysValue(vi, listOf(1)))
        assertEquals("1 day", leadDaysValue(en, listOf(1)))
        assertEquals("30 ngày", leadDaysValue(vi, listOf(30)))
        assertEquals("30 days", leadDaysValue(en, listOf(30)))
    }

    @Test
    fun zeroIsTheExpiryDayNotAnEmptySchedule() {
        assertEquals("0 ngày", leadDaysValue(vi, listOf(0)))
        assertEquals("0 days", leadDaysValue(en, listOf(0)))
    }

    @Test
    fun inputIsSortedDescendingAndDedupedBeforeDisplay() {
        // The server sorts too, but a cached/hand-built payload must not print
        // "7 và 30", which would look like a different schedule.
        assertEquals("30 và 7 ngày", leadDaysValue(vi, listOf(7, 30, 7)))
    }

    @Test
    fun anEmptyScheduleRendersNoRowAtAll() {
        // The DTO default keeps this from happening against an older server; a
        // caller that passes `[]` gets no value rather than " ngày".
        assertNull(leadDaysValue(vi, emptyList()))
        assertNull(leadDaysValue(en, emptyList()))
    }
}
