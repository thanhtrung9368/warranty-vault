package com.warrly.ui.components

import com.warrly.R
import com.warrly.i18n.AppStrings
import com.warrly.network.normalizeLeadDays

/**
 * The display form of a reminder schedule: `"30 và 7 ngày"` /
 * `"30 and 7 days"` — the value half of `"Nhắc trước 30 và 7 ngày"`, which is
 * how the device and subscription detail cards surface `leadDays`.
 *
 * Deliberately pure (`AppStrings` in, sentence out) so the exact Vietnamese is
 * pinned by a JVM test in both languages without Robolectric — the same seam
 * [WarrantyState] uses.
 *
 * The input is normalised first: the server sorts descending, but a cached or
 * hand-built payload might not, and "7 và 30 ngày" reads like a different
 * schedule. An empty list returns `null` so the caller omits the row entirely
 * rather than rendering a blank one — the DTO default (`[30, 7]`) means this
 * should only happen if a caller passes an explicitly empty list.
 *
 * The plural's quantity is the number of entries (or the single entry when
 * there is one), which is what selects `"1 day"` in English. The joined list
 * itself travels as the `%1$s` argument.
 */
fun leadDaysValue(s: AppStrings, days: List<Int>): String? {
    val normalized = normalizeLeadDays(days)
    if (normalized.isEmpty()) return null

    val joined = when (normalized.size) {
        1 -> normalized.single().toString()
        2 -> "${normalized[0]} ${s.get(R.string.lead_days_and)} ${normalized[1]}"
        else ->
            normalized.dropLast(1).joinToString(", ") +
                " ${s.get(R.string.lead_days_and)} " +
                normalized.last()
    }
    val quantity = if (normalized.size == 1) normalized.single() else normalized.size
    return s.quantity(R.plurals.lead_days_value, quantity, joined)
}
