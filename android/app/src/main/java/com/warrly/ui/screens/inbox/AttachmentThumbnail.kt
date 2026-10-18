package com.warrly.ui.screens.inbox

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.warrly.App
import com.warrly.BuildConfig
import com.warrly.network.ApiClient
import com.warrly.network.Attachment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request

/**
 * The inbox row's thumbnail.
 *
 * ## Why this is hand-rolled
 *
 * There is **no thumbnail endpoint**. The only way to the bytes is the existing
 * authenticated `GET /api/files/{id}`, which needs the bearer token, so a plain
 * image-loading URL (or Coil's default setup) cannot fetch it. This downloads the
 * blob with the same `ApiClient.fileClient` + `Authorization` header that
 * `AttachmentsSection.openAttachment` already uses, and decodes a downsampled
 * bitmap.
 *
 * ## Why it never touches disk
 *
 * The blobs are encrypted at rest on the server on purpose. A loader with a disk
 * cache (Coil's default) would quietly write a decrypted receipt into the app's
 * cache directory, defeating that. Everything here stays in memory and is gone
 * with the process. The cost is a re-download when a row scrolls out of the
 * `LazyColumn` and back in; a future server-side thumbnail endpoint is the right
 * fix for that, not a plaintext cache.
 *
 * A non-image (PDF) never hits the network at all — it renders the file-type
 * icon immediately. A failed/undecodable image (a HEIC on API 26, a 404 from a
 * server that does not serve unfiled attachments yet) degrades to the same icon
 * rather than an empty box.
 */
@Composable
internal fun AttachmentThumbnail(
    attachment: Attachment,
    size: Dp = 56.dp,
) {
    val cs = MaterialTheme.colorScheme
    val isImage = attachment.fileType.startsWith("image/")
    var bitmap by remember(attachment.id) { mutableStateOf<ImageBitmap?>(null) }

    LaunchedEffect(attachment.id, isImage) {
        if (isImage) bitmap = loadThumbnail(attachment.id)
    }

    Box(
        Modifier
            .size(size)
            .clip(RoundedCornerShape(10.dp))
            .background(cs.primary.copy(alpha = 0.12f)),
        contentAlignment = Alignment.Center,
    ) {
        val image = bitmap
        if (image != null) {
            Image(
                bitmap = image,
                // The filename is right next to it; a second announcement of the
                // same row would only make TalkBack slower.
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Icon(
                if (isImage) Icons.Filled.Image else Icons.Filled.PictureAsPdf,
                null,
                tint = cs.primary,
                modifier = Modifier.size(size / 2),
            )
        }
    }
}

/**
 * Silent on every failure (`null`): a thumbnail is decoration, and a row that
 * cannot be previewed must still be assignable. Errors are not surfaced here —
 * the screen has its own error card for the actions that actually matter.
 */
private suspend fun loadThumbnail(id: String): ImageBitmap? = withContext(Dispatchers.IO) {
    runCatching {
        val token = App.instance.tokenStore.read() ?: return@runCatching null
        val url = "${BuildConfig.BASE_URL.trimEnd('/')}/api/files/$id"
        val request = Request.Builder()
            .url(url)
            .addHeader("Authorization", "Bearer $token")
            .build()
        val bytes = ApiClient.fileClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return@runCatching null
            response.body?.bytes() ?: return@runCatching null
        }
        decodeDownsampled(bytes)
    }.getOrNull()
}

/** Longest edge of the decoded bitmap, in pixels — the box is 56dp. */
private const val THUMBNAIL_PX = 128

/**
 * Decodes at the smallest power-of-two sample size that still covers
 * [THUMBNAIL_PX]; a 5 MB camera photo never inflates into a full-size bitmap
 * just to be drawn in a 56dp square.
 */
private fun decodeDownsampled(bytes: ByteArray): ImageBitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    var sample = 1
    while (
        bounds.outWidth / (sample * 2) >= THUMBNAIL_PX &&
        bounds.outHeight / (sample * 2) >= THUMBNAIL_PX
    ) {
        sample *= 2
    }

    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    val bitmap: Bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return null
    return bitmap.asImageBitmap()
}
