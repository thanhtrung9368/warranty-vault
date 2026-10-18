package com.warrly.ui.screens.inbox

import android.net.Uri
import android.text.format.Formatter
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.outlined.Inbox
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
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.warrly.R
import com.warrly.i18n.appStrings
import com.warrly.network.ApiClient
import com.warrly.network.ApiService
import com.warrly.network.Attachment
import com.warrly.network.Device
import com.warrly.network.DeviceStatus
import com.warrly.network.FileAttachmentInput
import com.warrly.network.toUserMessage
import com.warrly.share.ShareTarget
import com.warrly.share.SharedFile
import com.warrly.ui.components.EmptyState
import com.warrly.ui.components.ErrorState
import com.warrly.ui.components.PageHeader
import com.warrly.ui.components.SkeletonList
import com.warrly.ui.screens.attachments.PickedAttachment
import com.warrly.ui.screens.attachments.readPickedAttachment
import com.warrly.ui.viewModelFactory
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

// ─── ViewModel ────────────────────────────────────────────────────────────────

/**
 * `GET /api/v1/inbox` plus the write paths that change it: uploading a shared
 * file, filing an item on a device and deleting one.
 *
 * Reading a content-provider `Uri` still happens in the composable — that needs
 * a `Context`, which a ViewModel must not hold. But once the Activity has turned
 * a share into bytes, the **upload** lives here: this view model is scoped to
 * the activity, so switching tabs mid-upload cannot cancel the request the way
 * `rememberCoroutineScope()` would. The bytes are passed in as a [SharedFile];
 * a failure stays visible in [sharedError] and the caller keeps the pending
 * file, so the user can retry.
 */
class InboxViewModel(private val api: ApiService) : ViewModel() {
    sealed interface State {
        data object Loading : State
        data class Loaded(val attachments: List<Attachment>) : State
        data class Error(val message: String) : State
    }

    /**
     * A filing attempt the server refused with **409 `LIMIT_REACHED`**. The
     * screen turns this into the dialog that offers the two ways out; keeping
     * the failed [attachment] and the target's [deviceName] here means the
     * dialog can name both without re-deriving them from a list that may have
     * changed.
     */
    data class DeviceFull(val attachment: Attachment, val deviceName: String)

    private val _state = MutableStateFlow<State>(State.Loading)
    val state: StateFlow<State> = _state.asStateFlow()

    /** Set only by the DEVICE_FULL branch of [file]; cleared by the dialog. */
    private val _deviceFull = MutableStateFlow<DeviceFull?>(null)
    val deviceFull: StateFlow<DeviceFull?> = _deviceFull.asStateFlow()

    /**
     * One transient sentence for an action that failed for a reason other than
     * the full-device 409 (the server's translated message, or the localized
     * fallback). The upload path reports through [reportError] so the screen
     * still has a single place to show errors.
     */
    private val _actionMessage = MutableStateFlow<String?>(null)
    val actionMessage: StateFlow<String?> = _actionMessage.asStateFlow()

    private val _filing = MutableStateFlow(false)
    val filing: StateFlow<Boolean> = _filing.asStateFlow()

    /**
     * Uploading a file that arrived from another app's share sheet.
     *
     * Its own flag (rather than the local `uploading` in the composable) so the
     * request survives a tab switch and the progress is still correct when the
     * user comes back. [sharedError] is the visible failure: the pending file is
     * **not** consumed by this class, so a failed upload keeps the card and its
     * retry button on screen.
     */
    private val _sharedUploading = MutableStateFlow(false)
    val sharedUploading: StateFlow<Boolean> = _sharedUploading.asStateFlow()

    private val _sharedError = MutableStateFlow<String?>(null)
    val sharedError: StateFlow<String?> = _sharedError.asStateFlow()

