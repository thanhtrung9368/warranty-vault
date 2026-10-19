package com.warrly.ui.screens.devices

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.net.toUri
import com.warrly.network.ApiService
import com.warrly.network.BrandOption

/**
 * The network/intent half of the brand warranty lookup. Kept out of
 * `BrandWarrantyRules.kt` so that file stays pure, and out of the composables so
 * the same two steps are not written twice (device detail and the device form).
 */

/**
 * Resolve the device's free-text brand to a `Brand.id`, fetch that brand's
 * `service-info`, and reduce it to the one answer the UI can render.
 *
 * [brands] is the catalog already loaded by the caller (the device form has it).
 * The detail screen passes `null` and this fetches it: the catalog is a small,
 * server-cached read, and doing it here keeps one code path instead of two.
 *
 * Returns [BrandLookupState.NoUrl] — never a guessed URL — when the brand has no
 * catalog row or the API's `warrantyLookupUrl` is absent/invalid. Network
 * failures are deliberately **not** swallowed here: the caller shows the
 * server's own message, because "could not load" and "this brand has no page"
 * are different sentences.
 */
internal suspend fun loadBrandLookupState(
    api: ApiService,
    brandName: String?,
    brands: List<BrandOption>? = null,
): BrandLookupState {
    if (brandName.isNullOrBlank()) return BrandLookupState.NoBrand
    val known = brands ?: api.catalog().brands
    val brandId = brandIdForName(brandName, known) ?: return BrandLookupState.NoUrl
    // `serviceInfo: null` is a 200: the brand exists but has no directory row.
    // It is the same "no sourced page" answer as a row whose URL is null.
    val info = api.getBrandServiceInfo(brandId).serviceInfo
    return brandLookupState(brandName, info?.warrantyLookupUrl)
}

/**
 * Open a brand's lookup page in the user's browser.
 *
 * `ACTION_VIEW` and not a WebView: the manufacturer's page is a third-party
 * login/form surface with its own security posture, and the user must see the
 * real address bar. The URL is re-validated here with the same pure rule the UI
 * used — this function must never be the place a malformed URL slips through.
 *
 * Returns `false` when there is no browser or the URL is not absolute http(s);
 * the caller turns that into the same plain sentence it shows for "no page",
 * rather than a button that silently does nothing.
 */
internal fun openBrandWarrantyPage(context: Context, url: String): Boolean {
    val safeUrl = brandLookupUrl(url) ?: return false
    return try {
        context.startActivity(Intent(Intent.ACTION_VIEW, safeUrl.toUri()))
        true
    } catch (e: ActivityNotFoundException) {
        Log.w("BrandWarranty", "no browser for the brand's lookup page", e)
        false
    }
}
