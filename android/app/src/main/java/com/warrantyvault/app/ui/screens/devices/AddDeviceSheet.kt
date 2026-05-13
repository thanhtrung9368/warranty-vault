package com.warrantyvault.app.ui.screens.devices

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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import com.warrantyvault.app.network.BrandOption
import com.warrantyvault.app.network.CategoryOption
import com.warrantyvault.app.network.Device
import com.warrantyvault.app.network.DeviceInput
import com.warrantyvault.app.network.DeviceStatus
import com.warrantyvault.app.network.StoreOption
import com.warrantyvault.app.network.toUserMessage
import com.warrantyvault.app.ui.components.SheetGroup
import com.warrantyvault.app.ui.screens.common.StoreAutocompleteField
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddDeviceSheet(
    api: ApiService,
    onDismiss: () -> Unit,
    onCreated: (Device) -> Unit,
    existing: Device? = null,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val isEdit = existing != null

    var name by remember { mutableStateOf(existing?.name ?: "") }
    var brand by remember { mutableStateOf(existing?.brand ?: "") }
    var model by remember { mutableStateOf(existing?.model ?: "") }
    var price by remember {
        mutableStateOf((existing?.purchasePrice ?: 0).takeIf { it > 0 }?.toString() ?: "")
    }
    var months by remember {
        mutableStateOf(if (isEdit) "" else "12")
    }
    var notes by remember { mutableStateOf(existing?.notes ?: "") }
    var category by remember { mutableStateOf(existing?.category ?: "PHONE") }
    var status by remember { mutableStateOf(existing?.status ?: DeviceStatus.ACTIVE) }
    var purchaseDate by remember {
        mutableStateOf(existing?.purchaseDate?.take(10) ?: today())
    }
    var serial by remember { mutableStateOf(existing?.serialNumber ?: "") }
    var purchasePlace by remember { mutableStateOf(existing?.purchasePlace ?: "") }

    var categoryOptions by remember { mutableStateOf<List<CategoryOption>>(emptyList()) }
    var brandOptions by remember { mutableStateOf<List<BrandOption>>(emptyList()) }
    var storeOptions by remember { mutableStateOf<List<StoreOption>>(emptyList()) }

    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        runCatching { api.catalog() }
            .onSuccess {
                categoryOptions = it.categories
                brandOptions = it.brands
                storeOptions = it.stores
            }
            .onFailure {
                categoryOptions = listOf(
                    CategoryOption("PHONE", "Điện thoại"),
                    CategoryOption("LAPTOP", "Laptop"),
                    CategoryOption("TABLET", "Máy tính bảng"),
                    CategoryOption("OTHER", "Khác"),
                )
            }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                if (isEdit) "Sửa thiết bị" else "Thêm thiết bị",
                fontSize = 18.sp, fontWeight = FontWeight.SemiBold,
            )

            SheetGroup {
                OutlinedTextField(
                    value = name, onValueChange = { name = it },
                    label = { Text("Tên thiết bị *") },
                    modifier = Modifier.fillMaxWidth(),
                )
                CategoryDropdown(
                    options = categoryOptions,
                    selected = category,
                    onSelected = { category = it },
                )
                BrandAutocomplete(
                    category = category,
                    brands = brandOptions,
                    value = brand,
                    onValueChange = { brand = it },
                )
                OutlinedTextField(
                    value = model, onValueChange = { model = it },
                    label = { Text("Model") },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = serial, onValueChange = { serial = it },
                    label = { Text("Số serial") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            SheetGroup {
                OutlinedTextField(
                    value = price, onValueChange = { price = it.filter { c -> c.isDigit() } },
                    label = { Text("Giá (VND)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = purchaseDate, onValueChange = { purchaseDate = it },
                    label = { Text("Ngày mua (YYYY-MM-DD) *") },
                    modifier = Modifier.fillMaxWidth(),
                )
                StoreAutocompleteField(
                    stores = storeOptions,
                    value = purchasePlace,
                    onValueChange = { purchasePlace = it },
                )
                // Warranty fields are only relevant when creating — edit mode keeps
                // existing warranty rows untouched and exposes them on the detail
                // screen.
                if (!isEdit) {
                    OutlinedTextField(
                        value = months,
                        onValueChange = { months = it.filter { c -> c.isDigit() } },
                        label = { Text("Số tháng bảo hành") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            SheetGroup {
                if (isEdit) {
                    StatusDropdown(selected = status, onSelected = { status = it })
                }
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
                    Spacer(Modifier.width(4.dp))
                    Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                }
            }

            Button(
                onClick = {
                    scope.launch {
                        submitting = true; error = null
                        val input = DeviceInput(
                            name = name.trim(),
                            category = category,
                            brand = brand.ifBlank { null },
                            model = model.ifBlank { null },
                            serialNumber = serial.ifBlank { null },
                            purchaseDate = purchaseDate,
                            purchasePrice = price.toIntOrNull() ?: 0,
                            purchasePlace = purchasePlace.ifBlank { null },
                            status = status,
                            warrantyMonths = if (isEdit) 0 else (months.toIntOrNull() ?: 0),
                            notes = notes.ifBlank { null },
                        )
                        try {
                            val res = if (existing != null) {
                                api.updateDevice(existing.id, input)
                            } else {
                                api.createDevice(input)
                            }
                            onCreated(res.device)
                        } catch (e: Exception) {
                            error = e.toUserMessage(ApiClient.json)
                        } finally {
                            submitting = false
                        }
                    }
                },
                enabled = name.isNotBlank() && purchaseDate.isNotBlank() && !submitting,
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
                        if (isEdit) "Cập nhật" else "Lưu",
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }

            Spacer(Modifier.height(20.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CategoryDropdown(
    options: List<CategoryOption>,
    selected: String,
    onSelected: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val selectedLabel = options.firstOrNull { it.code == selected }?.name ?: selected

    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
    ) {
        TextField(
            value = selectedLabel,
            onValueChange = {},
            readOnly = true,
            label = { Text("Loại") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            options.forEach { opt ->
                DropdownMenuItem(
                    text = { Text(opt.name) },
                    onClick = {
                        onSelected(opt.code)
                        expanded = false
                    },
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StatusDropdown(
    selected: DeviceStatus,
    onSelected: (DeviceStatus) -> Unit,
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
            label = { Text("Trạng thái") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            DeviceStatus.entries.forEach { s ->
                DropdownMenuItem(
                    text = { Text(s.label) },
                    onClick = { onSelected(s); expanded = false },
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BrandAutocomplete(
    category: String,
    brands: List<BrandOption>,
    value: String,
    onValueChange: (String) -> Unit,
) {
    val filtered = remember(category, brands, value) {
        brands
            .filter { it.categoryCodes.isEmpty() || it.categoryCodes.contains(category) }
            .filter {
                value.isBlank() || it.name.contains(value, ignoreCase = true)
            }
            .take(8)
    }
    var expanded by remember { mutableStateOf(false) }

    ExposedDropdownMenuBox(
        expanded = expanded && filtered.isNotEmpty(),
        onExpandedChange = { expanded = it },
    ) {
        OutlinedTextField(
            value = value,
            onValueChange = {
                onValueChange(it)
                expanded = true
            },
            label = { Text("Hãng") },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryEditable),
        )
        if (filtered.isNotEmpty()) {
            ExposedDropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false },
            ) {
                filtered.forEach { b ->
                    DropdownMenuItem(
                        text = { Text(b.name) },
                        onClick = {
                            onValueChange(b.name)
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}

private fun today(): String =
    SimpleDateFormat("yyyy-MM-dd", Locale.US)
        .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
        .format(Date())
