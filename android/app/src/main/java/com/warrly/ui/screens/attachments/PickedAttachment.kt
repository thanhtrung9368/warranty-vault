package com.warrly.ui.screens.attachments

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.warrly.R
import com.warrly.ui.screens.devices.isAttachmentTooLarge
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * A file the user picked from the photo picker or the document picker, already
 * read into memory and checked against the 5 MB cap.
 *
 * ### Why this is shared
 *
 * Two upload paths exist now: the device detail's attachment section
 * (`POST /api/v1/devices/{id}/attachments`) and the capture-first inbox
 * (`POST /api/v1/attachments`, no `deviceId`). Both have to read the same
 * content-provider URI, honour the same provider-reported size, apply the same
 * cap *before* opening the stream, and build the same `file` multipart part.
 * Copying that into a second screen is how the two paths end up disagreeing on
 * the boundary byte — and `AttachmentLimits.kt` is the one place that boundary
 * is already decided.
 *
 * ### The cap is checked twice, on purpose
 *
 * [declaredSize] is what the content provider claims; it is checked first so an
 * oversized file is refused in milliseconds instead of after a multi-minute
 * upload. Some providers report no size at all, so the bytes that actually
 * arrived are checked again. Exactly `MAX_ATTACHMENT_BYTES` is allowed — the Go
 * service's check is `size > max`.
 */
internal data class PickedAttachment(
    val fileName: String,
    val mimeType: String,
    val bytes: ByteArray,
) {
    /** The multipart part every upload endpoint expects, under the field `file`. */
    fun toMultipart(): MultipartBody.Part {
        val body: RequestBody = bytes.toRequestBody(mimeType.toMediaTypeOrNull())
        return MultipartBody.Part.createFormData("file", fileName, body)
    }
}

/**
 * Reads [uri] and returns its bytes plus the metadata the request needs.
 *
 * [fallbackMimeType] is used only when the content provider reports **no type
 * or the opaque `application/octet-stream`** — the shape some document
 * providers use for a perfectly readable PDF. It is the share intent's declared
 * type, which is more informative than the generic fallback. Callers that do
 * not have one (the photo/document picker) omit it and keep the old behaviour.
 *
 * @throws IllegalStateException carrying a **localized** message (from the
 *   `strings_devices.xml` catalogs) when the file is over 5 MB or cannot be
 *   opened. Callers surface `e.localizedMessage`; they cannot do better than
 *   the sentence this function already resolved in the UI language.
 */
internal suspend fun readPickedAttachment(
    context: Context,
    uri: Uri,
    fallbackMimeType: String? = null,
): PickedAttachment {
    val resolver = context.contentResolver
    val reportedMime = resolver.getType(uri)?.takeIf { it.isNotBlank() }
    val mime = when (reportedMime) {
        null, FALLBACK_MIME -> fallbackMimeType ?: reportedMime ?: FALLBACK_MIME
        else -> reportedMime
    }
    val name = queryDisplayName(resolver, uri) ?: FALLBACK_NAME

    val declaredSize = queryFileSize(resolver, uri)
    if (declaredSize != null && isAttachmentTooLarge(declaredSize)) {
        throw IllegalStateException(context.getString(R.string.att_file_too_large))
    }

    val bytes = withContext(Dispatchers.IO) {
        resolver.openInputStream(uri)?.use { it.readBytes() }
    } ?: throw IllegalStateException(context.getString(R.string.att_could_not_read_file))

    if (isAttachmentTooLarge(bytes.size.toLong())) {
        throw IllegalStateException(context.getString(R.string.att_file_too_large))
    }

    return PickedAttachment(fileName = name, mimeType = mime, bytes = bytes)
}

private const val FALLBACK_MIME = "application/octet-stream"
private const val FALLBACK_NAME = "file"

/**
 * The file's size as the content provider reports it, or `null` when it does not
 * know. Two sources, cheapest first: `OpenableColumns.SIZE` (what most pickers —
 * including the photo picker and SAF documents — expose) and the asset file
 * descriptor's declared length.
 */
private fun queryFileSize(resolver: ContentResolver, uri: Uri): Long? {
    var size: Long? = null
    runCatching {
        resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)
            ?.use { cursor ->
                val idx = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (idx >= 0 && cursor.moveToFirst() && !cursor.isNull(idx)) {
                    size = cursor.getLong(idx)
                }
            }
    }
    if (size != null) return size
    return runCatching {
        resolver.openAssetFileDescriptor(uri, "r")?.use { it.length }
    }.getOrNull()?.takeIf { it >= 0 }
}

private fun queryDisplayName(resolver: ContentResolver, uri: Uri): String? =
    runCatching {
        resolver.query(uri, null, null, null, null)?.use { cursor ->
            val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (idx >= 0 && cursor.moveToFirst()) cursor.getString(idx) else null
        }
    }.getOrNull()
