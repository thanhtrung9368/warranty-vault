package com.warrantyvault.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp

/**
 * One pill in a [ListFilterBar]'s facet row. `key` is what the screen stores;
 * `label` is the Vietnamese copy shown to the user.
 */
data class FilterOption(val key: String, val label: String)

/**
 * Search field + horizontally scrollable status pills, the mobile translation
 * of the web `*-filter-bar.tsx` components (same idea, same copy — the web
 * renders `pill-group` buttons, we render Material `FilterChip`s).
 *
 * Deliberately dumb: it owns no state, so each screen decides whether the
 * filter runs server-side (devices → `GET /v1/devices` query params) or
 * client-side (subscriptions / wishlist, whose endpoints take no filters).
 */
@Composable
fun ListFilterBar(
    query: String,
    onQueryChange: (String) -> Unit,
    placeholder: String,
    options: List<FilterOption>,
    selectedKey: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    secondaryOptions: List<FilterOption> = emptyList(),
    secondarySelectedKey: String = "",
    onSecondarySelect: (String) -> Unit = {},
    trailing: @Composable (() -> Unit)? = null,
) {
    val cs = MaterialTheme.colorScheme
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SearchField(
            query = query,
            onQueryChange = onQueryChange,
            placeholder = placeholder,
        )
        if (secondaryOptions.isNotEmpty()) {
            FilterChipRow(
                options = secondaryOptions,
                selectedKey = secondarySelectedKey,
                onSelect = onSecondarySelect,
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            FilterChipRow(
                options = options,
                selectedKey = selectedKey,
                onSelect = onSelect,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (trailing != null) {
                androidx.compose.foundation.layout.Spacer(Modifier.size(8.dp))
                trailing()
            }
        }
    }
}

/**
 * The rounded search box every filter bar is built around — one copy of the
 * styling, the leading magnifier and the "Xoá tìm kiếm" clear button. The
 * global search screen (`ui/screens/search/SearchScreen.kt`) reuses it so a
 * query typed there looks exactly like a per-list filter.
 *
 * Stateless on purpose, like [ListFilterBar]: the caller owns the text (and its
 * 300 ms debounce).
 */
@Composable
fun SearchField(
    query: String,
    onQueryChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        placeholder = { Text(placeholder) },
        singleLine = true,
        leadingIcon = { Icon(Icons.Filled.Search, null, Modifier.size(18.dp)) },
        trailingIcon = {
            if (query.isNotEmpty()) {
                IconButton(onClick = { onQueryChange("") }) {
                    Icon(Icons.Filled.Clear, "Xoá tìm kiếm", Modifier.size(18.dp))
                }
            }
        },
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(999.dp),
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
private fun FilterChipRow(
    options: List<FilterOption>,
    selectedKey: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val cs = MaterialTheme.colorScheme
    LazyRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = modifier,
    ) {
        items(options, key = { it.key }) { option ->
            FilterChip(
                selected = option.key == selectedKey,
                onClick = { onSelect(option.key) },
                label = { Text(option.label) },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = cs.primaryContainer,
                    selectedLabelColor = cs.onPrimaryContainer,
                ),
            )
        }
    }
}

/**
 * The "Sắp xếp" dropdown from the web filter bars. Generic so each screen can
 * hand over its own sort enum without a label→value lookup.
 */
@Composable
fun <T> SortMenuButton(
    options: List<T>,
    current: T,
    label: (T) -> String,
    onSelect: (T) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { open = true }) {
            Icon(Icons.Filled.SwapVert, "Sắp xếp", modifier = Modifier.size(16.dp))
            Spacer(Modifier.size(4.dp))
            Text(label(current), style = MaterialTheme.typography.labelLarge)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(label(option)) },
                    onClick = {
                        onSelect(option)
                        open = false
                    },
                )
            }
        }
    }
}
