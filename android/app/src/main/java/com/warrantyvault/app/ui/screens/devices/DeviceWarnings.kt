package com.warrantyvault.app.ui.screens.devices

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warrantyvault.app.R
import com.warrantyvault.app.i18n.AppStrings
import com.warrantyvault.app.i18n.appStrings
import com.warrantyvault.app.network.DeviceWarning
import com.warrantyvault.app.network.DraftDevice
import com.warrantyvault.app.ui.theme.WVAccent

/**
 * Serial/IMEI advisories (openapi `DeviceWarning`, FEATURE_IDEAS #6) and the AI
 * draft's two review channels.
 *
 * The distinction the whole feature turns on:
 *
 *  * `unmatched` — "we got a value but could **not** use it" (free text that
 *    matched no catalog entry, an OCR serial longer than 120 bytes). The value
 *    was dropped; the user has to type it.
 *  * `warnings` — "we **used** the value, but it looks wrong" (a 15-digit IMEI
 *    with a bad Luhn check digit, an all-digit 14/16/17-digit near-IMEI, a serial
 *    that already exists on another device). The value was kept and saved.
 *
 * Nothing here is ever an error: `POST`/`PATCH /api/v1/devices` returns 201/200
 * with the device row saved, and the client must not block, retry or rewrite the
 * serial because of a warning. That is also why the copy never says "thất bại".
 */

/**
 * Vietnamese sentence for one advisory. Prefers the API's own `message` (it is
 * written for the exact finding) and falls back to a code-specific sentence when
 * the field is blank — a warning without text would be a yellow box with nothing
 * in it, which is worse than no box.
 */
fun deviceWarningMessage(s: AppStrings, warning: DeviceWarning): String {
    warning.message.takeIf { it.isNotBlank() }?.let { return it }
    return when (warning.code) {
        "IMEI_CHECKSUM" -> s.get(R.string.warn_imei_checksum)
        "IMEI_LENGTH" -> s.get(R.string.warn_imei_length)
        "SERIAL_DUPLICATE" -> s.get(R.string.warn_serial_duplicate)
        else -> s.get(R.string.warn_generic)
    }
}

/** The warnings belonging to one request/draft field (`serialNumber` today). */
fun deviceWarningsForField(
    warnings: List<DeviceWarning>,
    field: String = DeviceWarning.SERIAL_FIELD,
): List<DeviceWarning> = warnings.filter { it.field == field }

/** Card title. "Đã lưu" first: the save succeeded, the remark is secondary. */
fun deviceWarningsTitle(s: AppStrings, isEdit: Boolean): String =
    if (isEdit) s.get(R.string.warn_title_updated) else s.get(R.string.warn_title_saved)

/**
 * The AI draft's two review channels, formatted for the sheet — and kept in two
 * separate strings so one can never be mistaken for the other.
 */
data class DraftReview(
    /** "Cần xem lại: Hãng, Nơi mua." — values that were dropped. `null` when none. */
    val unmatched: String?,
    /** "Đã điền nhưng có thể sai: …" — values that were kept. `null` when none. */
    val warnings: String?,
)

fun draftReview(s: AppStrings, draft: DraftDevice): DraftReview {
    val labels = draft.unmatched.mapNotNull { unmatchedLabel(s, it) }
    return DraftReview(
        unmatched = labels.takeIf { it.isNotEmpty() }
            ?.let { s.get(R.string.warn_unmatched, it.joinToString(", ")) },
        warnings = draft.warnings.takeIf { it.isNotEmpty() }
            ?.let {
                s.get(
                    R.string.warn_draft_filled,
                    it.joinToString(" ") { w -> deviceWarningMessage(s, w) },
                )
            },
    )
}

/** Vietnamese name of a draft field the AI could not bind — `null` = not user-facing. */
fun unmatchedLabel(s: AppStrings, key: String): String? = when (key) {
    "brand" -> s.get(R.string.warn_field_brand)
    "purchasePlace" -> s.get(R.string.warn_field_purchase_place)
    "category" -> s.get(R.string.warn_field_category)
    "serialNumber" -> s.get(R.string.warn_field_serial)
    "warrantyMonths" -> s.get(R.string.warn_field_warranty_months)
    else -> null
}

/**
 * Dismissible advisory card shown after a device was saved **successfully** but
 * came back with `warnings`.
 *
 * Deliberately not a dialog and not a snackbar: nothing is blocked, the row is
 * already in the list, and a warning the user can dismiss at leisure is the
 * honest shape for "đã lưu, nhưng…". Renders nothing when there is nothing to
 * say.
 */
@Composable
fun DeviceWarningsCard(
    warnings: List<DeviceWarning>,
    isEdit: Boolean,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (warnings.isEmpty()) return
    val s = appStrings()
    val accent = WVAccent.current
    Card(
        colors = CardDefaults.cardColors(containerColor = accent.warningContainer),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        shape = RoundedCornerShape(16.dp),
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(start = 14.dp, end = 6.dp, top = 12.dp, bottom = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Outlined.WarningAmber, null,
                    tint = accent.warning,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    deviceWarningsTitle(s, isEdit),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = accent.onWarningContainer,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) }
            }
            Text(
                stringResource(R.string.warn_still_saved),
                style = MaterialTheme.typography.bodySmall,
                color = accent.onWarningContainer,
            )
            Spacer(Modifier.height(6.dp))
            warnings.forEach { warning ->
                Row(
                    Modifier.padding(end = 8.dp, bottom = 2.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Text(
                        "•",
                        color = accent.warning,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(end = 6.dp),
                    )
                    Text(
                        deviceWarningMessage(s, warning),
                        style = MaterialTheme.typography.bodySmall,
                        color = accent.onWarningContainer,
                    )
                }
            }
        }
    }
}
