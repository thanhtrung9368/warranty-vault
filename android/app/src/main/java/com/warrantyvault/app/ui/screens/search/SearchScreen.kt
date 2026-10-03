package com.warrantyvault.app.ui.screens.search

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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SearchOff
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.Device
import com.warrantyvault.app.network.DeviceStatus
import com.warrantyvault.app.network.SearchResults
import com.warrantyvault.app.network.Subscription
import com.warrantyvault.app.network.SubscriptionStatus
import com.warrantyvault.app.network.WishlistItem
import com.warrantyvault.app.network.WishlistStatus
import com.warrantyvault.app.network.toUserMessage
import com.warrantyvault.app.ui.components.EmptyState
import com.warrantyvault.app.ui.components.ErrorState
import com.warrantyvault.app.ui.components.PillKind
import com.warrantyvault.app.ui.components.SearchField
import com.warrantyvault.app.ui.components.SectionHeader
import com.warrantyvault.app.ui.components.SkeletonList
import com.warrantyvault.app.ui.components.StatusPill
import com.warrantyvault.app.ui.components.pressScale
import com.warrantyvault.app.ui.screens.devices.formatVnd
import com.warrantyvault.app.ui.screens.subscriptions.formatPriceCycle
import com.warrantyvault.app.ui.viewModelFactory
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * `GET /api/v1/search` — one grouped request behind the global search surface.
 *
 * The ViewModel owns the *contract* rules and the [SearchScreen] owns the 300 ms
 * debounce (exactly like `DevicesScreen` / `SubscriptionsScreen`, whose filter
 * boxes debounce in a `LaunchedEffect`):
 *
 *  - a blank / whitespace-only keyword never reaches the network and never
 *    becomes an error — it goes back to [State.Blank];
 *  - a keyword over [SearchQuery.MAX_RUNES] runes is refused locally with the
 *    server's own wording instead of costing a round trip for a known 400;
 *  - `200` with three empty groups is [State.Empty] ("không tìm thấy"), which is
 *    a different thing from [State.Error] ("không tải được").
 */
class SearchViewModel(private val api: ApiService) : ViewModel() {

    sealed interface State {
        /** Nothing typed yet, or the box was cleared — an invitation, not a failure. */
        data object Blank : State

        /** A request is in flight (the "typing" state). */
        data object Loading : State

        /** At least one group has rows. */
        data class Loaded(val results: SearchResults) : State

        /** The query was valid but matched nothing in any group. */
        data class Empty(val query: String) : State

        /** Transport / server failure, with the query kept for the retry button. */
        data class Error(val message: String, val query: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Blank)
    val state: StateFlow<State> = _state.asStateFlow()

    fun search(raw: String) {
        val query = SearchQuery.normalize(raw)
        if (query.isEmpty()) {
            // Clearing the search box is a normal keystroke: the endpoint would
            // answer 200 with empty groups, and we don't even ask.
            _state.value = State.Blank
            return
        }
        SearchQuery.error(query)?.let { tooLong ->
            _state.value = State.Error(tooLong, query)
            return
        }
        viewModelScope.launch {
            _state.value = State.Loading
            try {
                val res = api.search(q = query, limit = SEARCH_LIMIT_PER_GROUP)
                _state.value = if (res.isEmpty) State.Empty(query) else State.Loaded(res)
            } catch (e: Exception) {
                _state.value = State.Error(e.toUserMessage(ApiClient.json), query)
            }
        }
    }

