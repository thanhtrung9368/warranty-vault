package com.warrantyvault.app.ui.screens.devices

import com.warrantyvault.app.network.BrandServiceInfo
import com.warrantyvault.app.network.PhoneSource
import com.warrantyvault.app.network.ServiceDirectory
import com.warrantyvault.app.network.WarrantyCentre
import com.warrantyvault.app.ui.screens.vietnamDate

/**
 * Warranty directory (FEATURE_IDEAS #15, openapi `ServiceDirectory`) — the answer
 * to *"giờ tôi mang máy đi đâu"*.
 *
 * The whole feature is an honesty problem, not a layout problem, and these pure
 * functions are where the honesty rules live so a JVM test can pin them:
 *
 *  1. **The app stores no hotline and no service-centre address.** Migration 0008
 *     deliberately seeded `WarrantyProvider.phone`/`.address` as NULL ("a wrong
 *     hotline is worse than an empty one") and migration 0012 kept that decision —
 *     `BrandServiceInfo` has no phone/address columns at all. So the only contact
 *     detail that may ever be rendered is one **the user typed**, and
 *     [PhoneSource] says so out loud. A phone must never be presented as
 *     app-verified, and a missing one must never read as "there is a hotline".
 *  2. **`null` means "app không biết".** `brand: null` is a valid answer — either
 *     no row is seeded for that brand or the free-text match **tied** and the
 *     server refused to guess. It is rendered as a sentence, never as an empty
 *     box, and the client never invents a URL to fill the gap.
 *  3. **`providerInput` is always shown**, even next to a matched `provider`: the
 *     match is fuzzy, so the user's own words are the thing they can check.
 */

// ---- The brand tier (tier 1 in the openapi description) ----

/**
 * `brandInput` as it should be shown: the user's own text, or `null` when they
 * never recorded a brand. Blank is treated as absent — the server trims, but a
 * cached payload should not be able to slip a row through.
 */
internal fun directoryBrandInput(directory: ServiceDirectory): String? =
    directory.brandInput?.trim()?.takeIf { it.isNotEmpty() }

/**
 * What to say when the server sent `brand: null`.
 *
 * Both honest causes are named, and so is the limit of the claim: the app does not
 * know, it will **not** guess, and the fix is in the user's hands (record the
 * brand so the next lookup can match). Deliberately no "tra cứu Google" style
 * suggestion — inventing a URL for a brand is exactly what the server declined to
 * do.
 */
internal const val NULL_BRAND_EXPLANATION: String =
    "App không có thông tin cho hãng này: chưa có dòng danh bạ nào khớp, hoặc có nhiều " +
        "dòng khớp ngang nhau nên app không đoán bừa. Ghi rõ hãng trong thiết bị để lần " +
        "sau tra được."

/** When there is no brand recorded at all, the same honesty, worded for that case. */
internal const val NO_BRAND_EXPLANATION: String =
    "Thiết bị này chưa ghi hãng nên app không tra được danh bạ. Thêm hãng trong thiết bị " +
        "để lần sau tra được."

/** A directory URL this client is willing to open, with the label approved for it. */
internal data class DirectoryLink(val label: String, val url: String)

internal const val SERVICE_LOCATOR_LABEL: String = "Tra cứu trung tâm bảo hành uỷ quyền"
internal const val SUPPORT_URL_LABEL: String = "Trang hỗ trợ của hãng"

/**
 * The links of a brand row, filtered to ones worth showing.
 *
 * The label says what the link **is**, per openapi's own distinction:
 * `serviceLocatorUrl` is the brand's authorised-service-centre locator, while
 * `supportUrl` is a general support page that may not list a single centre.
 * Calling the second one "trung tâm bảo hành" would send someone across town to a
 * page that only has a contact form.
 *
 * Only well-formed `http(s)` URLs survive: an entry this client cannot open does
 * not become a button that fails silently on tap.
 */
internal fun brandDirectoryLinks(brand: BrandServiceInfo): List<DirectoryLink> =
    listOfNotNull(
        brand.serviceLocatorUrl.toDirectoryLink(SERVICE_LOCATOR_LABEL),
        brand.supportUrl.toDirectoryLink(SUPPORT_URL_LABEL),
    )

private fun String?.toDirectoryLink(label: String): DirectoryLink? {
    val url = this?.trim().orEmpty()
    if (!url.startsWith("http://") && !url.startsWith("https://")) return null
    if (url.removePrefix("http://").removePrefix("https://").isBlank()) return null
    return DirectoryLink(label, url)
}

/** The brand's own Vietnamese note, or `null` when there is nothing to add. */
internal fun brandNote(brand: BrandServiceInfo): String? =
    brand.notes?.trim()?.takeIf { it.isNotEmpty() }

// ---- The centre tier (tier 2) ----

/**
 * Who this warranty's provider is, as one line: the catalog name when the
 * free-text match succeeded, otherwise the user's own words.
 *
 * ⚠️ `provider: null` is **not** an error and must not blank the line — the row
 * still has something to show ([WarrantyCentre.providerInput]) and the fallback
 * sentence says the app could not match it rather than pretending there is no
 * provider.
 */
internal fun centreProviderLine(centre: WarrantyCentre): String {
    centre.provider?.name?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
    val typed = centre.providerInput?.trim().orEmpty()
    return typed.ifEmpty { NO_PROVIDER_MESSAGE }
}

internal const val NO_PROVIDER_MESSAGE: String = "Chưa ghi nơi bảo hành"

