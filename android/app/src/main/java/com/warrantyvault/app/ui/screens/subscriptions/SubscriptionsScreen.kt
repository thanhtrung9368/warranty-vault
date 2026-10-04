package com.warrantyvault.app.ui.screens.subscriptions

import androidx.annotation.StringRes
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
import androidx.compose.material.icons.automirrored.filled.ArrowForwardIos
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.FilterAltOff
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.warrantyvault.app.R
import com.warrantyvault.app.i18n.AppStrings
import com.warrantyvault.app.i18n.Money
import com.warrantyvault.app.i18n.appLocale
import com.warrantyvault.app.i18n.appStrings
import com.warrantyvault.app.i18n.money
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.BillingCycle
import com.warrantyvault.app.network.Subscription
import com.warrantyvault.app.network.SubscriptionStatus
import com.warrantyvault.app.network.toUserMessage
import com.warrantyvault.app.ui.components.EmptyState
import com.warrantyvault.app.ui.components.ErrorState
import com.warrantyvault.app.ui.components.FilterOption
import com.warrantyvault.app.ui.components.ListFilterBar
import com.warrantyvault.app.ui.components.PageHeader
import com.warrantyvault.app.ui.components.PillKind
import com.warrantyvault.app.ui.components.SkeletonList
import com.warrantyvault.app.ui.components.SortMenuButton
import com.warrantyvault.app.ui.components.StatusPill
import com.warrantyvault.app.ui.components.pressScale
import com.warrantyvault.app.ui.viewModelFactory
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class SubscriptionsViewModel(private val api: ApiService) : ViewModel() {
    sealed interface State {
        data object Loading : State
        data class Loaded(val items: List<Subscription>) : State
        data class Error(val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _state.value = State.Loading
            try {
                val res = api.listSubscriptions()
                _state.value = State.Loaded(res.subscriptions)
            } catch (e: Exception) {
                _state.value = State.Error(e.toUserMessage(ApiClient.json))
            }
        }
    }

    fun upsert(item: Subscription) {
        _state.update { s ->
            when (s) {
                is State.Loaded -> {
                    val idx = s.items.indexOfFirst { it.id == item.id }
                    val next = if (idx >= 0) {
                        s.items.toMutableList().also { it[idx] = item }
                    } else {
                        listOf(item) + s.items
                    }
                    State.Loaded(next)
                }
                else -> s
            }
        }
    }

    fun remove(id: String) {
        _state.update { s ->
            when (s) {
                is State.Loaded -> State.Loaded(s.items.filterNot { it.id == id })
                else -> s
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SubscriptionsScreen(
    api: ApiService,
    onOpenSubscription: (String) -> Unit = {},
    onOpenSearch: () -> Unit = {},
    onOpenAudit: () -> Unit = {},
) {
    val vm: SubscriptionsViewModel = viewModel(
        factory = viewModelFactory { SubscriptionsViewModel(api) },
    )
    val state by vm.state.collectAsState()
    var editing by rememberSaveable { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    // Filter state — mirrors the web `subscription-filter-bar.tsx` (search box,
    // "Đang dùng / Hoạt động / …" pills, sort dropdown).
    var query by rememberSaveable { mutableStateOf("") }
    var statusKey by rememberSaveable { mutableStateOf(SubscriptionStatusFilter.ActivePaused.key) }
    var sortKey by rememberSaveable { mutableStateOf(SubscriptionSort.RenewalAsc.name) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) { vm.load() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("") },
                actions = {
                    // Global search — the box below only filters this list.
                    IconButton(onClick = onOpenSearch) {
                        Icon(Icons.Filled.Search, stringResource(R.string.dash_search_everything))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { editing = true },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                shape = RoundedCornerShape(28.dp),
                icon = { Icon(Icons.Filled.Add, null) },
                text = { Text(stringResource(R.string.subs_add_plan), fontWeight = FontWeight.SemiBold) },
            )
        },
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
                label = "subs-state",
            ) { s ->
                when (s) {
                    is SubscriptionsViewModel.State.Loading -> Column {
                        PageHeader(stringResource(R.string.subs_subscriptions), stringResource(R.string.state_loading))
                        SkeletonList(count = 4)
                    }
                    is SubscriptionsViewModel.State.Error -> ErrorState(
                        icon = Icons.Outlined.WarningAmber,
                        title = stringResource(R.string.dash_could_not_load_it),
                        body = s.message,
                        onRetry = { vm.load() },
                    )
                    is SubscriptionsViewModel.State.Loaded -> {
                        val statusFilter = SubscriptionStatusFilter.fromKey(statusKey)
                        val sort = SubscriptionSort.valueOf(sortKey)
                        val visible = filterAndSortSubscriptions(
                            rows = s.items,
                            query = query,
                            status = statusFilter,
                            sort = sort,
                        )
                        if (s.items.isEmpty()) {
                            Column(Modifier.fillMaxSize()) {
                                PageHeader(
                                    stringResource(R.string.subs_subscriptions),
                                    stringResource(R.string.subs_track_your_recurring_costs),
                                )
                                EmptyState(
                                    icon = Icons.Filled.CreditCard,
                                    title = stringResource(R.string.subs_no_plans_yet),
                                    body = stringResource(R.string.subs_add_your_first_plan_to_see),
                                    ctaLabel = stringResource(R.string.subs_add_your_first_plan),
                                    onCta = { editing = true },
                                )
                            }
                        } else {
                            SubscriptionList(
                                items = visible,
                                total = s.items.size,
                                isFiltered = query.isNotBlank() ||
                                    statusFilter != SubscriptionStatusFilter.ActivePaused,
                                query = query,
                                onQueryChange = { query = it },
                                statusKey = statusKey,
                                onStatusChange = { statusKey = it },
                                sort = sort,
                                onSortChange = { sortKey = it.name },
                                onClick = onOpenSubscription,
                                onOpenAudit = onOpenAudit,
                            )
                        }
                    }
                }
            }
        }
    }

    if (editing) {
        SubscriptionEditSheet(
            api = api,
            existing = null,
            onDismiss = { editing = false },
            onSaved = { sub ->
                vm.upsert(sub)
                editing = false
            },
            onDeleted = { id ->
                vm.remove(id)
                editing = false
            },
        )
    }
}

@Composable
private fun SubscriptionList(
    items: List<Subscription>,
    total: Int,
    isFiltered: Boolean,
    query: String,
    onQueryChange: (String) -> Unit,
    statusKey: String,
    onStatusChange: (String) -> Unit,
    sort: SubscriptionSort,
    onSortChange: (SubscriptionSort) -> Unit,
    onClick: (String) -> Unit,
    onOpenAudit: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 0.dp, bottom = 96.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            PageHeader(
                stringResource(R.string.subs_subscriptions),
                if (isFiltered) stringResource(R.string.subs_plans_match_the_filter, items.size, total)
                else pluralStringResource(R.plurals.subs_plans_tracked, total, total),
            )
        }
        // "Soát gói đăng ký" — GET /api/v1/subscriptions/audit, one tap away.
        //
        // A plain entry row with no count on purpose: the report is a separate
        // endpoint with its own `note` and `thresholds`, and fetching it here just
        // to print a number would double this tab's requests and give this list a
        // second failure mode. The audit screen owns its own badge.
        item { AuditEntryRow(onClick = onOpenAudit) }
        item {
            ListFilterBar(
                query = query,
                onQueryChange = onQueryChange,
                placeholder = stringResource(R.string.subs_search_name_brand_plan),
                options = subscriptionStatusOptions(),
                selectedKey = statusKey,
                onSelect = onStatusChange,
                modifier = Modifier.padding(horizontal = 4.dp),
                trailing = {
                    SortMenuButton(
                        options = SubscriptionSort.entries,
                        current = sort,
                        label = { stringResource(it.labelRes) },
                        onSelect = onSortChange,
                    )
                },
            )
        }
        if (items.isEmpty()) {
            item {
                EmptyState(
                    icon = Icons.Filled.FilterAltOff,
                    title = stringResource(R.string.subs_no_plans_match),
                    body = stringResource(R.string.subs_try_loosening_the_filter_or_choosing),
                )
            }
        }
        items(items, key = { it.id }) { sub ->
            SubscriptionCard(sub) { onClick(sub.id) }
        }
    }
}

