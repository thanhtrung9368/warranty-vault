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
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.warrantyvault.app.ui.viewModelFactory
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.WishlistItem
import com.warrantyvault.app.network.WishlistPriority
import com.warrantyvault.app.network.WishlistStatus
import com.warrantyvault.app.network.toUserMessage
import com.warrantyvault.app.ui.components.EmptyState
import com.warrantyvault.app.ui.components.ErrorState
import com.warrantyvault.app.ui.components.PageHeader
import com.warrantyvault.app.ui.components.PillKind
import com.warrantyvault.app.ui.components.SkeletonList
import com.warrantyvault.app.ui.components.StatusPill
import com.warrantyvault.app.ui.components.pressScale
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.Locale

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
) {
    val vm: WishlistViewModel = viewModel(
        factory = viewModelFactory { WishlistViewModel(api) },
    )
    val state by vm.state.collectAsState()
    var creating by rememberSaveable { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

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
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { creating = true },
                containerColor = MaterialTheme.colorScheme.tertiary,
                contentColor = MaterialTheme.colorScheme.onTertiary,
                shape = RoundedCornerShape(28.dp),
                icon = { Icon(Icons.Filled.Add, null) },
                text = { Text("Thèm thêm cái nữa", fontWeight = FontWeight.SemiBold) },
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
                        PageHeader("Wishlist", "Đang tải…")
                        SkeletonList(count = 4)
                    }
                    is WishlistViewModel.State.Error -> ErrorState(
                        icon = Icons.Outlined.WarningAmber,
                        title = "Tải không được rồi",
                        body = s.message,
                        onRetry = { vm.load() },
                    )
                    is WishlistViewModel.State.Loaded -> {
                        if (s.items.isEmpty()) {
                            Column(Modifier.fillMaxSize()) {
                                PageHeader(
                                    "Wishlist",
                                    "Cái mày đang thèm",
                                )
                                EmptyState(
                                    icon = Icons.Filled.FavoriteBorder,
                                    title = "Mày chưa thèm cái nào? Lạ thật.",
                                    body = "Thêm sản phẩm vào để theo dõi giá và quyết định mua đúng lúc.",
                                    ctaLabel = "Thêm cái đầu tiên",
                                    onCta = { creating = true },
                                    tone = MaterialTheme.colorScheme.tertiary,
                                )
                            }
                        } else {
                            WishlistList(items = s.items, onClick = onOpenItem)
                        }
                    }
                }
            }
        }
    }

    if (creating) {
        WishlistEditSheet(
            api = api,
            existing = null,
            onDismiss = { creating = false },
            onSaved = { item ->
                vm.upsert(item)
                creating = false
            },
            onDeleted = { id ->
                vm.remove(id)
                creating = false
            },
        )
    }
}

@Composable
private fun WishlistList(items: List<WishlistItem>, onClick: (String) -> Unit) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 0.dp, bottom = 96.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            PageHeader("Wishlist", "${items.size} món đang thèm")
        }
        items(items, key = { it.id }) { item ->
            WishlistCard(item) { onClick(item.id) }
        }
    }
}

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
    StatusPill(label = status.label, kind = kind)
}

@Composable
private fun PriorityPill(priority: WishlistPriority) {
    val kind = when (priority) {
        WishlistPriority.MUST -> PillKind.Danger
        WishlistPriority.WANT -> PillKind.Warning
        WishlistPriority.MAYBE -> PillKind.Neutral
    }
    StatusPill(label = priority.label, kind = kind)
}

internal fun formatVnd(amount: Int): String {
    val nf = NumberFormat.getNumberInstance(Locale("vi", "VN"))
    return nf.format(amount) + "đ"
}