/**
 * The line under an unmatched provider row, saying the app refused to guess.
 *
 * `null` in both cases where there is nothing to explain: when a catalog row
 * **was** matched (the row already shows its name), and when the user never typed
 * a provider at all — [NO_PROVIDER_MESSAGE] is a complete answer on its own, and
 * prefixing it with an empty quote (`"" chưa khớp danh bạ nào`) would claim the
 * user wrote something they did not. When there *is* text, it is quoted back
 * verbatim, because the near-miss is the useful information.
 */
internal fun unmatchedProviderNote(centre: WarrantyCentre): String? {
    if (!isUnmatchedProvider(centre)) return null
    val typed = centre.providerInput?.trim().orEmpty()
    if (typed.isEmpty()) return null
    return "\"$typed\" chưa khớp danh bạ nào — app không đoán."
}

/**
 * `true` when the line above is the user's unmatched text rather than a catalog
 * row — the UI shows it in plain style instead of as a matched provider, so a
 * near-miss on the fuzzy match is visible instead of implied to be exact.
 */
internal fun isUnmatchedProvider(centre: WarrantyCentre): Boolean =
    centre.provider?.name?.trim().isNullOrEmpty()

/** `"Còn hiệu lực"` / `"Đã hết hạn"` — server-computed, never re-derived here. */
internal fun centreStatusLabel(centre: WarrantyCentre): String =
    if (centre.isActive) "Còn hiệu lực" else "Đã hết hạn"

/**
 * `"Hết hạn 15/01/2027"`, or `null` when `endDate` is absent or not a shape this
 * client will render. A warranty with no `endDate` still shows its status line; it
 * just does not get a date the app made up.
 */
internal fun centreEndDateLabel(centre: WarrantyCentre): String? =
    vietnamDate(centre.endDate)?.let { "Hết hạn $it" }

/**
 * The phone row, as the two states [PhoneSource] can be in.
 *
 * This is the honesty mechanism the API exists to expose, so it is a value type
 * rather than a `String?`:
 *
 *  * [PhoneSource.USER] → a [DialablePhone] whose [DialablePhone.attribution] says
 *    **the user typed it**. The number becomes tappable with a dial intent.
 *  * [PhoneSource.NONE] → `null`. The UI renders "Chưa có số điện thoại": there is
 *    nothing, and the app will not imply a hotline exists.
 *
 * ⚠️ A non-blank `phone` whose `phoneSource` is `NONE` (a contradiction the server
 * does not produce) renders as **no number**: `phoneSource` is the authority on
 * where a number came from, and showing a number the app cannot attribute is the
 * exact failure this field was added to prevent. The reverse — `USER` with a blank
 * number — is also nothing, because there is nothing to dial.
 */
internal fun dialablePhone(centre: WarrantyCentre): DialablePhone? {
    if (centre.phoneSource != PhoneSource.USER) return null
    val number = centre.phone?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    return DialablePhone(number)
}

/**
 * A phone number that may be dialled, with its provenance attached so no caller
 * can render it without saying where it came from.
 */
internal data class DialablePhone(val number: String) {
    /**
     * Shown next to the number. States the source, not a verification: the app
     * never checked this number and must not look like it did.
     */
    val attribution: String get() = PhoneSource.USER.label

    /** The `tel:` URI for `Intent.ACTION_DIAL`. */
    val dialUri: String get() = "tel:${number.filter { !it.isWhitespace() }}"
}

/**
 * `"Chưa có số điện thoại"` — the absence, said rather than left blank. Sourced
 * from the enum's own label so the two can never drift apart; that is why it is a
 * `val` and not a `const`.
 */
internal val NO_PHONE_MESSAGE: String = PhoneSource.NONE.label

/**
 * The address row, or `null` when there is none. Same rule as the phone: this is
 * `Warranty.address`, written by the user — the app has never stored a centre
 * address (migration 0008 left `WarrantyProvider.address` NULL on purpose).
 */
internal fun centreAddress(centre: WarrantyCentre): String? =
    centre.address?.trim()?.takeIf { it.isNotEmpty() }

/** The server's own sentence about why so many fields are `null`. Rendered verbatim. */
internal fun directoryDisclaimer(directory: ServiceDirectory): String? =
    directory.disclaimer.trim().takeIf { it.isNotEmpty() }

/** `"3 gói bảo hành"` — the count of rows, which is the count of the device's warranties. */
internal fun centreCountLabel(centres: List<WarrantyCentre>): String = when (centres.size) {
    0 -> "Thiết bị chưa có gói bảo hành nào"
    1 -> "1 gói bảo hành"
    else -> "${centres.size} gói bảo hành"
}

// ---- Dial intent ----

/** `android.content.Intent.ACTION_DIAL`, mirrored so this file stays pure. */
internal const val ACTION_DIAL = "android.intent.action.DIAL"

/**
 * The dial intent for a [DialablePhone], as plain values.
 *
 * `ACTION_DIAL` — **not** `ACTION_CALL`: this opens the dialer prefilled and
 * leaves the call to the user. `ACTION_CALL` would need `CALL_PHONE` (a runtime
 * permission this app does not declare and has no business asking for) and would
 * place a call from a tap on a number typed into a notes field.
 */
internal data class DialIntent(val action: String, val uri: String)

internal fun dialIntent(phone: DialablePhone): DialIntent =
    DialIntent(action = ACTION_DIAL, uri = phone.dialUri)
