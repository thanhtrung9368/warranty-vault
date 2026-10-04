package com.warrantyvault.app.ui.screens.actions

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.warrantyvault.app.R
import com.warrantyvault.app.i18n.appStrings
import com.warrantyvault.app.network.ActionCounts
import com.warrantyvault.app.network.ActionItem
import com.warrantyvault.app.network.ActionQueue
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.SnoozeInput
import com.warrantyvault.app.network.SnoozeResult
import com.warrantyvault.app.network.toUserMessage
import com.warrantyvault.app.ui.components.EmptyState
import com.warrantyvault.app.ui.components.ErrorState
import com.warrantyvault.app.ui.components.PageHeader
import com.warrantyvault.app.ui.components.PillKind
import com.warrantyvault.app.ui.components.SkeletonList
import com.warrantyvault.app.ui.components.StatusPill
import com.warrantyvault.app.ui.components.pressScale
import java.time.LocalDate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

// ─── ViewModel ────────────────────────────────────────────────────────────────

/**
 * `GET /api/v1/actions` — the derived "việc cần xử lý" queue, plus its snooze
 * write path.
 *
 * [includeSnoozed] mirrors the query flag exactly: the server ADDS the snoozed
 * rows when it is on and never removes any, so [State.Loaded.queue]`.counts`
 * keeps describing the actionable workload in both modes and only the row list
 * changes.
 */
