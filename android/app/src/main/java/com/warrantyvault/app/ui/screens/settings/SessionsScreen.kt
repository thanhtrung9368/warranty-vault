package com.warrantyvault.app.ui.screens.settings

import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Android
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PhoneIphone
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.annotation.StringRes
import com.warrantyvault.app.R
import com.warrantyvault.app.i18n.AppStrings
import com.warrantyvault.app.i18n.appStrings
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.SessionRevokeResult
import com.warrantyvault.app.network.SessionSummary
import com.warrantyvault.app.network.toUserMessage
import com.warrantyvault.app.ui.components.EmptyState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

// ─── Pure helpers (JVM unit tests: SessionsViewModelTest) ─────────────────────
//
// Everything below the ViewModel that decides *what the user reads* is a plain
// function so it can be tested without Robolectric — same split the rest of the
// app uses.

/**
 * The fallback the API documents for a `null` deviceLabel:
 * "`null` với client cũ không gửi nhãn — hiện 'Không rõ thiết bị'".
 *
 * A blank (rather than null) label is treated the same way: an empty row tells
 * the user nothing, and "Không rõ thiết bị" at least says why.
 */
/**
     * The pure Vietnamese mirror, pinned by `SessionsViewModelTest` — the same
     * shape `ShareTarget.MESSAGE_*` uses. The UI does NOT read it: it renders
     * `sessionDeviceLabelOrNull(...) ?: stringResource(R.string.sess_unknown_device)`,
     * so the row follows the language setting while this constant keeps the
     * JVM-testable original.
     */
    const val UNKNOWN_DEVICE_LABEL = "Không rõ thiết bị"

/** Never-empty device name for a session row, in the UI language. */
@Composable
fun sessionDeviceLabelText(deviceLabel: String?): String =
    sessionDeviceLabelOrNull(deviceLabel) ?: stringResource(R.string.sess_unknown_device)

/** Never-empty device name for a session row. */
fun sessionDeviceLabel(deviceLabel: String?): String =
    sessionDeviceLabelOrNull(deviceLabel) ?: UNKNOWN_DEVICE_LABEL

/**
 * The same rule without the Vietnamese fallback, so the UI can render
 * `sess_unknown_device` in the current language. The pure [sessionDeviceLabel]
 * stays as the JVM-testable mirror (`SessionsViewModelTest` pins it).
 */
fun sessionDeviceLabelOrNull(deviceLabel: String?): String? =
    deviceLabel?.trim()?.takeIf { it.isNotEmpty() }

/**
 * Readable Vietnamese for the session platform code, or `null` when the server
 * sent none (the pill is then hidden rather than showing an empty chip).
 *
 * `ios | android | web` is what `/auth/login` accepts and therefore what the
 * Session rows carry. `apns | fcm` are the *push* platform codes — they only
 * appear here on rows written by an older client, and they mean the same two
 * platforms, so they map to the same labels instead of leaking a raw code.
 * Anything unknown degrades to the raw value (data, not a broken label).
 */
fun sessionPlatformLabel(platform: String?): String? {
    val code = platform?.trim()?.lowercase().orEmpty()
    return when (code) {
        "" -> null
        "android", "fcm" -> "Android"
        "ios", "apns" -> "iOS"
        "web" -> "Web"
        else -> platform?.trim()
    }
}

/**
 * `2026-03-01T09:30:00Z` → `01/03/2026`. The date half only, exactly like every
 * other naive-UTC timestamp in this app ([com.warrantyvault.app.network.Device.purchaseDate]).
 * A missing or malformed value renders an em dash instead of throwing.
 */
fun sessionDateLabel(iso: String?): String {
    val date = iso?.trim()?.take(10).orEmpty()
    val parts = date.split("-")
    if (parts.size != 3) return "—"
    val (year, month, day) = parts
    if (year.length != 4 || month.length != 2 || day.length != 2) return "—"
    if (parts.any { part -> part.any { !it.isDigit() } }) return "—"
    return "$day/$month/$year"
}

/**
 * What the UI must do after `DELETE /api/v1/auth/sessions/{id}` answers.
 *
 * [signOut] is `result.current`: the caller just revoked the session it was
 * holding, so its token is already dead and the next request will 401 — the
 * client has to clear the token store and go back to login. Revoking a *sibling*
 * session leaves this device signed in (hence `false`), and
 * `alreadyRevoked = true` is success too: idempotent, not an error.
 *
 * [message] prefers the server's own Vietnamese sentence (it already knows which
 * of the three cases happened) and only falls back when the field is blank.
 */
