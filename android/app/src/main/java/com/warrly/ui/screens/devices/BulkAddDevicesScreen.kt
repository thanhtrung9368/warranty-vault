package com.warrly.ui.screens.devices

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.warrly.R
import com.warrly.i18n.AppStrings
import com.warrly.i18n.appStrings
import com.warrly.network.ApiService
import com.warrly.network.CategoryOption
import com.warrly.ui.components.CategoryLabels
import com.warrly.ui.screens.common.rememberCatalog
import com.warrly.ui.viewModelFactory

/**
 * "Thêm nhiều thiết bị" — the bulk add screen.
 *
 * ## The shape chosen, and why
 *
 * **The person who just moved into a flat and is entering five appliances in
 * one sitting**, not a shop keying in a supplier order. That is why the screen
 * is a short stack of small device cards rather than a spreadsheet grid:
 *
 *  * a household is entering a handful of rows, often the same purchase date,
 *    and wants each row to look like the device form they already know;
 *  * the shop-order shape needs per-line brand/model/serial, a shared order
 *    total, and probably a barcode scanner — a different feature with different
 *    copy, and one that would make the household flow feel like accounting
 *    software;
 *  * the row keeps only what makes a saved device useful: **name, category,
 *    purchase date, price**. Brand, model, serial, store, notes, warranty terms,
 *    reminder schedule, currency/FX, resale, return window, activation dates,
 *    receipts and attachments are deliberately left out. Every one of them can
 *    be added later from the existing device detail/edit sheet, and asking for
 *    them here is exactly how a "set up your flat" flow becomes the twelve-form
 *    chore this feature exists to remove. Price is assumed VND for the same
 *    reason: it is the one currency a Vietnamese household receipt is in, and
 *    the edit sheet can change it.
 *
 * ## How partial failure stays actionable
 *
 * The server validates rows one by one and returns `failed[].index` plus that
 * row's own `fieldErrors`. [BulkAddViewModel] reconciles the response against the
 * exact array it sent, removes the devices that were created (they are already
 * saved), and replaces the form with **only the failed rows**. Each failed row
 * keeps its stable row number, shows its own server sentence and its own field
 * errors under the four inputs, and the button turns into "Retry N failed rows".
 * Fixing row 3 and pressing that button sends row 3 — not the whole batch again.
 *
 * ## How the 409 differs
 *
 * A 409 `limit_reached` is **not** a failed row: the whole batch was refused
 * before anything was saved. The red card says "No devices were added", leaves
 * every row untouched, and answers the only useful question — how many new
 * devices the account can still take — from the device list that
 * [BulkAddViewModel.loadQuota] reads (and re-reads after the refusal).
 *
 * The screen does no arithmetic and no HTTP itself: every rule is in
 * `BulkAddRules.kt`, every state transition in `BulkAddViewModel.kt`, and both
 * are JVM-tested without an emulator.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BulkAddDevicesScreen(
    api: ApiService,
    onBack: () -> Unit,
) {
    val vm: BulkAddViewModel = viewModel(factory = viewModelFactory { BulkAddViewModel(api) })
    val state by vm.state.collectAsState()
    val s = appStrings()

    // The category names are the same admin-curated catalog the single-device
    // form uses. Offline, the shared Vietnamese label table is the fallback;
    // every other word on this screen still follows the UI language.
    val catalog = rememberCatalog(api)
    val categories = remember(catalog) {
        catalog?.categories?.takeIf { it.isNotEmpty() }
            ?: CategoryLabels.table.map { CategoryOption(it.key, it.value) }
    }

    // Slots are only needed for the 409 explanation, but reading them when the
    // screen opens means the number is already there when the refusal lands.
    LaunchedEffect(Unit) { vm.loadQuota() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        stringResource(R.string.bulk_title),
                        fontWeight = FontWeight.SemiBold,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            stringResource(R.string.action_back),
                        )
                    }
                },
            )
        },
        bottomBar = {
            BulkSubmitBar(state = state, onSubmit = vm::submit)
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item(key = "intro") { BulkIntroCard() }

            // Latest event first: a refused batch is the thing the user must
            // deal with; a success from an earlier retry is context below it.
            state.limitReached?.let { notice ->
                item(key = "limit-reached") {
                    LimitReachedCard(notice = notice, onDismiss = vm::dismissLimitReached)
                }
            }
            state.error?.let { failure ->
                item(key = "request-error") {
                    RequestErrorCard(
                        s = s,
                        failure = failure,
                        onDismiss = vm::dismissError,
                    )
                }
            }
            if (state.lastCreated != null) {
                item(key = "submit-result") {
                    SubmitResultCard(state = state, onDone = onBack)
                }
            }
            if (state.unaccountedCount > 0) {
                item(key = "unaccounted") {
                    UnaccountedWarningCard(count = state.unaccountedCount)
                }
            }

            items(state.rows, key = { row -> row.key }) { row ->
                BulkRowCard(
                    row = row,
                    categories = categories,
                    canRemove = state.rows.size > 1,
                    onChange = { field, value -> vm.editRow(row.key, field, value) },
                    onRemove = { vm.removeRow(row.key) },
                )
            }

            item(key = "row-actions") {
                RowActions(
                    rowCount = state.rows.size,
                    canAdd = canAddBulkRow(state.rows),
                    onAdd = vm::addRow,
                )
            }
        }
    }
}

@Composable
private fun BulkIntroCard() {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(
            Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                stringResource(R.string.bulk_intro),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                stringResource(R.string.bulk_fields_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun RowActions(
    rowCount: Int,
    canAdd: Boolean,
    onAdd: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            stringResource(R.string.bulk_row_count, rowCount, MAX_BULK_DEVICES),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        TextButton(onClick = onAdd, enabled = canAdd) {
            Icon(Icons.Filled.Add, contentDescription = null)
            Spacer(Modifier.width(4.dp))
            Text(stringResource(R.string.bulk_add_row))
        }
    }
}

@Composable
private fun BulkRowCard(
    row: BulkDeviceDraft,
    categories: List<CategoryOption>,
    canRemove: Boolean,
    onChange: (BulkDeviceField, String) -> Unit,
    onRemove: () -> Unit,
) {
    val nameErrors = row.fieldErrorsFor(BulkDeviceField.NAME)
    val categoryErrors = row.fieldErrorsFor(BulkDeviceField.CATEGORY)
    val dateErrors = row.fieldErrorsFor(BulkDeviceField.PURCHASE_DATE)
    val priceErrors = row.fieldErrorsFor(BulkDeviceField.PRICE)
    val otherErrors = row.otherFieldErrors()

    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(
            Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    stringResource(R.string.bulk_row_label, row.key),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = onRemove, enabled = canRemove) {
                    Icon(
                        Icons.Outlined.DeleteOutline,
                        stringResource(R.string.bulk_remove_row),
                    )
                }
            }

            // The server's row sentence is shown once, at the top of the row it
            // belongs to. The field-level messages below are the specifics; the
            // row-level one is what remains for a failure with no field key.
            row.message?.takeIf { it.isNotBlank() }?.let { message ->
                Text(
                    message,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            if (otherErrors.isNotEmpty()) {
                Text(
                    otherErrors.joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }

            OutlinedTextField(
                value = row.name,
                onValueChange = { onChange(BulkDeviceField.NAME, it) },
                label = { Text(stringResource(R.string.bulk_name_label)) },
                isError = nameErrors.isNotEmpty(),
                supportingText = nameErrors.takeIf { it.isNotEmpty() }?.let { errors ->
                    {
                        Column {
                            errors.forEach { message ->
                                Text(message, color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            )

            BulkCategoryField(
                selected = row.category,
                options = categories,
                errors = categoryErrors,
                onSelected = { onChange(BulkDeviceField.CATEGORY, it) },
            )

            OutlinedTextField(
                value = row.purchaseDate,
                onValueChange = { onChange(BulkDeviceField.PURCHASE_DATE, it) },
                label = { Text(stringResource(R.string.bulk_date_label)) },
                isError = dateErrors.isNotEmpty(),
                supportingText = dateErrors.takeIf { it.isNotEmpty() }?.let { errors ->
                    {
                        Column {
                            errors.forEach { message ->
                                Text(message, color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            )

            OutlinedTextField(
                value = row.purchasePrice,
                onValueChange = { onChange(BulkDeviceField.PRICE, it) },
                label = { Text(stringResource(R.string.bulk_price_label)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                isError = priceErrors.isNotEmpty(),
                supportingText = if (priceErrors.isEmpty()) {
                    { Text(stringResource(R.string.bulk_price_hint)) }
                } else {
                    {
                        Column {
                            priceErrors.forEach { message ->
                                Text(message, color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BulkCategoryField(
    selected: String,
    options: List<CategoryOption>,
    errors: List<String>,
    onSelected: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val selectedLabel = options.firstOrNull { it.code == selected }?.name ?: selected

    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
    ) {
        OutlinedTextField(
            value = selectedLabel,
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.bulk_category_label)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            isError = errors.isNotEmpty(),
            supportingText = errors.takeIf { it.isNotEmpty() }?.let { messages ->
                {
                    Column {
                        messages.forEach { message ->
                            Text(message, color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option.name) },
                    onClick = {
                        onSelected(option.code)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun SubmitResultCard(
    state: BulkAddViewModel.State,
    onDone: () -> Unit,
) {
    val created = state.lastCreated ?: return
    val fullyCreated = state.lastFailed == 0 && state.unaccountedCount == 0

    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (fullyCreated) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.secondaryContainer
            },
        ),
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(
            Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (fullyCreated) {
                Text(
                    pluralStringResource(
                        R.plurals.bulk_success_all,
                        state.addedCount,
                        state.addedCount,
                    ),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    stringResource(R.string.bulk_success_all_body),
                    style = MaterialTheme.typography.bodyMedium,
                )
                TextButton(onClick = onDone) {
                    Text(stringResource(R.string.bulk_done))
                }
            } else {
                Text(
                    pluralStringResource(
                        R.plurals.bulk_partial_title,
                        state.lastBatchSize,
                        created,
                        state.lastBatchSize,
                    ),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                // The rows that succeeded are persisted; say so plainly even
                // while the failed rows are still on screen being fixed.
                if (created > 0) {
                    Text(
                        stringResource(R.string.bulk_success_all_body),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                if (state.lastFailed > 0) {
                    Text(
                        pluralStringResource(
                            R.plurals.bulk_failed_fix_hint,
                            state.lastFailed,
                            state.lastFailed,
                        ),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}

@Composable
private fun UnaccountedWarningCard(count: Int) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer,
        ),
        shape = RoundedCornerShape(20.dp),
    ) {
        Text(
            pluralStringResource(
                R.plurals.bulk_unaccounted_warning,
                count,
                count,
            ),
            modifier = Modifier.padding(16.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onErrorContainer,
        )
    }
}

@Composable
private fun LimitReachedCard(
    notice: BulkAddViewModel.LimitReached,
    onDismiss: () -> Unit,
) {
    val s = appStrings()
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer,
        ),
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(
            Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                stringResource(R.string.bulk_limit_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
            Text(
                stringResource(R.string.bulk_limit_body),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
            // The number is computed from the account's own device list; the
            // pure function falls back to "limit hit" when that list could not
            // be read, rather than inventing a slot count.
            Text(
                bulkLimitRemainingMessage(s, notice.slots),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
            Text(
                stringResource(R.string.bulk_limit_hint),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.bulk_dismiss))
            }
        }
    }
}

@Composable
private fun RequestErrorCard(
    s: AppStrings,
    failure: BulkRequestFailure,
    onDismiss: () -> Unit,
) {
    // Same fallback ladder as `Throwable.toUserMessage(json, context)`: the
    // server's translated sentence wins; then the HTTP status; then the
    // localized network sentence for a failure that never reached the API.
    val message = failure.serverMessage
        ?: failure.status?.let { status -> s.get(R.string.error_server_code, status) }
        ?: s.get(R.string.error_network)

    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer,
        ),
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(
            Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                stringResource(R.string.bulk_error_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
            // The over-50 400 carries `fieldErrors.devices`. The screen stops
            // the user at 50 rows, so this normally cannot happen from Android,
            // but a future contract change must still be readable instead of
            // appearing as a bare "Server error (400)".
            failure.deviceFieldErrors.forEach { detail ->
                Text(
                    detail,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                )
            }
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.bulk_dismiss))
            }
        }
    }
}

@Composable
private fun BulkSubmitBar(
    state: BulkAddViewModel.State,
    onSubmit: () -> Unit,
) {
    val toSend = bulkDraftsToSubmit(state.rows)
    // A true retry means every row that would be sent is a row the server has
    // already refused. If the user filled a brand-new row too, the button says
    // "Add N devices" because that is also what it will do.
    val retryingOnlyFailed =
        toSend.isNotEmpty() && toSend.all { row -> row.requestIndex != null }
    val label = when {
        toSend.isEmpty() -> stringResource(R.string.bulk_submit_empty)
        retryingOnlyFailed -> pluralStringResource(
            R.plurals.bulk_retry_count,
            toSend.size,
            toSend.size,
        )
        else -> pluralStringResource(
            R.plurals.bulk_submit_count,
            toSend.size,
            toSend.size,
        )
    }

    Surface(
        color = MaterialTheme.colorScheme.background,
        tonalElevation = 3.dp,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
        ) {
            Button(
                onClick = onSubmit,
                enabled = toSend.isNotEmpty() && !state.submitting,
                shape = RoundedCornerShape(28.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
            ) {
                if (state.submitting) {
                    CircularProgressIndicator(
                        strokeWidth = 2.dp,
                        modifier = Modifier.height(20.dp).width(20.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                } else {
                    Text(label, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}
