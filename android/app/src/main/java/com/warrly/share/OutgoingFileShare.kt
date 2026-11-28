package com.warrly.share

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File

/**
 * Hand a generated cache file to the system share sheet through the app's
 * **already-declared** `androidx.core.content.FileProvider`.
 *
 * The authority and the cache paths that may be exposed are fixed by
 * `AndroidManifest.xml` (`${applicationId}.fileprovider`) and
 * `res/xml/file_paths.xml`; [FileProvider.getUriForFile] throws for any file
 * outside those paths, which is why every feature writes into its own declared
 * sub-directory of `cacheDir` instead of a bare `File(context.cacheDir, …)`.
 *
 * This is the single outgoing-file share path: the insurance PDF and the backup
 * ZIP both call it. The backup ZIP (`application/zip`) does not collide with the
 * app's own `ACTION_SEND` filter (`text/plain`, images, `application/pdf`), so
 * it passes no exclusions; the insurance PDF does, because otherwise the app
 * could pick its own PDF back up as a receipt.
 *
 * @param noTargetMessage localized sentence reported when no app accepts
 *   [mimeType]. Callers cannot know this without trying, so it is a parameter
 *   rather than a silent no-op.
 * @throws IllegalStateException carrying [noTargetMessage].
 */
internal fun shareOutgoingFile(
    context: Context,
    file: File,
    mimeType: String,
    subject: String,
    chooserTitle: String,
    noTargetMessage: String,
    excludedComponents: Array<ComponentName> = emptyArray(),
    logTag: String = "Share",
) {
    val authority = "${context.packageName}.fileprovider"
    val uri = FileProvider.getUriForFile(context, authority, file)

    val send = Intent(Intent.ACTION_SEND).apply {
        type = mimeType
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_SUBJECT, subject)
        // Some apps only read the URI from the clip data; the grant flag then
        // travels with the chooser.
        clipData = ClipData.newRawUri(file.name, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    val chooser = Intent.createChooser(send, chooserTitle).apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        if (excludedComponents.isNotEmpty()) {
            putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, excludedComponents)
        }
    }

    try {
        context.startActivity(chooser)
    } catch (e: ActivityNotFoundException) {
        Log.w(logTag, "no app can receive $mimeType", e)
        throw IllegalStateException(noTargetMessage, e)
    }
}
