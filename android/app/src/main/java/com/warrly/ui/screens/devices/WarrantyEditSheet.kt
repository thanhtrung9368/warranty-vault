package com.warrly.ui.screens.devices

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.material3.TextField
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warrly.R
import com.warrly.i18n.appStrings
import com.warrly.network.ApiClient
import com.warrly.network.ApiService
import com.warrly.network.DEFAULT_CURRENCY
import com.warrly.network.Warranty
import com.warrly.network.WarrantyInput
import com.warrly.network.WarrantyProviderOption
import com.warrly.network.WarrantyType
import com.warrly.network.fieldErrors
import com.warrly.network.toUserMessage
import com.warrly.ui.components.SheetGroup
import com.warrly.ui.screens.common.WarrantyProviderAutocompleteField
import com.warrly.ui.screens.common.rememberCatalog
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WarrantyEditSheet(
    api: ApiService,
    deviceId: String,
    existing: Warranty?,
    onDismiss: () -> Unit,
    onSaved: () -> Unit,
    /**
     * The owning device's ISO 4217 currency. `Warranty.cost` is denominated in
     * it, so the label must say USD for a USD device instead of the old
     * unconditional "Cost (VND)". Defaults to VND for a caller that has no
     * device row at hand.
     */
    currency: String = DEFAULT_CURRENCY,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()

    var type by remember { mutableStateOf(existing?.type ?: WarrantyType.STANDARD) }
    var provider by remember { mutableStateOf(existing?.provider.orEmpty()) }
    var startDate by remember { mutableStateOf(existing?.startDate?.take(10) ?: todayUtcIso()) }
    var months by remember { mutableStateOf((existing?.months ?: 12).toString()) }
    var cost by remember { mutableStateOf(existing?.cost?.toString().orEmpty()) }
    var address by remember { mutableStateOf(existing?.address.orEmpty()) }
    var phone by remember { mutableStateOf(existing?.phone.orEmpty()) }
    var notes by remember { mutableStateOf(existing?.notes.orEmpty()) }

    // Contract terms. Nine more always-visible fields would bury a sheet that is
    // already long, so they live in ONE collapsible group. The default is the
    // important decision: collapsed when none of the nine is set (the common
    // plan, unchanged from before this feature), expanded when the row already
    // carries terms — an edit must not hide data the user came to see.
    var component by remember { mutableStateOf(existing?.component.orEmpty()) }
    // Called `coverage`, not `scope`: `scope` is already the coroutine scope above.
    var coverage by remember { mutableStateOf(existing?.scope.orEmpty()) }
    var cap by remember { mutableStateOf(existing?.cap?.toString().orEmpty()) }
    var deductible by remember { mutableStateOf(existing?.deductible?.toString().orEmpty()) }
    var exclusions by remember { mutableStateOf(existing?.exclusions.orEmpty()) }
    var region by remember { mutableStateOf(existing?.region.orEmpty()) }
    var transferable by remember { mutableStateOf(existing?.transferable) }
    var claimsAllowed by remember { mutableStateOf(existing?.claimsAllowed?.toString().orEmpty()) }
    // Blank, not "0": 0 is the contract default and an empty field is what
    // "none used yet" looks like. Saving always sends a number (0 when blank).
    var claimsUsed by remember {
        mutableStateOf(existing?.claimsUsed?.takeIf { it > 0 }?.toString().orEmpty())
    }
    var termsExpanded by rememberSaveable(existing?.id) {
        mutableStateOf(existing?.hasContractTerms() == true)
    }

    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var fieldErrors by remember { mutableStateOf<Map<String, List<String>>>(emptyMap()) }

    val claimsAllowedInt = claimsAllowed.toIntOrNull()
    val claimsUsedInt = claimsUsed.toIntOrNull() ?: 0
    // The server rejects this pair with a 400 on `fieldErrors.claimsUsed`; the
    // form blocks it before the request and says the same sentence inline.
    val claimsOverLimit = claimsExceedAllowed(claimsUsedInt, claimsAllowedInt)
    val claimsOverLimitMessage =
        if (claimsOverLimit) stringResource(R.string.warr_terms_claims_over_limit) else null

    val catalog = rememberCatalog(api)
    val providerOptions: List<WarrantyProviderOption> = catalog?.warrantyProviders ?: emptyList()

    val title = if (existing == null) stringResource(R.string.warr_add_a_warranty_plan) else stringResource(R.string.warr_edit_warranty_plan)

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(title, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)

            SheetGroup {
                WarrantyTypeDropdown(selected = type, onSelected = { type = it })
                WarrantyProviderAutocompleteField(
                    providers = providerOptions,
                    value = provider,
                    onValueChange = { provider = it },
                    onProviderPicked = { picked ->
                        if (phone.isBlank()) picked.phone?.let { phone = it }
                        if (address.isBlank()) picked.address?.let { address = it }
                    },
                )
                OutlinedTextField(
                    value = startDate, onValueChange = { startDate = it },
                    label = { Text(stringResource(R.string.warr_start_date_yyyy_mm_dd)) },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = months,
                    onValueChange = { months = it.filter { c -> c.isDigit() } },
                    label = { Text(stringResource(R.string.warr_months)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = cost,
                    onValueChange = { cost = it.filter { c -> c.isDigit() } },
                    label = {
                        // Cost follows the device's currency, not a fixed "VND":
                        // a USD device's plan cost is entered in dollars.
                        Text(stringResource(R.string.warr_cost_currency, normalizeCurrency(currency)))
                    },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            SheetGroup {
                OutlinedTextField(
                    value = phone, onValueChange = { phone = it },
                    label = { Text(stringResource(R.string.devadd_contact_phone)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = address, onValueChange = { address = it },
                    label = { Text(stringResource(R.string.warr_address)) },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = notes, onValueChange = { notes = it },
                    label = { Text(stringResource(R.string.warr_note)) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            // Contract terms — ONE collapsible group, collapsed by default when
            // none of the nine fields is set and expanded when the plan already
            // has terms (see `termsExpanded`). Nine always-visible fields would
            // bury a sheet that is already long; the header is the whole touch
            // target and announces itself as a button, like the handover card.
            SheetGroup {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable(role = Role.Button) { termsExpanded = !termsExpanded }
                        .padding(bottom = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.Description, null,
                        tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            stringResource(R.string.warr_terms_title),
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            stringResource(R.string.warr_terms_subtitle),
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Spacer(Modifier.width(8.dp))
                    Icon(
                        if (termsExpanded) {
                            Icons.Filled.KeyboardArrowUp
                        } else {
                            Icons.Filled.KeyboardArrowDown
                        },
                        stringResource(
                            if (termsExpanded) {
                                R.string.warr_terms_collapse
                            } else {
                                R.string.warr_terms_expand
                            },
                        ),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                if (termsExpanded) {
                    val componentError = fieldErrors["component"]?.firstOrNull()
                    OutlinedTextField(
                        value = component,
                        onValueChange = {
                            component = it
                            fieldErrors = fieldErrors - "component"
                        },
                        label = { Text(stringResource(R.string.warr_terms_component)) },
                        isError = componentError != null,
                        supportingText = {
                            Text(
                                componentError
                                    ?: stringResource(R.string.warr_terms_component_hint),
                                color = if (componentError != null) {
                                    MaterialTheme.colorScheme.error
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                },
                                fontSize = 11.sp,
                            )
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    val scopeError = fieldErrors["scope"]?.firstOrNull()
                    OutlinedTextField(
                        value = coverage,
                        onValueChange = {
                            coverage = it
                            fieldErrors = fieldErrors - "scope"
                        },
                        label = { Text(stringResource(R.string.warr_terms_scope)) },
                        minLines = 2,
                        isError = scopeError != null,
                        supportingText = scopeError?.let { msg ->
                            { Text(msg, color = MaterialTheme.colorScheme.error) }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    val capError = fieldErrors["cap"]?.firstOrNull()
                    OutlinedTextField(
                        value = cap,
                        onValueChange = {
                            cap = it.filter { c -> c.isDigit() }
                            fieldErrors = fieldErrors - "cap"
                        },
                        label = { Text(stringResource(R.string.warr_terms_cap_vnd)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        isError = capError != null,
                        supportingText = capError?.let { msg ->
                            { Text(msg, color = MaterialTheme.colorScheme.error) }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    val deductibleError = fieldErrors["deductible"]?.firstOrNull()
                    OutlinedTextField(
                        value = deductible,
                        onValueChange = {
                            deductible = it.filter { c -> c.isDigit() }
                            fieldErrors = fieldErrors - "deductible"
                        },
                        label = { Text(stringResource(R.string.warr_terms_deductible_vnd)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        isError = deductibleError != null,
                        supportingText = deductibleError?.let { msg ->
                            { Text(msg, color = MaterialTheme.colorScheme.error) }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    val claimsAllowedError = fieldErrors["claimsAllowed"]?.firstOrNull()
                    OutlinedTextField(
                        value = claimsAllowed,
                        onValueChange = {
                            claimsAllowed = it.filter { c -> c.isDigit() }
                            fieldErrors = fieldErrors - "claimsAllowed"
                        },
                        label = { Text(stringResource(R.string.warr_terms_claims_allowed)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        isError = claimsAllowedError != null,
                        supportingText = claimsAllowedError?.let { msg ->
                            { Text(msg, color = MaterialTheme.colorScheme.error) }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    val claimsUsedError =
                        fieldErrors["claimsUsed"]?.firstOrNull() ?: claimsOverLimitMessage
                    OutlinedTextField(
                        value = claimsUsed,
                        onValueChange = {
                            claimsUsed = it.filter { c -> c.isDigit() }
                            fieldErrors = fieldErrors - "claimsUsed"
                        },
                        label = { Text(stringResource(R.string.warr_terms_claims_used)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        isError = claimsUsedError != null,
                        supportingText = claimsUsedError?.let { msg ->
                            { Text(msg, color = MaterialTheme.colorScheme.error) }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    val regionError = fieldErrors["region"]?.firstOrNull()
                    OutlinedTextField(
                        value = region,
                        onValueChange = {
                            region = it
                            fieldErrors = fieldErrors - "region"
                        },
                        label = { Text(stringResource(R.string.warr_terms_region)) },
                        isError = regionError != null,
                        supportingText = regionError?.let { msg ->
                            { Text(msg, color = MaterialTheme.colorScheme.error) }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    TransferableDropdown(
                        selected = transferable,
                        onSelected = {
                            transferable = it
                            fieldErrors = fieldErrors - "transferable"
                        },
                        error = fieldErrors["transferable"]?.firstOrNull(),
                    )
                    val exclusionsError = fieldErrors["exclusions"]?.firstOrNull()
                    OutlinedTextField(
                        value = exclusions,
                        onValueChange = {
                            exclusions = it
                            fieldErrors = fieldErrors - "exclusions"
                        },
                        label = { Text(stringResource(R.string.warr_terms_exclusions)) },
                        minLines = 2,
                        isError = exclusionsError != null,
                        supportingText = exclusionsError?.let { msg ->
                            { Text(msg, color = MaterialTheme.colorScheme.error) }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            error?.let {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.WarningAmber, null,
                        tint = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.padding(2.dp))
                    Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                }
            }

            val monthsInt = months.toIntOrNull() ?: 0
            val canSubmit = !submitting && startDate.isNotBlank() && monthsInt >= 1 &&
                !claimsOverLimit

            Button(
                onClick = {
                    scope.launch {
                        submitting = true; error = null; fieldErrors = emptyMap()
                        val input = WarrantyInput(
                            type = type,
                            provider = provider.ifBlank { null },
                            startDate = startDate.trim(),
                            months = monthsInt,
                            cost = cost.toIntOrNull(),
                            address = address.ifBlank { null },
                            phone = phone.ifBlank { null },
                            notes = notes.ifBlank { null },
                            // Contract terms. Blank text becomes null and is
                            // dropped from the JSON (explicitNulls = false); a
                            // blank number becomes null too, EXCEPT claimsUsed,
                            // whose contract default is 0.
                            component = component.ifBlank { null },
                            scope = coverage.ifBlank { null },
                            cap = cap.toIntOrNull(),
                            deductible = deductible.toIntOrNull(),
                            exclusions = exclusions.ifBlank { null },
                            region = region.ifBlank { null },
                            transferable = transferable,
                            claimsAllowed = claimsAllowed.toIntOrNull(),
                            claimsUsed = claimsUsedInt,
                        )
                        try {
                            if (existing == null) {
                                api.createWarranty(deviceId, input)
                            } else {
                                api.updateWarranty(existing.id, input)
                            }
                            onSaved()
                        } catch (e: Exception) {
                            val fe = e.fieldErrors(ApiClient.json)
                            fieldErrors = fe
                            // A terms-field error is shown under its own input;
                            // open the group so the user can actually see it.
                            if (fe.keys.any { it in CONTRACT_TERM_FIELDS }) {
                                termsExpanded = true
                            }
                            error = if (fe.isEmpty() || fe.keys.any { it !in CONTRACT_TERM_FIELDS }) {
                                e.toUserMessage(ApiClient.json)
                            } else {
                                null
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WarrantyTypeDropdown(
    selected: WarrantyType,
    onSelected: (WarrantyType) -> Unit,
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
            label = { Text(stringResource(R.string.warr_warranty_type)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            WarrantyType.entries.forEach { t ->
                DropdownMenuItem(
                    text = { Text(stringResource(t.labelRes)) },
                    onClick = {
                        onSelected(t)
                        expanded = false
                    },
                )
            }
        }
    }
}

/**
 * The nine API fields rendered inside the terms group. Used only to decide
 * whether a server `fieldErrors` entry can be shown under its own input (so
 * the shared error banner is not duplicated) and whether the group must open.
 */
private val CONTRACT_TERM_FIELDS = setOf(
    "component",
    "scope",
    "cap",
    "deductible",
    "exclusions",
    "region",
    "transferable",
    "claimsAllowed",
    "claimsUsed",
)

/**
 * Yes / No / Not specified. `null` is a real option, not a missing one: the
 * contract distinguishes "not recorded" from an explicit "not transferable".
 */
private val TRANSFERABLE_CHOICES: List<Boolean?> = listOf(true, false, null)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TransferableDropdown(
    selected: Boolean?,
    onSelected: (Boolean?) -> Unit,
    error: String?,
) {
    val s = appStrings()
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
    ) {
        TextField(
            value = transferableLabel(s, selected),
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.warr_terms_transferable)) },
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
            TRANSFERABLE_CHOICES.forEach { choice ->
                DropdownMenuItem(
                    text = { Text(transferableLabel(s, choice)) },
                    onClick = {
                        onSelected(choice)
                        expanded = false
                    },
                )
            }
        }
    }
}
