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

    fun build(baseUrl: String, tokenProvider: () -> String?): ApiService {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
        }
        val ok = baseClient.newBuilder()
            .addInterceptor(AuthInterceptor(tokenProvider))
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
