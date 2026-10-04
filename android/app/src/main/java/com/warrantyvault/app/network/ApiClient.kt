package com.warrantyvault.app.network

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit

object ApiClient {

    val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }

    // Shared OkHttpClient — connection pool, thread pool and dispatcher are
    // reused across the whole app. The Retrofit client (built per-session in
    // `build()`) and the file-download client (`fileClient`) both derive from
    // this via `newBuilder()` so they share those resources.
    private val baseClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    // Plain client for authenticated raw downloads (encrypted attachments).
    // Longer read timeout so large file streams don't get cut off; the
    // Authorization header is added per-request by the caller.
    val fileClient: OkHttpClient by lazy {
        baseClient.newBuilder()
            .readTimeout(60, TimeUnit.SECONDS)
            .build()
    }

    /**
     * [languageProvider] is the BCP-47 tag the UI is currently rendering in
     * (`"vi"` / `"en"`), attached as `Accept-Language` on every call so the Go
     * API's error copy comes back in the language on screen. It defaults to
     * `null` so the network tests can build a client without one.
     *
     * It deliberately sits BEFORE [tokenProvider] so that the long-standing
     * trailing-lambda form `ApiClient.build(url) { token }` keeps binding to the
     * token provider — a defaulted parameter appended at the end would silently
     * steal the lambda instead (it did, and the compiler caught it, but the
     * ordering is what keeps every existing call site unchanged).
     */
    fun build(
        baseUrl: String,
        languageProvider: () -> String? = { null },
        tokenProvider: () -> String?,
    ): ApiService {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
        }
        val ok = baseClient.newBuilder()
            .addInterceptor(AuthInterceptor(tokenProvider, languageProvider))
            .addInterceptor(logging)
            .build()

        return Retrofit.Builder()
            .baseUrl(if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/")
            .client(ok)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ApiService::class.java)
    }
}
