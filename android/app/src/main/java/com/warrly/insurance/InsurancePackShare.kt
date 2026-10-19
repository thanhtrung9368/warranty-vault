package com.warrly.insurance

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.FileProvider
import com.warrly.MainActivity
import com.warrly.R
import com.warrly.network.ApiService
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Download the insurance PDF pack and hand it to the user's picker of apps.
 *
 * This is the Android side-effect half of the feature; everything that can be
 * decided without a device lives in `InsurancePack.kt` (and is unit-tested).
 *
 * ## Why a cache file at all
 *
 * `GET /api/v1/insurance-pack` is authenticated, and the receiving app (Gmail,
 * Drive, Zalo, a PDF viewer) cannot carry the app's bearer token. An `Intent`
 * with an `https://…/api/v1/insurance-pack` URL would therefore fail for every
 * target. The bytes are streamed straight into
 * `cacheDir/insurance-pack/<name>.pdf`, then exposed through the
 * **already-declared** `androidx.core.content.FileProvider` (authority
 * `${applicationId}.fileprovider`, path declared in `res/xml/file_paths.xml`).
 * The cache file is never treated as permanent storage: each new download
 * clears the directory first.
 *
 * ## Why `ACTION_SEND`, not `ACTION_VIEW`
 *
 * The job to be done is "send this to my insurer" — mail, a chat app, Drive.
 * Those are `ACTION_SEND` targets; `ACTION_VIEW` would only list PDF readers and
 * leave the user with no way to send the file. The chooser is the system's, so
 * every installed PDF-capable app is offered.
 *
 * The app's own share target (`MainActivity`, `application/pdf` in the manifest)
 * is excluded from the chooser. Without that, the insurance pack could be picked
 * back up by Warrly's inbox intake and treated as a receipt to file.
 *
 * @throws IllegalStateException carrying a **localized** sentence when the
 *   download is empty/refused or no app can receive the PDF. The Settings screen
 *   turns this into a snackbar; nothing here is swallowed.
 */
internal suspend fun downloadAndShareInsurancePack(
    context: Context,
    api: ApiService,
    request: InsurancePackRequest,
): File {
    val file = downloadInsurancePack(context, api, request)
    shareInsurancePack(context, file)
    return file
}

/**
 * Stream the pack into the FileProvider-visible cache directory.
 *
 * `ResponseBody` is consumed inside `Dispatchers.IO` because `@Streaming` does
 * not buffer the PDF in memory; reading it on the main thread would be a strict
 * mode violation on a multi-page document with photos.
 */
private suspend fun downloadInsurancePack(
    context: Context,
    api: ApiService,
    request: InsurancePackRequest,
): File = withContext(Dispatchers.IO) {
    val dir = File(context.cacheDir, INSURANCE_PACK_CACHE_DIR)
    if (!dir.isDirectory && !dir.mkdirs()) {
        throw IllegalStateException(context.getString(R.string.insurance_pack_error_cache))
    }
    // One pack is enough. Leaving previous downloads behind would grow the
    // cache with documents the user cannot reach (the chooser only ever gets
    // the latest URI) and would keep stale prices around.
    dir.listFiles()?.forEach { it.delete() }

    val outFile = File(dir, insurancePackFileName())
    try {
        api.downloadInsurancePack(request.deviceIds, request.includeSold).use { body ->
            body.byteStream().use { input ->
                outFile.outputStream().use { output -> input.copyTo(output) }
            }
        }
        // A 200 with an empty body is not a document an adjuster can accept.
        // Treat it as a failure instead of sharing a 0-byte PDF.
        if (outFile.length() == 0L) {
            throw IllegalStateException(context.getString(R.string.insurance_pack_error_empty))
        }
    } catch (e: Exception) {
        // Never leave a half-written/failed file in the directory the provider
        // points at.
        outFile.delete()
        throw e
    }

    outFile
}

/**
 * Fire the system chooser for [file].
 *
 * The `FileProvider` authority and the path must stay in lockstep with
 * `AndroidManifest.xml` and `res/xml/file_paths.xml`; a mismatch throws
 * `IllegalArgumentException` here, which the caller reports rather than letting
 * the user tap a button that does nothing.
 */
private fun shareInsurancePack(context: Context, file: File) {
    val authority = "${context.packageName}.fileprovider"
    val uri = FileProvider.getUriForFile(context, authority, file)

    val send = Intent(Intent.ACTION_SEND).apply {
        type = INSURANCE_PACK_MIME
        putExtra(Intent.EXTRA_STREAM, uri)
        // The subject is Vietnamese in BOTH app languages: like the PDF itself,
        // it is read by the insurer, who never chose a language in this app.
        putExtra(Intent.EXTRA_SUBJECT, context.getString(R.string.insurance_pack_share_subject))
        // Some apps only accept the URI from the clip data; the grant flag then
        // travels with the chooser.
        clipData = ClipData.newRawUri(file.name, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    val chooser = Intent.createChooser(
        send,
        context.getString(R.string.insurance_pack_chooser_title),
    ).apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        // The manifest declares this app as an ACTION_SEND/application/pdf
        // target. Exclude it by component so the generated pack cannot loop back
        // into the receipt inbox. It is the only share target activity the app
        // declares, so naming it directly is exact and needs no
        // queryIntentActivities() (and no broader package visibility).
        putExtra(
            Intent.EXTRA_EXCLUDE_COMPONENTS,
            arrayOf(ComponentName(context, MainActivity::class.java)),
        )
    }

    try {
        context.startActivity(chooser)
    } catch (e: ActivityNotFoundException) {
        Log.w("InsurancePack", "no app can receive a PDF", e)
        throw IllegalStateException(
            context.getString(R.string.insurance_pack_error_no_target),
            e,
        )
    }
}
