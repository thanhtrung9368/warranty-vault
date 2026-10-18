package com.warrly.ui.screens.attachments

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.widget.Toast
import androidx.core.content.FileProvider
import com.warrly.App
import com.warrly.BuildConfig
import com.warrly.R
import com.warrly.network.ApiClient
import com.warrly.network.Attachment
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request

/**
 * Downloads one attachment through the authenticated `GET /api/files/{id}` and
 * hands it to a viewer via `FileProvider`.
 *
 * The bytes cannot be opened with a plain URL/Intent: the endpoint needs the
 * bearer token, and `Intent.ACTION_VIEW` cannot carry an `Authorization` header.
 * So the file is streamed into the app cache first and exposed through the
 * already-configured `warranty-vault` FileProvider.
 *
 * Shared by the device detail's attachment list and the **search** screen's
 * `attachments` group (roadmap #13): both rows point at the same public
 * `Attachment` shape, and a second copy of this would be a second place to get
 * the header, the cache sanitising or the "no viewer installed" toast wrong.
 *
 * @throws IllegalStateException with a **localized** sentence when the user is
 *   signed out, the download fails, or the response carries no body.
 */
internal suspend fun openAttachment(context: Context, att: Attachment) {
    val token = App.instance.tokenStore.read()
        ?: throw IllegalStateException(context.getString(R.string.att_not_signed_in))
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
                throw IllegalStateException(context.getString(R.string.att_download_failed, resp.code))
            }
            resp.body?.byteStream()?.use { input ->
                outFile.outputStream().use { out -> input.copyTo(out) }
            } ?: throw IllegalStateException(context.getString(R.string.att_no_data))
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
        Toast.makeText(
            context,
            context.getString(R.string.att_no_app_for_file_type, att.fileType),
            Toast.LENGTH_SHORT,
        ).show()
    }
}

private fun sanitize(name: String): String =
    name.replace(Regex("[^A-Za-z0-9._-]"), "_").take(120)
