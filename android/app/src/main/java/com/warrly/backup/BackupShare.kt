package com.warrly.backup

import android.content.Context
import com.warrly.R
import com.warrly.network.ApiService
import com.warrly.share.shareOutgoingFile
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Download the full backup (document + every encrypted attachment) and hand the
 * ZIP to the system share sheet.
 *
 * `GET /api/v1/backup/export?includeBlobs=true` is authenticated and answers
 * with a ZIP, so it cannot be opened from the receiving app by URL: the bytes
 * are streamed into `cacheDir/backup/warrly-backup-<yyyy-MM-dd>.zip` and exposed
 * through the app's existing FileProvider (see
 * `share/OutgoingFileShare.kt`). The JSON export was metadata-only; this ZIP is
 * the same document plus each attachment's ciphertext, which is why the UI must
 * say the receipt images are included but need the same server master key to be
 * readable elsewhere.
 *
 * A failed or empty download never leaves a file in the provider-visible cache:
 * the partial file is deleted before the exception reaches the screen.
 *
 * @throws IllegalStateException carrying a **localized** sentence when the
 *   cache is unusable, the download is empty, or no app can receive the ZIP.
 */
internal suspend fun downloadAndShareBackup(context: Context, api: ApiService): File {
    val file = downloadBackup(context, api)
    try {
        shareOutgoingFile(
            context = context,
            file = file,
            mimeType = BACKUP_MIME,
            subject = context.getString(R.string.backup_share_subject),
            chooserTitle = context.getString(R.string.backup_chooser_title),
            noTargetMessage = context.getString(R.string.backup_error_no_target),
            logTag = "Backup",
        )
    } catch (e: Exception) {
        // The archive is complete, but it never reached a target; clearing it
        // keeps the share cache at "the most recent backup that was actually
        // handed off" rather than accumulating unreachable files.
        file.delete()
        throw e
    }
    return file
}

/**
 * Stream the ZIP into the FileProvider-visible cache directory.
 *
 * `ResponseBody` is consumed inside `Dispatchers.IO` because `@Streaming` does
 * not buffer the archive in memory; a backup with receipt images can be large
 * enough that reading it on the main thread would be a strict-mode violation.
 */
private suspend fun downloadBackup(context: Context, api: ApiService): File =
    withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, BACKUP_CACHE_DIR)
        if (!dir.isDirectory && !dir.mkdirs()) {
            throw IllegalStateException(context.getString(R.string.backup_error_cache))
        }
        // Only the latest archive is shareable; dated files from earlier days
        // would grow the cache with documents the user cannot reach.
        dir.listFiles()?.forEach { it.delete() }

        val outFile = File(dir, backupFileName())
        try {
            api.exportBackup(includeBlobs = true).use { body ->
                body.byteStream().use { input ->
                    outFile.outputStream().use { output -> input.copyTo(output) }
                }
            }
            // A 200 with an empty body is not a backup worth sharing.
            if (outFile.length() == 0L) {
                throw IllegalStateException(context.getString(R.string.backup_error_empty))
            }
        } catch (e: Exception) {
            // Never leave a half-written file in the directory the provider
            // points at.
            outFile.delete()
            throw e
        }

        outFile
    }
