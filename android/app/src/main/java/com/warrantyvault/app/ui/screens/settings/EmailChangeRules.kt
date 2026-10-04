package com.warrantyvault.app.ui.screens.settings

/**
 * Client-side rules for the email-change form
 * (`POST /api/v1/auth/change-email` → `/confirm-email-change`).
 *
 * Pure Kotlin — no `android.*`, no Compose — so every branch below is pinned by
 * an ordinary JVM test (`test/.../ui/screens/settings/EmailChangeRulesTest.kt`).
 * Ported from `ios/Sources/WarrantyVaultKit/EmailChange.swift`, which is the same
 * screen on the other native client.
 */
object EmailChangeRules {

    /**
     * The server's TTL for both email-change and password-reset tokens
     * (`api/internal/services/`, migration `0009`). Duplicated as a constant
     * because the UI states it ("expires in %d minutes") and the response body
     * does not carry it — if the server ever changes it, this string lies.
     */
    const val TOKEN_TTL_MINUTES: Int = 30

    /**
     * Trim + lowercase: exactly what the server does before comparing or storing
     * the address. Normalising locally means the address echoed back to the user
     * ("open the inbox of …") is the address that was actually requested.
     */
    fun normalizedEmail(raw: String): String = raw.trim().lowercase()

    /**
     * Extracts the raw token from whatever the user pasted.
     *
     * The email shows the code as text *and* a link, and the link is the larger
     * tap target — so people copy the whole
     * `<APP_URL>/confirm-email/<token>` URL. Posting that URL as the token fails
     * with `invalid_email_change_token` for no good reason, so a pasted
     * confirm-email link is reduced to its last path component (a trailing
     * whitespace run, query string and fragment are dropped). Anything that does
     * not look like a link is returned trimmed and otherwise untouched, because a
     * bare token must never be mangled.
     */
    fun tokenFromPasted(raw: String): String {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return ""

        val markerAt = trimmed.indexOf(LINK_MARKER)
        if (markerAt < 0) return trimmed

        val afterMarker = trimmed.substring(markerAt + LINK_MARKER.length)
        return afterMarker
            .takeWhile { !it.isWhitespace() }
            .substringBefore('?')
            .substringBefore('#')
            .trim('/')
    }

    /** Step 1 is submittable once both required fields carry something. */
    fun canRequest(newEmail: String, currentPassword: String): Boolean =
        normalizedEmail(newEmail).isNotEmpty() && currentPassword.isNotEmpty()

    /** Step 2 is submittable once the pasted text yields a non-empty token. */
    fun canConfirm(pastedToken: String): Boolean = tokenFromPasted(pastedToken).isNotEmpty()

    private const val LINK_MARKER = "/confirm-email/"
}
