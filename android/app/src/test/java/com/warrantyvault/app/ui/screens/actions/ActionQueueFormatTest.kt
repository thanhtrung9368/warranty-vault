package com.warrantyvault.app.ui.screens.actions

import com.warrantyvault.app.i18n.Money
import com.warrantyvault.app.i18n.ResCatalog
import com.warrantyvault.app.network.ActionCounts
import com.warrantyvault.app.network.SnoozeResult
import com.warrantyvault.app.testing.Fixtures
import com.warrantyvault.app.ui.components.PillKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/**
 * The pure half of "Việc cần xử lý": severity mapping, ordering, the two
 * sets (actionable vs snoozed), the badge rule, destination mapping and the
 * Vietnamese labels the screen prints.
 *
 * The screen itself is compile-verified only (no emulator), so anything that
 * decides *what the user reads* is pinned here instead.
 */
class ActionQueueFormatTest {

    /** The Vietnamese original and the English translation, off disk. */
    private val vi = ResCatalog.vietnamese()
    private val en = ResCatalog.english()

    // ---- severity ----

    @Test
    fun severity_mapsTheThreeCodesAndDegradesAnyUnknownOne() {
        assertEquals(ActionSeverity.HIGH, actionSeverityOf("HIGH"))
        assertEquals(ActionSeverity.MEDIUM, actionSeverityOf("MEDIUM"))
        assertEquals(ActionSeverity.LOW, actionSeverityOf("LOW"))
        // A code a future server adds must render, not throw away the queue.
        assertEquals(ActionSeverity.UNKNOWN, actionSeverityOf("CRITICAL"))
        assertEquals(ActionSeverity.UNKNOWN, actionSeverityOf(""))
        // Case/whitespace tolerance: the code is UPPER_SNAKE by contract.
        assertEquals(ActionSeverity.HIGH, actionSeverityOf(" high "))
    }

    @Test
    fun severity_ordersHighFirstAndUnknownLast() {
        val ordered = listOf("LOW", "HIGH", "CRITICAL", "MEDIUM")
            .map { actionSeverityOf(it) }
            .sortedBy { it.rank }

        assertEquals(
            listOf(
                ActionSeverity.HIGH,
                ActionSeverity.MEDIUM,
                ActionSeverity.LOW,
                ActionSeverity.UNKNOWN,
            ),
            ordered,
        )
    }

    @Test
    fun severity_pillKindsAreDistinctSoTwoSeveritiesNeverLookAlike() {
        val kinds = listOf(
            ActionSeverity.HIGH,
            ActionSeverity.MEDIUM,
            ActionSeverity.LOW,
            ActionSeverity.UNKNOWN,
        ).map { it.pill }
        assertEquals(kinds.size, kinds.toSet().size)
        assertEquals(PillKind.Danger, ActionSeverity.HIGH.pill)
    }

    // ---- actionable vs snoozed ----

    /**
     * `?snoozed=true` only ADDS rows: the server never removes one. So the split
     * has to be computed from `snoozedUntil` and nothing else — a row without it
     * is actionable even when it arrived in a snoozed read.
     */
    @Test
    fun actionableAndSnoozed_partitionTheRowsBySnoozedUntil() {
        val actionable = Fixtures.actionItem(itemKey = "A:1")
        val snoozed = Fixtures.actionItem(
            itemKey = "B:2",
            snoozedUntil = "2026-06-01T00:00:00Z",
        )
        val rows = listOf(actionable, snoozed)

        assertEquals(listOf(actionable), actionableItems(rows))
        assertEquals(listOf(snoozed), snoozedItems(rows))
        assertEquals(rows.size, actionableItems(rows).size + snoozedItems(rows).size)
    }

    @Test
    fun blankSnoozedUntilIsNotASnooze() {
        val row = Fixtures.actionItem(snoozedUntil = "   ")
        assertFalse(row.isSnoozed)
        assertEquals(listOf(row), actionableItems(listOf(row)))
    }

    // ---- the badge rule ----

    /**
     * The one rule a badge must never break: `counts` describes the ACTIONABLE
     * set even when `?snoozed=true` added rows, so the number cannot change
     * meaning with a display flag. Here `items` holds 3 rows while the workload
     * is 2 — reading `items.size` would over-report by exactly the snoozed row.
     */
    @Test
    fun badge_readsCountsNeverTheVisibleRowCount() {
        val queue = Fixtures.actionQueue(
            items = listOf(
                Fixtures.actionItem(itemKey = "A:1", severity = "HIGH"),
                Fixtures.actionItem(itemKey = "B:2", severity = "LOW"),
                Fixtures.actionItem(
                    itemKey = "C:3",
                    severity = "HIGH",
                    snoozedUntil = "2026-06-01T00:00:00Z",
                ),
            ),
            counts = ActionCounts(total = 2, high = 1, medium = 0, low = 1),
            snoozedCount = 1,
        )

        assertEquals(2, actionBadgeCount(queue))
        assertEquals(3, queue.items.size)
        assertTrue("the badge must not count the snoozed row", actionBadgeCount(queue) < queue.items.size)
        assertEquals(1, queue.snoozedCount)
    }

