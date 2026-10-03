package com.warrantyvault.app.ui.screens.devices

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.util.Log
import android.widget.Toast
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warrantyvault.app.BuildConfig
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.CreateShareInput
import com.warrantyvault.app.network.CreatedDeviceShare
import com.warrantyvault.app.network.DeviceShare
import com.warrantyvault.app.network.toUserMessage
import com.warrantyvault.app.ui.screens.vietnamDate
import kotlinx.coroutines.launch

/**
 * "Phiếu bàn giao bảo hành" — the share-link section on the device detail screen
 * (FEATURE_IDEAS #2).
 *
 * ## The one thing this screen must not get wrong
 *
 * `POST /api/v1/devices/{id}/shares` returns the token **once**; the server keeps
 * only its sha256, so no later call can reproduce it. The create result is
 * therefore shown in a [AlertDialog] whose *title* is [ONE_TIME_TITLE], whose body
 * opens with [ONE_TIME_WARNING] **above** the link, and which offers copy and the
 * system share sheet right there. The warning cannot be scrolled off, cannot be
 * reached late, and does not depend on the user having read an earlier card — it
 * is inside the only surface that displays the credential, before any way to
 * dismiss it. The copy confirmation repeats it ([COPIED_MESSAGE]) so the rule
 * still stands after the dialog is gone.
 *
 * The token is never written to `TokenStore`, a file, or `rememberSaveable`: a
 * credential the server will not re-issue must not become a permanent one on disk.
 *
 * ## Outgoing share vs the app's own share target
 *
 * `AndroidManifest.xml` registers this app as an `ACTION_SEND` / `text/plain`
 * target (FEATURE_IDEAS #10), which is the same intent this section sends. Left
 * alone, the chooser would list WarrantyVault itself and picking it would re-enter
 * `ShareTarget.deliver()` — the certificate URL parses as a product link, so the
 * user would land in the **wishlist** form with the buyer's certificate in it.
 * [excludedShareTargets] removes exactly that component (see `ShareLinks.kt`).
 */
