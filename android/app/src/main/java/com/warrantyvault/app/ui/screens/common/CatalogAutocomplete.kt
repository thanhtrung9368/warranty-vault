package com.warrantyvault.app.ui.screens.common

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.BrandOption
import com.warrantyvault.app.network.Catalog
import com.warrantyvault.app.network.StoreOption
import com.warrantyvault.app.network.WarrantyProviderOption

/**
 * Loads /api/v1/catalog once per composition tree. Returns null while
 * loading or on failure — callers fall back to plain OutlinedTextField.
 */
@Composable
fun rememberCatalog(api: ApiService): Catalog? {
    var catalog by remember { mutableStateOf<Catalog?>(null) }
    LaunchedEffect(api) {
        runCatching { api.catalog() }.onSuccess { catalog = it }
    }
    return catalog
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BrandAutocompleteField(
    brands: List<BrandOption>,
    categoryCode: String?,
    value: String,
    onValueChange: (String) -> Unit,
    label: String = "Hãng",
    modifier: Modifier = Modifier,
) {
    val filtered = remember(brands, categoryCode, value) {
        brands
            .filter {
                categoryCode == null
                    || it.categoryCodes.isEmpty()
                    || it.categoryCodes.contains(categoryCode)
            }
            .filter { value.isBlank() || it.name.contains(value, ignoreCase = true) }
            .take(8)
    }
    var expanded by remember { mutableStateOf(false) }

    ExposedDropdownMenuBox(
        expanded = expanded && filtered.isNotEmpty(),
        onExpandedChange = { expanded = it },
        modifier = modifier,
    ) {
        OutlinedTextField(
            value = value,
            onValueChange = {
                onValueChange(it)
                expanded = true
            },
            label = { Text(label) },
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StoreAutocompleteField(
    stores: List<StoreOption>,
    value: String,
    onValueChange: (String) -> Unit,
    label: String = "Nơi mua",
    modifier: Modifier = Modifier,
) {
    val filtered = remember(stores, value) {
        stores
            .filter { value.isBlank() || it.name.contains(value, ignoreCase = true) }
            .take(8)
    }
    var expanded by remember { mutableStateOf(false) }

    ExposedDropdownMenuBox(
        expanded = expanded && filtered.isNotEmpty(),
        onExpandedChange = { expanded = it },
        modifier = modifier,
    ) {
        OutlinedTextField(
            value = value,
            onValueChange = {
                onValueChange(it)
                expanded = true
            },
            label = { Text(label) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryEditable),
        )
        if (filtered.isNotEmpty()) {
            ExposedDropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false },
            ) {
                filtered.forEach { s ->
                    DropdownMenuItem(
                        text = { Text(s.name) },
                        onClick = {
                            onValueChange(s.name)
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}

/**
 * Picking a known provider auto-fills phone + address via [onProviderPicked].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WarrantyProviderAutocompleteField(
    providers: List<WarrantyProviderOption>,
    value: String,
    onValueChange: (String) -> Unit,
    onProviderPicked: (WarrantyProviderOption) -> Unit = {},
    label: String = "Đơn vị bảo hành",
    modifier: Modifier = Modifier,
) {
    val filtered = remember(providers, value) {
        providers
            .filter { value.isBlank() || it.name.contains(value, ignoreCase = true) }
            .take(8)
    }
    var expanded by remember { mutableStateOf(false) }

    ExposedDropdownMenuBox(
        expanded = expanded && filtered.isNotEmpty(),
        onExpandedChange = { expanded = it },
        modifier = modifier,
    ) {
        OutlinedTextField(
            value = value,
            onValueChange = {
                onValueChange(it)
                expanded = true
            },
            label = { Text(label) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryEditable),
        )
        if (filtered.isNotEmpty()) {
            ExposedDropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false },
            ) {
                filtered.forEach { p ->
                    DropdownMenuItem(
                        text = { Text(p.name) },
                        onClick = {
                            onValueChange(p.name)
                            onProviderPicked(p)
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}