    @Test
    fun badge_isZeroOnlyWhenTheServerSaysSo() {
        val empty = Fixtures.actionQueue(items = emptyList())
        assertEquals(0, actionBadgeCount(empty))
    }

    // ---- ordering and sections ----

    @Test
    fun sort_putsSeverityFirstThenTheSoonestDateThenKey() {
        val late = Fixtures.actionItem(itemKey = "C:3", severity = "HIGH", dueDate = "2026-05-01T00:00:00")
        val soon = Fixtures.actionItem(itemKey = "A:1", severity = "HIGH", dueDate = "2026-03-01T00:00:00")
        val medium = Fixtures.actionItem(itemKey = "B:2", severity = "MEDIUM", dueDate = "2026-01-01T00:00:00")
        val undated = Fixtures.actionItem(itemKey = "D:4", severity = "HIGH", dueDate = null)

        val sorted = sortActionItems(listOf(late, medium, undated, soon))

        assertEquals(
            listOf("A:1", "C:3", "D:4", "B:2"),
            sorted.map { it.itemKey },
        )
        assertTrue("an item with no date sorts last within its severity", sorted[2].dueDate == null)
    }

    @Test
    fun sort_isTotalSoTwoReadsCannotShuffleTheList() {
        val a = Fixtures.actionItem(itemKey = "SAME:1", severity = "LOW", dueDate = null)
        val b = Fixtures.actionItem(itemKey = "SAME:2", severity = "LOW", dueDate = null)
        assertEquals(
            listOf("SAME:1", "SAME:2"),
            sortActionItems(listOf(b, a)).map { it.itemKey },
        )
    }

    @Test
    fun sections_groupConsecutiveSeveritiesInDisplayOrder() {
        val sections = actionSections(
            listOf(
                Fixtures.actionItem(itemKey = "LOW:1", severity = "LOW"),
                Fixtures.actionItem(itemKey = "HIGH:1", severity = "HIGH"),
                Fixtures.actionItem(itemKey = "HIGH:2", severity = "HIGH"),
                Fixtures.actionItem(itemKey = "ODD:1", severity = "CRITICAL"),
            ),
        )

        assertEquals(
            listOf(
                ActionSeverity.HIGH,
                ActionSeverity.LOW,
                ActionSeverity.UNKNOWN,
            ),
            sections.map { it.severity },
        )
        assertEquals(listOf("HIGH:1", "HIGH:2"), sections.first().items.map { it.itemKey })
    }

    // ---- where a row goes ----

    @Test
    fun target_prefersTheEntityTheItemCarries() {
        assertEquals(
            ActionTarget.Device("dev-1"),
            actionTarget(Fixtures.actionItem(deviceId = "dev-1")),
        )
        assertEquals(
            ActionTarget.Subscription("sub-1"),
            actionTarget(
                Fixtures.actionItem(
                    kind = "SUBSCRIPTION_RENEWING_NO_CANCEL_URL",
                    deviceId = null,
                    warrantyId = null,
                    subscriptionId = "sub-1",
                ),
            ),
        )
        assertEquals(
            ActionTarget.WishlistItem("wish-1"),
            actionTarget(
                Fixtures.actionItem(
                    kind = "WISHLIST_TARGET_PASSED",
                    deviceId = null,
                    warrantyId = null,
                    wishlistItemId = "wish-1",
                ),
            ),
        )
    }

    /**
     * "Some kinds have none" is real: a partial payload — or a kind a future
     * server adds — may arrive with no id at all, and the row must then be a
     * non-tappable card rather than a link to nowhere.
     */
    @Test
    fun target_isNullWhenTheItemHasNoEntityToOpen() {
        assertNull(
            actionTarget(
                Fixtures.actionItem(
                    deviceId = null,
                    warrantyId = null,
                    subscriptionId = null,
                    wishlistItemId = null,
                ),
            ),
        )
        assertNull(actionTarget(Fixtures.actionItem(deviceId = "  ")))
    }

    // ---- the day-count pill ----

