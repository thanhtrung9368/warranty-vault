package com.warrantyvault.app.ui.screens.devices

import com.warrantyvault.app.R
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.widget.Toast

/**
 * The two Android side effects of the warranty directory (#15): opening a brand's
 * own service-centre locator, and prefilling the dialer with a number **the user
 * typed**.
 *
 * Both are kept out of the pure rule files (`ServiceDirectoryInfo.kt` decides
 * *whether* a number may be dialled and *which* URLs are worth showing) so those
 * rules stay JVM-testable, and out of the composable so the directory section is
 * about layout rather than `Intent` handling.
 */

/** Opens a brand directory page in the browser. Only ever called with an http(s) URL. */
internal fun openDirectoryLink(context: Context, url: String) {
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    } catch (e: ActivityNotFoundException) {
        Log.w("ServiceDirectory", "no browser", e)
        Toast.makeText(context, context.getString(R.string.dir_no_app_for_link), Toast.LENGTH_SHORT).show()
    }
}

/**
 * Prefilled dialer for a user-recorded number.
 *
 * `ACTION_DIAL`, **not** `ACTION_CALL`: nothing is dialled without a second tap,
 * and no `CALL_PHONE` runtime permission is needed — or wanted, for a number that
 * was typed into a notes field.
 *
 * Only ever reached via [dialablePhone], i.e. only when `phoneSource == "user"`.
 * The caller has already decided the app is allowed to present this number.
 */
internal fun openDialer(context: Context, phone: DialablePhone) {
    val dial = dialIntent(phone)
    try {
        context.startActivity(Intent(dial.action, Uri.parse(dial.uri)))
    } catch (e: ActivityNotFoundException) {
        Log.w("ServiceDirectory", "no dialer", e)
        Toast.makeText(context, context.getString(R.string.dir_cannot_open_dialer), Toast.LENGTH_SHORT).show()
    }
}
