package com.warrly.network

/**
 * Client-side mirror of the `leadDays` contract on **Device** and
 * **Subscription** — the user-chosen "remind me this many days before expiry"
 * schedule (openapi `Device.leadDays` / `Subscription.leadDays`).
 *
 * The server is still the authority; this file exists so the sheet can show a
 * valid schedule *before* the request is sent and so three clients do not each
 * invent their own bounds:
 *
 *  * 1..5 entries (an **empty array is a 400** — "a user who wants fewer
 *    reminders picks fewer days", not none),
 *  * each entry 0..365 days,
 *  * no duplicates,
 *  * sorted **descending** (the server sorts too, so equality comparisons and
 *    the on-screen order do not depend on input order),
 *  * absent on create = the server default [DEFAULT_LEAD_DAYS].
 *
 * `0` is a real, meaningful choice ("nhắc đúng ngày hết hạn"), never "unset";
 * that is why it is excluded from nothing and a blank candidate list is not
 * silently turned into the default. The picker shows the required-field error
 * instead; only [leadDaysForRequest] degrades an empty list to `null`, which
 * the wire reads as "absent".
 */

/** The days server-side default when `leadDays` is omitted on create. */
// Device default: the old warranty cron fired at 7 and 30 days.
val DEFAULT_LEAD_DAYS: List<Int> = listOf(30, 7)

// Subscription default: the old renewal cron fired at 3, 1 and 0 days. Kept
// separate on purpose — one default cannot preserve both schedules.
val DEFAULT_SUBSCRIPTION_LEAD_DAYS: List<Int> = listOf(3, 1, 0)

/** Earliest allowed entry — the reminder fired on the expiry day itself. */
const val MIN_LEAD_DAY: Int = 0

/** Latest allowed entry. */
const val MAX_LEAD_DAY: Int = 365

/** The contract's cap on how many schedules one device/subscription may have. */
const val MAX_LEAD_DAYS: Int = 5

/**
 * Clamp to 0..365, drop duplicates, sort descending, keep at most 5.
 *
 * An empty candidate stays empty: the contract has no "zero reminders" state,
 * and inventing the default here would resurrect a day the user just removed.
 * [isValidLeadDays] is the predicate that says so, and the picker uses it to
 * block Save.
 */
fun normalizeLeadDays(candidate: Iterable<Int>): List<Int> =
    candidate
        .map { it.coerceIn(MIN_LEAD_DAY, MAX_LEAD_DAY) }
        .distinct()
        .sortedDescending()
        .take(MAX_LEAD_DAYS)

/**
 * `true` when [days] is exactly what the API accepts as a **sent** value: 1..5
 * entries, each 0..365, no duplicates.
 *
 * The list does not have to be sorted — this is a membership/shape check on a
 * value the client is about to normalise anyway; the wire normaliser always
 * sorts descending.
 */
fun isValidLeadDays(days: List<Int>): Boolean =
    days.size in 1..MAX_LEAD_DAYS &&
        days.all { it in MIN_LEAD_DAY..MAX_LEAD_DAY } &&
        days.distinct().size == days.size

/**
 * The value to put in a create/update body.
 *
 * `null` means "omit the key": on **create** the server applies
 * [DEFAULT_LEAD_DAYS], and on **update** it leaves the stored schedule
 * unchanged. The picker never lets a save happen with an empty list, but this
 * keeps the DTO honest if a future caller does.
 */
fun leadDaysForRequest(days: List<Int>): List<Int>? =
    normalizeLeadDays(days).ifEmpty { null }
