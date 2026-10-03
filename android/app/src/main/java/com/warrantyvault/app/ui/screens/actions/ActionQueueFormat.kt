package com.warrantyvault.app.ui.screens.actions

import com.warrantyvault.app.network.ActionItem
import com.warrantyvault.app.network.ActionQueue
import com.warrantyvault.app.network.SnoozeResult
import com.warrantyvault.app.ui.components.PillKind
import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.DateTimeParseException
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * "Việc cần xử lý" — the pure half of the action queue (openapi
 * `GET /api/v1/actions`).
 *
 * Everything that decides *what the user reads or taps* lives here as a plain
 * function so it can be tested on the JVM without Robolectric — the same split
 * `RemindersScreen.kt` uses for its day-count pill.
 *
 * Three rules come straight from the payload's contract and are the reason these
 * helpers exist at all rather than being inlined in the composable:
 *
 *  1. **A badge reads `counts`, never `items.size`.** With `?snoozed=true` the
 *     server ADDS rows, so `items.size` grows while the real workload does not.
 *     `counts` always counts the actionable subset.
 *  2. **The server's `title`/`detail` are rendered verbatim.** They name the
 *     actual dates and amounts that produced the item; re-wording them on the
 *     client is how a queue starts lying. The client's own additions are limited
 *     to things the payload does not say: which screen to open, and how far away
 *     `dueDate` is.
 *  3. **`itemKey` is the identity.** Snoozing targets the key, never a position
 *     in the list.
 */

/**
 * The server's default snooze length (`SnoozeDaysDefault` in Go). The client
 * still sends an explicit `days` on every call — this constant only labels the
 * suggested choice, so the two can never disagree about what "mặc định" means.
 */
internal const val SNOOZE_DAYS_DEFAULT = 90

/** One "hoãn bao lâu" choice. Bounds are the server's: 1–365 days. */
internal data class SnoozeChoice(val days: Int, val label: String)

/**
 * A few Vietnamese durations rather than a free number field: the decision is
 * "để đó một thời gian", and every option here is inside the server's `1–365`
 * window, so no choice can produce a 400.
 */
internal val snoozeChoices: List<SnoozeChoice> = listOf(
    SnoozeChoice(7, "1 tuần"),
    SnoozeChoice(30, "1 tháng"),
    SnoozeChoice(SNOOZE_DAYS_DEFAULT, "3 tháng (mặc định)"),
    SnoozeChoice(365, "1 năm"),
)

/** Display order of the three severities — `HIGH` first, exactly like the server. */
internal enum class ActionSeverity(val rank: Int, val sectionLabel: String, val pill: PillKind) {
    HIGH(0, "Cần xử lý ngay", PillKind.Danger),
    MEDIUM(1, "Nên xử lý", PillKind.Warning),
    LOW(2, "Nhắc nhẹ", PillKind.Info),

    /**
     * A severity code this build has never seen. It still renders (data, not a
     * broken row) and sorts last — the alternative, throwing inside
     * kotlinx.serialization, would blank the whole queue over one new code.
     */
    UNKNOWN(3, "Khác", PillKind.Neutral),
}

/** Raw `severity` code → enum, unknown codes degrading to [ActionSeverity.UNKNOWN]. */
internal fun actionSeverityOf(raw: String): ActionSeverity =
    when (raw.trim().uppercase()) {
        "HIGH" -> ActionSeverity.HIGH
        "MEDIUM" -> ActionSeverity.MEDIUM
        "LOW" -> ActionSeverity.LOW
        else -> ActionSeverity.UNKNOWN
    }

/**
 * The rows the user actually has to decide about: everything the server returned
 * **minus** the ones a snooze is hiding. With the default call this is all of
 * them; with `?snoozed=true` it is what remains actionable.
 */
internal fun actionableItems(items: List<ActionItem>): List<ActionItem> =
    items.filterNot { it.isSnoozed }

/** The rows hidden by a snooze — only ever non-empty on a `?snoozed=true` read. */
internal fun snoozedItems(items: List<ActionItem>): List<ActionItem> = items.filter { it.isSnoozed }

/**
 * The number a badge may show. It is [ActionQueue.counts]`.total` — the server's
 * count of the actionable set — and deliberately **not** `items.size`, which
 * grows when the queue is read with `?snoozed=true` and would make the badge
 * change meaning with a display flag.
 */
internal fun actionBadgeCount(queue: ActionQueue): Int = queue.counts.total

/**
 * Sorts the queue the way the server does: severity first, then the date the item
 * is about (soonest first, no date last), then `itemKey` so the order is total
 * and two reads cannot shuffle rows for no reason.
 *
 * Re-sorting a list the server already sorted is not redundancy: the split
 * between "đang cần xử lý" and "đang hoãn" is done on the client, and each
 * section has to stay ordered on its own.
 */
internal fun sortActionItems(items: List<ActionItem>): List<ActionItem> =
    items.sortedWith(
        compareBy(
            { actionSeverityOf(it.severity).rank },
            { it.dueDate.isNullOrBlank() },
            { it.dueDate.orEmpty() },
            { it.itemKey },
        ),
    )

/** One severity heading plus its rows, in the order the list renders them. */
internal data class ActionSection(val severity: ActionSeverity, val items: List<ActionItem>)

/**
 * Groups the queue into severity sections, each already sorted. Grouping (rather
 * than a flat sorted list) is what makes a mixed queue readable: the user sees
 * "Cần xử lý ngay" as a block instead of inferring the boundary from a pill
 * colour repeating down the screen.
 */
