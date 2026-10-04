package com.warrantyvault.app.ui.screens.subscriptions

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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warrantyvault.app.R
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.BillingCycle
import com.warrantyvault.app.network.Subscription
import com.warrantyvault.app.network.SubscriptionInput
import com.warrantyvault.app.network.SubscriptionStatus
import com.warrantyvault.app.network.toUserMessage
import com.warrantyvault.app.ui.components.SheetGroup
import com.warrantyvault.app.ui.screens.common.BrandAutocompleteField
import com.warrantyvault.app.ui.screens.common.rememberCatalog
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SubscriptionEditSheet(
    api: ApiService,
    existing: Subscription?,
    onDismiss: () -> Unit,
    onSaved: (Subscription) -> Unit,
    onDeleted: (String) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val isEdit = existing != null

    val today = remember {
        SimpleDateFormat("yyyy-MM-dd", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .format(Date())
    }

    var name by remember { mutableStateOf(existing?.name ?: "") }
    var brand by remember { mutableStateOf(existing?.brand ?: "") }
    var plan by remember { mutableStateOf(existing?.plan ?: "") }
    var category by remember { mutableStateOf(existing?.category ?: "") }
    var price by remember { mutableStateOf((existing?.price ?: 0).takeIf { it > 0 }?.toString() ?: "") }
    var cycle by remember { mutableStateOf(existing?.billingCycle ?: BillingCycle.MONTHLY) }
    var intervalDays by remember {
        mutableStateOf(existing?.intervalDays?.toString() ?: "")
    }
    var startedAt by remember { mutableStateOf(existing?.startedAt?.take(10) ?: today) }
    var renewalDate by remember { mutableStateOf(existing?.renewalDate?.take(10) ?: "") }
    var autoRenew by remember { mutableStateOf(existing?.autoRenew ?: true) }
    var status by remember { mutableStateOf(existing?.status ?: SubscriptionStatus.ACTIVE) }
    var accountEmail by remember { mutableStateOf(existing?.accountEmail ?: "") }
    var paymentMethod by remember { mutableStateOf(existing?.paymentMethod ?: "") }
    var manageUrl by remember { mutableStateOf(existing?.manageUrl ?: "") }
    var cancelUrl by remember { mutableStateOf(existing?.cancelUrl ?: "") }
    var notes by remember { mutableStateOf(existing?.notes ?: "") }

    var submitting by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val catalog = rememberCatalog(api)
    val brandOptions = catalog?.brands ?: emptyList()

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                if (isEdit) stringResource(R.string.subs_edit_plan) else stringResource(R.string.subs_add_plan),
                fontSize = 18.sp, fontWeight = FontWeight.SemiBold,
            )

            SheetGroup {
                OutlinedTextField(
                    value = name, onValueChange = { name = it },
                    label = { Text(stringResource(R.string.subs_plan_name)) },
                    modifier = Modifier.fillMaxWidth(),
                )
                BrandAutocompleteField(
                    brands = brandOptions,
                    categoryCode = null,
                    value = brand,
                    onValueChange = { brand = it },
                    label = stringResource(R.string.subs_brand_provider),
                )
                OutlinedTextField(
                    value = plan, onValueChange = { plan = it },
                    label = { Text(stringResource(R.string.subs_plan)) },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = category, onValueChange = { category = it },
                    label = { Text(stringResource(R.string.subs_category_optional)) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            SheetGroup {
                BillingCycleDropdown(selected = cycle, onSelected = { cycle = it })
                if (cycle == BillingCycle.CUSTOM) {
                    OutlinedTextField(
                        value = intervalDays,
                        onValueChange = { intervalDays = it.filter { c -> c.isDigit() } },
                        label = { Text(stringResource(R.string.subs_cycle_length_days)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                OutlinedTextField(
                    value = price, onValueChange = { price = it.filter { c -> c.isDigit() } },
                    label = { Text(stringResource(R.string.devadd_price_vnd)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = startedAt, onValueChange = { startedAt = it },
                    label = { Text(stringResource(R.string.subs_start_date_yyyy_mm_dd)) },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = renewalDate, onValueChange = { renewalDate = it },
                    label = { Text(stringResource(R.string.subs_next_renewal_date_yyyy_mm_dd)) },
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.subs_auto_renew), modifier = Modifier.weight(1f))
                    Switch(checked = autoRenew, onCheckedChange = { autoRenew = it })
                }
                StatusDropdown(selected = status, onSelected = { status = it })
            }

            SheetGroup {
                OutlinedTextField(
                    value = accountEmail, onValueChange = { accountEmail = it },
                    label = { Text(stringResource(R.string.subs_account_email)) },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = paymentMethod, onValueChange = { paymentMethod = it },
                    label = { Text(stringResource(R.string.subs_payment_method)) },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = manageUrl, onValueChange = { manageUrl = it },
                    label = { Text(stringResource(R.string.subs_manage_url)) },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = cancelUrl, onValueChange = { cancelUrl = it },
                    label = { Text(stringResource(R.string.subs_cancel_url)) },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = notes, onValueChange = { notes = it },
                    label = { Text(stringResource(R.string.devadd_note)) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            error?.let {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.WarningAmber, null,
                        tint = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.width(4.dp))
                    Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                }
            }

            Button(
                onClick = {
                    scope.launch {
                        submitting = true; error = null
                        val input = SubscriptionInput(
                            name = name.trim(),
                            category = category.ifBlank { null },
                            brand = brand.ifBlank { null },
                            plan = plan.ifBlank { null },
                            billingCycle = cycle,
                            intervalDays = if (cycle == BillingCycle.CUSTOM) {
                                intervalDays.toIntOrNull()
                            } else null,
                            price = price.toIntOrNull() ?: 0,
                            startedAt = startedAt,
                            renewalDate = renewalDate.ifBlank { null },
                            autoRenew = autoRenew,
                            status = status,
                            accountEmail = accountEmail.ifBlank { null },
                            paymentMethod = paymentMethod.ifBlank { null },
                            manageUrl = manageUrl.ifBlank { null },
                            cancelUrl = cancelUrl.ifBlank { null },
                            notes = notes.ifBlank { null },
                        )
                        try {
                            val res = if (existing != null) {
                                api.updateSubscription(existing.id, input)
                            } else {
                                api.createSubscription(input)
                            }
                            onSaved(res.subscription)
                        } catch (e: Exception) {
                            error = e.toUserMessage(ApiClient.json)
                        } finally {
                            submitting = false
                        }
                    }
                },
                enabled = name.isNotBlank() && startedAt.isNotBlank() && !submitting,
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
                    Text(
                        if (isEdit) stringResource(R.string.devadd_update) else stringResource(R.string.action_save),
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }

            if (isEdit && existing != null) {
                OutlinedButton(
                    onClick = {
                        scope.launch {
                            deleting = true; error = null
                            try {
                                api.deleteSubscription(existing.id)
                                onDeleted(existing.id)
                            } catch (e: Exception) {
                                error = e.toUserMessage(ApiClient.json)
                            } finally {
                                deleting = false
                            }
                        }
                    },
                    enabled = !deleting && !submitting,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        if (deleting) stringResource(R.string.subs_deleting) else stringResource(R.string.subs_delete_plan),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }

            Spacer(Modifier.height(20.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BillingCycleDropdown(
    selected: BillingCycle,
    onSelected: (BillingCycle) -> Unit,
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
            label = { Text(stringResource(R.string.subs_billing_cycle)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            BillingCycle.entries.forEach { c ->
                DropdownMenuItem(
                    text = { Text(stringResource(c.labelRes)) },
                    onClick = { onSelected(c); expanded = false },
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StatusDropdown(
    selected: SubscriptionStatus,
    onSelected: (SubscriptionStatus) -> Unit,
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
            label = { Text(stringResource(R.string.devadd_status)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            SubscriptionStatus.entries.forEach { s ->
                DropdownMenuItem(
                    text = { Text(stringResource(s.labelRes)) },
                    onClick = { onSelected(s); expanded = false },
                )
            }
        }
    }
}
