package com.warrly.network

import okhttp3.Interceptor
import okhttp3.Response

/**
 * OkHttp interceptor that attaches the two headers every request to the Go API
 * wants:
 *
 *  - `Authorization: Bearer <token>` when a token is available. Read fresh on
 *    each request so login/logout doesn't require rebuilding Retrofit.
 *  - `Accept-Language: <tag>` — the language the UI is *actually rendering*
 *    (`docs/I18N_PLAN.md` §2.2). The API resolves its own language from
 *    `?lang=` → `Accept-Language` → `User.locale` → `en`, and since phase 1 of
 *    that plan every converted endpoint answers with translated copy. Without
 *    this header a Vietnamese screen prints English validation errors, and with
 *    the wrong value it prints the other language's.
 *
 * The value is read through a provider rather than captured once, for the same
 * reason as the token: the user can change it in Settings without a restart, and
 * `ApiClient.build()` runs once in `App.onCreate`.
 *
 * The header is only ADDED, never overwritten — a request that already carries
 * an explicit `Accept-Language` keeps it.
 *
 * This is the only interceptor the app installs on the Retrofit client
 * (`ApiClient.build`); the raw file-download client derives from the same base
 * client but deliberately carries neither header, because the caller attaches
 * them per request.
 *
 * ## Dead-session observer
 *
 * [#onUnauthorized] is the single "the server no longer accepts this session"
 * hook. It fires once per request when the request carried a bearer and the
 * response is `401` — the only status that means the token is dead server-side
 * (revoked from another device, expired, password changed elsewhere). The
 * caller (`App.onCreate`) forwards it to `AuthStore.handleUnauthorizedSession`,
 * which makes the transition one-shot; this interceptor does not retry and does
 * not touch the response.
 *
 * Deliberately narrow, mirroring iOS `APIClient.setUnauthorizedObserver`:
 *  * a request with no bearer never notifies — there is no session to end;
 *  * the credential-verification calls (`/auth/login`, `/auth/register`) never
 *    notify even if an old bearer happened to ride along: their `401` is an
 *    answer about the credentials just typed, not about the stored session;
 *  * transport failures, timeouts, decoding failures and `5xx` never notify —
 *    those mean "try again", not "signed out" (see `AuthStore.bootstrap`).
 */
class AuthInterceptor(
    private val tokenProvider: () -> String?,
    private val languageProvider: () -> String? = { null },
    private val onUnauthorized: () -> Unit = {},
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val builder = request.newBuilder()
        var touched = false

        // A caller may already have attached a bearer; count it too, so the
        // observer follows "the request carried a bearer", not "we added one".
        var carriedBearer = request.header("Authorization")?.startsWith("Bearer ") == true

        tokenProvider()?.takeIf { it.isNotBlank() }?.let { token ->
            builder.addHeader("Authorization", "Bearer $token")
            touched = true
            carriedBearer = true
        }

        if (request.header("Accept-Language") == null) {
            languageProvider()?.takeIf { it.isNotBlank() }?.let { tag ->
                builder.addHeader("Accept-Language", tag)
                touched = true
            }
        }

        val response = chain.proceed(if (touched) builder.build() else request)

        if (carriedBearer && response.code == 401 && !isCredentialVerification(request)) {
            onUnauthorized()
        }
        return response
    }

    /** Login/register answer 401 about the password, never about a session. */
    private fun isCredentialVerification(request: okhttp3.Request): Boolean {
        val path = request.url.encodedPath.trimEnd('/')
        return path.endsWith("/auth/login") || path.endsWith("/auth/register")
    }
}