    /**
     * `POST /api/v1/attachments` with **no `deviceId`** for a shared photo/PDF.
     *
     * [onUploaded] runs only after the server accepted the bytes; the screen
     * uses it to clear the pending share. On failure [sharedError] is set and
     * [onUploaded] is *not* called — the bytes stay in memory and the user can
     * retry rather than losing the share to a dead socket.
     */
    fun uploadShared(file: SharedFile, onUploaded: () -> Unit) {
        viewModelScope.launch {
            _sharedUploading.value = true
            _sharedError.value = null
            try {
                api.uploadAttachment(
                    PickedAttachment(
                        fileName = file.fileName,
                        mimeType = file.mimeType,
                        bytes = file.bytes,
                    ).toMultipart(),
                )
                onUploaded()
                // The row is now on the server; refresh the list behind the
                // disappearing confirmation card.
                load()
            } catch (e: Exception) {
                _sharedError.value = e.toUserMessage(ApiClient.json)
            } finally {
                _sharedUploading.value = false
            }
        }
    }

    /** Clears the failure line when the user discards the pending card. */
    fun dismissSharedError() {
        _sharedError.value = null
    }

    /**
     * Loads the inbox. A reload **keeps the current list on screen** while it
     * runs: this is a pull-to-refresh / post-write refresh, and swapping rows
     * for a skeleton on every file action would be worse than a stale second.
     */
    fun load() {
        viewModelScope.launch {
            if (_state.value !is State.Loaded) _state.value = State.Loading
            try {
                _state.value = State.Loaded(api.getInbox().attachments)
            } catch (e: Exception) {
                _state.value = State.Error(e.toUserMessage(ApiClient.json))
            }
        }
    }

    /**
     * `POST /api/v1/attachments/{id}/file`.
     *
     * A success removes the row locally (the item is no longer unfiled, so it
     * left this list) — no refetch needed. A 409 `LIMIT_REACHED` sets
     * [deviceFull] and leaves the row where it is, because the receipt was not
     * assigned to anything and the user still has to decide.
     */
    fun file(attachment: Attachment, device: Device) {
        viewModelScope.launch {
            _filing.value = true
            _deviceFull.value = null
            _actionMessage.value = null
            try {
                api.fileAttachment(attachment.id, FileAttachmentInput(device.id))
                removeLocally(attachment.id)
            } catch (e: Exception) {
                // One parse of the error body: it carries both the machine code
                // (`LIMIT_REACHED`) and the server's translated sentence, and the
                // body can only be read once.
                val error = inboxFileError(e, ApiClient.json)
                if (error.failure == InboxFileFailure.DEVICE_FULL) {
                    _deviceFull.value = DeviceFull(attachment, device.name)
                } else {
                    _actionMessage.value = error.serverMessage ?: e.toUserMessage(ApiClient.json)
                }
            } finally {
                _filing.value = false
            }
        }
    }

    /** `DELETE /api/v1/attachments/{id}` — also the "delete" way out of a 409. */
    fun delete(attachment: Attachment) {
        viewModelScope.launch {
            _actionMessage.value = null
            try {
                api.deleteAttachment(attachment.id)
                removeLocally(attachment.id)
            } catch (e: Exception) {
                _actionMessage.value = e.toUserMessage(ApiClient.json)
            }
        }
    }

    fun dismissDeviceFull() {
        _deviceFull.value = null
    }

    fun dismissActionMessage() {
        _actionMessage.value = null
    }

    /** The upload's error, routed through the same channel as the other actions. */
    fun reportError(message: String) {
        _actionMessage.value = message
    }