@Composable
fun ShareCertificatesSection(api: ApiService, deviceId: String, deviceName: String) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var shares by remember { mutableStateOf<List<DeviceShare>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var creating by remember { mutableStateOf(false) }
    var expiresInDays by remember { mutableStateOf(CreateShareInput.DEFAULT_EXPIRES_IN_DAYS) }
    var includeSerial by remember { mutableStateOf(false) }

    // The one-time credential. Holds the *created* share only, and is cleared the
    // moment the dialog closes — nothing else in the app may read it.
    var created by remember { mutableStateOf<CreatedDeviceShare?>(null) }
    var revoking by remember { mutableStateOf<DeviceShare?>(null) }

    suspend fun reload() {
        loading = true
        try {
            shares = api.listShares(deviceId).shares
            error = null
        } catch (e: Exception) {
            error = e.toUserMessage(ApiClient.json)
        } finally {
            loading = false
        }
    }

    LaunchedEffect(deviceId) { reload() }

    // One instant for the whole list: re-reading the clock per row could show one
    // link as live and the next as expired for the same moment. It is *sticky*
    // across recompositions and re-read only when the list itself changes, so rows
    // cannot flip state underneath the user while they read them — and the header
    // count can never disagree with the rows below it.
    //
    // `shares` is a key, not a remembered value: `remember { System.currentTimeMillis() }`
    // with no key would freeze the clock for the lifetime of the screen, so a link
    // that expired while the user was looking at it would keep reading as live.
    val now = remember(shares) { System.currentTimeMillis() }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Link, null, tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(8.dp))
            Text("Phiếu bàn giao bảo hành",
                fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            if (loading) {
                CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
            } else {
                Text("${shares.count { isShareLive(it, now) }} đang hiệu lực",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        Text(
            "Gửi người mua một link chỉ-đọc, không cần đăng nhập, để họ tự xem phần " +
                "bảo hành còn lại. Link luôn có hạn và thu hồi được.",
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        // ---- Create ----
        Card(
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceContainerHighest,
            ),
            elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                ExpiryPicker(
                    days = expiresInDays,
                    enabled = !creating,
                    onPick = { expiresInDays = it },
                )

                // Serial opt-in. Off by default, and the consequence of turning it
                // on is stated where the switch is — a seller handing a stranger a
                // link is entitled to know exactly what it exposes.
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Kèm số máy/IMEI đầy đủ",
                            fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                        Text(
                            if (includeSerial) SERIAL_ON_EXPLANATION else SERIAL_OFF_EXPLANATION,
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(
                        checked = includeSerial,
                        enabled = !creating,
                        onCheckedChange = { includeSerial = it },
                    )
                }

                Text(CERTIFICATE_PROJECTION_EXPLANATION,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)

                Button(
                    onClick = {
                        scope.launch {
                            creating = true
                            error = null
                            try {
                                val res = api.createShare(
                                    deviceId,
                                    CreateShareInput(
                                        expiresInDays = expiresInDays,
                                        includeSerial = includeSerial,
                                    ),
                                )
                                created = res.share
                                reload()
                            } catch (e: Exception) {
                                error = e.toUserMessage(ApiClient.json)
                            } finally {
                                creating = false
                            }
                        }
                    },
                    enabled = !creating,
                    shape = CircleShape,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                    ),
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                ) {
                    if (creating) {
                        CircularProgressIndicator(
                            strokeWidth = 2.dp,
                            modifier = Modifier.height(18.dp),
                            color = MaterialTheme.colorScheme.onPrimary,
                        )
                    } else {
                        Icon(Icons.Filled.Add, null)
                        Spacer(Modifier.width(6.dp))
                        Text("Tạo link chia sẻ", fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }

        error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
        }

        // ---- Live + past links ----
        if (!loading && shares.isEmpty()) {
            Text(NO_LINKS_MESSAGE,
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        shares.forEach { share ->
            ShareRow(
                share = share,
                live = isShareLive(share, now),
                nowMillis = now,
                onRevoke = { revoking = share },
            )
        }
    }

    created?.let { share ->
        OneTimeLinkDialog(
            share = share,
            deviceName = deviceName,
            onCopy = { url ->
                copyToClipboard(context, url)
                Toast.makeText(context, COPIED_MESSAGE, Toast.LENGTH_LONG).show()
            },
            onShare = { url -> openShareSheet(context, deviceName, url) },
            onDismiss = { created = null },
        )
    }

    revoking?.let { share ->
        AlertDialog(
            onDismissRequest = { revoking = null },
            title = { Text("Thu hồi link này?") },
            text = { Text(revokeConfirmMessage(share)) },
            confirmButton = {
                TextButton(onClick = {
                    val id = share.id
                    revoking = null
                    scope.launch {
                        try {
                            api.revokeShare(id)
                            reload()
                        } catch (e: Exception) {
                            error = e.toUserMessage(ApiClient.json)
                        }
                    }
                }) { Text("Thu hồi", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { revoking = null }) { Text("Huỷ") }
            },
        )
    }
}

/**
 * The create result — **the only surface in the app that ever shows a token**.
 *
 * Layout order is the design, not decoration:
 *
 *  1. title = [ONE_TIME_TITLE] (the stakes, before anything is read),
 *  2. [ONE_TIME_WARNING] in an error-tinted box with a warning icon,
 *  3. the link (selectable, so a failed clipboard still has a manual path),
 *  4. share + copy, side by side and equal weight,
 *  5. only then "Đóng".
 *
 * `onDismissRequest` (back / tap outside) closes it like the button does. That is
 * safe **because** the warning is inside the dialog and above the link: a user who
 * dismisses has already been told, in the same view, that there is no second
 * chance.
 */
@Composable
private fun OneTimeLinkDialog(
    share: CreatedDeviceShare,
    deviceName: String,
    onCopy: (String) -> Unit,
    onShare: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    val url = shareUrl(BuildConfig.BASE_URL, share.sharePath)

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(ONE_TIME_TITLE, fontWeight = FontWeight.SemiBold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                    Icon(Icons.Outlined.WarningAmber, null, tint = cs.error)
                    Spacer(Modifier.width(8.dp))
                    Text(
                        ONE_TIME_WARNING,
                        color = cs.error,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }

                Text("Link của \"$deviceName\":",
                    fontSize = 12.sp,
                    color = cs.onSurfaceVariant)

                if (url != null) {
                    // Rendered in full and wrap-enabled: this is the one moment
                    // the credential exists on screen, so it is never truncated
                    // into something the user cannot read back.
                    Text(url, fontSize = 13.sp, color = cs.onSurface)
                } else {
                    Text(
                        "Máy chủ không trả về đường dẫn cho link này. Hãy thu hồi và tạo lại.",
                        fontSize = 13.sp,
                        color = cs.error,
                    )
                }

                Text(
                    "Hạn: ${vietnamDate(share.expiresAt) ?: "—"} · " +
                        if (share.includeSerial) {
                            "có số máy đầy đủ"
                        } else {
                            "số máy đã che giữa"
                        },
                    fontSize = 12.sp,
                    color = cs.onSurfaceVariant,
                )

                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Button(
                        onClick = { url?.let(onShare) },
                        enabled = url != null,
                        shape = CircleShape,
                        modifier = Modifier.weight(1f),
                    ) {
                        Icon(Icons.Filled.Share, null)
                        Spacer(Modifier.width(6.dp))
                        Text("Chia sẻ")
                    }
                    OutlinedButton(
                        onClick = { url?.let(onCopy) },
                        enabled = url != null,
                        shape = CircleShape,
                        modifier = Modifier.weight(1f),
                    ) {
                        Icon(Icons.Filled.ContentCopy, null)
                        Spacer(Modifier.width(6.dp))
                        Text("Sao chép")
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("Đóng") }
        },
    )
}

/** Expiry in days, offered as explicit choices rather than free text. */
@Composable
private fun ExpiryPicker(days: Int, enabled: Boolean, onPick: (Int) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column {
        Text("Link có hiệu lực trong", fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedButton(
            onClick = { open = true },
            enabled = enabled,
            shape = CircleShape,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("$days ngày")
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            EXPIRY_CHOICES.forEach { choice ->
                DropdownMenuItem(
                    text = { Text("$choice ngày") },
                    onClick = {
                        onPick(choice)
                        open = false
                    },
                )
            }
        }
    }
}

/**
 * The durations this client offers, all inside the contract's 1–90 bound.
 *
 * Not a free-text field: an out-of-range value is a 400, and a user typing "0"
 * hoping for "no expiry" would be told no by the server anyway — there is no
 * permanent link, so the UI never offers one.
 */
private val EXPIRY_CHOICES = listOf(7, 30, 90)

/** One existing link. States what it is, whether it still works, and how to kill it. */
@Composable
private fun ShareRow(
    share: DeviceShare,
    live: Boolean,
    nowMillis: Long,
    onRevoke: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        border = BorderStroke(1.dp, cs.outline),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        shareStateLabel(share, nowMillis),
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (live) cs.primary else cs.onSurfaceVariant,
                    )
                    if (share.includeSerial) {
                        Spacer(Modifier.width(6.dp))
                        Text("· có số máy đầy đủ",
                            fontSize = 12.sp, color = cs.onSurfaceVariant)
                    } else {
                        Spacer(Modifier.width(6.dp))
                        Text("· số máy che giữa",
                            fontSize = 12.sp, color = cs.onSurfaceVariant)
                    }
                }
                shareExpiryLabel(share)?.let {
                    Text(it, fontSize = 12.sp, color = cs.onSurfaceVariant)
                }
                Text(shareViewLabel(share),
                    fontSize = 12.sp, color = cs.onSurfaceVariant)
            }
            if (live) {
                IconButton(onClick = onRevoke) {
                    Icon(Icons.Filled.Delete, "Thu hồi link", tint = cs.error)
                }
            }
        }
    }
}