class ActionQueueViewModel(private val api: ApiService) : ViewModel() {
    sealed interface State {
        data object Loading : State
        data class Loaded(val queue: ActionQueue, val includeSnoozed: Boolean) : State
        data class Error(val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state.asStateFlow()

    /** Remembered across reloads so a snooze does not silently reset the filter. */
    private var includeSnoozed = false

    fun load(showSnoozed: Boolean = includeSnoozed) {
        includeSnoozed = showSnoozed
        viewModelScope.launch {
            _state.value = State.Loading
            try {
                // `null` (not `false`) when off: the default read must be the
                // bare `GET /api/v1/actions`, never `?snoozed=false`.
                val queue = api.listActionItems(snoozed = showSnoozed.takeIf { it })
                _state.value = State.Loaded(queue, showSnoozed)
            } catch (e: Exception) {
                _state.value = State.Error(e.toUserMessage(ApiClient.json))
            }
        }
    }

    /** The "Đang hoãn" chip: flips the flag and refetches. */
    fun toggleSnoozed() = load(!includeSnoozed)

    /**
     * Hoãn one item for [days] (1–365). The server answers with the duration it
     * applied, which is handed to [onSnoozed] so the confirmation can quote the
     * server rather than the request.
     */
    fun snooze(
        itemKey: String,
        days: Int,
        onSnoozed: (SnoozeResult) -> Unit,
        onError: (String) -> Unit,
    ) {
        viewModelScope.launch {
            try {
                val result = api.snoozeActionItem(itemKey, SnoozeInput(days))
                load()
                onSnoozed(result)
            } catch (e: Exception) {
                onError(e.toUserMessage(ApiClient.json))
            }
        }
    }

    /** Bỏ hoãn — the item returns to the queue immediately. */
    fun unsnooze(itemKey: String, onDone: () -> Unit, onError: (String) -> Unit) {
        viewModelScope.launch {
            try {
                api.unsnoozeActionItem(itemKey)
                load()
                onDone()
            } catch (e: Exception) {
                onError(e.toUserMessage(ApiClient.json))
            }
        }
    }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

/**
 * Full-screen "Việc cần xử lý" route, reached from the Dashboard.
 *
 * **Why a route and not an eighth bottom-nav tab:** the shell already carries
 * seven destinations and no shared top bar, and this queue is a *detour you come
 * back from* — the same call [com.warrantyvault.app.ui.screens.search.SearchScreen]
 * and the settings leaf screens make. The Dashboard is where the workload is
 * discovered ("Tổng quan"), so that is where the entry point lives, with the
 * badge taken from `counts`.
 *
 * [onOpenDevice] / [onOpenSubscription] / [onOpenWishlistItem] push the entity a
 * row is about; rows with no entity id render as plain cards (see [actionTarget]).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActionQueueScreen(
    api: ApiService,
    onBack: () -> Unit,
    onOpenDevice: (String) -> Unit = {},
    onOpenSubscription: (String) -> Unit = {},
    onOpenWishlistItem: (String) -> Unit = {},
) {
    // `remember`, not `viewModel()`: the route leaves the tree on Back, and a VM
    // retained in the Activity store would come back with a stale queue — the
    // same reason SessionsScreen does this.
    val s = appStrings()
    val vm = remember { ActionQueueViewModel(api) }
    val state by vm.state.collectAsState()
    val snackbarHost = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { vm.load() }

    fun snooze(itemKey: String, days: Int) {
        actionError = null
        vm.snooze(
            itemKey = itemKey,
            days = days,
            onSnoozed = { result ->
                scope.launch { snackbarHost.showSnackbar(snoozeConfirmation(s, result)) }
            },
            onError = { actionError = it },
        )
    }

    // Hoisted: `scope.launch { }` is not a composable scope.
    val unsnoozedMessage = stringResource(R.string.act_un_snoozed_this_item_is_back)

    fun unsnooze(itemKey: String) {
        actionError = null
        vm.unsnooze(
            itemKey = itemKey,
            onDone = {
                scope.launch { snackbarHost.showSnackbar(unsnoozedMessage) }
            },
            onError = { actionError = it },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.dash_action_items)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.action_back))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
        snackbarHost = { SnackbarHost(snackbarHost) },
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
            when (val st = state) {
                is ActionQueueViewModel.State.Loading -> Column {
                    PageHeader(stringResource(R.string.dash_action_items), stringResource(R.string.state_loading))
                    SkeletonList(count = 4)
                }

                is ActionQueueViewModel.State.Error -> ErrorState(
                    icon = Icons.Outlined.WarningAmber,
                    title = stringResource(R.string.dash_could_not_load_it),
                    body = st.message,
                    onRetry = { vm.load() },
                )

                is ActionQueueViewModel.State.Loaded -> {
                    val queue = st.queue
                    val actionable = actionableItems(queue.items)
                    val snoozed = snoozedItems(queue.items)
                    val sections = actionSections(actionable)
                    val today = remember(queue.generatedAt) { LocalDate.now() }

                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(
                            start = 16.dp, end = 16.dp, top = 0.dp, bottom = 32.dp,
                        ),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        item {
                            PageHeader(
                                stringResource(R.string.dash_action_items),
                                actionQueueSubtitle(s, queue.counts.total, queue.snoozedCount),
                            )
                        }

                        // Severity breakdown, straight from `counts` — the same
                        // numbers a badge would use, never `items.size`.
                        if (queue.counts.total > 0) {
                            item { CountsRow(queue.counts) }
                        }

                        // The server's sentence about what this queue is NOT.
                        item { NoteCard(actionQueueNote(s, queue)) }

                        actionError?.let { message ->
                            item {
                                ErrorCard(message = message, onDismiss = { actionError = null })
                            }
                        }

                        // Snoozed rows exist only behind `?snoozed=true`; the chip
                        // is the way in, and its number is `snoozedCount`, which
                        // is never part of `counts`.
                        if (queue.snoozedCount > 0 || st.includeSnoozed) {
                            item {
                                SnoozedToggle(
                                    count = queue.snoozedCount,
                                    active = st.includeSnoozed,
                                    onToggle = { vm.toggleSnoozed() },
                                )
                            }
                        }

                        if (actionable.isEmpty()) {
                            item {
                                EmptyState(
                                    icon = Icons.Filled.CheckCircle,
                                    title = if (queue.snoozedCount > 0) {
                                        stringResource(R.string.act_nothing_left_waiting)
                                    } else {
                                        stringResource(R.string.act_nothing_needs_your_attention)
                                    },
                                    body = if (queue.snoozedCount > 0) {
                                        s.quantity(
                                            R.plurals.act_snoozed_note,
                                            queue.snoozedCount,
                                            queue.snoozedCount,
                                        ) + " " +
                                            stringResource(R.string.act_open_the_snoozed_section_to_look)
                                    } else {
                                        stringResource(R.string.act_the_app_could_not_infer_anything)
                                    },
                                    tone = MaterialTheme.colorScheme.primary,
                                )
                            }
                        } else {
                            sections.forEach { section ->
                                item(key = "header-${section.severity.name}") {
                                    Text(
                                        stringResource(section.severity.sectionLabelRes),
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.SemiBold,
                                        color = MaterialTheme.colorScheme.onBackground,
                                        modifier = Modifier.padding(start = 4.dp, top = 4.dp),
                                    )
                                }
                                for (row in section.items) {
                                    item(key = "item-${section.severity.name}-${row.itemKey}") {
                                        ActionCard(
                                            item = row,
                                            today = today,
                                            onOpen = {
                                                when (val target = actionTarget(row)) {
                                                    is ActionTarget.Device -> onOpenDevice(target.id)
                                                    is ActionTarget.Subscription ->
                                                        onOpenSubscription(target.id)
                                                    is ActionTarget.WishlistItem ->
                                                        onOpenWishlistItem(target.id)
                                                    null -> Unit
                                                }
                                            },
                                            onSnooze = { days -> snooze(row.itemKey, days) },
                                            onUnsnooze = { unsnooze(row.itemKey) },
                                        )
                                    }
                                }
                            }
                        }

                        if (st.includeSnoozed && snoozed.isNotEmpty()) {
                            item(key = "header-snoozed") {
                                Text(
                                    stringResource(R.string.act_snoozed, snoozed.size),
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onBackground,
                                    modifier = Modifier.padding(start = 4.dp, top = 4.dp),
                                )
                            }
                            for (row in sortActionItems(snoozed)) {
                                item(key = "snoozed-${row.itemKey}") {
                                    ActionCard(
                                        item = row,
                                        today = today,
                                        onOpen = {
                                            when (val target = actionTarget(row)) {
                                                is ActionTarget.Device -> onOpenDevice(target.id)
                                                is ActionTarget.Subscription ->
                                                    onOpenSubscription(target.id)
                                                is ActionTarget.WishlistItem ->
                                                    onOpenWishlistItem(target.id)
                                                null -> Unit
                                            }
                                        },
                                        onSnooze = { days -> snooze(row.itemKey, days) },
                                        onUnsnooze = { unsnooze(row.itemKey) },
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

@Composable
private fun CountsRow(counts: ActionCounts) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (counts.high > 0) StatusPill(stringResource(R.string.act_high, counts.high), PillKind.Danger)
        if (counts.medium > 0) StatusPill(stringResource(R.string.act_medium, counts.medium), PillKind.Warning)
        if (counts.low > 0) StatusPill(stringResource(R.string.act_low, counts.low), PillKind.Info)
        if (counts.total == 0) StatusPill(stringResource(R.string.act_no_items), PillKind.Success)
    }
}

@Composable
private fun NoteCard(note: String) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerHighest,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            note,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(14.dp),
        )
    }
}

@Composable
private fun ErrorCard(message: String, onDismiss: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.Outlined.WarningAmber, null,
                tint = MaterialTheme.colorScheme.onErrorContainer,
            )
            Spacer(Modifier.width(8.dp))
            Text(
                message,
                color = MaterialTheme.colorScheme.onErrorContainer,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) }
        }
    }
}

/**
 * The way into the snoozed rows. A chip, not a switch: it changes what the list
 * *shows*, and the label says how many rows are behind it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SnoozedToggle(count: Int, active: Boolean, onToggle: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        FilterChip(
            selected = active,
            onClick = onToggle,
            label = { Text(if (count > 0) stringResource(R.string.act_snoozed_2, count) else stringResource(R.string.act_snoozed_3)) },
            leadingIcon = {
                Icon(Icons.Filled.Schedule, null, modifier = Modifier.size(16.dp))
            },
        )
        Spacer(Modifier.width(8.dp))
        Text(
            if (active) stringResource(R.string.act_snoozed_items_are_shown_too) else stringResource(R.string.act_show_only_actionable_items),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ActionCard(
    item: ActionItem,
    today: LocalDate,
    onOpen: () -> Unit,
    onSnooze: (Int) -> Unit,
    onUnsnooze: () -> Unit,
) {
    val s = appStrings()
    val cs = MaterialTheme.colorScheme
    val severity = actionSeverityOf(item.severity)
    val target = actionTarget(item)
    val pill = actionDuePill(s, item.dueDate, today)
    val interactionSource = remember { MutableInteractionSource() }

    Card(
        // A row with no entity to open is a plain card — no click, no ripple
        // pretending there is somewhere to go.
        onClick = onOpen,
        enabled = target != null,
        interactionSource = interactionSource,
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier
            .fillMaxWidth()
            .then(if (target != null) Modifier.pressScale(interactionSource) else Modifier),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(28.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        actionTargetIcon(target),
                        null,
                        tint = cs.onSurfaceVariant,
                        modifier = Modifier.size(20.dp),
                    )
                }
                Spacer(Modifier.width(8.dp))
                StatusPill(stringResource(severity.sectionLabelRes), severity.pill)
                if (item.isSnoozed) {
                    Spacer(Modifier.width(6.dp))
                    StatusPill(stringResource(R.string.act_snoozed_3), PillKind.Neutral)
                }
                Spacer(Modifier.weight(1f))
                if (pill != null) StatusPill(pill.label, pill.kind)
            }

            Spacer(Modifier.height(10.dp))
            Text(
                item.title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = cs.onSurface,
            )
            Spacer(Modifier.height(4.dp))
            // The server's own sentence, verbatim: it names the dates and amounts
            // behind the item, and re-wording it here is how a queue drifts from
            // the data it was derived from.
            Text(
                item.detail,
                style = MaterialTheme.typography.bodyMedium,
                color = cs.onSurfaceVariant,
            )

            item.amountVnd?.let { amount ->
                Spacer(Modifier.height(6.dp))
                Text(
                    formatVndLong(amount),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.primary,
                )
            }

            // Snoozed rows carry the date they come back — that is the whole
            // reason `?snoozed=true` returns `snoozedUntil` at all.
            if (item.isSnoozed) {
                actionDateLabel(item.snoozedUntil)?.let { until ->
                    Spacer(Modifier.height(6.dp))
                    Text(
                        stringResource(R.string.act_show_again, until),
                        style = MaterialTheme.typography.bodySmall,
                        color = cs.onSurfaceVariant,
                    )
                }
            }

            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (item.isSnoozed) {
                    TextButton(onClick = onUnsnooze) {
                        Icon(Icons.Filled.NotificationsOff, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(stringResource(R.string.act_un_snooze), style = MaterialTheme.typography.labelLarge)
                    }
                } else {
                    SnoozeMenu(onSnooze = onSnooze)
                }
                Spacer(Modifier.weight(1f))
                if (target != null) {
                    Text(
                        stringResource(R.string.act_open_details),
                        style = MaterialTheme.typography.labelMedium,
                        color = cs.primary,
                    )
                }
            }
        }
    }
}

/**
 * A few Vietnamese durations instead of a free number field. Nothing is sent
 * until one is picked, so a stray tap cannot snooze anything.
 */
@Composable
private fun SnoozeMenu(onSnooze: (Int) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { expanded = true }) {
            Icon(Icons.Filled.Schedule, null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.act_snooze), style = MaterialTheme.typography.labelLarge)
            Icon(Icons.Filled.MoreVert, null, modifier = Modifier.size(16.dp))
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            Text(
                stringResource(R.string.act_snooze_this_for),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            )
            snoozeChoices.forEach { choice ->
                DropdownMenuItem(
                    text = { Text(stringResource(choice.labelRes)) },
                    onClick = {
                        expanded = false
                        onSnooze(choice.days)
                    },
                )
            }
        }
    }
}

/**
 * Icon by destination rather than by kind: the row's own `title`/`detail` already
 * say what the item is, while the icon is the only cue for *where it goes*. An
 * item with no entity gets the neutral warning icon.
 */
private fun actionTargetIcon(target: ActionTarget?): ImageVector = when (target) {
    is ActionTarget.Device -> Icons.Filled.Devices
    is ActionTarget.Subscription -> Icons.Filled.CreditCard
    is ActionTarget.WishlistItem -> Icons.Filled.Star
    null -> Icons.Outlined.WarningAmber
}