    companion object {
        /**
         * Rows per group. The server defaults to exactly this and caps at 50
         * (`services.MaxSearchLimit`); sending it explicitly documents that the
         * number is **per group**, not a total across the three groups.
         */
        const val SEARCH_LIMIT_PER_GROUP = 20
    }
}

/**
 * Full-screen cross-entity search: one box, three grouped result sections
 * (thiết bị / gói dịch vụ / wishlist), tapping a row opens that entity's detail
 * screen. Opened from the magnifier in the list screens' top bars
 * (`MainScreen` owns the route so a detail screen can stack on top and Back
 * returns to the results).
 *
 * The keyword is hoisted to [MainScreen] on purpose: tapping a result leaves
 * this composable's tree, so a local `rememberSaveable` would come back empty
 * and the user would lose the query they just typed.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchScreen(
    api: ApiService,
    query: String,
    onQueryChange: (String) -> Unit,
    onBack: () -> Unit,
    onOpenDevice: (String) -> Unit,
    onOpenSubscription: (String) -> Unit,
    onOpenWishlistItem: (String) -> Unit,
) {
    val vm: SearchViewModel = viewModel(
        factory = viewModelFactory { SearchViewModel(api) },
    )
    val state by vm.state.collectAsState()
    val focusRequester = remember { FocusRequester() }

    // Same debounce as the per-list filter bars. A blank box is not an error —
    // SearchViewModel turns it back into the Blank invitation.
    LaunchedEffect(query) {
        if (query.isNotBlank()) delay(SearchQuery.DEBOUNCE_MS)
        vm.search(query)
    }
    LaunchedEffect(Unit) {
        // Keyboard up front: the user tapped a magnifier, not a results page.
        runCatching { focusRequester.requestFocus() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Tìm kiếm") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Quay lại")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SearchField(
                query = query,
                onQueryChange = onQueryChange,
                placeholder = "Tìm thiết bị, gói dịch vụ, wishlist…",
                modifier = Modifier
                    .padding(horizontal = 16.dp)
                    .focusRequester(focusRequester),
            )

            when (val s = state) {
                SearchViewModel.State.Blank -> EmptyState(
                    icon = Icons.Filled.Search,
                    title = "Tìm gì cũng được",
                    body = "Gõ tên thiết bị, hãng, model, serial, gói dịch vụ hoặc món trong wishlist — " +
                        "không dấu vẫn ra (\"dien thoai\" khớp \"Điện thoại\").",
                )

                SearchViewModel.State.Loading -> SkeletonList(count = 4)

                is SearchViewModel.State.Empty -> EmptyState(
                    icon = Icons.Filled.SearchOff,
                    title = "Không tìm thấy gì khớp",
                    body = "Không có thiết bị, gói dịch vụ hay món wishlist nào khớp " +
                        "\"${s.query}\". Thử một từ khoá ngắn hơn xem sao.",
                )

                is SearchViewModel.State.Error -> ErrorState(
                    icon = Icons.Outlined.WarningAmber,
                    title = "Tìm không được rồi",
                    body = s.message,
                    onRetry = { vm.search(s.query) },
                )

                is SearchViewModel.State.Loaded -> SearchResultsList(
                    results = s.results,
                    onOpenDevice = onOpenDevice,
                    onOpenSubscription = onOpenSubscription,
                    onOpenWishlistItem = onOpenWishlistItem,
                )
            }
        }
    }
}

@Composable
private fun SearchResultsList(
    results: SearchResults,
    onOpenDevice: (String) -> Unit,
    onOpenSubscription: (String) -> Unit,
    onOpenWishlistItem: (String) -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item(key = "summary") {
            Text(
                "${results.total} kết quả cho \"${results.query}\"",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 4.dp),
            )
        }
        if (results.devices.isNotEmpty()) {
            item(key = "header-devices") {
                SectionHeader(SearchGroups.header(SearchGroups.DEVICES, results.devices.size))
            }
            items(results.devices, key = { "device-${it.id}" }) { device ->
                ResultCard(
                    icon = Icons.Filled.Devices,
                    title = device.name,
                    subtitle = deviceSubtitle(device),
                    meta = formatVnd(device.purchasePrice),
                    trailing = { DeviceStatusPill(device.status) },
                    onClick = { onOpenDevice(device.id) },
                )
            }
        }
        if (results.subscriptions.isNotEmpty()) {
            item(key = "header-subscriptions") {
                SectionHeader(
                    SearchGroups.header(SearchGroups.SUBSCRIPTIONS, results.subscriptions.size),
                )
            }
            items(results.subscriptions, key = { "sub-${it.id}" }) { sub ->
                ResultCard(
                    icon = Icons.Filled.CreditCard,
                    title = sub.name,
                    subtitle = subscriptionSubtitle(sub),
                    meta = formatPriceCycle(sub.price, sub.billingCycle),
                    trailing = { SubscriptionStatusPill(sub.status) },
                    onClick = { onOpenSubscription(sub.id) },
                )
            }
        }
        if (results.wishlist.isNotEmpty()) {
            item(key = "header-wishlist") {
                SectionHeader(SearchGroups.header(SearchGroups.WISHLIST, results.wishlist.size))
            }
            items(results.wishlist, key = { "wish-${it.id}" }) { item ->
                ResultCard(
                    icon = Icons.Filled.Star,
                    title = item.name,
                    subtitle = wishlistSubtitle(item),
                    // Priority first (it is what the "Thèm" list sorts on), then
                    // the watched price — or the target date when there is none.
                    meta = listOfNotNull(
                        item.priority.label,
                        item.currentPrice?.let { formatVnd(it) } ?: item.targetDate?.take(10),
                    ).joinToString(" • "),
                    trailing = { WishlistStatusPill(item.status) },
                    onClick = { onOpenWishlistItem(item.id) },
                )
            }
        }
    }
}

@Composable
private fun ResultCard(
    icon: ImageVector,
    title: String,
    subtitle: String,
    meta: String,
    trailing: @Composable () -> Unit,
    onClick: () -> Unit,
) {
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
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(cs.primary.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, null, tint = cs.primary, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onSurface,
                )
                if (subtitle.isNotBlank()) {
                    Text(
                        subtitle,
                        style = MaterialTheme.typography.bodyMedium,
                        color = cs.onSurfaceVariant,
                    )
                }
                if (meta.isNotBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        meta,
                        style = MaterialTheme.typography.labelMedium,
                        color = cs.onSurfaceVariant,
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            trailing()
        }
    }
}

// The three status pills below repeat the mappings the list screens keep
// private. They are label-mapped in one place per status enum (`DeviceStatus`,
// `SubscriptionStatus`, `WishlistStatus` carry the Vietnamese copy), so only
// the colour bucket is duplicated here.

@Composable
private fun DeviceStatusPill(status: DeviceStatus) {
    val kind = when (status) {
        DeviceStatus.ACTIVE -> PillKind.Success
        DeviceStatus.EXPIRED -> PillKind.Neutral
        DeviceStatus.SOLD -> PillKind.Info
        DeviceStatus.BROKEN -> PillKind.Danger
        DeviceStatus.LOST -> PillKind.Warning
    }
    StatusPill(label = status.label, kind = kind)
}

@Composable
private fun SubscriptionStatusPill(status: SubscriptionStatus) {
    val kind = when (status) {
        SubscriptionStatus.ACTIVE -> PillKind.Success
        SubscriptionStatus.PAUSED -> PillKind.Warning
        SubscriptionStatus.CANCELED -> PillKind.Neutral
        SubscriptionStatus.EXPIRED -> PillKind.Danger
    }
    StatusPill(label = status.label, kind = kind)
}

@Composable
private fun WishlistStatusPill(status: WishlistStatus) {
    val kind = when (status) {
        WishlistStatus.WATCHING -> PillKind.Info
        WishlistStatus.DECIDED -> PillKind.Success
        WishlistStatus.SKIPPED -> PillKind.Neutral
        WishlistStatus.PURCHASED -> PillKind.Accent
    }
    StatusPill(label = status.label, kind = kind)
}
