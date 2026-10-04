package com.warrantyvault.app.ui.screens.devices

import androidx.annotation.StringRes
import com.warrantyvault.app.R
import com.warrantyvault.app.i18n.AppStrings
import com.warrantyvault.app.network.DeviceShare
import com.warrantyvault.app.ui.screens.vietnamDate

/**
 * Handover certificate / share link (FEATURE_IDEAS #2, openapi `shares`).
 *
 * Everything here is a **pure function** so the rules that matter are unit-tested
 * as ordinary JVM code: what URL the buyer actually receives, whether a link is
 * expired or revoked, and — the one this feature lives or dies on — the sentence
 * that tells the user the token cannot be shown again.
 *
 * ## The one-time rule
 *
 * `POST /api/v1/devices/{id}/shares` is the **only** response in the API that
 * carries a share token; the server stores just its sha256, so `GET .../shares`
 * can never return it and there is no endpoint to add later. The consequence for
 * the UI is absolute: the token must be on screen, next to a copy action and next
 * to [ONE_TIME_WARNING], **before** anything can dismiss that screen. "Bạn quên
 * sao chép rồi à?" shown afterwards is worthless — the link is already gone.
 *
 * This client deliberately does **not** persist the token anywhere (not
 * `TokenStore`, not a file, not saved instance state): storing a credential the
 * server refuses to re-issue would turn a one-time secret into a permanent one.
 */

/**
 * The warning shown **inside** the create-result dialog, above the copy button.
 *
 * ⚠️ Read it as a pair with the dialog's dismiss action: closing the dialog is
 * exactly the moment the link becomes unrecoverable, so this must be legible
 * without scrolling and before the user reaches for "Đóng". It is also shown
 * verbatim on the copy confirmation, so a user who copies and then dismisses
 * still ends with the same statement rather than a bare "Đã sao chép".
 */
@StringRes
val ONE_TIME_WARNING: Int = R.string.share_one_time_warning

/** Title of the create-result dialog — states the stakes before the body does. */
@StringRes
val ONE_TIME_TITLE: Int = R.string.share_one_time_title

/** Shown on the copy confirmation, so the rule survives the dialog being closed. */
@StringRes
val COPIED_MESSAGE: Int = R.string.share_copied

/** Empty-state line: not an error, just no live links yet. */
@StringRes
val NO_LINKS_MESSAGE: Int = R.string.share_no_links

/**
 * The share-sheet message. Sent **instead of** a bare URL so the recipient knows
 * what they were handed and that the link expires — a bare capability URL in a
 * chat app reads like spam.
 *
 * No price, no account name, nothing the certificate itself does not already
 * expose: this text travels further than the certificate does.
 */
internal fun shareMessage(s: AppStrings, deviceName: String, url: String): String =
    s.get(R.string.share_message, deviceName, url)

/**
 * The certificate URL handed to the buyer.
 *
 * `sharePath` arrives as a **path** (`/api/v1/public/shares/<token>`) because the
 * server does not know which host the client reaches it through, so it is paired
 * with the API base URL the app is actually configured with. The client stores no
 * second copy of that base URL — `BuildConfig.BASE_URL` is the single source.
 *
 * Returns an absolute `https?://` URL or `null`. `null` is not a cosmetic failure:
 * a share action with no usable URL would hand the buyer a broken link, so the UI
 * disables the action instead of sending one.
 *
 * The token is never logged or persisted on the way through.
 */
internal fun shareUrl(baseUrl: String, sharePath: String?): String? {
    val path = sharePath?.trim().orEmpty()
    if (path.isEmpty()) return null
    val base = baseUrl.trim().trimEnd('/')
    if (base.isEmpty()) return null
    if (!base.startsWith("http://") && !base.startsWith("https://")) return null
    val joined = if (path.startsWith("/")) "$base$path" else "$base/$path"
    return joined.takeIf { it.substringAfter("://").trim('/').isNotEmpty() }
}

/**
 * `true` when the link can still be opened by the buyer: not revoked and not past
 * its expiry.
 *
 * [nowMillis] is passed in rather than read from the clock so the rule is
 * testable and the whole list is judged against **one** instant — a list that
 * re-read the clock per row could show one row as live and the next as expired
 * for the same moment.
 *
 * An unparseable `expiresAt` counts as **not** live: this drives "còn hiệu lực",
 * and claiming a link works when the app cannot tell would be the wrong side to
 * fail on. The link is still listed and still revocable either way.
 */
internal fun isShareLive(share: DeviceShare, nowMillis: Long): Boolean {
    if (share.revokedAt != null) return false
    val expiry = expiryMillis(share.expiresAt) ?: return false
    return expiry > nowMillis
}

/**
 * Vietnamese state for one link in the list: what it is, and whether it still
 * works. Revoked and expired are told apart because they need different actions —
 * an expired link is housekeeping, a revoked one was a decision.
 */
internal fun shareStateLabel(s: AppStrings, share: DeviceShare, nowMillis: Long): String = when {
    share.revokedAt != null -> s.get(R.string.share_state_revoked)
    !isShareLive(share, nowMillis) -> s.get(R.string.dash_expired)
    else -> s.get(R.string.share_state_live)
}

/**
 * `"Hết hạn 15/01/2026"`, or `null` when the server sent a shape this client will
 * not pretend to understand — the row then reads `Đã hết hạn` / `Đang hiệu lực`
 * without a date it made up.
 */
