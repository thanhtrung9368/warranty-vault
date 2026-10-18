package com.warrly.ui.screens.devices

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warrly.R
import com.warrly.i18n.appStrings
import com.warrly.network.Device

/**
 * "Chuẩn bị trước khi đi bảo hành" — the checklist card on the device detail
 * screen, directly under "Đi bảo hành ở đâu" (see `DeviceDetailBody`).
 *
 * It sits there because the screen has just answered *where* to take the device;
 * the next question in the same trip is *what to do before going*, and the answer
 * is the thing that decides whether the shop accepts it at all. The card is
 * collapsed by default so a device that is not going anywhere does not carry a
 * dozen rows, and opens on tap (or already open when some rows were ticked
 * earlier in the session).
 *
 * ## Read-only list, tick-boxes only
 *
 * The content is fixed per device ([handoverChecklist]); the user cannot add,
 * edit or reorder rows. The only interaction is the tick-box, which is a
 * `toggleable` row with `Role.Checkbox` — the whole row is the touch target and
 * TalkBack announces it as a checkbox with its title, rather than as a 20 dp icon
 * with no label.
 *
 * ## Ticks survive leaving the screen, and only that
 *
 * The state is [HandoverChecklistSession] (process-scoped, in memory). Navigating
 * to another tab and back keeps the ticks; killing the app clears them, and the
 * card's footer says so. Persisting was explicitly out of scope; pretending
 * otherwise would be worse than saying it.
 */
@Composable
fun HandoverChecklistSection(device: Device, modifier: Modifier = Modifier) {
    val s = appStrings()
    val cs = MaterialTheme.colorScheme
    val items = remember(s, device) { handoverChecklist(s, device) }
    val checkedByDevice by HandoverChecklistSession.store.checked.collectAsState()
    val checked = checkedByDevice[device.id].orEmpty()
    val done = handoverProgress(items, checked)
    // Open by default only when there is progress to show: a fresh device keeps
    // the detail screen short, a half-done checklist stays visible on the way back.
    var expanded by rememberSaveable(device.id) { mutableStateOf(checked.isNotEmpty()) }

    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(
                Modifier
                    .fillMaxWidth()
                    // A button, not a bare click target: the row expands the list,
                    // and TalkBack should announce that rather than "clickable".
                    .clickable(role = Role.Button) { expanded = !expanded }
                    .padding(bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Checklist, null, tint = cs.primary)
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        stringResource(R.string.handover_title),
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = cs.onSurface,
                    )
                    Text(
                        stringResource(R.string.handover_subtitle),
                        fontSize = 12.sp,
                        color = cs.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    stringResource(R.string.handover_progress, done, items.size),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = if (done == items.size) cs.primary else cs.onSurfaceVariant,
                )
                Icon(
                    if (expanded) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
                    stringResource(
                        if (expanded) R.string.handover_collapse else R.string.handover_expand,
                    ),
                    tint = cs.onSurfaceVariant,
                )
            }

            if (!expanded) return@Column

            Spacer(Modifier.height(8.dp))
            items.forEach { item ->
                HandoverRow(
                    item = item,
                    checked = item.key.name in checked,
                    onToggle = { HandoverChecklistSession.store.toggle(device.id, item.key) },
                )
            }
            Spacer(Modifier.height(6.dp))
            Text(
                stringResource(R.string.handover_session_note),
                fontSize = 11.sp,
                color = cs.onSurfaceVariant,
            )
            if (done > 0) {
                TextButton(
                    onClick = { HandoverChecklistSession.store.reset(device.id) },
                    contentPadding = PaddingValues(0.dp),
                ) {
                    Text(stringResource(R.string.handover_reset), fontSize = 13.sp)
                }
            }
        }
    }
}

@Composable
private fun HandoverRow(
    item: HandoverChecklistItem,
    checked: Boolean,
    onToggle: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    Row(
        Modifier
            .fillMaxWidth()
            .toggleable(value = checked, role = Role.Checkbox, onValueChange = { onToggle() })
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.Top,
    ) {
        // `onCheckedChange = null` on purpose: the row owns the toggle, so the
        // checkbox is presentation only and one tap cannot fire twice.
        Checkbox(checked = checked, onCheckedChange = null)
        Spacer(Modifier.width(4.dp))
        Column(Modifier.weight(1f)) {
            Text(
                stringResource(item.titleRes),
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                color = if (checked) cs.onSurfaceVariant else cs.onSurface,
                textDecoration = if (checked) TextDecoration.LineThrough else null,
            )
            // The per-device value (saved IMEI, warranty end) replaces the generic
            // "why" when there is one — one supporting line per row, never two.
            Text(
                item.note ?: stringResource(item.whyRes),
                fontSize = 11.sp,
                color = cs.onSurfaceVariant,
            )
        }
    }
}
