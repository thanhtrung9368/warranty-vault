package com.warrantyvault.app.network

import retrofit2.HttpException

/** Try to extract our standard error envelope from a Retrofit failure. */
fun Throwable.toApiError(json: kotlinx.serialization.json.Json): ApiErrorEnvelope? {
    if (this !is HttpException) return null
    val raw = response()?.errorBody()?.string() ?: return null
    return runCatching { json.decodeFromString(ApiErrorEnvelope.serializer(), raw) }.getOrNull()
}

fun Throwable.toUserMessage(json: kotlinx.serialization.json.Json): String {
    val env = toApiError(json)
    if (env?.message != null) return env.message
    if (this is HttpException) return "Lỗi máy chủ (${code()})"
    return localizedMessage ?: "Lỗi mạng"
}

fun Throwable.fieldErrors(json: kotlinx.serialization.json.Json): Map<String, List<String>> {
    return toApiError(json)?.fieldErrors ?: emptyMap()
}

val Throwable.isUnauthorized: Boolean
    get() = this is HttpException && code() == 401