internal fun shareExpiryLabel(s: AppStrings, share: DeviceShare): String? =
    vietnamDate(share.expiresAt)?.let { s.get(R.string.sess_expires, it) }

/**
 * `"Đã mở 3 lần"` / `"Chưa mở lần nào"`.
 *
 * `viewCount` is the number of times the certificate was **fetched**, which is
 * the only thing the app can observe. It is never phrased as "người mua đã xem":
 * the link has no identity behind it and may have been forwarded.
 */
internal fun shareViewLabel(s: AppStrings, share: DeviceShare): String = when (share.viewCount) {
    0 -> s.get(R.string.share_views_none)
    else -> s.quantity(R.plurals.share_views, share.viewCount, share.viewCount)
}

/**
 * What `includeSerial` means, in the two states the switch can be in.
 *
 * `false` is the default and the safe half: the certificate carries only
 * `serialNumberMasked` (first/last characters kept, the middle replaced by `*`).
 * `true` is needed when a service centre looks the device up by IMEI — and means
 * the link, if it is forwarded beyond the buyer, carries the machine's full
 * identifier. Both sentences say what is exposed; neither implies a warning that
 * is not there.
 */
@StringRes
val SERIAL_OFF_EXPLANATION: Int = R.string.share_serial_off

@StringRes
val SERIAL_ON_EXPLANATION: Int = R.string.share_serial_on

/**
 * What the recipient of the certificate can see — the seller's side of the
 * bargain. A seller deciding whether to hand a stranger a link is entitled to
 * know the projection is narrow **and** to know the limit of that promise.
 *
 * Only claims the SQL actually enforces (openapi `SharedCertificate` selects the
 * columns; there is no Go-side filter to forget): no prices, no notes, no
 * attachments, no other device. The last clause is the honest other half — the
 * certificate *does* show the serial if asked, and the device name, so it is not
 * anonymous.
 */
@StringRes
val CERTIFICATE_PROJECTION_EXPLANATION: Int = R.string.share_projection

/** Said when the device already holds the maximum of 10 live links. */
@StringRes
val SHARE_LIMIT_MESSAGE: Int = R.string.share_limit

/** Confirm-button copy for revocation; revocation is immediate and irreversible. */
internal fun revokeConfirmMessage(s: AppStrings, share: DeviceShare): String {
    val expiry = vietnamDate(share.expiresAt)
    return if (expiry != null) {
        s.get(R.string.share_revoke_confirm_dated, expiry)
    } else {
        s.get(R.string.share_revoke_confirm)
    }
}

// ---- Outgoing share (`Intent.ACTION_SEND`) ----

/**
 * The outgoing share payload: `ACTION_SEND` + `text/plain` carrying [message].
 *
 * Kept as plain values rather than an `Intent` so the collision rule below is a
 * JVM test instead of something only a device can check — the same reason
 * `ShareTarget.kt` (the *incoming* half) never lets an `android.*` type in.
 */
internal data class OutgoingShare(val action: String, val mimeType: String, val message: String)

internal fun outgoingShare(message: String): OutgoingShare =
    OutgoingShare(action = "android.intent.action.SEND", mimeType = "text/plain", message = message)

/**
 * One resolved `ACTION_SEND` target: the flattened component name, and whether it
 * is this very app.
 */
internal data class ResolvedTarget(val component: String, val isSelfTarget: Boolean)

/**
 * The components to hide from the chooser.
 *
 * ⚠️ **This is the mirror image of the app's own share *target*** (`ACTION_SEND` /
 * `text/plain` in `AndroidManifest.xml`, delivered to `MainActivity` →
 * `ShareTarget.deliver()`), and the two do collide: an unfiltered chooser lists
 * every app that accepts `text/plain`, WarrantyVault included, and picking our own
 * row re-enters the incoming handler. The certificate URL is an `http(s)` link, so
 * `ShareTarget` would classify it as a usable product link and open the
 * **wishlist** form with the buyer's certificate prefilled — a silent, wrong
 * outcome rather than a crash.
 *
 * Excluding **every** self target (not just when other apps remain) is the honest
 * choice: a chooser with nothing left is visibly empty and the caller reports it,
 * whereas falling back to self would quietly do the wrong thing. Nothing else is
 * ever filtered — the user's other apps are not this app's business.
 */
internal fun excludedShareTargets(targets: List<ResolvedTarget>): List<String> =
    targets.filter { it.isSelfTarget }.map { it.component }

/** What `Intent.createChooser` shows above the app list. */
@StringRes
internal val CHOOSER_TITLE: Int = R.string.share_chooser_title

/** No app can send a plain-text share on this device. Said out loud, never silent. */
@StringRes
internal val NO_SHARE_TARGET_MESSAGE: Int = R.string.share_no_target

/**
 * `expiresAt` (`"2026-03-02T17:04:05Z"`) → epoch millis, or `null` when it is not
 * the shape the server sends.
 *
 * Hand-parsed to UTC on purpose: `Instant.parse` is fine, but going through a
 * `SimpleDateFormat` with the device's default timezone would move the instant by
 * the offset — and this value decides whether a link the buyer may still be using
 * is reported as dead. `Instant.parse` accepts only the RFC3339 form documented in
 * openapi, so an offset form the server never sends falls through to `null`, i.e.
 * "not live", which is the safe side.
 */
internal fun expiryMillis(wire: String?): Long? {
    val raw = wire?.trim().orEmpty()
    if (raw.isEmpty()) return null
    return runCatching { java.time.Instant.parse(raw).toEpochMilli() }.getOrNull()
}