data class SessionRevokeOutcome(val message: String, val signOut: Boolean)

fun sessionRevokeOutcome(s: AppStrings, result: SessionRevokeResult): SessionRevokeOutcome {
    val fallback = if (result.alreadyRevoked) {
        s.get(R.string.sess_already_revoked)
    } else {
        s.get(R.string.sess_revoked)
    }
    return SessionRevokeOutcome(
        message = result.message.takeIf { it.isNotBlank() } ?: fallback,
        signOut = result.current,
    )
}

// ─── ViewModel ────────────────────────────────────────────────────────────────

/** `GET /api/v1/auth/sessions` — the caller's own active logins. */
class SessionsViewModel(private val api: ApiService) : ViewModel() {
    sealed interface State {
        data object Loading : State
        data class Loaded(val sessions: List<SessionSummary>) : State
        data class Error(val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            _state.value = State.Loading
            try {
                _state.value = State.Loaded(api.listSessions().sessions)
            } catch (e: Exception) {
                _state.value = State.Error(e.toUserMessage(ApiClient.json))
            }
        }
    }

    /**
     * Drops a revoked row without a refetch: the id came from this list, the
     * server confirmed the revocation (or said it was already revoked), and the
     * row is gone in both cases.
     */
    fun removeLocally(id: String) {
        val cur = _state.value
        if (cur is State.Loaded) {
            _state.value = State.Loaded(cur.sessions.filterNot { it.id == id })
        }
    }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

/**
 * Full-screen list of the account's active login sessions, hung off Settings
 * exactly like [PushDevicesScreen] (a leaf route of the shell, not a tab — the
 * bottom bar already carries seven destinations).
 *
 * [onCurrentSessionRevoked] is invoked once the server has confirmed that the
 * **current** session was revoked; the host clears the token store and drops to
 * login, the same route the delete-account flow takes. No snackbar is shown on
 * that path on purpose: this whole screen is about to be replaced by the login
 * screen, and the confirmation dialog already said the sign-out would happen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionsScreen(
    api: ApiService,
    onCurrentSessionRevoked: () -> Unit,
    onBack: () -> Unit,
) {
    val s = appStrings()
    // `remember`, not `viewModel()`: this route is removed from the tree on
    // Back, and a VM retained in the Activity store would come back with a
    // stale list on the next visit.
    val vm = remember { SessionsViewModel(api) }
    val state by vm.state.collectAsState()
    val snackbarHost = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    var confirm by remember { mutableStateOf<SessionSummary?>(null) }
    var revokingId by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { vm.load() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.sess_sign_in_sessions)) },
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
        Box(Modifier.padding(padding).fillMaxSize()) {
            when (val s = state) {
                is SessionsViewModel.State.Loading -> Box(
                    Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) { CircularProgressIndicator() }

                is SessionsViewModel.State.Error -> Column(
                    Modifier.fillMaxSize().padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Icon(
                        Icons.Outlined.WarningAmber, null,
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(40.dp),
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(s.message, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = { vm.load() }) { Text(stringResource(R.string.action_retry)) }
                }

                is SessionsViewModel.State.Loaded -> {
                    if (s.sessions.isEmpty()) {
                        EmptyState(
                            icon = Icons.Outlined.Devices,
                            title = stringResource(R.string.sess_no_sessions_yet),
                            body = stringResource(R.string.sess_none_active) + " " +
                                stringResource(R.string.sess_sign_in_again_to_create_a),
                        )
                    } else {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(16.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            item {
                                Text(
                                    stringResource(R.string.sess_list_body),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            items(s.sessions, key = { it.id }) { session ->
                                SessionRow(
                                    session = session,
                                    revoking = revokingId == session.id,
                                    onRevoke = { confirm = session },
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    confirm?.let { session ->
        val isCurrent = session.current
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = {
                Text(if (isCurrent) stringResource(R.string.sess_sign_this_device_out) else stringResource(R.string.sess_revoke_this_session))
            },
            text = {
                Text(
                    if (isCurrent) {
                        stringResource(
                            R.string.sess_this_device_note,
                            sessionDeviceLabelText(session.deviceLabel),
                        ) + " " + stringResource(R.string.sess_once_revoked_you_will_be_sent)
                    } else {
                        stringResource(
                            R.string.sess_other_device_note,
                            sessionDeviceLabelText(session.deviceLabel),
                        ) + " " + stringResource(R.string.sess_the_device_you_are_using_is)
                    },
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val id = session.id
                    confirm = null
                    scope.launch {
                        revokingId = id
                        try {
                            val outcome = sessionRevokeOutcome(s, api.revokeSession(id))
                            if (outcome.signOut) {
                                // The token is dead as of this response; the host
                                // clears the store and returns to login.
                                onCurrentSessionRevoked()
                            } else {
                                vm.removeLocally(id)
                                snackbarHost.showSnackbar(outcome.message)
                            }
                        } catch (e: Exception) {
                            snackbarHost.showSnackbar(e.toUserMessage(ApiClient.json))
                        } finally {
                            revokingId = null
                        }
                    }
                }) {
                    Text(
                        if (isCurrent) stringResource(R.string.sess_sign_out) else stringResource(R.string.sess_revoke),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { confirm = null }) { Text(stringResource(R.string.action_cancel)) }
            },
        )
    }
}

@Composable
private fun SessionRow(
    session: SessionSummary,
    revoking: Boolean,
    onRevoke: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (session.current) cs.primaryContainer else cs.surface,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = if (session.current) 0.dp else 2.dp),
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val (icon, tint) = sessionIcon(session.platform)
            Box(
                Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(tint.copy(alpha = 0.14f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, null, tint = tint, modifier = Modifier.size(24.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        sessionDeviceLabelOrNull(session.deviceLabel)
                            ?: stringResource(R.string.sess_unknown_device),
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium,
                        color = cs.onSurface,
                    )
                    sessionPlatformLabel(session.platform)?.let { label ->
                        Spacer(Modifier.width(8.dp))
                        SessionPill(label, cs.primary)
                    }
                    // Marks the session that issued this request. Its revoke
                    // button means "đăng xuất thiết bị này" and signs the app out.
                    if (session.current) {
                        Spacer(Modifier.width(8.dp))
                        Icon(
                            Icons.Filled.Verified, null,
                            tint = cs.primary,
                            modifier = Modifier.size(14.dp),
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(
                            stringResource(R.string.sess_this_device),
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = cs.primary,
                        )
                    }
                }
                Spacer(Modifier.height(2.dp))
                Text(
                    stringResource(
                        R.string.sess_active,
                        relativeVi(session.lastSeenAt, LocalContext.current),
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = cs.onSurfaceVariant,
                )
                Text(
                    stringResource(
                        R.string.sess_signed_in_at,
                        sessionDateLabel(session.createdAt),
                    ) + " · " + stringResource(R.string.sess_expires, sessionDateLabel(session.expiresAt)),
                    style = MaterialTheme.typography.labelSmall,
                    color = cs.onSurfaceVariant,
                )
            }
            if (revoking) {
                CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
            } else {
                IconButton(onClick = onRevoke) {
                    Icon(
                        if (session.current) {
                            Icons.AutoMirrored.Filled.Logout
                        } else {
                            Icons.Filled.Delete
                        },
                        contentDescription = if (session.current) {
                            stringResource(R.string.sess_sign_this_device_out_2)
                        } else {
                            stringResource(R.string.sess_revoke_session)
                        },
                        tint = cs.error,
                    )
                }
            }
        }
    }
}

@Composable
private fun SessionPill(label: String, tint: Color) {
    Box(
        Modifier
            .clip(CircleShape)
            .background(tint.copy(alpha = 0.14f))
            .padding(horizontal = 8.dp, vertical = 2.dp),
    ) {
        Text(
            label,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            color = tint,
        )
    }
}

/**
 * Icon + tint for a session row. Derived from the same normalised label the pill
 * shows, so an unknown code gets the neutral "other device" icon rather than
 * pretending to be a phone.
 */
private fun sessionIcon(platform: String?): Pair<ImageVector, Color> =
    when (sessionPlatformLabel(platform)) {
        "Android" -> Icons.Filled.Android to Color(0xFF3DDC84)
        "iOS" -> Icons.Filled.PhoneIphone to Color(0xFF007AFF)
        "Web" -> Icons.Filled.Public to Color(0xFF6B7280)
        else -> Icons.Outlined.Devices to Color(0xFF6B7280)
    }
