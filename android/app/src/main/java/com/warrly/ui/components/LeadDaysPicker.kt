package com.warrly.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warrly.R
import com.warrly.i18n.appStrings
import com.warrly.network.MAX_LEAD_DAYS
import com.warrly.network.MAX_LEAD_DAY
import com.warrly.network.MIN_LEAD_DAY
import com.warrly.network.normalizeLeadDays

/**
 * Quick-pick presets, chosen to cover the cases the fixed 30/7 schedule could
 * not: a 60-day shop return window, the old 30/7 defaults, a 14-day exchange
 * window, a 7-day accessory warranty, the day before, and the expiry day
 * itself (`0`). They are chips, not a closed list — the number field below is
 * how a 3-month or 10-year schedule gets entered.
 */
internal val LEAD_DAY_PRESETS: List<Int> = listOf(60, 30, 14, 7, 1, 0)

/**
 * The `leadDays` editor shared by `AddDeviceSheet` and `SubscriptionEditSheet`.
 *
 * Three rows, all inside the parent's `SheetGroup` so it matches the rest of
 * the form:
 *  1. the chosen days as removable [InputChip]s, always descending (the list is
 *     normalised on every callback) — or the required-field error when empty;
 *  2. the preset [FilterChip]s (selected presets can be tapped off, unselected
 *     ones are disabled at the 5-entry cap);
 *  3. a custom `0–365` number field + "Add" button.
 *
 * At least one day is required by the API (an empty array is a 400). The parent
 * disables Save while [days] is empty; this composable states why, so the
 * disabled button never looks broken. [error] carries a server
 * `fieldErrors.leadDays` message when one arrives — shown in the same place,
 * in error colour.
 *
 * The component is stateless about the schedule itself: only the custom number
 * field's draft text lives here. `onDaysChange` always receives a normalised
 * list (`com.warrly.network.normalizeLeadDays`), so the caller never has to
 * re-sort or de-dupe.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LeadDaysPicker(
    days: List<Int>,
    onDaysChange: (List<Int>) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
) {
    val s = appStrings()
    val normalized = normalizeLeadDays(days)
    var custom by remember { mutableStateOf("") }

    val customDay = custom.toIntOrNull()?.coerceIn(MIN_LEAD_DAY, MAX_LEAD_DAY)
    val canAddCustom = customDay != null &&
        customDay !in normalized &&
        normalized.size < MAX_LEAD_DAYS

    fun add(day: Int) {
        onDaysChange(normalizeLeadDays(normalized + day))
    }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                stringResource(R.string.lead_days_label),
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            Text(
                "${normalized.size}/$MAX_LEAD_DAYS",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        if (normalized.isEmpty()) {
            // The API rejects `[]`; "no reminders" is not a state a user can
            // choose, only "fewer reminders". So this is an error, never a
            // silent default.
            Text(
                error ?: stringResource(R.string.lead_days_required),
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.error,
            )
        } else {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                normalized.forEach { day ->
                    InputChip(
                        selected = true,
                        onClick = { onDaysChange(normalized - day) },
                        label = { Text(leadDaysValue(s, listOf(day)).orEmpty()) },
                        trailingIcon = {
                            Icon(
                                Icons.Filled.Close,
                                contentDescription = stringResource(R.string.action_delete),
                                modifier = Modifier.size(16.dp),
                            )
                        },
                    )
                }
            }
            error?.let {
                Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.error)
            }
        }

        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LEAD_DAY_PRESETS.forEach { preset ->
                val selected = preset in normalized
                FilterChip(
                    selected = selected,
                    onClick = {
                        if (selected) {
                            onDaysChange(normalized - preset)
                        } else {
                            add(preset)
                        }
                    },
                    // At the cap, only the already-chosen presets stay
                    // tappable (so one can be swapped out).
                    enabled = selected || normalized.size < MAX_LEAD_DAYS,
                    label = { Text(preset.toString()) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                        selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    ),
                )
            }
        }

        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = custom,
                onValueChange = { raw -> custom = raw.filter { it.isDigit() }.take(3) },
                label = { Text(stringResource(R.string.lead_days_custom_label)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
            OutlinedButton(
                onClick = {
                    customDay?.let {
                        add(it)
                        custom = ""
                    }
                },
                enabled = canAddCustom,
            ) {
                Text(stringResource(R.string.action_add))
            }
        }

        Text(
            stringResource(R.string.lead_days_hint),
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
