package com.warrly.share

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Process-scoped mailbox between a share `Intent` and the screen that can show
 * it.
 *
 * Two kinds of share land here, and they go to two different places:
 *
 *  * a **product link** ([ShareTarget.Product]) waits for the wishlist form;
 *  * a **photo/PDF** ([SharedFile], bytes already copied) waits for the Inbox
 *    screen's "save this receipt?" card.
 *
 * The Activity parks a share here as soon as the intent arrives; the shell
 * (`MainScreen`) is the only place that can *show* it, and that screen exists
 * only while the user is signed in. A share that lands on the login screen
 * therefore **waits here instead of being dropped** — it is applied the moment
 * the user is through, with no second share needed.
 *
 * The two mailboxes are intentionally separate flows rather than one sealed
 * value: the wishlist consumer must keep working exactly as before, and the
 * inbox consumer needs the bytes, not a link. Holding one kind clears the other,
 * because the user's last share is the one they meant and two stacked
 * destinations would be worse than one.
 *
 * Deliberately in memory only. The content is user data that should not outlive
 * the session, and an unsaved share reappearing days later at the next launch
 * would be a surprise rather than a feature. The cost is documented: if the
 * user kills the app before signing in, the held share is gone — and for a file
 * that is unavoidable anyway, because the URI grant dies with the activity.
 */
class ShareIntake {

    private val _pending = MutableStateFlow<ShareTarget.Product?>(null)
    private val _pendingFile = MutableStateFlow<SharedFile?>(null)

    /** The link waiting for a form, if any. */
    val pending: StateFlow<ShareTarget.Product?> = _pending.asStateFlow()

    /** The shared file waiting for the inbox confirmation, if any. */
    val pendingFile: StateFlow<SharedFile?> = _pendingFile.asStateFlow()

    /**
     * A newer share replaces an older one still waiting — whichever kind it is.
     * Two stacked forms (or a link form plus a receipt card) would be worse
     * than one, and the last action is the one the user meant.
     */
    fun hold(product: ShareTarget.Product) {
        _pending.value = product
        _pendingFile.value = null
    }

    /**
     * Clears [product] **only if it is still the one waiting** — consuming an
     * older link after a newer share landed must not eat the newer one.
     * Compare-and-set rather than a plain write for exactly that reason.
     */
    fun consume(product: ShareTarget.Product) {
        _pending.compareAndSet(product, null)
    }

    /**
     * Parks the bytes [file] read from a live share URI. Replaces any waiting
     * link or file: see [hold].
     */
    fun hold(file: SharedFile) {
        _pendingFile.value = file
        _pending.value = null
    }

    /**
     * Clears [file] **only if it is still the one waiting**, so a late
     * "discard" from an old card cannot throw away a newer share.
     */
    fun consume(file: SharedFile) {
        _pendingFile.compareAndSet(file, null)
    }
}
