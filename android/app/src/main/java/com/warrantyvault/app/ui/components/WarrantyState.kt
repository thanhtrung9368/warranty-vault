package com.warrantyvault.app.ui.components

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.warrantyvault.app.R
import com.warrantyvault.app.i18n.AppStrings
import java.time.LocalDate
import java.time.format.DateTimeParseException
import java.time.temporal.ChronoUnit

/**
 * Tone buckets for a warranty-end countdown. Mirrors `WarrantyState['tone']`
 * in `website/src/lib/format.ts`.
 */
enum class WarrantyTone { Expired, Danger, Warn, Safe }

/** Remaining days + the exact Vietnamese label used by the web pill. */
data class WarrantyState(
    val daysLeft: Long,
    val label: String,
    val tone: WarrantyTone,
)

/**
 * Pure port of `warrantyState()` in `website/src/lib/format.ts`, so the device
 * list speaks the same language as the web table:
 *
 * | days left | label           | tone    |
 * |-----------|-----------------|---------|
 * | < 0       | `Đã hết N ngày` | Expired |
 * | 0         | `Hết hôm nay`   | Danger  |
 * | 1..15     | `Còn N ngày`    | Danger  |
 * | 16..30    | `Còn N ngày`    | Warn    |
 * | 31..90    | `Còn N ngày`    | Safe    |
 * | > 90      | `Còn N tháng`   | Safe    |
 *
 * `today` is injectable so the boundaries are testable without a clock.
 * Returns `null` for a blank/unparseable date instead of guessing — the caller
 * renders "Không có" rather than a bogus countdown.
 */
fun warrantyState(
    s: AppStrings,
    endIso: String?,
    today: LocalDate = LocalDate.now(),
): WarrantyState? {
    val end = parseIsoDate(endIso) ?: return null
    val days = ChronoUnit.DAYS.between(today, end)
    val daysLeft = s.quantity(R.plurals.comp_warranty_days_left, days.toInt(), days)
    return when {
        days < 0L -> WarrantyState(
            days,
            s.quantity(R.plurals.comp_warranty_expired_days, (-days).toInt(), -days),
            WarrantyTone.Expired,
        )
        days == 0L -> WarrantyState(0L, s.get(R.string.comp_warranty_expires_today), WarrantyTone.Danger)
        days <= 15L -> WarrantyState(days, daysLeft, WarrantyTone.Danger)
        days <= 30L -> WarrantyState(days, daysLeft, WarrantyTone.Warn)
        days <= 90L -> WarrantyState(days, daysLeft, WarrantyTone.Safe)
        else -> WarrantyState(
            days,
            s.quantity(R.plurals.comp_warranty_months_left, (days / 30).toInt(), days / 30),
            WarrantyTone.Safe,
        )
    }
}

/**
 * Accepts both a plain `YYYY-MM-DD` and a full RFC3339 timestamp (the server
 * sends the latter for `effectiveWarrantyEnd`, the former for `endDate`).
 */
internal fun parseIsoDate(raw: String?): LocalDate? {
    val ten = raw?.trim()?.take(10) ?: return null
    if (ten.length != 10) return null
    return try {
        LocalDate.parse(ten)
    } catch (_: DateTimeParseException) {
        null
    }
}

private fun pillKindFor(tone: WarrantyTone): PillKind = when (tone) {
    WarrantyTone.Expired -> PillKind.Neutral
    WarrantyTone.Danger -> PillKind.Danger
    WarrantyTone.Warn -> PillKind.Warning
    WarrantyTone.Safe -> PillKind.Success
}

/** The device-list "Bảo hành" cell: a pill, or "Không có" when there is none. */
@Composable
fun WarrantyPill(state: WarrantyState?, modifier: Modifier = Modifier) {
    if (state == null) {
        Text(
            stringResource(R.string.comp_warranty_none),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = modifier,
        )
        return
    }
    StatusPill(label = state.label, kind = pillKindFor(state.tone), modifier = modifier)
}