    private fun removeLocally(id: String) {
        val current = _state.value as? State.Loaded ?: return
        _state.value = current.copy(attachments = current.attachments.filterNot { it.id == id })
    }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

/**
 * The capture-first inbox: receipts saved **before** a device was chosen.
 *
 * ### Where the upload entry point lives, and why
 *
 * On this screen, above the list: "Add photo" / "Add PDF". The device detail's
 * attachment section cannot be the device-less entry point — it is scoped to a
 * device by construction — and the inbox is the only surface that exists
 * without one. Capture and its result therefore sit together: the user taps
 * once, the bytes go to `POST /api/v1/attachments` with no `deviceId`, and the
 * new row appears in the list below it. The empty state offers the same action
 * so the first capture has a call to action rather than a blank page.
 *
 * ### The 409
 *
 * Filing can fail because the target device already holds five attachments
 * (`409 LIMIT_REACHED`). That is not a generic error: it needs a way out. The
 * dialog names the device and offers exactly the two exits the contract allows —
 * pick another device, or delete the receipt.
 *
 * ### A share from another app
 *
 * A photo/PDF shared into Warrly reaches this screen as [sharedFile]: the bytes
 * were copied at intent time, and a card above the list offers "Save to inbox"
 * or "Discard". Confirmation (rather than an immediate upload) is deliberate —
 * the user sees what was shared before it becomes a row, and a failed upload
 * keeps the bytes and the error on screen so the share cannot be lost to an
 * invisible network failure.
 *
 * This is a tab of the shell (`ui/MainScreen.kt`) rather than a pushed route:
 * the inbox is a place you come back to and its badge is visible from every
 * other tab, not a detour like search.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(
    api: ApiService,
    /**
     * A file the Activity copied out of a live share URI, waiting for
     * confirmation. `null` = no share. The screen never consumes it directly:
     * [onSharedFileHandled] is called only after the server accepted the bytes
     * or the user explicitly discarded them.
     */
    sharedFile: SharedFile? = null,
    onSharedFileHandled: (SharedFile) -> Unit = {},
    /** The shell's nav badge; `null` means "hide the bubble". */
    onCountChanged: (Int?) -> Unit = {},
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val vm: InboxViewModel = viewModel(
        factory = viewModelFactory { InboxViewModel(api) },
    )
    val state by vm.state.collectAsState()
    val deviceFull by vm.deviceFull.collectAsState()
    val actionMessage by vm.actionMessage.collectAsState()
    val filing by vm.filing.collectAsState()
    val sharedUploading by vm.sharedUploading.collectAsState()
    val sharedError by vm.sharedError.collectAsState()

    var refreshing by remember { mutableStateOf(false) }
    var uploading by remember { mutableStateOf(false) }
    // The item a device picker is currently open for; null = no sheet.
    var pickerFor by remember { mutableStateOf<Attachment?>(null) }
    var devices by remember { mutableStateOf<List<Device>>(emptyList()) }
    var devicesLoading by remember { mutableStateOf(false) }
    var devicesError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { vm.load() }

    // A new share (or a discard) must not inherit the previous file's failure
    // sentence. Keyed on the file itself, not on every recomposition.
    LaunchedEffect(sharedFile) { vm.dismissSharedError() }

    // Keep the shell's badge in step with the list on screen. A successful
    // upload/file/delete changes this list, so this one effect covers all three
    // without a second network call. `null` at zero hides the bubble.
    val loadedAttachments = (state as? InboxViewModel.State.Loaded)?.attachments
    LaunchedEffect(loadedAttachments) {
        if (loadedAttachments != null) onCountChanged(inboxBadgeCount(loadedAttachments))
    }

    // A successful file call removes the row; close the picker that produced it.
    LaunchedEffect(loadedAttachments, pickerFor) {
        val target = pickerFor ?: return@LaunchedEffect
        if (loadedAttachments != null && loadedAttachments.none { it.id == target.id }) {
            pickerFor = null
        }
    }

    // The 409 dialog takes over from the picker: the sheet would hide the two
    // choices the user now has to make.
    LaunchedEffect(deviceFull) {
        if (deviceFull != null) pickerFor = null
    }

    fun startUpload(uri: Uri) {
        scope.launch {
            uploading = true
            vm.dismissActionMessage()
            try {
                val picked = readPickedAttachment(context, uri)
                // No `deviceId` part: the server stores it as an inbox item.
                api.uploadAttachment(picked.toMultipart())
                vm.load()
            } catch (e: Exception) {
                // The reader throws a localized sentence for "too large" / "could
                // not read"; `localizedMessage` is that sentence.
                vm.reportError(e.toUserMessage(ApiClient.json, context))
            } finally {
                uploading = false
            }
        }
    }

    fun openPicker(attachment: Attachment) {
        pickerFor = attachment
        devicesLoading = true
        devicesError = null
        scope.launch {
            try {
                // A sold device is not a place for a new receipt; everything else
                // (broken, lost, expired) can still own its paperwork.
                devices = api.listDevices().devices.filter { it.status != DeviceStatus.SOLD }
            } catch (e: Exception) {
                devicesError = e.toUserMessage(ApiClient.json, context)
            } finally {
                devicesLoading = false
            }
        }
    }

