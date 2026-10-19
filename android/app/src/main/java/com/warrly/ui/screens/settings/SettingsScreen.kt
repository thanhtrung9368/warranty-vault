package com.warrly.ui.screens.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MailOutline
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PhonelinkLock
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material.icons.filled.SettingsBrightness
import androidx.compose.material.icons.filled.TableChart
import androidx.compose.material.icons.filled.Translate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.warrly.App
import com.warrly.BuildConfig
import com.warrly.R
import com.warrly.auth.AppLockAvailability
import com.warrly.auth.AppLockFailure
import com.warrly.auth.AppLockNotice
import com.warrly.auth.AppLockStore
import com.warrly.auth.AuthStore
import com.warrly.export.csvFileName
import com.warrly.export.devicesCsvBytes
import com.warrly.i18n.appStrings
import com.warrly.insurance.downloadAndShareInsurancePack
import com.warrly.insurance.insurancePackRequest
import com.warrly.network.AIOptInRequest
import com.warrly.network.ApiClient
import com.warrly.network.ApiService
import com.warrly.network.toUserMessage
import com.warrly.ui.components.PageHeader
import com.warrly.ui.components.SectionHeader
import com.warrly.ui.screens.lock.messageRes
import com.warrly.ui.theme.ThemePreference
import com.warrly.ui.theme.ThemeStore
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    auth: AuthStore,
    themeStore: ThemeStore,
    api: ApiService,
    appLock: AppLockStore,
    onOpenPushDevices: () -> Unit = {},
    onOpenSessions: () -> Unit = {},
) {
    val status by auth.status.collectAsState()
    val themePref by themeStore.preference.collectAsState()
    // App lock state — the store is app-scoped so these flows survive Activity
    // recreation; the row below only renders them.
    val appLockEnabled by appLock.isEnabled.collectAsState()
    val appLockBusy by appLock.isAuthenticating.collectAsState()
    val appLockAvailability by appLock.availability.collectAsState()
    val appLockFailure by appLock.lastFailure.collectAsState()
    val appLockNotice by appLock.autoDisabledNotice.collectAsState()
    val cs = MaterialTheme.colorScheme
    var showChangePassword by rememberSaveable { mutableStateOf(false) }
    var showProfileEdit by rememberSaveable { mutableStateOf(false) }
    var showLanguage by rememberSaveable { mutableStateOf(false) }
    var showEmailChange by rememberSaveable { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    // The store is the single source of truth for the signed-in user: the
    // profile card below recomposes from it after a successful PATCH.
    val currentUser = (status as? AuthStore.Status.Authenticated)?.user

    val context = LocalContext.current

    // AI receipt-scan opt-in.
    var aiOptIn by remember { mutableStateOf(false) }
    var aiBusy by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        runCatching { api.getAIOptIn() }.onSuccess { aiOptIn = it.aiOptIn }
    }

    // Backup export / import + account deletion.
    var backupBusy by remember { mutableStateOf(false) }
    var showImportModeDialog by remember { mutableStateOf(false) }
    var pendingImportMode by remember { mutableStateOf("merge") }
    var showDeleteDialog by remember { mutableStateOf(false) }
    var deletePassword by rememberSaveable { mutableStateOf("") }
    var deleteBusy by remember { mutableStateOf(false) }
    var deleteError by remember { mutableStateOf<String?>(null) }

    // CSV export of the device list. Built client-side by `devicesCsvBytes()`
    // (pure, unit-tested in app/src/test/.../export/CsvExportTest.kt) from
    // `GET /api/v1/devices` — the same call the "Thiết bị" tab already makes, so
    // this adds no API surface. Delivered through SAF exactly like the JSON
    // backup below; `pendingCsv` holds the finished bytes so cancelling the
    // picker never leaves a half-written file behind.
    var csvBusy by remember { mutableStateOf(false) }
    var pendingCsv by remember { mutableStateOf<ByteArray?>(null) }
    var pendingCsvCount by remember { mutableStateOf(0) }

    // Insurance PDF pack (Settings → Data). The document is rendered server-side
    // by `GET /api/v1/insurance-pack` — Android never builds the PDF and never
    // needs a device list to do it. `includeSold` is the only option exposed here;
    // the account-wide pack covers every device, so no device picker is needed.
    var insuranceBusy by remember { mutableStateOf(false) }
    var showInsuranceDialog by remember { mutableStateOf(false) }
    var insuranceIncludeSold by rememberSaveable { mutableStateOf(false) }

    fun snack(msg: String) { scope.launch { snackbarHostState.showSnackbar(msg) } }

    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json"),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            backupBusy = true
            try {
                val body = api.exportBackup()
                context.contentResolver.openOutputStream(uri)?.use { out ->
                    body.byteStream().use { it.copyTo(out) }
                } ?: throw IllegalStateException("no stream")
                snack(context.getString(R.string.set_backed_up_to_a_json_file))
            } catch (e: Exception) {
                snack(context.getString(R.string.set_backup_failed, e.toUserMessage(ApiClient.json, context)))
            } finally {
                backupBusy = false
            }
        }
    }

    // SAF writer for the CSV bytes prepared by `startCsvExport()`. Same
    // `CreateDocument` pattern as the JSON backup above, with `text/csv` so the
    // picker offers spreadsheet-friendly targets.
    val csvLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("text/csv"),
    ) { uri ->
        val bytes = pendingCsv
        pendingCsv = null
        if (uri == null || bytes == null) return@rememberLauncherForActivityResult
        scope.launch {
            csvBusy = true
            try {
                context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                    ?: throw IllegalStateException("no stream")
                snack(context.resources.getQuantityString(R.plurals.set_exported_devices_to_a_csv_file, pendingCsvCount, pendingCsvCount))
            } catch (e: Exception) {
                snack(context.getString(R.string.set_csv_export_failed, e.toUserMessage(ApiClient.json, context)))
            } finally {
                csvBusy = false
            }
        }
    }

    fun startCsvExport() {
        if (csvBusy || backupBusy) return
        csvBusy = true
        scope.launch {
            try {
                val devices = api.listDevices().devices
                if (devices.isEmpty()) {
                    snack(context.getString(R.string.set_there_are_no_devices_to_export))
                    return@launch
                }
                // Fetch + serialise before opening the picker: an empty list or a
                // network error then costs the user nothing, and the bytes carry
                // the UTF-8 BOM Excel needs (see CsvExport.kt).
                pendingCsv = devicesCsvBytes(context.appStrings(), devices)
                pendingCsvCount = devices.size
                csvLauncher.launch(csvFileName())
            } catch (e: Exception) {
                snack(context.getString(R.string.set_csv_export_failed, e.toUserMessage(ApiClient.json, context)))
            } finally {
                csvBusy = false
            }
        }
    }

    /**
     * Download the pack and open the system share sheet.
     *
     * There is deliberately no silent branch: a failed download, an empty body,
     * an unusable FileProvider path or a chooser that cannot open all become a
     * snackbar carrying the server's message where there is one (401/403/5xx are
     * `HttpException`s) and a localized fallback where there is not.
     */
    fun startInsurancePack(includeSold: Boolean) {
        if (insuranceBusy) return
        showInsuranceDialog = false
        insuranceBusy = true
        scope.launch {
            try {
                downloadAndShareInsurancePack(
                    context = context,
                    api = api,
                    request = insurancePackRequest(includeSold = includeSold),
                )
            } catch (e: Exception) {
                snack(
                    context.getString(
                        R.string.set_insurance_pack_failed,
                        e.toUserMessage(ApiClient.json, context),
                    ),
                )
            } finally {
                insuranceBusy = false
            }
        }
    }

    fun runImport(uri: android.net.Uri, mode: String) {
        scope.launch {
            backupBusy = true
            try {
                val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    ?: throw IllegalStateException("no stream")
                val reqBody = bytes.toRequestBody("application/json".toMediaType())
                val res = api.importBackup(mode, reqBody).result
                val skipped = res.skipped + res.subSkipped + res.wishlistSkipped
                snack(
                    if (skipped > 0) {
                        context.getString(
                            R.string.set_import_summary_skipped,
                            res.imported, res.subImported, res.wishlistImported, skipped,
                        )
                    } else {
                        context.getString(
                            R.string.set_import_summary,
                            res.imported, res.subImported, res.wishlistImported,
                        )
                    },
                )
            } catch (e: Exception) {
                snack(context.getString(R.string.set_import_failed, e.toUserMessage(ApiClient.json, context)))
            } finally {
                backupBusy = false
            }
        }
    }

    val importLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) runImport(uri, pendingImportMode)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = cs.background,
                ),
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = cs.background,
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 24.dp),
        ) {
            PageHeader(stringResource(R.string.nav_settings), stringResource(R.string.set_personalise_your_account_and_appearance))

            // Profile card
            currentUser?.let { user ->
                Card(
                    colors = CardDefaults.cardColors(containerColor = cs.surface),
                    elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                    shape = RoundedCornerShape(20.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp),
                ) {
                    Row(
                        Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .size(56.dp)
                                .clip(CircleShape)
                                .background(cs.primary.copy(alpha = 0.14f)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                Icons.Filled.Person, null,
                                tint = cs.primary,
                                modifier = Modifier.size(30.dp),
                            )
                        }
                        Spacer(Modifier.size(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                user.displayLabel,
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                user.email,
                                style = MaterialTheme.typography.bodyMedium,
                                color = cs.onSurfaceVariant,
                            )
                        }
                    }
                }
            }

            // Profile editing. The display name is edited in place; the email is
            // NOT frozen — it is changed by its own two-step flow
            // (`POST /auth/change-email` → `/confirm-email-change`), which this
            // row opens. An earlier version of this comment claimed the API had
            // no email change at all; that was wrong and cost Android the feature
            // for a release (web and iOS both had it).
            Spacer(Modifier.height(16.dp))
            Box(Modifier.padding(horizontal = 16.dp)) {
                SectionHeader(stringResource(R.string.set_profile))
            }
            Spacer(Modifier.height(8.dp))
            Card(
                colors = CardDefaults.cardColors(containerColor = cs.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
            ) {
                Column {
                    SettingsRow(
                        icon = Icons.Filled.Badge,
                        title = stringResource(R.string.set_display_name),
                        subtitle = currentUser?.name?.takeIf { it.isNotBlank() }
                            ?: stringResource(R.string.set_no_name_yet_tap_to_add),
                        onClick = { showProfileEdit = true },
                        showDivider = true,
                    )
                    SettingsRow(
                        icon = Icons.Filled.MailOutline,
                        title = "Email",
                        subtitle = stringResource(
                            R.string.settings_email_row_subtitle,
                            currentUser?.email.orEmpty(),
                        ),
                        onClick = { showEmailChange = true },
                        showDivider = false,
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            Box(Modifier.padding(horizontal = 16.dp)) {
                SectionHeader(stringResource(R.string.set_appearance))
            }
            Spacer(Modifier.height(8.dp))
            Card(
                colors = CardDefaults.cardColors(containerColor = cs.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
            ) {
                Column {
                    ThemePreference.entries.forEach { pref ->
                        SettingsRow(
                            icon = iconFor(pref),
                            title = stringResource(pref.labelRes),
                            onClick = { themeStore.set(pref) },
                            trailing = {
                                RadioButton(
                                    selected = themePref == pref,
                                    onClick = { themeStore.set(pref) },
                                )
                            },
                            showDivider = true,
                        )
                    }
                    // Language (docs/I18N_PLAN.md phase 2). Sits in "Giao diện"
                    // next to the theme because it is the same kind of choice —
                    // except this one is also PATCHed to the account, since push
                    // notifications and emails are rendered server-side with no
                    // request context to take an `Accept-Language` from (§2.3).
                    SettingsRow(
                        icon = Icons.Filled.Translate,
                        title = stringResource(R.string.settings_lang_row_title),
                        subtitle = stringResource(R.string.settings_lang_row_subtitle),
                        onClick = { showLanguage = true },
                        showDivider = false,
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            Box(Modifier.padding(horizontal = 16.dp)) {
                SectionHeader(stringResource(R.string.subs_account))
            }
            Spacer(Modifier.height(8.dp))
            Card(
                colors = CardDefaults.cardColors(containerColor = cs.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
            ) {
                Column {
                    SettingsRow(
                        icon = Icons.Filled.Lock,
                        title = stringResource(R.string.set_change_password),
                        subtitle = stringResource(R.string.set_update_the_password_you_sign_in),
                        onClick = { showChangePassword = true },
                        showDivider = true,
                    )
                    // App lock — the Android twin of iOS "Face ID & Touch ID"
                    // (AccountView.swift). Off by default; turning it on AND off
                    // each authenticate once (`AppLockStore.setEnabled`), and the
                    // switch cannot be turned on when the device could never
                    // satisfy it, so nobody can lock themselves out.
                    SettingsRow(
                        icon = Icons.Filled.Fingerprint,
                        title = stringResource(R.string.app_lock_row_title),
                        subtitle = appLockSubtitle(
                            enabled = appLockEnabled,
                            availability = appLockAvailability,
                            failure = appLockFailure,
                            notice = appLockNotice,
                        ),
                        trailing = {
                            if (appLockBusy) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(20.dp),
                                    strokeWidth = 2.dp,
                                )
                            } else {
                                Switch(
                                    checked = appLockEnabled,
                                    enabled = appLockEnabled || appLockAvailability.canEnableLock,
                                    onCheckedChange = { next ->
                                        appLock.acknowledgeAutoDisabledNotice()
                                        scope.launch {
                                            appLock.setEnabled(
                                                next,
                                                context.getString(R.string.app_lock_prompt_reason),
                                            )
                                        }
                                    },
                                )
                            }
                        },
                        showDivider = true,
                    )
                    SettingsRow(
                        icon = Icons.Filled.Notifications,
                        title = stringResource(R.string.set_notification_devices),
                        subtitle = stringResource(R.string.set_manage_the_devices_registered_for_push),
                        onClick = onOpenPushDevices,
                        showDivider = true,
                    )
                    // Device sessions are NOT the push list above: revoking here
                    // ends a login (data access), removing a push target only
                    // stops notifications. Different rows on purpose.
                    SettingsRow(
                        icon = Icons.Filled.PhonelinkLock,
                        title = stringResource(R.string.set_sign_in_sessions),
                        subtitle = stringResource(R.string.set_see_which_devices_are_signed_in),
                        onClick = onOpenSessions,
                        showDivider = false,
                    )
                }
            }
            // Honest about what the lock is: a screen cover, not encryption of
            // the data at rest.
            Text(
                stringResource(R.string.app_lock_row_footer),
                style = MaterialTheme.typography.bodySmall,
                color = cs.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp),
            )

            Spacer(Modifier.height(16.dp))
            Box(Modifier.padding(horizontal = 16.dp)) {
                SectionHeader(stringResource(R.string.set_invoice_scanning_ai))
            }
            Spacer(Modifier.height(8.dp))
            Card(
                colors = CardDefaults.cardColors(containerColor = cs.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
            ) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                stringResource(R.string.set_scan_invoices_with_ai),
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                stringResource(R.string.set_the_invoice_image_is_sent_decrypted),
                                style = MaterialTheme.typography.bodySmall,
                                color = cs.onSurfaceVariant,
                            )
                        }
                        Spacer(Modifier.size(12.dp))
                        Switch(
                            checked = aiOptIn,
                            enabled = !aiBusy,
                            onCheckedChange = { next ->
                                aiBusy = true
                                scope.launch {
                                    try {
                                        val res = api.setAIOptIn(AIOptInRequest(next))
                                        aiOptIn = res.aiOptIn
                                        snack(
                                            context.getString(
                                                if (res.aiOptIn) R.string.set_ai_invoice_scanning_is_on
                                                else R.string.set_ai_invoice_scanning_is_off,
                                            ),
                                        )
                                    } catch (e: Exception) {
                                        // Never fail silently here: flipping back
                                        // with no explanation reads as a bug, and
                                        // the web toasts the server message.
                                        snack(
                                            context.getString(
                                                R.string.set_could_not_update_the_setting,
                                                e.toUserMessage(ApiClient.json, context),
                                            ),
                                        )
                                    } finally {
                                        aiBusy = false
                                    }
                                }
                            },
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            Box(Modifier.padding(horizontal = 16.dp)) {
                SectionHeader(stringResource(R.string.set_data))
            }
            Spacer(Modifier.height(8.dp))
            Card(
                colors = CardDefaults.cardColors(containerColor = cs.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
            ) {
                Column {
                    SettingsRow(
                        icon = Icons.Filled.CloudDownload,
                        title = if (backupBusy) stringResource(R.string.set_working) else stringResource(R.string.set_back_up_export_json),
                        subtitle = stringResource(R.string.set_download_every_device_plan_and_wishlist),
                        onClick = {
                            if (!backupBusy) exportLauncher.launch("warrly-backup.json")
                        },
                        showDivider = true,
                    )
                    SettingsRow(
                        icon = Icons.Filled.TableChart,
                        title = if (csvBusy) stringResource(R.string.set_working) else stringResource(R.string.set_export_csv_excel),
                        subtitle = stringResource(R.string.set_download_the_device_list_as_a),
                        onClick = { startCsvExport() },
                        showDivider = true,
                    )
                    // Insurance PDF pack. Sits in Data/Export, next to backup and
                    // CSV, because it is the same kind of action — "give me my
                    // data as a document" — not a per-device feature. The title
                    // says "(tiếng Việt)" and the subtitle says why: the PDF is
                    // always Vietnamese because the insurer reads it.
                    SettingsRow(
                        icon = Icons.Filled.PictureAsPdf,
                        title = if (insuranceBusy) stringResource(R.string.set_working) else stringResource(R.string.set_insurance_pack_title),
                        subtitle = stringResource(R.string.set_insurance_pack_subtitle),
                        onClick = {
                            if (!insuranceBusy) {
                                insuranceIncludeSold = false
                                showInsuranceDialog = true
                            }
                        },
                        showDivider = true,
                    )
                    SettingsRow(
                        icon = Icons.Filled.Restore,
                        title = stringResource(R.string.set_restore_from_a_backup),
                        subtitle = stringResource(R.string.set_import_your_data_back_from_an),
                        onClick = { if (!backupBusy) showImportModeDialog = true },
                        showDivider = false,
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            Box(Modifier.padding(horizontal = 16.dp)) {
                SectionHeader(stringResource(R.string.set_system))
            }
            Spacer(Modifier.height(8.dp))
            Card(
                colors = CardDefaults.cardColors(containerColor = cs.surfaceContainerHighest),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        "Backend URL",
                        style = MaterialTheme.typography.labelMedium,
                        color = cs.onSurfaceVariant,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        BuildConfig.BASE_URL,
                        style = MaterialTheme.typography.bodyMedium,
                        color = cs.onSurface,
                    )
                }
            }

            Spacer(Modifier.height(28.dp))

            Button(
                onClick = { auth.logout() },
                colors = ButtonDefaults.buttonColors(
                    containerColor = cs.errorContainer,
                    contentColor = cs.onErrorContainer,
                ),
                shape = CircleShape,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .height(52.dp),
            ) {
                Icon(Icons.AutoMirrored.Filled.Logout, null, modifier = Modifier.size(20.dp))
                Spacer(Modifier.size(8.dp))
                Text(
                    stringResource(R.string.set_sign_out),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                )
            }

            Spacer(Modifier.height(8.dp))

            TextButton(
                onClick = { deletePassword = ""; deleteError = null; showDeleteDialog = true },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
            ) {
                Icon(
                    Icons.Filled.DeleteForever, null,
                    tint = cs.error, modifier = Modifier.size(20.dp),
                )
                Spacer(Modifier.size(8.dp))
                Text(
                    stringResource(R.string.set_delete_account),
                    color = cs.error,
                    style = MaterialTheme.typography.labelLarge,
                )
            }
        }
    }

    // Import-mode picker (merge vs replace).
    if (showImportModeDialog) {
        AlertDialog(
            onDismissRequest = { showImportModeDialog = false },
            title = { Text(stringResource(R.string.set_restore_from_a_backup)) },
            text = {
                Text(stringResource(R.string.set_import_mode_body))
            },
            confirmButton = {
                TextButton(onClick = {
                    pendingImportMode = "merge"
                    showImportModeDialog = false
                    importLauncher.launch(arrayOf("application/json"))
                }) { Text(stringResource(R.string.set_merge)) }
            },
            dismissButton = {
                TextButton(onClick = {
                    pendingImportMode = "replace"
                    showImportModeDialog = false
                    importLauncher.launch(arrayOf("application/json"))
                }) { Text(stringResource(R.string.set_replace), color = cs.error) }
            },
        )
    }

    // Insurance PDF confirmation. Shown before the download so the Vietnamese
    // language rule is stated up front (the row title says "(tiếng Việt)"; this
    // body says the insurer is the reader, so it does not look like a bug), and
    // so the one optional flag — include sold devices — is a deliberate choice.
    if (showInsuranceDialog) {
        AlertDialog(
            onDismissRequest = { if (!insuranceBusy) showInsuranceDialog = false },
            title = { Text(stringResource(R.string.set_insurance_pack_title)) },
            text = {
                Column {
                    Text(stringResource(R.string.set_insurance_pack_dialog_body))
                    Spacer(Modifier.height(8.dp))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(enabled = !insuranceBusy) {
                                insuranceIncludeSold = !insuranceIncludeSold
                            }
                            .padding(vertical = 4.dp),
                    ) {
                        Checkbox(
                            checked = insuranceIncludeSold,
                            onCheckedChange = { insuranceIncludeSold = it },
                            enabled = !insuranceBusy,
                        )
                        Spacer(Modifier.size(8.dp))
                        Text(
                            stringResource(R.string.set_insurance_pack_include_sold),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !insuranceBusy,
                    onClick = { startInsurancePack(insuranceIncludeSold) },
                ) { Text(stringResource(R.string.set_insurance_pack_create)) }
            },
            dismissButton = {
                TextButton(
                    enabled = !insuranceBusy,
                    onClick = { showInsuranceDialog = false },
                ) { Text(stringResource(R.string.action_cancel)) }
            },
        )
    }

    // Delete-account confirmation (requires current password).
    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { if (!deleteBusy) showDeleteDialog = false },
            title = { Text(stringResource(R.string.set_delete_your_account)) },
            text = {
                Column {
                    Text(stringResource(R.string.set_delete_account_body))
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = deletePassword,
                        onValueChange = { deletePassword = it },
                        label = { Text(stringResource(R.string.set_current_password)) },
                        singleLine = true,
                        enabled = !deleteBusy,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        isError = deleteError != null,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (deleteError != null) {
                        Text(
                            deleteError!!,
                            color = cs.error,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !deleteBusy && deletePassword.isNotBlank(),
                    onClick = {
                        deleteBusy = true
                        deleteError = null
                        scope.launch {
                            try {
                                // On success the auth status flips and the app
                                // returns to the login screen automatically.
                                auth.deleteAccount(deletePassword)
                            } catch (e: Exception) {
                                deleteError = e.toUserMessage(ApiClient.json, context)
                            } finally {
                                deleteBusy = false
                                if (deleteError == null) showDeleteDialog = false
                            }
                        }
                    },
                ) { Text(if (deleteBusy) stringResource(R.string.devdetail_deleting) else stringResource(R.string.set_delete_permanently), color = cs.error) }
            },
            dismissButton = {
                TextButton(enabled = !deleteBusy, onClick = { showDeleteDialog = false }) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
        )
    }

    if (showChangePassword) {
        ChangePasswordSheet(
            api = App.instance.api,
            onDismiss = { showChangePassword = false },
            onSuccess = {
                showChangePassword = false
                scope.launch {
                    snackbarHostState.showSnackbar(context.getString(R.string.set_password_changed_successfully))
                }
            },
        )
    }

    // PATCH /api/v1/auth/me. AuthStore republishes the user, so the card above
    // and the "Tên hiển thị" row both show the saved name right away.
    if (showProfileEdit && currentUser != null) {
        ProfileEditSheet(
            auth = auth,
            initialName = currentUser.name.orEmpty(),
            onDismiss = { showProfileEdit = false },
            onSuccess = { message ->
                showProfileEdit = false
                snack(message)
            },
        )
    }

    if (showLanguage) {
        LanguageSheet(
            auth = auth,
            languageStore = App.instance.languageStore,
            onDismiss = { showLanguage = false },
        )
    }

    // Step 2 of the email change revokes EVERY session server-side, so the local
    // bearer token is dead the moment `onConfirmed` fires. `endLocalSession`
    // drops it without a request (the next call would be a 401) and RootScreen
    // shows the login screen — the same route delete-account takes.
    if (showEmailChange && currentUser != null) {
        EmailChangeSheet(
            auth = auth,
            currentEmail = currentUser.email,
            onDismiss = { showEmailChange = false },
            onConfirmed = {
                showEmailChange = false
                auth.endLocalSession()
            },
        )
    }
}

@Composable
private fun SettingsRow(
    icon: ImageVector,
    title: String,
    subtitle: String? = null,
    onClick: (() -> Unit)? = null,
    trailing: @Composable (() -> Unit)? = null,
    showDivider: Boolean = false,
) {
    val cs = MaterialTheme.colorScheme
    Column {
        Row(
            Modifier
                .fillMaxWidth()
                .let { if (onClick != null) it.clickable(onClick = onClick) else it }
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(cs.primary.copy(alpha = 0.10f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, null, tint = cs.primary, modifier = Modifier.size(22.dp))
            }
            Spacer(Modifier.size(12.dp))
            Column(
                Modifier.weight(1f),
                verticalArrangement = Arrangement.Center,
            ) {
                Text(
                    title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    color = cs.onSurface,
                )
                if (subtitle != null) {
                    Text(
                        subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = cs.onSurfaceVariant,
                    )
                }
            }
            if (trailing != null) trailing()
        }
        if (showDivider) {
            androidx.compose.material3.HorizontalDivider(
                color = cs.outlineVariant.copy(alpha = 0.5f),
                modifier = Modifier.padding(start = 68.dp),
            )
        }
    }
}

/**
 * The app-lock row's subtitle, in priority order — exactly the order the iOS
 * `AccountView.appLockDetail` uses:
 *
 *  1. the last failure ("Xác thực không thành công. Thử lại.") — it explains a
 *     switch that visibly refused to move;
 *  2. the one-shot self-disabled notice (the device lost its screen lock);
 *  3. "đang bật" when on;
 *  4. the reason it cannot be enabled (no credential / no sensor / not enrolled);
 *  5. "đang tắt".
 */
@Composable
private fun appLockSubtitle(
    enabled: Boolean,
    availability: AppLockAvailability,
    failure: AppLockFailure?,
    notice: AppLockNotice?,
): String {
    failure?.let { return stringResource(it.messageRes()) }
    notice?.let { return stringResource(it.messageRes()) }
    if (enabled) return stringResource(R.string.app_lock_row_subtitle_on)
    availability.unavailable?.let { return stringResource(it.messageRes()) }
    return stringResource(R.string.app_lock_row_subtitle_off)
}

private fun iconFor(pref: ThemePreference): ImageVector = when (pref) {
    ThemePreference.System -> Icons.Filled.SettingsBrightness
    ThemePreference.Light  -> Icons.Filled.LightMode
    ThemePreference.Dark   -> Icons.Filled.DarkMode
}