@Composable
private fun subscriptionStatusOptions(): List<FilterOption> =
    SubscriptionStatusFilter.entries.map { FilterOption(it.key, stringResource(it.labelRes)) }

/**
 * The way into "Soát gói đăng ký" (`GET /api/v1/subscriptions/audit`).
 *
 * Deliberately a row rather than a section: the audit is advisory and read-only,
 * and it carries its own explanatory copy, so it opens its own screen. The text
 * here describes what it reads (payment history) and never pre-judges the result
 * — no "gói bỏ quên", no "bạn không dùng".
 */
@Composable
private fun AuditEntryRow(onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val interactionSource = remember { MutableInteractionSource() }
    Card(
        onClick = onClick,
        interactionSource = interactionSource,
        colors = CardDefaults.cardColors(containerColor = cs.primaryContainer),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier
            .fillMaxWidth()
            .pressScale(interactionSource),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Lightbulb, null, tint = cs.primary)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    stringResource(AUDIT_ENTRY_TITLE),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onSurface,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    stringResource(AUDIT_ENTRY_SUBTITLE),
                    style = MaterialTheme.typography.bodySmall,
                    color = cs.onSurfaceVariant,
                )
            }
            Spacer(Modifier.width(8.dp))
            Icon(
                Icons.AutoMirrored.Filled.ArrowForwardIos, null,
                tint = cs.onSurfaceVariant,
                modifier = Modifier.size(14.dp),
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SubscriptionCard(sub: Subscription, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val s = appStrings()
    val interactionSource = remember { MutableInteractionSource() }
    Card(
        onClick = onClick,
        interactionSource = interactionSource,
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier
            .fillMaxWidth()
            .pressScale(interactionSource),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.Top) {
            Box(
                Modifier
                    .size(48.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(cs.primary.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.CreditCard, null, tint = cs.primary)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        sub.name,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = cs.onSurface,
                        modifier = Modifier.weight(1f),
                    )
                    SubStatusPill(sub.status)
                }
                val sub2 = listOfNotNull(sub.brand, sub.plan).joinToString(" • ")
                if (sub2.isNotEmpty()) {
                    Text(
                        sub2,
                        style = MaterialTheme.typography.bodyMedium,
                        color = cs.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        formatPriceCycle(s, sub.price, sub.billingCycle),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = cs.primary,
                    )
                    Spacer(Modifier.weight(1f))
                    sub.renewalDate?.take(10)?.let {
                        Text(
                            stringResource(R.string.subs_renew, it),
                            style = MaterialTheme.typography.labelMedium,
                            color = cs.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SubStatusPill(status: SubscriptionStatus) {
    val kind = when (status) {
        SubscriptionStatus.ACTIVE -> PillKind.Success
        SubscriptionStatus.PAUSED -> PillKind.Warning
        SubscriptionStatus.CANCELED -> PillKind.Neutral
        SubscriptionStatus.EXPIRED -> PillKind.Danger
    }
    StatusPill(label = stringResource(status.labelRes), kind = kind)
}

/**
 * Money in the UI language. The Vietnamese half is
 * `i18n/Money.kt::Money.vietnamese` — the frozen bytes `VietnameseFormatterTest`
 * pins — and this is the one the screens call, following [appLocale] rather than
 * the phone's system locale so an in-app language switch moves the digits too.
 */
@Composable
internal fun formatVnd(amount: Int): String = Money.of(amount.toLong(), appLocale())

/**
 * `99.000 ₫ / tháng` in Vietnamese, the same line in English.
 *
 * The cycle suffixes are existing resources (`subs_per_month` …) that already
 * carry their leading space, so the Vietnamese output is byte-identical to the
 * literal version this replaced — which is also why there is now one function
 * instead of a Vietnamese one plus a `Context` twin.
 */
internal fun formatPriceCycle(s: AppStrings, price: Int, cycle: BillingCycle): String {
    val id = cycleSuffixRes(cycle)
    return s.money(price.toLong()) + if (id == 0) "" else s.get(id)
}

@StringRes
internal fun cycleSuffixRes(cycle: BillingCycle): Int = when (cycle) {
    BillingCycle.MONTHLY -> R.string.subs_per_month
    BillingCycle.QUARTERLY -> R.string.subs_per_quarter
    BillingCycle.YEARLY -> R.string.subs_per_year
    BillingCycle.LIFETIME -> R.string.subs_lifetime
    BillingCycle.CUSTOM -> 0
}