// ---- Android side effects (the only part of this file that is not testable) ----

private fun copyToClipboard(context: Context, url: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("Link phiếu bàn giao", url))
}

/**
 * Opens the system share sheet for the certificate.
 *
 * Two Android details carry the collision fix (see the file header): the target
 * list is queried with the same `ACTION_SEND` / `text/plain` intent, and this
 * app's own component — found via `BuildConfig.APPLICATION_ID` —
 * is passed to the chooser as `EXTRA_EXCLUDE_COMPONENTS`.
 *
 * Filtering is by package name, not by class name: the manifest declares exactly
 * one share-target activity (`MainActivity`, `launchMode="singleTop"`), and
 * matching the package keeps the rule correct if that activity is ever renamed,
 * while still leaving every other app in the sheet untouched.
 */
private fun openShareSheet(context: Context, deviceName: String, url: String) {
    val message = shareMessage(deviceName, url)
    val outgoing = outgoingShare(message)
    val send = Intent(outgoing.action).apply {
        type = outgoing.mimeType
        putExtra(Intent.EXTRA_TEXT, outgoing.message)
    }

    val selfPackage = BuildConfig.APPLICATION_ID
    val resolved = context.packageManager
        .queryIntentActivities(send, 0)
        .map { info ->
            ResolvedTarget(
                component = "${info.activityInfo.packageName}/${info.activityInfo.name}",
                isSelfTarget = info.activityInfo.packageName == selfPackage,
            )
        }
    val excluded = excludedShareTargets(resolved)

    val chooser = Intent.createChooser(send, CHOOSER_TITLE).apply {
        if (excluded.isNotEmpty()) {
            putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, excluded.toTypedArray())
        }
    }
    try {
        context.startActivity(chooser)
    } catch (e: ActivityNotFoundException) {
        Log.w("ShareLinks", "no share target", e)
        Toast.makeText(context, NO_SHARE_TARGET_MESSAGE, Toast.LENGTH_LONG).show()
    }
}
