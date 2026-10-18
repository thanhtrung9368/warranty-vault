package com.warrly.ui.screens.reminders

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.warrly.R
import com.warrly.i18n.AppStrings
import com.warrly.i18n.appStrings
import com.warrly.network.ApiClient
import com.warrly.network.ApiService
import com.warrly.network.DeviceStatus
import com.warrly.network.UpcomingReminder
import com.warrly.network.WarrantyType
import com.warrly.network.toUserMessage
import com.warrly.ui.components.CategoryLabels
import com.warrly.ui.components.EmptyState
import com.warrly.ui.components.ErrorState
import com.warrly.ui.components.PageHeader
import com.warrly.ui.components.PillKind
import com.warrly.ui.components.SkeletonList
import com.warrly.ui.components.StatusPill
import com.warrly.ui.components.pressScale
import java.time.LocalDate
import java.time.format.DateTimeParseException
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The widest horizon the reminders endpoint accepts (`withinDays` max 365),
 * used for the "Đã ẩn" read.
 *
 * The server ignores `withinDays` for dismissed rows, so this is not a filter —
 * it is simply the widest window available, and keeping a hidden reminder from
 * falling out of the response for a reason the user cannot see. Mirrors
 * `RemindersStore.dismissedWindowDays` on iOS.
 */
internal const val DISMISSED_WINDOW_DAYS = 365

class RemindersViewModel(private val api: ApiService) : ViewModel() {
    sealed interface State {
        data object Loading : State

        /**
         * [items] is the default upcoming feed. [dismissed] is the "Đã ẩn"
         * rollup from the same endpoint asked with `includeDismissed=true`.
         *
         * The two reads are independent on purpose: a hidden-rows failure must
         * not hide the active reminders the user can still see. In that case
         * [dismissedUnavailable] is true and the section says so instead of
         * rendering an empty list (which would read as "nothing is hidden").
         */
        data class Loaded(
            val items: List<UpcomingReminder>,
            val dismissed: List<DismissedReminder> = emptyList(),
            val dismissedUnavailable: Boolean = false,
        ) : State

        data class Error(val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _state.value = State.Loading
            try {
                // Two independent reads, run together, exactly like web/iOS:
                // the plain feed stays the source of the upcoming list (its
                // request is unchanged — no `includeDismissed` parameter), and
                // a second call asks the server to add the hidden rows.
                val upcoming = async { api.listUpcomingReminders() }
                val widened = async {
                    runCatching {
                        api.listUpcomingReminders(
                            withinDays = DISMISSED_WINDOW_DAYS,
                            includeDismissed = true,
                        )
                    }
                }

                val items = upcoming.await().reminders
                // A hidden-rows failure degrades to a flagged section, never to
                // a blank screen: the active reminders already arrived.
                val hidden = widened.await()
                _state.value = State.Loaded(
                    items = items,
                    dismissed = hidden.getOrNull()
                        ?.let { dismissedReminders(it.reminders) }
                        .orEmpty(),
                    dismissedUnavailable = hidden.isFailure,
                )
            } catch (e: Exception) {
                _state.value = State.Error(e.toUserMessage(ApiClient.json))
            }
        }
    }

    fun dismiss(warrantyId: String, onError: (String) -> Unit, onSuccess: () -> Unit) {
        viewModelScope.launch {
            try {
                api.dismissWarrantyReminder(warrantyId)
                load()
                onSuccess()
            } catch (e: Exception) {
                onError(e.toUserMessage(ApiClient.json))
            }
        }
    }

    /**
     * Un-dismisses a reminder — the "Hoàn tác" undo *and* the explicit "Khôi
     * phục" button in the "Đã ẩn" list — then reloads both feeds so the row
     * moves back to wherever it belongs.
     */
    fun restore(
        warrantyId: String,
        onError: (String) -> Unit,
        onSuccess: () -> Unit = {},
    ) {
        viewModelScope.launch {
            try {
                api.restoreWarrantyReminder(warrantyId)
                load()
                onSuccess()
            } catch (e: Exception) {
                onError(e.toUserMessage(ApiClient.json))
            }
        }
    }
}

