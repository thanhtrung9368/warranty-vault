package com.warrantyvault.app.network

import okhttp3.Interceptor
import okhttp3.Response

/**
 * OkHttp interceptor that injects Authorization: Bearer <token> when a
 * token is available. Token is read fresh on each request so login/logout
 * doesn't require rebuilding Retrofit.
 */
class AuthInterceptor(private val tokenProvider: () -> String?) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = tokenProvider()
        val req = if (token.isNullOrBlank()) {
            chain.request()
        } else {
            chain.request().newBuilder()
                .addHeader("Authorization", "Bearer $token")
                .build()
        }
        return chain.proceed(req)
    }
}
