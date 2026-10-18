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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warrly.R
import com.warrly.i18n.appStrings
import com.warrly.network.ApiClient
import com.warrly.network.ApiService
import com.warrly.network.Claim
import com.warrly.network.ClaimInput
import com.warrly.network.ClaimStatus
import com.warrly.network.Device
import com.warrly.network.Warranty
import com.warrly.network.toUserMessage
import com.warrly.ui.components.SheetGroup
import com.warrly.ui.screens.vietnamDate
import com.warrly.ui.theme.WVAccent
import kotlinx.coroutines.launch

/**
 * The add/edit form for one **warranty claim** — the repair ticket that turns
 * `Device.status = BROKEN` from a dead end into a record.
 *
 * ## The fields
 *
 * Every writable contract field is here: device (prefilled and read-only — a
 * claim never moves between devices), warranty (only *this* device's plans),
 * status, opened date, expected return, ticket number, shop, issue, diagnosis,
 * outcome, cost and the tri-state "warranty pays".
 *
 * Two deliberate omissions:
 *
 *  * **`closedAt`** is server-owned. It is never shown as an input; the closing
 *    date appears on the card after the server stamps it.
 *  * **The device picker** is not a picker. The contract requires `deviceId`,
 *    and the claim's whole meaning is "this device's repair"; the field is a
 *    read-only line so the form always says which device it will be saved on.
 *
 * `issue` is required (Save stays disabled until it is non-blank) and `cost` is
 * digit-only, so a negative amount can neither be typed nor sent. `null`
 * `coveredByWarranty` is dropped from the JSON by `ApiClient.json`
 * (`explicitNulls = false`) and therefore means "unknown", which is exactly the
 * tri-state the contract keeps.
 *
 * ## The 409
 *
 * A second `OPEN`/`IN_REPAIR` claim is **409 `limit_reached`**. A generic
 * "conflict" would strand the user: the whole point of the contract's cap is to
 * force them into the ticket that is already open. So the sheet catches that
 * code specifically ([claimWriteError]), warns in context, and offers **Open the
 * existing ticket**. The target comes from the loaded device first; if the
 * detail payload is stale, it is looked up through
 * `GET /api/v1/claims?deviceId=…` so the way out does not depend on a previous
 * screen having fresh data.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClaimEditSheet(
    api: ApiService,
    /** The device the claim belongs to (prefilled, never editable here). */
    device: Device,
    /** The claim being edited, or `null` for a new one. */
    existing: Claim?,
    /** The device's claims as loaded — the first place to find a 409 target. */
    existingClaims: List<Claim>,
    onDismiss: () -> Unit,
    onSaved: () -> Unit,
    /** Open the live claim a 409 pointed at, in this same sheet position. */
    onOpenExistingClaim: (Claim) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    var status by remember { mutableStateOf(existing?.status ?: ClaimStatus.OPEN) }
    var warrantyId by remember { mutableStateOf<String?>(existing?.warrantyId) }
    var openedAt by remember {
        mutableStateOf(existing?.openedAt?.take(10) ?: todayUtcIso())
    }
    var expectedReturnAt by remember {
        mutableStateOf(existing?.expectedReturnAt?.take(10).orEmpty())
    }
    var ticketNumber by remember { mutableStateOf(existing?.ticketNumber.orEmpty()) }
    var serviceCenter by remember { mutableStateOf(existing?.serviceCenter.orEmpty()) }
    var issue by remember { mutableStateOf(existing?.issue.orEmpty()) }
    var diagnosis by remember { mutableStateOf(existing?.diagnosis.orEmpty()) }
    var outcome by remember { mutableStateOf(existing?.outcome.orEmpty()) }
    var cost by remember { mutableStateOf(existing?.cost?.toString().orEmpty()) }
    var coveredByWarranty by remember { mutableStateOf(existing?.coveredByWarranty) }

    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var fieldErrors by remember { mutableStateOf<Map<String, List<String>>>(emptyMap()) }
    // The 409 state. `limitTarget` is the ticket the button opens; it can take
    // one request to find when the loaded device is stale.
    var limitReached by remember { mutableStateOf(false) }
    var limitTarget by remember { mutableStateOf<Claim?>(null) }
    var limitLookingUp by remember { mutableStateOf(false) }

    // The 409 code is shared with the account-wide claim ceiling, so the server's
    // own words are the only honest fallback when no open claim can be found.
    var limitMessage by remember { mutableStateOf<String?>(null) }

    fun fieldError(key: String): String? = fieldErrors[key]?.firstOrNull()

    val costInvalid = cost.isNotBlank() && !claimCostIsValid(cost)
    val costError = fieldError("cost")
        ?: if (costInvalid) stringResource(R.string.claim_form_cost_invalid) else null
    val issueError = fieldError("issue")
    val openedAtError = fieldError("openedAt")

    val title = if (existing == null) {
        stringResource(R.string.claim_form_title_add)
    } else {
        stringResource(R.string.claim_form_title_edit)
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(title, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)

            // ---- Who / which plan / when --------------------------------
            SheetGroup {
                OutlinedTextField(
                    value = device.name,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text(stringResource(R.string.claim_form_device)) },
                    modifier = Modifier.fillMaxWidth(),
                )
                ClaimWarrantyDropdown(
                    warranties = device.warranties,
                    selectedId = warrantyId,
                    onSelected = {
                        warrantyId = it
                        fieldErrors = fieldErrors - "warrantyId"
                    },
                    error = fieldError("warrantyId"),
                )
                ClaimStatusDropdown(
                    selected = status,
                    onSelected = { status = it },
                )
                OutlinedTextField(
                    value = openedAt,
                    onValueChange = {
                        openedAt = it
                        fieldErrors = fieldErrors - "openedAt"
                    },
                    label = { Text(stringResource(R.string.claim_form_opened_at)) },
                    isError = openedAtError != null,
                    supportingText = openedAtError?.let { msg ->
                        { Text(msg, color = MaterialTheme.colorScheme.error) }
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                val expectedReturnError = fieldError("expectedReturnAt")
                OutlinedTextField(
                    value = expectedReturnAt,
                    onValueChange = {
                        expectedReturnAt = it
                        fieldErrors = fieldErrors - "expectedReturnAt"
                    },
                    label = { Text(stringResource(R.string.claim_form_expected_return)) },
                    isError = expectedReturnError != null,
                    supportingText = expectedReturnError?.let { msg ->
                        { Text(msg, color = MaterialTheme.colorScheme.error) }
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            // ---- The repair itself --------------------------------------
            SheetGroup {
                val ticketError = fieldError("ticketNumber")
                OutlinedTextField(
                    value = ticketNumber,
                    onValueChange = {
                        ticketNumber = it
                        fieldErrors = fieldErrors - "ticketNumber"
                    },
                    label = { Text(stringResource(R.string.claim_form_ticket_number)) },
                    isError = ticketError != null,
                    supportingText = ticketError?.let { msg ->
                        { Text(msg, color = MaterialTheme.colorScheme.error) }
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                val serviceCenterError = fieldError("serviceCenter")
                OutlinedTextField(
                    value = serviceCenter,
                    onValueChange = {
                        serviceCenter = it
                        fieldErrors = fieldErrors - "serviceCenter"
                    },
                    label = { Text(stringResource(R.string.claim_form_service_center)) },
                    isError = serviceCenterError != null,
                    supportingText = serviceCenterError?.let { msg ->
                        { Text(msg, color = MaterialTheme.colorScheme.error) }
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = issue,
                    onValueChange = {
                        issue = it
                        fieldErrors = fieldErrors - "issue"
                    },
                    label = { Text(stringResource(R.string.claim_form_issue)) },
                    minLines = 2,
                    isError = issueError != null,
                    supportingText = {
                        Text(
                            issueError ?: stringResource(R.string.claim_form_issue_hint),
                            color = if (issueError != null) {
                                MaterialTheme.colorScheme.error
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                            fontSize = 11.sp,
                        )
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                val diagnosisError = fieldError("diagnosis")
                OutlinedTextField(
                    value = diagnosis,
                    onValueChange = {
                        diagnosis = it
                        fieldErrors = fieldErrors - "diagnosis"
                    },
                    label = { Text(stringResource(R.string.claim_form_diagnosis)) },
                    minLines = 2,
                    isError = diagnosisError != null,
                    supportingText = diagnosisError?.let { msg ->
                        { Text(msg, color = MaterialTheme.colorScheme.error) }
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                val outcomeError = fieldError("outcome")
                OutlinedTextField(
                    value = outcome,
                    onValueChange = {
                        outcome = it
                        fieldErrors = fieldErrors - "outcome"
                    },
                    label = { Text(stringResource(R.string.claim_form_outcome)) },
                    minLines = 2,
                    isError = outcomeError != null,
                    supportingText = outcomeError?.let { msg ->
                        { Text(msg, color = MaterialTheme.colorScheme.error) }
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = cost,
                    onValueChange = {
                        cost = it.filter { c -> c.isDigit() }
                        fieldErrors = fieldErrors - "cost"
                    },
                    label = { Text(stringResource(R.string.claim_form_cost)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    isError = costError != null,
                    supportingText = {
                        Text(
                            costError ?: stringResource(R.string.claim_form_cost_note),
                            color = if (costError != null) {
                                MaterialTheme.colorScheme.error
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                            fontSize = 11.sp,
                        )
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                CoveredByWarrantyDropdown(
                    selected = coveredByWarranty,
                    onSelected = { coveredByWarranty = it },
                )
                // Only meaningful on an already-closed ticket: the date is the
                // server's, so the form says so rather than offering an input.
                if (existing?.closedAt != null) {
                    Text(
                        stringResource(R.string.claim_form_closed_note),
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            // ---- The 409, in context ------------------------------------
            if (limitReached) {
                LimitReachedCard(
                    target = limitTarget,
                    lookingUp = limitLookingUp,
                    serverMessage = limitMessage,
                    onOpenExisting = { target -> onOpenExistingClaim(target) },
                )
            }

            error?.let {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Outlined.WarningAmber, null,
                        tint = MaterialTheme.colorScheme.error,
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                }
            }

            val canSubmit = !submitting &&
                issue.trim().isNotEmpty() &&
                openedAt.isNotBlank() &&
                !costInvalid

            Button(
                onClick = {
                    scope.launch {
                        submitting = true
                        error = null
                        fieldErrors = emptyMap()
                        limitReached = false
                        limitTarget = null
                        limitLookingUp = false
                        val input = ClaimInput(
                            deviceId = device.id,
                            warrantyId = warrantyId,
                            status = status,
                            openedAt = openedAt.trim(),
                            expectedReturnAt = expectedReturnAt.trim().ifBlank { null },
                            ticketNumber = ticketNumber.trim().ifBlank { null },
                            serviceCenter = serviceCenter.trim().ifBlank { null },
                            diagnosis = diagnosis.trim().ifBlank { null },
                            outcome = outcome.trim().ifBlank { null },
                            issue = issue.trim(),
                            cost = claimCostValue(cost),
                            coveredByWarranty = coveredByWarranty,
                        )
                        try {
                            if (existing == null) {
                                api.createClaim(input)
                            } else {
                                api.updateClaim(existing.id, input)
                            }
                            onSaved()
                        } catch (e: Exception) {
                            // One parse of the error body: it carries the machine
                            // code, the translated message AND the field errors,
                            // and `ResponseBody.string()` is one-shot.
                            val parsed = claimWriteError(e, ApiClient.json)
                            fieldErrors = parsed.fieldErrors
                            when (parsed.failure) {
                                ClaimFailure.LIMIT_REACHED -> {
                                    limitReached = true
                                    limitMessage = parsed.serverMessage
                                    limitTarget = claimLimitTarget(
                                        existingClaims,
                                        editingClaimId = existing?.id,
                                    )
                                    if (limitTarget == null) {
                                        // The device payload may be stale. The
                                        // contract's list endpoint is the
                                        // authority, and "no way out" is the one
                                        // thing this screen must not say.
                                        limitLookingUp = true
                                        limitTarget = runCatching {
                                            claimLimitTarget(
                                                api.listClaims(deviceId = device.id).claims,
                                                editingClaimId = existing?.id,
                                            )
                                        }.getOrNull()
                                        limitLookingUp = false
                                    }
                                }
                                ClaimFailure.OTHER -> {
                                    error = parsed.serverMessage
                                        ?: e.toUserMessage(ApiClient.json, context)
                                }
                            }
                        } finally {
                            submitting = false
                        }
                    }
                },
                enabled = canSubmit,
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                ),
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                if (submitting) {
                    CircularProgressIndicator(
                        strokeWidth = 2.dp,
                        modifier = Modifier.height(20.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                } else {
                    Text(stringResource(R.string.action_save), fontWeight = FontWeight.SemiBold)
                }
            }

            Spacer(Modifier.height(20.dp))
        }
    }
}

/**
 * The 409 body: names the constraint, then either opens the live ticket or says
 * that it could not be loaded here. It is warning-coloured, not error-coloured:
 * the claim was not saved, but nothing is broken in the app.
 */
@Composable
private fun LimitReachedCard(
    target: Claim?,
    lookingUp: Boolean,
    serverMessage: String?,
    onOpenExisting: (Claim) -> Unit,
) {
    // `target == null` after the lookup means the device has no open ticket, so
    // the 409 came from the per-account ceiling. Saying "already has an open
    // repair" there would be a lie about the user's own device.
    val openRepairExists = target != null || lookingUp
    val accent = WVAccent.current
    Card(
        colors = CardDefaults.cardColors(containerColor = accent.warningContainer),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
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
                    stringResource(
                        if (openRepairExists) R.string.claim_limit_reached_title
                        else R.string.claim_limit_reached_generic_title,
                    ),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = accent.onWarningContainer,
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(
                if (openRepairExists) stringResource(R.string.claim_limit_reached_body)
                else serverMessage ?: stringResource(R.string.claim_lookup_failed),
                style = MaterialTheme.typography.bodySmall,
                color = accent.onWarningContainer,
            )
            when {
                lookingUp -> Row(
                    Modifier.padding(top = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(16.dp),
                        color = accent.onWarningContainer,
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        stringResource(R.string.claim_looking_up_open),
                        style = MaterialTheme.typography.bodySmall,
                        color = accent.onWarningContainer,
                    )
                }
                target != null -> TextButton(onClick = { onOpenExisting(target) }) {
                    Text(
                        stringResource(R.string.claim_open_existing),
                        color = accent.onWarningContainer,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                else -> Text(
                    stringResource(R.string.claim_lookup_failed),
                    style = MaterialTheme.typography.bodySmall,
                    color = accent.onWarningContainer,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ClaimStatusDropdown(
    selected: ClaimStatus,
    onSelected: (ClaimStatus) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
    ) {
        TextField(
            value = stringResource(selected.labelRes),
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.claim_form_status)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            ClaimStatus.entries.forEach { option ->
                DropdownMenuItem(
                    text = { Text(stringResource(option.labelRes)) },
                    onClick = {
                        onSelected(option)
                        expanded = false
                    },
                )
            }
        }
    }
}

/**
 * Warranty picker restricted to **the claim's own device** — the contract
 * requires `warrantyId` to belong to `deviceId`, so a plan from another device
 * is not offered at all.
 *
 * `null` is a real option ("no plan linked"). A stored id that is not in the
 * current list (the plan was removed elsewhere) is shown as
 * "Plan no longer on this device" and preserved rather than silently cleared:
 * dropping it would turn an edit of the ticket number into a detach.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ClaimWarrantyDropdown(
    warranties: List<Warranty>,
    selectedId: String?,
    onSelected: (String?) -> Unit,
    error: String?,
) {
    var expanded by remember { mutableStateOf(false) }
    val selected = warranties.firstOrNull { it.id == selectedId }
    val value = when {
        selectedId == null -> stringResource(R.string.claim_form_no_warranty)
        selected != null -> warrantyOptionLabel(selected)
        else -> stringResource(R.string.claim_form_warranty_missing)
    }
    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
    ) {
        TextField(
            value = value,
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.claim_form_warranty)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            isError = error != null,
            supportingText = error?.let { msg ->
                { Text(msg, color = MaterialTheme.colorScheme.error) }
            },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.claim_form_no_warranty)) },
                onClick = {
                    onSelected(null)
                    expanded = false
                },
            )
            warranties.forEach { warranty ->
                DropdownMenuItem(
                    text = { Text(warrantyOptionLabel(warranty)) },
                    onClick = {
                        onSelected(warranty.id)
                        expanded = false
                    },
                )
            }
        }
    }
}

/** "AppleCare · Standard · 01/03/2026" — enough to pick the right plan. */
@Composable
private fun warrantyOptionLabel(warranty: Warranty): String {
    val provider = warranty.provider?.takeIf { it.isNotBlank() }
    return listOfNotNull(
        provider,
        stringResource(warranty.type.labelRes),
        vietnamDate(warranty.endDate),
    ).joinToString(" · ")
}

/** Yes / No / Not specified. `null` is a real choice, not a missing one. */
private val COVERED_CHOICES: List<Boolean?> = listOf(true, false, null)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CoveredByWarrantyDropdown(
    selected: Boolean?,
    onSelected: (Boolean?) -> Unit,
) {
    val s = appStrings()
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
    ) {
        TextField(
            value = coveredByWarrantyLabel(s, selected),
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.claim_form_covered)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            COVERED_CHOICES.forEach { choice ->
                DropdownMenuItem(
                    text = { Text(coveredByWarrantyLabel(s, choice)) },
                    onClick = {
                        onSelected(choice)
                        expanded = false
                    },
                )
            }
        }
    }
}
