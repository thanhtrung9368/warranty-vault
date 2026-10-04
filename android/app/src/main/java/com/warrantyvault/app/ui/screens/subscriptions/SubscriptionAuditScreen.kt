package com.warrantyvault.app.ui.screens.subscriptions

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AssistChip
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
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.SubscriptionAudit
import com.warrantyvault.app.network.SubscriptionAuditFinding
import com.warrantyvault.app.network.SubscriptionAuditThresholds
import com.warrantyvault.app.network.toUserMessage
import com.warrantyvault.app.ui.components.EmptyState
import com.warrantyvault.app.ui.components.ErrorState
import com.warrantyvault.app.ui.components.PageHeader
import com.warrantyvault.app.ui.components.PillKind
import com.warrantyvault.app.ui.components.SkeletonList
import com.warrantyvault.app.ui.components.StatusPill
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

// ─── ViewModel ────────────────────────────────────────────────────────────────

/** `GET /api/v1/subscriptions/audit` — read-only, so the VM has one job: load it. */
class SubscriptionAuditViewModel(private val api: ApiService) : ViewModel() {
    sealed interface State {
        data object Loading : State
        data class Loaded(val audit: SubscriptionAudit) : State
        data class Error(val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _state.value = State.Loading
            try {
                _state.value = State.Loaded(api.getSubscriptionAudit())
            } catch (e: Exception) {
                _state.value = State.Error(e.toUserMessage(ApiClient.json))
            }
        }
    }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

/**
 * Full-screen "Soát gói đăng ký" route, reached from the top of
 * [SubscriptionsScreen].
 *
 * **Why its own screen rather than a section on the list:** the audit ships its
 * own explanatory payload — a `note` about what the analysis cannot know and the
 * `thresholds` that produced each verdict — and those belong neither above a list
 * the user is trying to read nor folded into a single collapsible row. It is a
 * read-only detour you come back from, the same shape as the action queue.
 *
 * **What this screen must never do**, and does not: claim a subscription is
 * unused, rank anything as "bỏ quên", or offer a cancel/disable action. The
 * endpoint has no write path (`advisory` is always true) and the app has no usage
 * telemetry, so `title`/`detail`/`note` are the server's own sentences rendered
 * as-is.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SubscriptionAuditScreen(
    api: ApiService,
    onBack: () -> Unit,
    onOpenSubscription: (String) -> Unit = {},
) {
    // `remember`, not `viewModel()`: the route leaves the tree on Back and the
    // report must be re-read next time rather than served stale.
    val vm = remember { SubscriptionAuditViewModel(api) }
    val state by vm.state.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.load() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(AUDIT_ENTRY_TITLE)) },
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
            val s = appStrings()
            when (val st = state) {
                is SubscriptionAuditViewModel.State.Loading -> Column {
                    PageHeader(stringResource(AUDIT_ENTRY_TITLE), stringResource(R.string.audit_reading_your_payment_history))
                    SkeletonList(count = 3)
                }

                is SubscriptionAuditViewModel.State.Error -> ErrorState(
                    icon = Icons.Outlined.WarningAmber,
                    title = stringResource(R.string.audit_the_audit_failed),
                    body = st.message,
                    onRetry = { vm.load() },
                )

                is SubscriptionAuditViewModel.State.Loaded -> {
                    val audit = st.audit
                    val findings = auditSortFindings(audit.findings)
                    val thresholdLines = auditThresholdLines(s, audit.thresholds)

                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(
                            start = 16.dp, end = 16.dp, top = 0.dp, bottom = 32.dp,
                        ),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        item {
                            PageHeader(stringResource(AUDIT_ENTRY_TITLE), auditSubtitle(s, audit.counts))
                        }

                        // The server's own limits, rendered verbatim: it already
                        // says the app cannot read bank transactions and cannot
                        // know whether a plan is used.
                        if (audit.note.isNotBlank()) {
                            item {
                                InfoCard(
                                    icon = Icons.Filled.Info,
                                    title = stringResource(R.string.audit_what_this_analysis_does_and_does),
                                    body = audit.note,
                                )
                            }
                        }

                        // `advisory` is a claim about the server's behaviour, so
                        // it is only repeated when the payload actually made it.
                        auditAdvisoryNote(s, audit.advisory)?.let { advisory ->
                            item { AdvisoryChip(advisory) }
                        }

                        if (thresholdLines.isNotEmpty()) {
                            item {
                                ThresholdCard(lines = thresholdLines)
                            }
                        }

                        if (auditIsEmpty(audit)) {
                            item {
                                EmptyState(
                                    icon = Icons.Filled.CreditCard,
                                    title = stringResource(R.string.audit_nothing_worth_flagging),
                                    body = stringResource(R.string.audit_empty),
                                    tone = MaterialTheme.colorScheme.primary,
                                )
                            }
                        } else {
                            for (finding in findings) {
                                item(key = finding.findingKey) {
                                    FindingCard(
                                        finding = finding,
                                        thresholds = audit.thresholds,
                                        onOpenSubscription = onOpenSubscription,
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
private fun AdvisoryChip(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        StatusPill(text, PillKind.Success)
    }
}

@Composable
private fun InfoCard(
    icon: ImageVector,
    title: String,
    body: String,
) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surfaceContainerHighest),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, null, tint = cs.onSurfaceVariant, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text(
                    title,
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onSurface,
                )
            }
            Spacer(Modifier.height(6.dp))
            Text(body, style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
        }
    }
}

/** "Luật đang áp dụng" — the thresholds that produced every verdict below. */
@Composable
private fun ThresholdCard(lines: List<String>) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Filled.Lightbulb, null,
                    tint = cs.primary,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    stringResource(R.string.audit_rules_in_effect),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onSurface,
                )
            }
            Spacer(Modifier.height(6.dp))
            lines.forEach { line ->
                Text(
                    "• $line",
                    style = MaterialTheme.typography.bodySmall,
                    color = cs.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun FindingCard(
    finding: SubscriptionAuditFinding,
    thresholds: SubscriptionAuditThresholds?,
    onOpenSubscription: (String) -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    val s = appStrings()
    val severity = auditSeverityOf(finding.severity)
    val links = auditLinks(finding)

    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusPill(auditSeverityLabel(s, severity), severity.pill)
                auditMinorPillLabel(s, finding)?.let {
                    Spacer(Modifier.width(6.dp))
                    StatusPill(it, PillKind.Neutral)
                }
            }

            Spacer(Modifier.height(10.dp))
            // The server's title and detail, verbatim: each one names the amounts
            // and dates behind the conclusion.
            Text(
                finding.title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = cs.onSurface,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                finding.detail,
                style = MaterialTheme.typography.bodyMedium,
                color = cs.onSurfaceVariant,
            )

            auditMoneyLine(s, finding)?.let { money ->
                Spacer(Modifier.height(6.dp))
                Text(
                    money,
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.primary,
                )
            }

            auditTimelineNote(s, finding)?.let { timeline ->
                Spacer(Modifier.height(4.dp))
                Text(
                    timeline,
                    style = MaterialTheme.typography.bodySmall,
                    color = cs.onSurfaceVariant,
                )
            }

            auditMaterialNote(s, finding, thresholds)?.let { minor ->
                Spacer(Modifier.height(6.dp))
                Text(
                    minor,
                    style = MaterialTheme.typography.bodySmall,
                    color = cs.onSurfaceVariant,
                )
            }

            auditRuleLabel(s, finding, thresholds)?.let { rule ->
                Spacer(Modifier.height(6.dp))
                Text(
                    rule,
                    style = MaterialTheme.typography.bodySmall,
                    color = cs.onSurfaceVariant,
                )
            }

            // Links to the subscription(s) involved. A `DUPLICATE` names two, so
            // each gets its own chip instead of a single card-wide tap that would
            // have to pick one silently. Two chips go on separate lines on
            // purpose: side by side, two long plan names would fight for the same
            // width and one could end up unreadable. Nothing here cancels or edits
            // anything — the chips only open the plan.
            if (links.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    links.forEach { link ->
                        AssistChip(
                            onClick = { onOpenSubscription(link.subscriptionId) },
                            label = { Text(link.name ?: stringResource(R.string.audit_open_the_plan)) },
                            leadingIcon = {
                                Icon(
                                    Icons.Filled.CreditCard, null,
                                    modifier = Modifier.size(16.dp),
                                )
                            },
                        )
                    }
                }
            }
        }
    }
}