    val photoPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri -> if (uri != null) startUpload(uri) }

    val pdfPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri -> if (uri != null) startUpload(uri) }

    Scaffold(containerColor = MaterialTheme.colorScheme.background) { padding ->
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
                is InboxViewModel.State.Loading -> Column {
                    PageHeader(
                        stringResource(R.string.nav_inbox),
                        stringResource(R.string.inbox_subtitle),
                    )
                    SkeletonList(count = 3)
                }

                is InboxViewModel.State.Error -> ErrorState(
                    icon = Icons.Outlined.WarningAmber,
                    title = stringResource(R.string.dash_could_not_load_it),
                    body = st.message,
                    onRetry = { vm.load() },
                )

                is InboxViewModel.State.Loaded -> InboxBody(
                    attachments = st.attachments,
                    uploading = uploading,
                    sharedFile = sharedFile,
                    sharedUploading = sharedUploading,
                    sharedError = sharedError,
                    actionMessage = actionMessage,
                    onDismissMessage = { vm.dismissActionMessage() },
                    onSaveShared = { file ->
                        // Consume only after the server accepted the bytes; a
                        // failure keeps the card (and the bytes) for a retry.
                        vm.uploadShared(file) { onSharedFileHandled(file) }
                    },
                    onDiscardShared = { file ->
                        vm.dismissSharedError()
                        onSharedFileHandled(file)
                    },
                    onAddPhoto = {
                        photoPicker.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                        )
                    },
                    onAddPdf = { pdfPicker.launch(arrayOf("application/pdf")) },
                    onAssign = { openPicker(it) },
                    onDelete = { vm.delete(it) },
                )
            }
        }
    }

    pickerFor?.let { attachment ->
        DevicePickerSheet(
            attachment = attachment,
            devices = devices,
            loading = devicesLoading,
            error = devicesError,
            filing = filing,
            onPick = { device -> vm.file(attachment, device) },
            onRetry = { openPicker(attachment) },
            onDismiss = { pickerFor = null },
        )
    }

    deviceFull?.let { full ->
        val s = appStrings()
        AlertDialog(
            onDismissRequest = { vm.dismissDeviceFull() },
            icon = {
                Icon(
                    Icons.Outlined.WarningAmber,
                    null,
                    tint = MaterialTheme.colorScheme.error,
                )
            },
            title = { Text(stringResource(R.string.inbox_device_full_title)) },
            // The sentence names the device, the five-file cap AND both exits —
            // the server's own 409 message explains the conflict but not what to
            // do next.
            text = {
                Text(
                    inboxFileFailureMessage(s, InboxFileFailure.DEVICE_FULL, full.deviceName)
                        .orEmpty(),
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        vm.dismissDeviceFull()
                        openPicker(full.attachment)
                    },
                ) {
                    Text(stringResource(R.string.inbox_pick_another_device))
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        vm.dismissDeviceFull()
                        vm.delete(full.attachment)
                    },
                ) {
                    Text(stringResource(R.string.inbox_delete_receipt))
                }
            },
        )
    }
}

