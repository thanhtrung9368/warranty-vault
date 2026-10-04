package com.warrantyvault.app.network

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
 */
class AuthInterceptor(
    private val tokenProvider: () -> String?,
    private val languageProvider: () -> String? = { null },
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val builder = request.newBuilder()
        var touched = false

        tokenProvider()?.takeIf { it.isNotBlank() }?.let { token ->
            builder.addHeader("Authorization", "Bearer $token")
            touched = true
        }

        if (request.header("Accept-Language") == null) {
            languageProvider()?.takeIf { it.isNotBlank() }?.let { tag ->
                builder.addHeader("Accept-Language", tag)
                touched = true
            }
        }

        return chain.proceed(if (touched) builder.build() else request)
    }
}
