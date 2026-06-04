package com.warrantyvault.app.ui.screens.devices

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import com.warrantyvault.app.App
import com.warrantyvault.app.BuildConfig
import com.warrantyvault.app.network.ApiClient
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.Attachment
import com.warrantyvault.app.network.toUserMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File

@Composable
fun AttachmentsSection(api: ApiService, deviceId: String) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var items by remember { mutableStateOf<List<Attachment>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var uploading by remember { mutableStateOf(false) }

    suspend fun reload() {
        loading = true
        try {
            items = api.listAttachments(deviceId).attachments
            error = null
        } catch (e: Exception) {
            error = e.toUserMessage(ApiClient.json)
        } finally {
            loading = false
        }
    }

    LaunchedEffect(deviceId) { reload() }

    val photoPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri ->
        if (uri != null) {
            scope.launch {
                uploading = true
                try {
                    uploadFromUri(context, api, deviceId, uri)
                    reload()
                } catch (e: Exception) {
                    error = e.toUserMessage(ApiClient.json)
                } finally {
                    uploading = false
                }
            }
        }
    }

    val pdfPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) {
            scope.launch {
                uploading = true
                try {
                    uploadFromUri(context, api, deviceId, uri)
                    reload()
                } catch (e: Exception) {
                    error = e.toUserMessage(ApiClient.json)
                } finally {
                    uploading = false
                }
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Description, null,
                tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(8.dp))
            Text("Tài liệu / Ảnh đính kèm",
                fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            Text("${items.size}/5",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                onClick = {
                    photoPicker.launch(
                        PickVisualMediaRequest(
                            ActivityResultContracts.PickVisualMedia.ImageOnly,
                        ),
                    )
                },
                enabled = !uploading,
                modifier = Modifier.weight(1f),
            ) {
                Icon(Icons.Filled.Image, null)
                Spacer(Modifier.width(6.dp))
                Text("Thêm ảnh")
            }
            OutlinedButton(
                onClick = { pdfPicker.launch(arrayOf("application/pdf")) },
                enabled = !uploading,
                modifier = Modifier.weight(1f),
            ) {
                Icon(Icons.Filled.PictureAsPdf, null)
                Spacer(Modifier.width(6.dp))
                Text("Thêm PDF")
            }
        }

        if (uploading) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(
                    strokeWidth = 2.dp,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text("Đang tải lên...", fontSize = 13.sp)
            }
        }

        error?.let {
            Text(
                it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp,
            )
        }

        when {
            loading && items.isEmpty() -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text("Đang tải...", fontSize = 13.sp)
                }
            }
            items.isEmpty() -> {
                Text(
                    "Chưa có tài liệu đính kèm.",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            else -> {
                items.forEach { att ->
                    AttachmentRow(
                        att,
                        onOpen = {
                            scope.launch {
                                try {
                                    openAttachment(context, att)
                                } catch (e: Exception) {
                                    error = e.toUserMessage(ApiClient.json)
                                }
                            }
                        },
                        onDelete = {
                            scope.launch {
                                try {
                                    api.deleteAttachment(att.id)
                                    reload()
                                } catch (e: Exception) {
                                    error = e.toUserMessage(ApiClient.json)
                                }
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun AttachmentRow(
    att: Attachment,
    onOpen: () -> Unit,
    onDelete: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    val isImage = att.fileType.startsWith("image/")
    Card(
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        border = BorderStroke(1.dp, cs.outline),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(cs.primary.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (isImage) Icons.Filled.Image else Icons.Filled.PictureAsPdf,
                    null, tint = cs.primary,
                )
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    att.fileName, fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold, color = cs.onSurface,
                )
                Text(
                    formatBytes(att.fileSize),
                    fontSize = 12.sp, color = cs.onSurfaceVariant,
                )
            }
            IconButton(onClick = onOpen) {
                Icon(Icons.AutoMirrored.Filled.OpenInNew, "Mở", tint = cs.primary)
            }
            IconButton(onClick = onDelete) {
                Icon(Icons.Filled.Delete, "Xoá", tint = cs.error)
            }
        }
    }
}

private fun formatBytes(b: Long): String {
    if (b < 1024) return "$b B"
    if (b < 1024 * 1024) return "${b / 1024} KB"
    return String.format(java.util.Locale.US, "%.1f MB", b / (1024.0 * 1024.0))
}

// Reads the picked URI in chunks and uploads as multipart/form-data. We pull
// the bytes through OkHttp's RequestBody so the whole file isn't held in
// memory, but for an MVP simple readBytes is fine — backend caps at 5 MB.
private suspend fun uploadFromUri(
    context: Context,
    api: ApiService,
    deviceId: String,
    uri: Uri,
) {
    val resolver = context.contentResolver
    val mime = resolver.getType(uri) ?: "application/octet-stream"
    val name = queryDisplayName(context, uri) ?: "file"
    val bytes = withContext(Dispatchers.IO) {
        resolver.openInputStream(uri)?.use { it.readBytes() }
    } ?: throw IllegalStateException("Không đọc được file")

    val body: RequestBody = bytes.toRequestBody(mime.toMediaTypeOrNull())
    val part = MultipartBody.Part.createFormData("file", name, body)
    api.uploadAttachment(deviceId, part, null)
}

private fun queryDisplayName(context: Context, uri: Uri): String? {
    return runCatching {
        context.contentResolver.query(uri, null, null, null, null)?.use { c ->
            val idx = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            if (idx >= 0 && c.moveToFirst()) c.getString(idx) else null
        }
    }.getOrNull()
}

// Downloads encrypted attachment via authenticated GET, writes to cache, then
// hands off to a viewer via FileProvider — required because /api/files/:id
// needs a Bearer token and the system Intent.ACTION_VIEW can't carry headers.
private suspend fun openAttachment(context: Context, att: Attachment) {
    val token = App.instance.tokenStore.read()
        ?: throw IllegalStateException("Chưa đăng nhập")
    val url = "${BuildConfig.BASE_URL.trimEnd('/')}/api/files/${att.id}"

    val cacheDir = File(context.cacheDir, "attachments").apply { mkdirs() }
    val outFile = File(cacheDir, sanitize(att.fileName))

    withContext(Dispatchers.IO) {
        val client = ApiClient.fileClient
        val req = Request.Builder()
            .url(url)
            .addHeader("Authorization", "Bearer $token")
            .build()
        client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) {
                throw IllegalStateException("Tải về thất bại (${resp.code})")
            }
            resp.body?.byteStream()?.use { input ->
                outFile.outputStream().use { out -> input.copyTo(out) }
            } ?: throw IllegalStateException("Không có dữ liệu")
        }
    }

    val authority = "${context.packageName}.fileprovider"
    val contentUri: Uri = FileProvider.getUriForFile(context, authority, outFile)
    val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(contentUri, att.fileType)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    try {
        context.startActivity(intent)
    } catch (e: ActivityNotFoundException) {
        Log.w("Attachments", "no viewer", e)
        Toast.makeText(context,
            "Không có ứng dụng mở file ${att.fileType}",
            Toast.LENGTH_SHORT).show()
    }
}

private fun sanitize(name: String): String =
    name.replace(Regex("[^A-Za-z0-9._-]"), "_").take(120)
