package com.warrantyvault.app.ui.screens.settings

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
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material.icons.filled.SettingsBrightness
import androidx.compose.material.icons.filled.TableChart
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.warrantyvault.app.App
import com.warrantyvault.app.BuildConfig
import com.warrantyvault.app.auth.AuthStore
import com.warrantyvault.app.export.csvFileName
import com.warrantyvault.app.export.devicesCsvBytes
import com.warrantyvault.app.network.AIOptInRequest
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.toUserMessage
import com.warrantyvault.app.ui.components.PageHeader
import com.warrantyvault.app.ui.components.SectionHeader
import com.warrantyvault.app.ui.theme.ThemePreference
import com.warrantyvault.app.ui.theme.ThemeStore
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    auth: AuthStore,
    themeStore: ThemeStore,
    api: ApiService,
    onOpenPushDevices: () -> Unit = {},
) {
    val status by auth.status.collectAsState()
    val themePref by themeStore.preference.collectAsState()
    val cs = MaterialTheme.colorScheme
    var showChangePassword by rememberSaveable { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

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
                snack("Đã sao lưu ra file JSON")
            } catch (e: Exception) {
                snack("Không sao lưu được: ${e.toUserMessage(ApiClient.json)}")
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
                snack("Đã xuất $pendingCsvCount thiết bị ra file CSV")
            } catch (e: Exception) {
                snack("Không xuất được CSV: ${e.toUserMessage(ApiClient.json)}")
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
                    snack("Không có thiết bị nào để xuất")
                    return@launch
                }
                // Fetch + serialise before opening the picker: an empty list or a
                // network error then costs the user nothing, and the bytes carry
                // the UTF-8 BOM Excel needs (see CsvExport.kt).
                pendingCsv = devicesCsvBytes(devices)
                pendingCsvCount = devices.size
                csvLauncher.launch(csvFileName())
            } catch (e: Exception) {
                snack("Không xuất được CSV: ${e.toUserMessage(ApiClient.json)}")
            } finally {
                csvBusy = false
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
                    "Đã nhập ${res.imported} thiết bị, ${res.subImported} gói, " +
                        "${res.wishlistImported} mục" +
                        if (skipped > 0) " · bỏ qua $skipped bản trùng" else "",
                )
            } catch (e: Exception) {
                snack("Nhập thất bại: ${e.toUserMessage(ApiClient.json)}")
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
            PageHeader("Cài đặt", "Cá nhân hoá tài khoản & giao diện của mày")

            // Profile card
            (status as? AuthStore.Status.Authenticated)?.user?.let { user ->
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
                                user.name ?: user.email,
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

            Spacer(Modifier.height(16.dp))
            Box(Modifier.padding(horizontal = 16.dp)) {
                SectionHeader("Giao diện")
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
                    ThemePreference.entries.forEachIndexed { index, pref ->
                        SettingsRow(
                            icon = iconFor(pref),
                            title = pref.label,
                            onClick = { themeStore.set(pref) },
                            trailing = {
                                RadioButton(
                                    selected = themePref == pref,
                                    onClick = { themeStore.set(pref) },
                                )
                            },
                            showDivider = index < ThemePreference.entries.size - 1,
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            Box(Modifier.padding(horizontal = 16.dp)) {
                SectionHeader("Tài khoản")
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
                        title = "Đổi mật khẩu",
                        subtitle = "Cập nhật mật khẩu đăng nhập của mày.",
                        onClick = { showChangePassword = true },
                        showDivider = true,
                    )
                    SettingsRow(
                        icon = Icons.Filled.Notifications,
                        title = "Thiết bị nhận thông báo",
                        subtitle = "Quản lý các thiết bị đăng ký push notification.",
                        onClick = onOpenPushDevices,
                        showDivider = false,
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            Box(Modifier.padding(horizontal = 16.dp)) {
                SectionHeader("Quét hoá đơn (AI)")
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
                                "Quét hoá đơn bằng AI",
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                "Ảnh hoá đơn sẽ được gửi (đã giải mã) tới dịch vụ AI bên thứ ba để tự điền. Luôn kiểm tra lại trước khi lưu. Mặc định tắt.",
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
                                            if (res.aiOptIn) "Đã bật quét hoá đơn AI"
                                            else "Đã tắt quét hoá đơn AI",
                                        )
                                    } catch (e: Exception) {
                                        // Never fail silently here: flipping back
                                        // with no explanation reads as a bug, and
                                        // the web toasts the server message.
                                        snack(
                                            "Không cập nhật được cài đặt: " +
                                                e.toUserMessage(ApiClient.json),
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
                SectionHeader("Dữ liệu")
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
                        title = if (backupBusy) "Đang xử lý…" else "Sao lưu (xuất JSON)",
                        subtitle = "Tải toàn bộ thiết bị, gói & wishlist ra 1 file JSON.",
                        onClick = {
                            if (!backupBusy) exportLauncher.launch("warrantyvault-backup.json")
                        },
                        showDivider = true,
                    )
                    SettingsRow(
                        icon = Icons.Filled.TableChart,
                        title = if (csvBusy) "Đang xử lý…" else "Xuất CSV (Excel)",
                        subtitle = "Tải danh sách thiết bị ra file CSV (UTF-8) để mở bằng Excel / Google Sheets.",
                        onClick = { startCsvExport() },
                        showDivider = true,
                    )
                    SettingsRow(
                        icon = Icons.Filled.Restore,
                        title = "Khôi phục từ sao lưu",
                        subtitle = "Nhập lại dữ liệu từ file JSON đã xuất.",
                        onClick = { if (!backupBusy) showImportModeDialog = true },
                        showDivider = false,
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            Box(Modifier.padding(horizontal = 16.dp)) {
                SectionHeader("Hệ thống")
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
                    "Đăng xuất",
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
                    "Xoá tài khoản",
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
            title = { Text("Khôi phục từ sao lưu") },
            text = {
                Text(
                    "“Gộp” thêm dữ liệu từ file vào dữ liệu hiện có. " +
                        "“Thay thế” XOÁ TOÀN BỘ dữ liệu hiện tại trước khi nạp — không thể hoàn tác.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    pendingImportMode = "merge"
                    showImportModeDialog = false
                    importLauncher.launch(arrayOf("application/json"))
                }) { Text("Gộp (merge)") }
            },
            dismissButton = {
                TextButton(onClick = {
                    pendingImportMode = "replace"
                    showImportModeDialog = false
                    importLauncher.launch(arrayOf("application/json"))
                }) { Text("Thay thế", color = cs.error) }
            },
        )
    }

    // Delete-account confirmation (requires current password).
    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { if (!deleteBusy) showDeleteDialog = false },
            title = { Text("Xoá tài khoản?") },
            text = {
                Column {
                    Text(
                        "Toàn bộ thiết bị, hoá đơn, ảnh BH và cài đặt sẽ bị xoá vĩnh viễn — " +
                            "không thể hoàn tác. Nhập mật khẩu để xác nhận.",
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = deletePassword,
                        onValueChange = { deletePassword = it },
                        label = { Text("Mật khẩu hiện tại") },
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
                                deleteError = e.toUserMessage(ApiClient.json)
                            } finally {
                                deleteBusy = false
                                if (deleteError == null) showDeleteDialog = false
                            }
                        }
                    },
                ) { Text(if (deleteBusy) "Đang xoá…" else "Xoá vĩnh viễn", color = cs.error) }
            },
            dismissButton = {
                TextButton(enabled = !deleteBusy, onClick = { showDeleteDialog = false }) {
                    Text("Huỷ")
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
                    snackbarHostState.showSnackbar("Đã đổi mật khẩu thành công")
                }
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

private fun iconFor(pref: ThemePreference): ImageVector = when (pref) {
    ThemePreference.System -> Icons.Filled.SettingsBrightness
    ThemePreference.Light  -> Icons.Filled.LightMode
    ThemePreference.Dark   -> Icons.Filled.DarkMode
}