private fun parseIsoDate(raw: String): LocalDate? {
    val ten = raw.take(10)
    return try {
        LocalDate.parse(ten)
    } catch (_: DateTimeParseException) {
        null
    }
}

private fun daysLeftFromIso(raw: String): Long? {
    val end = parseIsoDate(raw) ?: return null
    return java.time.temporal.ChronoUnit.DAYS.between(LocalDate.now(), end)
}

private fun warrantyTypeLabel(s: AppStrings, raw: String): String =
    WarrantyType.entries.firstOrNull { it.name == raw }?.let { s.get(it.labelRes) } ?: raw

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemindersScreen(
    api: ApiService,
    onOpenDevice: (String) -> Unit = {},
) {
    val vm = remember { RemindersViewModel(api) }
    val state by vm.state.collectAsState()
    var refreshing by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    // Hoisted out of the coroutine below: `scope.launch { }` is not a
    // composable scope, so stringResource() cannot be called inside it.
    val hiddenMessage = stringResource(R.string.rem_reminder_hidden)
    val restoredMessage = stringResource(R.string.rem_reminder_restored)
    val undoLabel = stringResource(R.string.action_undo)

    fun onDismiss(warrantyId: String) {
        vm.dismiss(
            warrantyId,
            onError = { actionError = it },
            onSuccess = {
                scope.launch {
                    val res = snackbarHostState.showSnackbar(
                        message = hiddenMessage,
                        actionLabel = undoLabel,
                    )
                    if (res == SnackbarResult.ActionPerformed) {
                        vm.restore(warrantyId, onError = { actionError = it })
                    }
                }
            },
        )
    }

    fun onRestore(warrantyId: String) {
        actionError = null
        vm.restore(
            warrantyId,
            onError = { actionError = it },
            onSuccess = {
                scope.launch { snackbarHostState.showSnackbar(restoredMessage) }
            },
        )
    }

    LaunchedEffect(Unit) { vm.load() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    vm.load()
                    refreshing = false
                }
            },
            modifier = Modifier.padding(padding).fillMaxSize(),
        ) {
            Crossfade(
                targetState = state,
                animationSpec = tween(220),
                label = "reminders-state",
            ) { s ->
                when (s) {
                    is RemindersViewModel.State.Loading -> Column {
                        PageHeader(stringResource(R.string.dash_warranty_expiring_soon), stringResource(R.string.state_loading))
                        SkeletonList(count = 3)
                    }
                    is RemindersViewModel.State.Error -> ErrorState(
                        icon = Icons.Outlined.WarningAmber,
                        title = stringResource(R.string.dash_could_not_load_it),
                        body = s.message,
                        onRetry = { vm.load() },
                    )
                    is RemindersViewModel.State.Loaded -> {
                        Column {
                            actionError?.let {
                                Card(
                                    colors = CardDefaults.cardColors(
                                        containerColor = MaterialTheme.colorScheme.errorContainer,
                                    ),
                                    shape = RoundedCornerShape(16.dp),
                                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                                ) {
                                    Row(
                                        Modifier.padding(12.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Icon(Icons.Outlined.WarningAmber, null,
                                            tint = MaterialTheme.colorScheme.onErrorContainer)
                                        Spacer(Modifier.width(8.dp))
                                        Text(
                                            it,
                                            color = MaterialTheme.colorScheme.onErrorContainer,
                                            style = MaterialTheme.typography.bodySmall,
                                            modifier = Modifier.weight(1f),
                                        )
                                        TextButton(onClick = { actionError = null }) {
                                            Text(stringResource(R.string.action_close))
                                        }
                                    }
                                }
                            }
                            LazyColumn(
                                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 0.dp, bottom = 24.dp),
                                verticalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                item {
                                    PageHeader(
                                        stringResource(R.string.dash_warranty_expiring_soon),
                                        if (s.items.isEmpty()) {
                                            stringResource(R.string.rem_we_will_ping_you_when_it)
                                        } else {
                                            pluralStringResource(
                                                R.plurals.rem_items_to_look_at,
                                                s.items.size,
                                                s.items.size,
                                            )
                                        },
                                    )
                                }

                                if (s.items.isEmpty()) {
                                    item {
                                        EmptyState(
                                            icon = Icons.Filled.NotificationsActive,
                                            title = stringResource(R.string.rem_relax_nothing_is_expiring_yet),
                                            body = stringResource(R.string.rem_all_of_your_devices_are_safely),
                                            tone = MaterialTheme.colorScheme.primary,
                                        )
                                    }
                                } else {
                                    items(s.items, key = { it.id }) { r ->
                                        ReminderCard(
                                            reminder = r,
                                            onOpenDevice = { onOpenDevice(r.deviceId) },
                                            onDismiss = { onDismiss(r.id) },
                                        )
                                    }
                                }

                                // "Đã ẩn" is always rendered — even when empty or
                                // when the hidden read failed — so the way to
                                // restore a row is never a state the user has to
                                // discover by accident. Its count is the number
                                // of hidden rows, not the upcoming list's size.
                                item(key = "dismissed-header") {
                                    HiddenSectionHeader(
                                        count = if (s.dismissedUnavailable) null else s.dismissed.size,
                                    )
                                }
                                if (s.dismissedUnavailable) {
                                    item(key = "dismissed-unavailable") {
                                        HiddenMessageCard(stringResource(R.string.rem_hidden_unavailable))
                                    }
                                } else if (s.dismissed.isEmpty()) {
                                    item(key = "dismissed-empty") {
                                        HiddenMessageCard(stringResource(R.string.rem_hidden_empty))
                                    }
                                } else {
                                    items(s.dismissed, key = { "dismissed-${it.warrantyId}" }) { d ->
                                        DismissedReminderCard(
                                            reminder = d,
                                            onOpenDevice = { onOpenDevice(d.deviceId) },
                                            onRestore = { onRestore(d.warrantyId) },
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Count pill + "Đã ẩn" heading. `null` count renders "?" (the read failed). */
@Composable
private fun HiddenSectionHeader(count: Int?) {
    val cs = MaterialTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 4.dp, end = 4.dp, top = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StatusPill(
            label = count?.toString() ?: "?",
            kind = PillKind.Neutral,
        )
        Spacer(Modifier.width(8.dp))
        Icon(
            Icons.Filled.NotificationsOff,
            contentDescription = null,
            tint = cs.onSurfaceVariant,
            modifier = Modifier.size(18.dp),
        )
        Spacer(Modifier.width(6.dp))
        Text(
            stringResource(R.string.rem_hidden),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            color = cs.onBackground,
        )
    }
}

/** Empty / unavailable copy for the hidden section — a muted card, not a pill. */
@Composable
private fun HiddenMessageCard(text: String) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surfaceVariant),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            text,
            modifier = Modifier.padding(16.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = cs.onSurfaceVariant,
        )
    }
}

/**
 * A hidden reminder. Deliberately *not* styled like [ReminderCard]:
 *
 *  * a neutral "Đã ẩn" pill on every row, plus the muted surface, says this row
 *    is here because it was hidden — not because its end date is near;
 *  * a device-status pill when the owning device is no longer ACTIVE explains
 *    the row that would otherwise look impossible (the upcoming feed only ever
 *    shows ACTIVE devices);
 *  * "Khôi phục" is the explicit un-dismiss path, so the list can never become
 *    a one-way trap. It calls the same `DELETE …/reminder` as the snackbar undo.
 */
@Composable
private fun DismissedReminderCard(
    reminder: DismissedReminder,
    onOpenDevice: () -> Unit,
    onRestore: () -> Unit,
) {
    val s = appStrings()
    val cs = MaterialTheme.colorScheme
    val days = daysLeftFromIso(reminder.endDate) ?: 0L
    val pillKind = when {
        days <= 3 -> PillKind.Danger
        days <= 7 -> PillKind.Warning
        else -> PillKind.Info
    }
    val pillLabel = when {
        days < 0L -> stringResource(R.string.dash_expired)
        days == 0L -> stringResource(R.string.dash_expires_today)
        days == 1L -> stringResource(R.string.dash_1_day_left)
        else -> pluralStringResource(R.plurals.dash_days_left, days.toInt(), days)
    }
    val interactionSource = remember { MutableInteractionSource() }
    Card(
        onClick = onOpenDevice,
        interactionSource = interactionSource,
        colors = CardDefaults.cardColors(containerColor = cs.surfaceVariant),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier
            .fillMaxWidth()
            .pressScale(interactionSource),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusPill(
                    label = stringResource(R.string.rem_hidden),
                    kind = PillKind.Neutral,
                    icon = Icons.Filled.NotificationsOff,
                )
                Spacer(Modifier.width(8.dp))
                StatusPill(label = pillLabel, kind = pillKind)
                Spacer(Modifier.width(8.dp))
                Text(
                    warrantyTypeLabel(s, reminder.warrantyType),
                    style = MaterialTheme.typography.labelMedium,
                    color = cs.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(10.dp))
            Text(
                reminder.deviceName,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = cs.onSurface,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (reminder.deviceCategory.isNotBlank()) {
                    Text(
                        CategoryLabels.label(reminder.deviceCategory),
                        style = MaterialTheme.typography.bodyMedium,
                        color = cs.onSurfaceVariant,
                    )
                }
                if (reminder.deviceStatus != DeviceStatus.ACTIVE) {
                    Spacer(Modifier.width(8.dp))
                    StatusPill(
                        label = s.get(reminder.deviceStatus.labelRes),
                        kind = PillKind.Neutral,
                    )
                }
            }
            Spacer(Modifier.height(6.dp))
            Text(
                stringResource(R.string.rem_expires, reminder.endDate.take(10)),
                style = MaterialTheme.typography.bodySmall,
                color = cs.onSurfaceVariant,
            )
            reminder.warrantyProvider?.takeIf { it.isNotBlank() }?.let {
                Text(
                    stringResource(R.string.rem_warranty_provider, it),
                    style = MaterialTheme.typography.bodySmall,
                    color = cs.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(8.dp))
            Row {
                TextButton(onClick = onRestore) {
                    Icon(Icons.Filled.Refresh, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(
                        stringResource(R.string.rem_restore),
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReminderCard(
    reminder: UpcomingReminder,
    onOpenDevice: () -> Unit,
    onDismiss: () -> Unit,
) {
    val s = appStrings()
    val cs = MaterialTheme.colorScheme
    val days = daysLeftFromIso(reminder.endDate) ?: 0L
    val pillKind = when {
        days <= 3 -> PillKind.Danger
        days <= 7 -> PillKind.Warning
        else -> PillKind.Info
    }
    val pillLabel = when {
        days < 0L -> stringResource(R.string.dash_expired)
        days == 0L -> stringResource(R.string.dash_expires_today)
        days == 1L -> stringResource(R.string.dash_1_day_left)
        else -> pluralStringResource(R.plurals.dash_days_left, days.toInt(), days)
    }
    val interactionSource = remember { MutableInteractionSource() }
    Card(
        onClick = onOpenDevice,
        interactionSource = interactionSource,
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier
            .fillMaxWidth()
            .pressScale(interactionSource),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusPill(label = pillLabel, kind = pillKind)
                Spacer(Modifier.width(8.dp))
                Text(
                    warrantyTypeLabel(s, reminder.type),
                    style = MaterialTheme.typography.labelMedium,
                    color = cs.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(10.dp))
            Text(
                reminder.device.name,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = cs.onSurface,
            )
            if (reminder.device.category.isNotBlank()) {
                Text(
                    CategoryLabels.label(reminder.device.category),
                    style = MaterialTheme.typography.bodyMedium,
                    color = cs.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(6.dp))
            Text(
                stringResource(R.string.rem_expires, reminder.endDate.take(10)),
                style = MaterialTheme.typography.bodySmall,
                color = cs.onSurfaceVariant,
            )
            reminder.provider?.takeIf { it.isNotBlank() }?.let {
                Text(
                    stringResource(R.string.rem_warranty_provider, it),
                    style = MaterialTheme.typography.bodySmall,
                    color = cs.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(8.dp))
            Row {
                TextButton(onClick = onDismiss) {
                    Icon(Icons.Filled.NotificationsOff, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.rem_seen), style = MaterialTheme.typography.labelLarge)
                }
            }
        }
    }
}
