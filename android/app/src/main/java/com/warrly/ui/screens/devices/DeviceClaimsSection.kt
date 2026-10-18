package com.warrly.ui.screens.devices

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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warrly.R
import com.warrly.i18n.appStrings
import com.warrly.network.Claim
import com.warrly.network.Device
import com.warrly.ui.components.StatusPill
import com.warrly.ui.screens.vietnamDate
import com.warrly.ui.theme.WVAccent

/**
 * "Sửa chữa & bảo hành" — the device-scoped warranty-claim section.
 *
 * ## Why this lives on the device detail and not in a ninth tab
 *
 * A claim belongs to exactly one device: `deviceId` is required by the
 * contract, `warrantyId` must be one of *that* device's plans, and the
 * one-open-claim-per-device cap only makes sense against a device. The detail
 * payload (`GET /api/v1/devices/{id}`) is also the only read that carries
 * `claims`, so a cross-device list would need a join the contract's `Claim` does
 * not expose (it has no device name).
 *
 * The bottom bar already holds eight destinations. A ninth "Repairs" tab would
 * duplicate the per-device relationship and still need a tap into the device to
 * add or edit anything. The dead end this feature closes — `BROKEN` with nowhere
 * to put what happens next — is visible exactly where the status is: here.
 * Cross-device discovery already exists through the device list's status filter
 * and the device status pill, and the `BROKEN` nudge below makes the missing
 * claim impossible to miss.
 *
 * ## What this section shows
 *
 *  * every claim, live ones first (`claimsInDisplayOrder`), with status, dates
 *    and ticket number;
 *  * a warning-coloured nudge when the device is `BROKEN` and no claim is
 *    open — including when every past claim is terminal;
 *  * a neutral empty state otherwise, and an inline error for a failed delete.
 *
 * The add/edit form is [ClaimEditSheet]; the 409 rule and the broken-device
 * predicate are pure and tested in `ClaimRulesTest`.
 */
@Composable
fun DeviceClaimsSection(
    device: Device,
    /** A failed delete/action on this section, shown above the list. */
    error: String?,
    onClearError: () -> Unit,
    onAdd: () -> Unit,
    onEdit: (Claim) -> Unit,
    onDelete: (Claim) -> Unit,
    modifier: Modifier = Modifier,
) {
    val claims = claimsInDisplayOrder(device.claims)
    val nudge = device.isBrokenWithoutOpenClaim()
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.Filled.Build, null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                stringResource(R.string.claim_section_title),
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.weight(1f))
            TextButton(onClick = onAdd) {
                Icon(Icons.Filled.Add, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text(stringResource(R.string.claim_add))
            }
        }
        if (error != null) {
            ClaimErrorCard(message = error, onDismiss = onClearError)
        }
        if (nudge) {
            ClaimNudgeCard(onAdd = onAdd)
        }
        if (claims.isEmpty()) {
            if (!nudge) {
                ClaimEmptyCard(onAdd = onAdd)
            }
        } else {
            claims.forEach { claim ->
                ClaimCard(
                    claim = claim,
                    onEdit = { onEdit(claim) },
                    onDelete = { onDelete(claim) },
                )
            }
        }
    }
}

/**
 * The `BROKEN` dead-end nudge. Warning-coloured (not an error): the device is
 * saved, the status is a deliberate fact, and the action is one tap away.
 */
@Composable
private fun ClaimNudgeCard(onAdd: () -> Unit) {
    val accent = WVAccent.current
    Card(
        colors = CardDefaults.cardColors(containerColor = accent.warningContainer),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Icon(
                    Icons.Outlined.WarningAmber, null,
                    tint = accent.warning,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    stringResource(R.string.claim_broken_nudge_title),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = accent.onWarningContainer,
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(
                stringResource(R.string.claim_broken_nudge_body),
                style = MaterialTheme.typography.bodySmall,
                color = accent.onWarningContainer,
            )
            TextButton(onClick = onAdd) {
                Icon(
                    Icons.Filled.Add, null,
                    tint = accent.onWarningContainer,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(4.dp))
                Text(
                    stringResource(R.string.claim_broken_nudge_action),
                    color = accent.onWarningContainer,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

/** Neutral empty state for a device that is not marked broken. */
@Composable
private fun ClaimEmptyCard(onAdd: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerHighest,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            Modifier.padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                stringResource(R.string.claim_empty_title),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                stringResource(R.string.claim_empty_body),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(4.dp))
            TextButton(onClick = onAdd) {
                Text(stringResource(R.string.claim_add_first))
            }
        }
    }
}

/** One repair ticket. Rows are omitted rather than blanked when a value is absent. */
@Composable
private fun ClaimCard(
    claim: Claim,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    val s = appStrings()
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusPill(
                    label = claimStatusLabel(s, claim.status),
                    kind = claimStatusPillKind(claim.status),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    claim.issue,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onSurface,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = onEdit) {
                    Icon(
                        Icons.Filled.Edit, stringResource(R.string.action_edit),
                        tint = cs.onSurfaceVariant,
                    )
                }
                IconButton(onClick = onDelete) {
                    Icon(
                        Icons.Filled.Delete, stringResource(R.string.action_delete),
                        tint = cs.error,
                    )
                }
            }
            // Ticket number first: it is the thing the shop asks for on the
            // phone, and the reason a claim is worth recording at all.
            if (!claim.ticketNumber.isNullOrBlank()) {
                ClaimRow(stringResource(R.string.claim_ticket_number), claim.ticketNumber)
            }
            vietnamDate(claim.openedAt)?.let {
                ClaimRow(stringResource(R.string.claim_opened_on), it)
            }
            vietnamDate(claim.expectedReturnAt)?.let {
                ClaimRow(stringResource(R.string.claim_expected_return), it)
            }
            // Server-set, and only meaningful once the claim is terminal.
            vietnamDate(claim.closedAt)?.let {
                ClaimRow(stringResource(R.string.claim_closed_on), it)
            }
            if (!claim.serviceCenter.isNullOrBlank()) {
                ClaimRow(stringResource(R.string.claim_service_center), claim.serviceCenter)
            }
            // `null` = not recorded, `0` = a real free repair: both must read
            // differently, which is why the helper returns null only for null.
            claimCostLabel(s, claim.cost)?.let {
                ClaimRow(stringResource(R.string.claim_cost), it)
            }
            // Tri-state: only an explicit Yes/No is shown on the card. `null`
            // means "not recorded" and is not a row the user wrote.
            claim.coveredByWarranty?.let {
                ClaimRow(
                    stringResource(R.string.claim_covered_by_warranty),
                    coveredByWarrantyLabel(s, it),
                )
            }
            claim.diagnosis?.takeIf { it.isNotBlank() }?.let {
                ClaimParagraph(stringResource(R.string.claim_diagnosis), it)
            }
            claim.outcome?.takeIf { it.isNotBlank() }?.let {
                ClaimParagraph(stringResource(R.string.claim_outcome), it)
            }
        }
    }
}

@Composable
private fun ClaimErrorCard(message: String, onDismiss: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.errorContainer),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(start = 12.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Outlined.WarningAmber, null,
                tint = cs.onErrorContainer,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                message,
                color = cs.onErrorContainer,
                fontSize = 13.sp,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.action_close), color = cs.onErrorContainer)
            }
        }
    }
}

@Composable
private fun ClaimRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(
            label,
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(112.dp),
        )
        Text(value, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface)
    }
}

@Composable
private fun ClaimParagraph(label: String, value: String) {
    Spacer(Modifier.height(6.dp))
    Text(
        label,
        fontSize = 12.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Text(value, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface)
}
