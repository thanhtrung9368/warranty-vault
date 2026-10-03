package com.warrantyvault.app.share

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Process-scoped mailbox between a share `Intent` and the wishlist form.
 *
 * The Activity parks a captured link here as soon as the intent arrives; the
 * shell (`MainScreen`) is the only place that can *show* it, and that screen
 * exists only while the user is signed in. A share that lands on the login
 * screen therefore **waits here instead of being dropped** — the form opens
 * prefilled the moment the user is through, with no second share needed.
 *
 * Deliberately in memory only. The link is user content that should not outlive
 * the session, and an unsaved share reappearing days later at the next launch
 * would be a surprise rather than a feature. The cost is documented: if the
 * user kills the app before signing in, the held link is gone (the classic
 * answer — persist it with a TTL — is more machinery than this feature earns).
 */
class ShareIntake {

    private val _pending = MutableStateFlow<ShareTarget.Product?>(null)

    /** The link waiting for a form, if any. */
    val pending: StateFlow<ShareTarget.Product?> = _pending.asStateFlow()

    /**
     * A newer share replaces an older one still waiting: the user's last action
     * is the one they meant, and two stacked forms would be worse than one.
     */
    fun hold(product: ShareTarget.Product) {
        _pending.value = product
    }

    /**
     * Clears [product] **only if it is still the one waiting** — consuming an
     * older link after a newer share landed must not eat the newer one.
     * Compare-and-set rather than a plain write for exactly that reason.
     */
    fun consume(product: ShareTarget.Product) {
        _pending.compareAndSet(product, null)
    }
}