@Composable
private fun InboxBody(
    attachments: List<Attachment>,
    uploading: Boolean,
    sharedFile: SharedFile?,
    sharedUploading: Boolean,
    sharedError: String?,
    actionMessage: String?,
    onDismissMessage: () -> Unit,
    onSaveShared: (SharedFile) -> Unit,
    onDiscardShared: (SharedFile) -> Unit,
    onAddPhoto: () -> Unit,
    onAddPdf: () -> Unit,
    onAssign: (Attachment) -> Unit,
    onDelete: (Attachment) -> Unit,
) {
    val s = appStrings()
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 0.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            PageHeader(
                stringResource(R.string.nav_inbox),
                stringResource(R.string.inbox_subtitle),
            )
        }

        // A file shared from another app, already copied out of its URI and
        // waiting for confirmation. It sits above the capture buttons because
        // it is the freshest user action and the only one with unsaved bytes.
        sharedFile?.let { file ->
            item {
                SharedFileCard(
                    file = file,
                    uploading = sharedUploading,
                    error = sharedError,
                    onSave = { onSaveShared(file) },
                    onDiscard = { onDiscardShared(file) },
                )
            }
        }

        // The capture entry point. It is here — not on the device detail — because
        // this is the one screen that exists without a device to upload to.
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = onAddPhoto,
                    enabled = !uploading && !sharedUploading,
                    modifier = Modifier.weight(1f),
                ) {
                    Icon(Icons.Filled.Image, null)
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.att_add_photo))
                }
                OutlinedButton(
                    onClick = onAddPdf,
                    enabled = !uploading && !sharedUploading,
                    modifier = Modifier.weight(1f),
                ) {
                    Icon(Icons.Filled.PictureAsPdf, null)
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.att_add_pdf))
                }
            }
        }

        if (uploading) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.att_uploading), fontSize = 13.sp)
                }
            }
        }

        actionMessage?.let { message ->
            item { InboxErrorCard(message = message, onDismiss = onDismissMessage) }
        }

        if (attachments.isEmpty() && !uploading && sharedFile == null) {
            item {
                EmptyState(
                    icon = Icons.Outlined.Inbox,
                    title = stringResource(R.string.inbox_empty_title),
                    body = stringResource(R.string.inbox_empty_body),
                    ctaLabel = stringResource(R.string.att_add_photo),
                    onCta = onAddPhoto,
                )
            }
        } else {
            items(attachments, key = { it.id }) { attachment ->
                InboxCard(
                    attachment = attachment,
                    uploadedLabel = inboxUploadedLabel(s, attachment.uploadedAt),
                    enabled = !uploading,
                    onAssign = { onAssign(attachment) },
                    onDelete = { onDelete(attachment) },
                )
            }
        }
    }
}

/**
 * The confirmation card for a photo/PDF shared from another app.
 *
 * It shows the file **before** it is in the inbox, and it is deliberately not a
 * dismissible modal: a swipe-away would lose a file whose content URI is already
 * gone, with no trace. Saving and discarding are both explicit buttons. On
 * failure the error line stays inside the card and "Save to inbox" remains
 * available — the bytes are still in memory (see `SharedFile`).
 */
@Composable
private fun SharedFileCard(
    file: SharedFile,
    uploading: Boolean,
    error: String?,
    onSave: () -> Unit,
    onDiscard: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    val context = LocalContext.current
    val isPdf = ShareTarget.baseMime(file.mimeType) == ShareTarget.MIME_TYPE_PDF

    Card(
        colors = CardDefaults.cardColors(containerColor = cs.primaryContainer),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    if (isPdf) Icons.Filled.PictureAsPdf else Icons.Filled.Image,
                    null,
                    tint = cs.primary,
                )
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        stringResource(R.string.inbox_shared_file_title),
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = cs.onPrimaryContainer,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        stringResource(
                            R.string.inbox_shared_file_body,
                            file.fileName,
                            Formatter.formatShortFileSize(context, file.sizeBytes),
                        ),
                        fontSize = 12.sp,
                        color = cs.onPrimaryContainer,
                    )
                }
            }

            if (uploading) {
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.inbox_shared_file_uploading), fontSize = 13.sp)
                }
            }

            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, fontSize = 12.sp, color = cs.error)
            }

            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = onSave,
                    enabled = !uploading,
                    modifier = Modifier.weight(1f),
                ) {
                    Text(stringResource(R.string.inbox_shared_file_save))
                }
                TextButton(onClick = onDiscard, enabled = !uploading) {
                    Text(stringResource(R.string.inbox_shared_file_discard))
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InboxCard(
    attachment: Attachment,
    uploadedLabel: String?,
    enabled: Boolean,
    onAssign: () -> Unit,
    onDelete: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        border = BorderStroke(1.dp, cs.outline),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AttachmentThumbnail(attachment)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        attachment.fileName,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = cs.onSurface,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    uploadedLabel?.let {
                        Text(it, fontSize = 12.sp, color = cs.onSurfaceVariant)
                    }
                    if (!attachment.description.isNullOrBlank()) {
                        Text(
                            attachment.description,
                            fontSize = 12.sp,
                            color = cs.onSurfaceVariant,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                IconButton(onClick = onDelete) {
                    Icon(
                        Icons.Filled.Delete,
                        stringResource(R.string.action_delete),
                        tint = cs.error,
                    )
                }
            }

            Spacer(Modifier.height(10.dp))
            OutlinedButton(
                onClick = onAssign,
                enabled = enabled,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Filled.Devices, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.inbox_assign_to_device))
            }
        }
    }
}

