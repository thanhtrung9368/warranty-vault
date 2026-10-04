package com.warrantyvault.app.ui.screens.wishlist

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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.FilterAltOff
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
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
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
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
import androidx.lifecycle.viewmodel.compose.viewModel
import com.warrantyvault.app.R
import com.warrantyvault.app.i18n.Money
import com.warrantyvault.app.i18n.appLocale
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.WishlistItem
import com.warrantyvault.app.network.WishlistPriority
import com.warrantyvault.app.network.WishlistStatus
import com.warrantyvault.app.network.toUserMessage
import com.warrantyvault.app.share.ShareTarget
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

class WishlistViewModel(private val api: ApiService) : ViewModel() {
    sealed interface State {
        data object Loading : State
        data class Loaded(val items: List<WishlistItem>) : State
        data class Error(val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _state.value = State.Loading
            try {
                val res = api.listWishlist()
                _state.value = State.Loaded(res.items)
            } catch (e: Exception) {
                _state.value = State.Error(e.toUserMessage(ApiClient.json))
            }
        }
    }

    fun upsert(item: WishlistItem) {
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
fun WishlistScreen(
    api: ApiService,
    onOpenItem: (String) -> Unit = {},
    onOpenSearch: () -> Unit = {},
    /**
     * Share target (#10): a product link captured from another app's share
     * sheet, handed over by `MainScreen` once the user is signed in. Arriving
     * here means "open the create form prefilled" — see the effect below.
     */
    sharedLink: ShareTarget.Product? = null,
    /** Called once [sharedLink] has been taken in, so the shell does not hand
     * the same link over again on the next recomposition. */
    onSharedLinkShown: () -> Unit = {},
) {
    val vm: WishlistViewModel = viewModel(
        factory = viewModelFactory { WishlistViewModel(api) },
    )
    val state by vm.state.collectAsState()
    var creating by rememberSaveable { mutableStateOf(false) }
    // The share prefill lives here, not in the shell, and it is saveable: the
    // shell's hand-off value is consumed immediately, so without this a
    // rotation would reopen the sheet empty and look like the share was lost.
    var sharedDraft by rememberSaveable(stateSaver = SharedProductSaver) {
        mutableStateOf<ShareTarget.Product?>(null)
    }
    var refreshing by remember { mutableStateOf(false) }
    // Filter state — mirrors the web `wishlist-filter-bar.tsx` (search box,
    // "Đang theo dõi / Watching / …" pills, priority + sort dropdowns).
    var query by rememberSaveable { mutableStateOf("") }
    var statusKey by rememberSaveable { mutableStateOf(WishlistStatusFilter.Active.key) }
    var priorityKey by rememberSaveable { mutableStateOf(WishlistPriorityFilter.All.key) }
    var sortKey by rememberSaveable { mutableStateOf(WishlistSort.PriorityAsc.name) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) { vm.load() }

    // A share is a request to add *this* link: open the create form, prefilled,
    // right away. The hand-off is acknowledged immediately — `sharedDraft` is
    // what the form actually reads from now on.
    LaunchedEffect(sharedLink) {
        val product = sharedLink ?: return@LaunchedEffect
        sharedDraft = product
        creating = true
        onSharedLinkShown()
    }

    fun closeSheet() {
        creating = false
        // Dropped with the sheet: a later tap on "+" must open a blank form,
        // not resurrect the link from a previous share.
        sharedDraft = null
    }

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
                onClick = { creating = true },
                containerColor = MaterialTheme.colorScheme.tertiary,
                contentColor = MaterialTheme.colorScheme.onTertiary,
                shape = RoundedCornerShape(28.dp),
                icon = { Icon(Icons.Filled.Add, null) },
                text = { Text(stringResource(R.string.wish_add_another_one), fontWeight = FontWeight.SemiBold) },
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
                label = "wishlist-state",
            ) { s ->
                when (s) {
                    is WishlistViewModel.State.Loading -> Column {
                        PageHeader("Wishlist", stringResource(R.string.state_loading))
                        SkeletonList(count = 4)
                    }
                    is WishlistViewModel.State.Error -> ErrorState(
                        icon = Icons.Outlined.WarningAmber,
                        title = stringResource(R.string.dash_could_not_load_it),
                        body = s.message,
                        onRetry = { vm.load() },
                    )
                    is WishlistViewModel.State.Loaded -> {
                        val statusFilter = WishlistStatusFilter.fromKey(statusKey)
                        val priorityFilter = WishlistPriorityFilter.fromKey(priorityKey)
                        val sort = WishlistSort.valueOf(sortKey)
                        val visible = filterAndSortWishlist(
                            rows = s.items,
                            query = query,
                            status = statusFilter,
                            priority = priorityFilter,
                            sort = sort,
                        )
                        if (s.items.isEmpty()) {
                            Column(Modifier.fillMaxSize()) {
                                PageHeader(
                                    "Wishlist",
                                    stringResource(R.string.wish_what_you_want),
                                )
                                EmptyState(
                                    icon = Icons.Filled.FavoriteBorder,
                                    title = stringResource(R.string.wish_nothing_on_your_wishlist_yet),
                                    body = stringResource(R.string.wish_add_an_item_to_track_its),
                                    ctaLabel = stringResource(R.string.wish_add_the_first_one),
                                    onCta = { creating = true },
                                    tone = MaterialTheme.colorScheme.tertiary,
                                )
                            }
                        } else {
                            WishlistList(
                                items = visible,
                                total = s.items.size,
                                isFiltered = query.isNotBlank() ||
                                    statusFilter != WishlistStatusFilter.Active ||
                                    priorityFilter != WishlistPriorityFilter.All,
                                query = query,
                                onQueryChange = { query = it },
                                statusKey = statusKey,
                                onStatusChange = { statusKey = it },
                                priorityKey = priorityKey,
                                onPriorityChange = { priorityKey = it },
                                sort = sort,
                                onSortChange = { sortKey = it.name },
                                onClick = onOpenItem,
                            )
                        }
                    }
                }
            }
        }
    }

    if (creating) {
        // Keyed on the draft so a SECOND share arriving while this sheet is
        // open re-initialises the form with the new link instead of silently
        // keeping the old one (the sheet's fields are `remember`ed from the
        // prefill, like every other edit sheet in this app).
        key(sharedDraft) {
            WishlistEditSheet(
                api = api,
                existing = null,
                prefill = sharedDraft,
                onDismiss = { closeSheet() },
                onSaved = { item ->
                    vm.upsert(item)
                    closeSheet()
                },
                onDeleted = { id ->
                    vm.remove(id)
                    closeSheet()
                },
            )
        }
    }
}

