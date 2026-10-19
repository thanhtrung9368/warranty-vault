package com.warrly.ui.screens.devices

import com.warrly.R
import com.warrly.i18n.AppStrings
import com.warrly.ui.components.parseIsoDate
import com.warrly.ui.screens.vietnamDate
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * Warranty activation and the extended-cover deadline — openapi
 * `Device.activationRequired` / `Device.activatedAt` /
 * `Device.extendedCoverBuyBy`.
 *
 * Two Vietnamese retail realities meet in this file:
 *
 *  * the warranty often starts with a **retailer action**, not the invoice, and
 *    an unactivated device can be refused at the counter;
 *  * extended cover (AppleCare+, Samsung Care+) must be bought inside a window
 *    that closes forever.
 *
 * Everything here is pure: (strings, data, today) in, sentence out. That is what
 * lets the JVM tests pin both languages without Robolectric, the same seam
 * `com.warrly.ui.components.warrantyState` uses.
 *
 * ## The three activation states are not two
 *
 *  * `NotRequired` — the ordinary case; the warranty runs from the invoice.
 *  * `RequiredNotActivated` — the warning state: the shop still has to activate
 *    it, and until then the warranty has not started.
 *  * `Activated(onDate)` — a date actually exists.
 *
 * An `activatedAt` that is **earlier** than `purchaseDate` is legitimate (a shop
 * can pre-activate), so nothing here compares the two dates or rejects one.
 */

/** The derived activation state. `onDate` is already `dd/MM/yyyy`. */
sealed interface ActivationStatus {
    /** No activation step for this device. */
    data object NotRequired : ActivationStatus

    /** The device needs activation and no date has been recorded yet. */
    data object RequiredNotActivated : ActivationStatus

    /**
     * The device was activated on `onDate`. This wins over
     * [RequiredNotActivated] even when [activationRequired] is `false`: a
     * recorded activation date is a fact, not a toggle.
     */
    data class Activated(val onDate: String) : ActivationStatus
}

/**
 * Wire → derived state.
 *
 * `activatedAt` wins when it formats as a real date; otherwise the boolean
 * decides between "still waiting" and "not required". A malformed date never
 * produces an activation claim — an older/broken server must not invent one.
 */
fun activationStatus(activationRequired: Boolean, activatedAt: String?): ActivationStatus {
    // Both checks matter: [vietnamDate] validates the shape, [parseIsoDate]
    // validates the calendar (a shape-valid "2026-02-31" is not a date this app
    // will claim the warranty started on).
    val onDate = parseIsoDate(activatedAt)?.let { vietnamDate(activatedAt) }
    return when {
        onDate != null -> ActivationStatus.Activated(onDate)
        activationRequired -> ActivationStatus.RequiredNotActivated
        else -> ActivationStatus.NotRequired
    }
}

/** The one-sentence value the device detail card shows for [status]. */
fun activationLabel(s: AppStrings, status: ActivationStatus): String = when (status) {
    ActivationStatus.NotRequired -> s.get(R.string.devdetail_activation_not_required)
    ActivationStatus.RequiredNotActivated -> s.get(R.string.devdetail_activation_required)
    is ActivationStatus.Activated -> s.get(R.string.devdetail_activation_on, status.onDate)
}

/**
 * `true` when the activation row is worth showing on the detail card: activation
 * is required, or a date was recorded. The default `false` + no date case stays
 * silent instead of adding a "not required" row to every device in the app.
 */
fun hasActivationState(activationRequired: Boolean, activatedAt: String?): Boolean =
    activationRequired || !activatedAt.isNullOrBlank()

/**
 * `true` when the activation-date field is visible in the form: the toggle is on,
 * or a date already exists and the user may want to see/edit it.
 */
fun showsActivationDate(activationRequired: Boolean, activatedAtRaw: String): Boolean =
    activationRequired || activatedAtRaw.isNotBlank()

// ---- Wire <-> form for the two dates --------------------------------------
//
// Both fields are **calendar days** (`YYYY-MM-DD`) on the wire, the same shape
// as `purchaseDate` and `receivedAt`: no time, no zone. `take(10)` is the whole
// value; parsing either as an instant would invent a timezone and could move
// the day.

/** `"2026-03-02"` → `"2026-03-02"`; missing/blank → `""`. */
internal fun activatedAtInput(wire: String?): String = wire?.trim()?.take(10).orEmpty()

/** Form → request. Blank means "not recorded" and drops the key. */
internal fun activatedAtRequest(raw: String): String? = raw.trim().ifBlank { null }

/** `"2026-12-31"` → `"2026-12-31"`; missing/blank → `""`. */
internal fun extendedCoverBuyByInput(wire: String?): String =
    wire?.trim()?.take(10).orEmpty()

/** Form → request. Blank means "the shop gave no deadline" and drops the key. */
internal fun extendedCoverBuyByRequest(raw: String): String? = raw.trim().ifBlank { null }

// ---- Extended-cover countdown --------------------------------------------

/** How urgent the extended-cover window is. Drives the colour only. */
enum class ExtendedCoverTone { Expired, Today, Soon, Open }

/**
 * The derived buy-by state.
 *
 * [daysLeft] is signed: positive = still buyable, `0` = the last day, negative =
 * the window closed that many days ago. [buyByDate] is `dd/MM/yyyy`.
 */
data class ExtendedCoverState(
    val buyByDate: String,
    val daysLeft: Long,
    val label: String,
    val tone: ExtendedCoverTone,
)

/**
 * Wire → countdown, or `null` when no usable deadline exists (the row is then
 * omitted rather than showing a made-up date).
 *
 * [today] is injectable so the boundary tests never depend on the wall clock.
 */
fun extendedCoverState(
    s: AppStrings,
    buyBy: String?,
    today: LocalDate = LocalDate.now(),
): ExtendedCoverState? {
    val buyByDate = vietnamDate(buyBy) ?: return null
    val end = parseIsoDate(buyBy) ?: return null
    val daysLeft = ChronoUnit.DAYS.between(today, end)
    val label = when {
        daysLeft > 0L ->
            s.quantity(
                R.plurals.devdetail_extended_cover_days_left,
                daysLeft.toInt(),
                daysLeft.toInt(),
            )
        daysLeft == 0L -> s.get(R.string.devdetail_extended_cover_last_day)
        else -> {
            val overdue = (-daysLeft).toInt()
            s.quantity(
                R.plurals.devdetail_extended_cover_days_overdue,
                overdue,
                overdue,
            )
        }
    }
    val tone = when {
        daysLeft < 0L -> ExtendedCoverTone.Expired
        daysLeft == 0L -> ExtendedCoverTone.Today
        daysLeft <= 30L -> ExtendedCoverTone.Soon
        else -> ExtendedCoverTone.Open
    }
    return ExtendedCoverState(
        buyByDate = buyByDate,
        daysLeft = daysLeft,
        label = label,
        tone = tone,
    )
}
