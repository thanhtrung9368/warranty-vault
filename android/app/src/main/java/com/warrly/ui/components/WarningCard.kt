package com.warrly.ui.components

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
import com.warrly.R
import com.warrly.ui.theme.WVAccent

/**
 * The app's one "the write SUCCEEDED, but read this" card — an advisory about
 * data that was saved/restored, never an error and never a success banner.
 *
 * The visual language is deliberately fixed and shared: `warningContainer` +
 * `WarningAmber`, a title that opens with the completed action ("Saved,
 * but…"), an optional reassurance line, then one bullet per caveat. Errors use
 * `errorContainer` (or a red snackbar) and successes use `primaryContainer`, so
 * a warning can never be mistaken for either.
 *
 * It was extracted verbatim from `DeviceWarningsCard`
 * (`ui/screens/devices/DeviceWarnings.kt`) when backup restore gained a
 * provenance warning — the same situation, so the same card. Do not restyle one
 * call site: changing this composable changes every non-fatal warning in the
 * app at once, which is the point.
 *
 * [messages] is the caller's data and is rendered as plain text (no
 * `String.format`), so an already-localized server sentence is shown exactly as
 * sent. Renders nothing when [messages] is empty, which lets a caller place it
 * unconditionally. [onDismiss] is optional: a notice the user cannot get rid of
 * is a dialog, not an inline advisory.
 */
@Composable
fun WarningCard(
    title: String,
    messages: List<String>,
    modifier: Modifier = Modifier,
    body: String? = null,
    onDismiss: (() -> Unit)? = null,
) {
    if (messages.isEmpty()) return
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
                    title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = accent.onWarningContainer,
                    modifier = Modifier.weight(1f),
                )
                if (onDismiss != null) {
                    TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) }
                }
            }
            if (body != null) {
                Text(
                    body,
                    style = MaterialTheme.typography.bodySmall,
                    color = accent.onWarningContainer,
                )
            }
            Spacer(Modifier.height(6.dp))
            messages.forEach { message ->
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
                        message,
                        style = MaterialTheme.typography.bodySmall,
                        color = accent.onWarningContainer,
                    )
                }
            }
        }
    }
}