    @Test
    fun duePill_countsCalendarDaysFromTheDateHalfOnly() {
        val today = LocalDate.of(2026, 3, 4)

        // Naive UTC ("no Z"): the date half is 01/03, so this is overdue — an
        // instant-based parse in +07:00 would have shifted it to the 2nd.
        assertEquals(
            ActionDuePill("Quá hạn 3 ngày", PillKind.Danger),
            actionDuePill(vi, "2026-03-01T00:00:00", today),
        )
        assertEquals(ActionDuePill("Hôm nay", PillKind.Danger), actionDuePill(vi, "2026-03-04", today))
        assertEquals(ActionDuePill("Còn 1 ngày", PillKind.Warning), actionDuePill(vi, "2026-03-05", today))
        assertEquals(ActionDuePill("Còn 7 ngày", PillKind.Warning), actionDuePill(vi, "2026-03-11", today))
        assertEquals(ActionDuePill("Còn 8 ngày", PillKind.Info), actionDuePill(vi, "2026-03-12", today))
    }

    @Test
    fun duePill_isAbsentForAMissingOrMalformedDate() {
        val today = LocalDate.of(2026, 3, 4)
        assertNull(actionDuePill(vi, null, today))
        assertNull(actionDuePill(vi, "", today))
        assertNull(actionDuePill(vi, "không-phải-ngày", today))
        assertNull(actionDuePill(vi, "2026-3-4", today))
    }

    // ---- copy ----

    @Test
    fun dateLabel_isVietnameseDayFirstAndToleratesRubbish() {
        assertEquals("01/03/2026", actionDateLabel("2026-03-01T00:00:00"))
        assertEquals("01/03/2026", actionDateLabel("2026-03-01"))
        assertNull(actionDateLabel(null))
        assertNull(actionDateLabel(""))
        assertNull(actionDateLabel("2026/03/01"))
    }

    /**
     * `formatVndLong` is the `@Composable` entry point now (it needs the selected
     * language), so the bytes are pinned one level down at `Money`, which is the
     * single implementation behind it and behind every screen's money.
     *
     * Vietnamese is `260.000 ₫` — space, `₫` U+20AB — matching Go's `FormatMoney`
     * and the web; see `VietnameseFormatterTest`'s header for why the expected
     * strings moved from the old `260.000đ`.
     */
    @Test
    fun vndFormatting_handlesInt64MagnitudesAndVietnameseGrouping() {
        assertEquals("260.000 ₫", Money.vietnamese(260_000))
        assertEquals("0 ₫", Money.vietnamese(0))
        // Larger than Int.MAX_VALUE: an Int field would have thrown on the wire.
        assertEquals("3.000.000.000 ₫", Money.vietnamese(3_000_000_000L))
        // …and the English shape the same formatter produces for an en catalog.
        assertEquals("₫3,000,000,000", Money.english(3_000_000_000L))
    }

    @Test
    fun snoozeConfirmation_quotesTheDaysTheServerApplied() {
        val result = SnoozeResult(
            itemKey = "WARRANTY_EXPIRED:war-1",
            snoozedUntil = "2026-06-02T00:00:00Z",
            days = 90,
        )
        assertEquals("Đã hoãn 90 ngày — việc này hiện lại 02/06/2026", snoozeConfirmation(vi, result))
        assertEquals(
            "Đã hoãn 7 ngày",
            snoozeConfirmation(vi, SnoozeResult(itemKey = "A:1", snoozedUntil = "", days = 7)),
        )
    }

    @Test
    fun snoozeChoices_stayInsideTheServerRangeSoNoTapCanBeA400() {
        assertTrue(snoozeChoices.isNotEmpty())
        snoozeChoices.forEach { choice ->
            assertTrue("${choice.days} is outside 1–365", choice.days in 1..365)
            assertTrue(vi.get(choice.labelRes).isNotBlank())
        }
        assertEquals(90, SNOOZE_DAYS_DEFAULT)
        assertTrue(snoozeChoices.any { it.days == SNOOZE_DAYS_DEFAULT })
    }

    @Test
    fun note_prefersTheServersSentenceAndOnlyFallsBackWhenItIsBlank() {
        val served = Fixtures.actionQueue(note = "Câu của máy chủ.")
        assertEquals("Câu của máy chủ.", actionQueueNote(vi, served))

        val blank = Fixtures.actionQueue(note = "   ")
        assertEquals(vi.get(ACTION_QUEUE_NOTE_FALLBACK), actionQueueNote(vi, blank))
        assertTrue(actionQueueNote(vi, blank).contains("không phải thông báo đẩy"))
    }

    @Test
    fun subtitle_countsTheWorkloadAndKeepsSnoozedSeparate() {
        assertEquals("Không còn việc nào", actionQueueSubtitle(vi, counts = 0, snoozed = 0))
        assertEquals("3 việc cần xử lý", actionQueueSubtitle(vi, counts = 3, snoozed = 0))
        assertEquals("3 việc cần xử lý · 2 việc đang hoãn", actionQueueSubtitle(vi, counts = 3, snoozed = 2))
        assertEquals("Không còn việc nào · 2 việc đang hoãn", actionQueueSubtitle(vi, counts = 0, snoozed = 2))
    }
}