/**
 * Keeps the shared link across a configuration change. A nullable data class of
 * two strings is not saveable by default, and without this the create form
 * would come back blank after a rotation — the share would look lost even
 * though it was captured.
 *
 * `null` is stored as an empty list, which is also what an absent entry
 * restores to.
 */
private val SharedProductSaver: Saver<ShareTarget.Product?, Any> = listSaver(
    save = { product ->
        if (product == null) emptyList() else listOf(product.buyUrl, product.name.orEmpty())
    },
    restore = { saved ->
        saved.firstOrNull()?.let { url ->
            ShareTarget.Product(url, saved.getOrNull(1)?.takeIf { it.isNotEmpty() })
        }
    },
)

@Composable
private fun WishlistList(
    items: List<WishlistItem>,
    total: Int,
    isFiltered: Boolean,
    query: String,
    onQueryChange: (String) -> Unit,
    statusKey: String,
    onStatusChange: (String) -> Unit,
    priorityKey: String,
    onPriorityChange: (String) -> Unit,
    sort: WishlistSort,
    onSortChange: (WishlistSort) -> Unit,
    onClick: (String) -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 0.dp, bottom = 96.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            PageHeader(
                "Wishlist",
                if (isFiltered) stringResource(R.string.wish_items_match_the_filter, items.size, total)
                else pluralStringResource(R.plurals.wish_items_on_your_wishlist, total, total),
            )
        }
        item {
            ListFilterBar(
                query = query,
                onQueryChange = onQueryChange,
                placeholder = stringResource(R.string.wish_search_name_brand_note),
                options = wishlistStatusOptions(),
                selectedKey = statusKey,
                onSelect = onStatusChange,
                modifier = Modifier.padding(horizontal = 4.dp),
                secondaryOptions = wishlistPriorityOptions(),
                secondarySelectedKey = priorityKey,
                onSecondarySelect = onPriorityChange,
                trailing = {
                    SortMenuButton(
                        options = WishlistSort.entries,
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
                    title = stringResource(R.string.dev_nothing_matches_the_filter),
                    body = stringResource(R.string.subs_try_loosening_the_filter_or_choosing),
                )
            }
        }
        items(items, key = { it.id }) { item ->
            WishlistCard(item) { onClick(item.id) }
        }
    }
}

@Composable
private fun wishlistStatusOptions(): List<FilterOption> =
    WishlistStatusFilter.entries.map { FilterOption(it.key, stringResource(it.labelRes)) }

@Composable
private fun wishlistPriorityOptions(): List<FilterOption> =
    WishlistPriorityFilter.entries.map { FilterOption(it.key, stringResource(it.labelRes)) }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WishlistCard(item: WishlistItem, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
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
                    .background(cs.tertiary.copy(alpha = 0.14f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Star, null, tint = cs.tertiary)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        item.name,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = cs.onSurface,
                        modifier = Modifier.weight(1f),
                    )
                    WishStatusPill(item.status)
                }
                if (!item.brand.isNullOrBlank()) {
                    Text(
                        item.brand,
                        style = MaterialTheme.typography.bodyMedium,
                        color = cs.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.height(8.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    item.currentPrice?.let {
                        Text(
                            formatVnd(it),
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = cs.tertiary,
                        )
                    }
                    PriorityPill(item.priority)
                    Spacer(Modifier.weight(1f))
                    item.targetDate?.take(10)?.let {
                        Text(
                            it,
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
private fun WishStatusPill(status: WishlistStatus) {
    val kind = when (status) {
        WishlistStatus.WATCHING -> PillKind.Info
        WishlistStatus.DECIDED -> PillKind.Success
        WishlistStatus.SKIPPED -> PillKind.Neutral
        WishlistStatus.PURCHASED -> PillKind.Accent
    }
    StatusPill(label = stringResource(status.labelRes), kind = kind)
}

@Composable
private fun PriorityPill(priority: WishlistPriority) {
    val kind = when (priority) {
        WishlistPriority.MUST -> PillKind.Danger
        WishlistPriority.WANT -> PillKind.Warning
        WishlistPriority.MAYBE -> PillKind.Neutral
    }
    StatusPill(label = stringResource(priority.labelRes), kind = kind)
}

/**
 * Money in the UI language: `1.000.000 ₫` in Vietnamese — the canonical shape
 * `i18n/Money.kt` shares with Go's `FormatMoney` and the web, pinned by
 * `VietnameseFormatterTest` — and `₫1,000,000` in English. Follows [appLocale], not the phone locale, so the in-app switcher
 * moves the digits too.
 */
@Composable
internal fun formatVnd(amount: Int): String = Money.of(amount.toLong(), appLocale())
