package com.warrantyvault.app.ui.screens.devices

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.Warranty
import com.warrantyvault.app.network.WarrantyInput
import com.warrantyvault.app.network.WarrantyProviderOption
import com.warrantyvault.app.network.WarrantyType
import com.warrantyvault.app.network.toUserMessage
import com.warrantyvault.app.ui.components.SheetGroup
import com.warrantyvault.app.ui.screens.common.WarrantyProviderAutocompleteField
import com.warrantyvault.app.ui.screens.common.rememberCatalog
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WarrantyEditSheet(
    api: ApiService,
    deviceId: String,
    existing: Warranty?,
    onDismiss: () -> Unit,
    onSaved: () -> Unit,
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

    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val catalog = rememberCatalog(api)
    val providerOptions: List<WarrantyProviderOption> = catalog?.warrantyProviders ?: emptyList()

    val title = if (existing == null) "Thêm gói bảo hành" else "Sửa gói bảo hành"

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
                    label = { Text("Ngày bắt đầu (YYYY-MM-DD) *") },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = months,
                    onValueChange = { months = it.filter { c -> c.isDigit() } },
                    label = { Text("Số tháng *") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = cost,
                    onValueChange = { cost = it.filter { c -> c.isDigit() } },
                    label = { Text("Chi phí (VND)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            SheetGroup {
                OutlinedTextField(
                    value = phone, onValueChange = { phone = it },
                    label = { Text("Điện thoại liên hệ") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = address, onValueChange = { address = it },
                    label = { Text("Địa chỉ") },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = notes, onValueChange = { notes = it },
                    label = { Text("Ghi chú") },
                    modifier = Modifier.fillMaxWidth(),
                )
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
            val canSubmit = !submitting && startDate.isNotBlank() && monthsInt >= 1

            Button(
                onClick = {
                    scope.launch {
                        submitting = true; error = null
                        val input = WarrantyInput(
                            type = type,
                            provider = provider.ifBlank { null },
                            startDate = startDate.trim(),
                            months = monthsInt,
                            cost = cost.toIntOrNull(),
                            address = address.ifBlank { null },
                            phone = phone.ifBlank { null },
                            notes = notes.ifBlank { null },
                        )
                        try {
                            if (existing == null) {
                                api.createWarranty(deviceId, input)
                            } else {
                                api.updateWarranty(existing.id, input)
                            }
                            onSaved()
                        } catch (e: Exception) {
                            error = e.toUserMessage(ApiClient.json)
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
                    Text("Lưu", fontWeight = FontWeight.SemiBold)
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
            value = selected.label,
            onValueChange = {},
            readOnly = true,
            label = { Text("Loại bảo hành") },
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
                    text = { Text(t.label) },
                    onClick = {
                        onSelected(t)
                        expanded = false
                    },
                )
            }
        }
    }
}