internal fun actionSections(items: List<ActionItem>): List<ActionSection> =
    sortActionItems(items)
        .groupBy { actionSeverityOf(it.severity) }
        .map { (severity, rows) -> ActionSection(severity, rows) }
        .sortedBy { it.severity.rank }

/**
 * Where tapping an item goes. The payload carries at most one entity id per item
 * (a device, a subscription or a wishlist row), and all ten kinds today name one.
 *
 * `null` is a real case, not dead code: an older/partial payload — or a kind a
 * future server adds — may arrive with no id at all, and the row must then be a
 * plain, non-tappable card instead of a crash or a link to nowhere.
 */
internal sealed interface ActionTarget {
    data class Device(val id: String) : ActionTarget
    data class Subscription(val id: String) : ActionTarget
    data class WishlistItem(val id: String) : ActionTarget
}

/** The entity to open, or `null` when this item has none to open. */
internal fun actionTarget(item: ActionItem): ActionTarget? {
    item.deviceId?.takeIf { it.isNotBlank() }?.let { return ActionTarget.Device(it) }
    item.subscriptionId?.takeIf { it.isNotBlank() }?.let { return ActionTarget.Subscription(it) }
    item.wishlistItemId?.takeIf { it.isNotBlank() }?.let { return ActionTarget.WishlistItem(it) }
    return null
}

/** A day-count pill derived from `dueDate`, mirroring the reminders screen's. */
internal data class ActionDuePill(val label: String, val kind: PillKind)

/**
 * "Còn 3 ngày" / "Quá hạn 5 ngày" for an item's `dueDate`, or `null` when the
 * item has no single date. `today` is a parameter so the test does not depend on
 * the calendar — the same reason `daysLeftFromIso` in RemindersScreen is a plain
 * function.
 *
 * Only the date half of the timestamp is read: the server sends naive UTC
 * (`"2026-03-01T00:00:00"`), so an instant-based parse would shift the day.
 */
internal fun actionDuePill(dueDate: String?, today: LocalDate): ActionDuePill? {
    val raw = dueDate?.trim()?.take(10) ?: return null
    val date = try {
        LocalDate.parse(raw)
    } catch (_: DateTimeParseException) {
        return null
    }
    val days = ChronoUnit.DAYS.between(today, date)
    return when {
        days < 0 -> ActionDuePill("Quá hạn ${-days} ngày", PillKind.Danger)
        days == 0L -> ActionDuePill("Hôm nay", PillKind.Danger)
        days == 1L -> ActionDuePill("Còn 1 ngày", PillKind.Warning)
        days <= 7 -> ActionDuePill("Còn $days ngày", PillKind.Warning)
        else -> ActionDuePill("Còn $days ngày", PillKind.Info)
    }
}

/**
 * `dd/mm/yyyy` for a naive-UTC timestamp, or `null` when there is nothing
 * sensible to print. Same tolerance as `sessionDateLabel`: a malformed value
 * renders as "no date", never as a crash.
 */
internal fun actionDateLabel(iso: String?): String? {
    val date = iso?.trim()?.take(10).orEmpty()
    val parts = date.split("-")
    if (parts.size != 3) return null
    val (year, month, day) = parts
    if (year.length != 4 || month.length != 2 || day.length != 2) return null
    if (parts.any { part -> part.any { !it.isDigit() } }) return null
    return "$day/$month/$year"
}

/**
 * Money for the queue rows and headings. `Long` because every money field on the
 * wire is int64: `Int` would throw inside kotlinx.serialization on a large value
 * and blank the screen (Android has been bitten by exactly that before).
 */
internal fun formatVndLong(amount: Long): String {
    val nf = NumberFormat.getNumberInstance(Locale("vi", "VN"))
    return nf.format(amount) + "đ"
}

/**
 * What the snackbar says after a successful snooze. [SnoozeResult.days] is the
 * duration the **server** applied — echoed instead of assuming the one we asked
 * for, so the confirmation can never claim a different number than the queue
 * will actually show.
 */
internal fun snoozeConfirmation(result: SnoozeResult): String {
    val until = actionDateLabel(result.snoozedUntil)
    return if (until != null) {
        "Đã hoãn ${result.days} ngày — việc này hiện lại ${until}"
    } else {
        "Đã hoãn ${result.days} ngày"
    }
}

/**
 * The queue's own Vietnamese sentence when the server sent none. It states the
 * two things the payload's `note` always states and a user would otherwise
 * assume wrongly: this is not a push feed, and snoozing here does not silence
 * warranty reminders. Used **only** as a fallback — the server's copy wins.
 */
internal const val ACTION_QUEUE_NOTE_FALLBACK =
    "Danh sách này chỉ gồm những việc app tự suy ra từ dữ liệu bạn đã nhập. " +
        "Nó không phải thông báo đẩy, và hoãn một việc ở đây không ảnh hưởng tới nhắc bảo hành."

/** `queue.note` when present, otherwise the fallback above. */
internal fun actionQueueNote(queue: ActionQueue): String =
    queue.note.trim().ifBlank { ACTION_QUEUE_NOTE_FALLBACK }

/**
 * The subtitle under the screen title: the actionable workload, split by
 * severity, built from `counts` — never from the visible rows.
 */
internal fun actionQueueSubtitle(counts: Int, snoozed: Int): String {
    val head = if (counts == 0) "Không còn việc nào" else "$counts việc cần xử lý"
    return if (snoozed > 0) "$head · $snoozed việc đang hoãn" else head
}