/**
 * The picker for "Gán vào thiết bị". It is a sheet rather than a dropdown
 * because the list is user data (up to 50 active devices) and each row has to
 * carry its own slot count; a menu would be a scrollable popup on top of a
 * scrollable screen.
 *
 * The `n/5` count is a **hint**, not a block: `Device.attachmentCount` is a list
 * projection that can be stale or absent, so a full-looking row is still
 * selectable and the server's 409 is what actually decides. Hiding that path
 * would also hide the dialog that tells the user what to do next.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DevicePickerSheet(
    attachment: Attachment,
    devices: List<Device>,
    loading: Boolean,
    error: String?,
    filing: Boolean,
    onPick: (Device) -> Unit,
    onRetry: () -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val cs = MaterialTheme.colorScheme

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        // One LazyColumn for the whole sheet, not a Column wrapping a second
        // one: the header is small, the device list is user data, and a nested
        // scroll inside an unbounded Column is the classic clipped-sheet bug.
        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 560.dp),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Text(
                    stringResource(R.string.inbox_pick_device_title),
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            item {
                Text(
                    attachment.fileName,
                    fontSize = 13.sp,
                    color = cs.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            item {
                Text(
                    stringResource(R.string.inbox_pick_device_subtitle),
                    fontSize = 13.sp,
                    color = cs.onSurfaceVariant,
                )
            }

            when {
                loading -> item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(
                            strokeWidth = 2.dp,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.inbox_loading_devices), fontSize = 13.sp)
                    }
                }

                error != null -> item {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            stringResource(R.string.inbox_could_not_load_devices),
                            color = cs.error,
                            fontSize = 13.sp,
                        )
                        Text(error, color = cs.onSurfaceVariant, fontSize = 12.sp)
                        TextButton(onClick = onRetry) {
                            Text(stringResource(R.string.action_retry))
                        }
                    }
                }

                devices.isEmpty() -> item {
                    Text(
                        stringResource(R.string.inbox_no_devices_to_pick),
                        fontSize = 13.sp,
                        color = cs.onSurfaceVariant,
                    )
                }

                else -> {
                    if (filing) {
                        item {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                CircularProgressIndicator(
                                    strokeWidth = 2.dp,
                                    modifier = Modifier.size(16.dp),
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(stringResource(R.string.inbox_assigning), fontSize = 13.sp)
                            }
                        }
                    }
                    items(devices, key = { it.id }) { device ->
                        DevicePickRow(
                            device = device,
                            enabled = !filing,
                            onClick = { onPick(device) },
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DevicePickRow(
    device: Device,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    val full = inboxDeviceIsFull(device)
    Card(
        onClick = onClick,
        enabled = enabled,
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        border = BorderStroke(1.dp, cs.outline),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Devices, null, tint = cs.primary)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    device.name,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = cs.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                device.brand?.takeIf { it.isNotBlank() }?.let {
                    Text(it, fontSize = 12.sp, color = cs.onSurfaceVariant)
                }
            }
            Text(
                pluralStringResource(
                    R.plurals.inbox_device_slots,
                    device.attachmentCount,
                    device.attachmentCount,
                    MAX_ATTACHMENTS_PER_DEVICE,
                ),
                fontSize = 12.sp,
                fontWeight = if (full) FontWeight.SemiBold else FontWeight.Normal,
                color = if (full) cs.error else cs.onSurfaceVariant,
            )
        }
    }
}

/** Inline failure for anything that is not the full-device 409. */
@Composable
private fun InboxErrorCard(message: String, onDismiss: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.errorContainer),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.WarningAmber, null, tint = cs.onErrorContainer)
            Spacer(Modifier.width(8.dp))
            Text(
                message,
                color = cs.onErrorContainer,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.action_close))
            }
        }
    }
}
