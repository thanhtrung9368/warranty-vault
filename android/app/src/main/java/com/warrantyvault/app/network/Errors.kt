package com.warrantyvault.app.network

import android.content.Context
import com.warrantyvault.app.R
import retrofit2.HttpException

/** Try to extract our standard error envelope from a Retrofit failure. */
fun Throwable.toApiError(json: kotlinx.serialization.json.Json): ApiErrorEnvelope? {
    if (this !is HttpException) return null
    val raw = response()?.errorBody()?.string() ?: return null
    return runCatching { json.decodeFromString(ApiErrorEnvelope.serializer(), raw) }.getOrNull()
}

/**
 * The message to show the user.
 *
 * The API always wins when it sent one: since phase 1 of `docs/I18N_PLAN.md`
 * every converted endpoint returns `message` already translated, in the language
 * this client asked for with `Accept-Language` (see [AuthInterceptor]). Nothing
 * below this line is a translation of a server string — it is the fallback for a
 * failure that never reached the API or whose body carried no message at all.
 *
 * ## Two overloads, on purpose
 *
 * The 2-argument form is language-free (Vietnamese) and remains for the code
 * paths that have no `Context` to hand — a pure formatter, a ViewModel that was
 * not given one. The [Context] form is what every converted screen should use:
 * it resolves the two fallback sentences from resources, so a dead socket in
 * English mode does not print "Lỗi mạng".
 */
fun Throwable.toUserMessage(json: kotlinx.serialization.json.Json): String {
    val env = toApiError(json)
    if (env?.message != null) return env.message
    if (this is HttpException) return "Lỗi máy chủ (${code()})"
    return localizedMessage ?: "Lỗi mạng"
}

/** [toUserMessage] with the fallback sentences resolved in the UI language. */
fun Throwable.toUserMessage(json: kotlinx.serialization.json.Json, context: Context): String {
    val env = toApiError(json)
    if (env?.message != null) return env.message
    if (this is HttpException) return context.getString(R.string.error_server_code, code())
    return localizedMessage ?: context.getString(R.string.error_network)
}

fun Throwable.fieldErrors(json: kotlinx.serialization.json.Json): Map<String, List<String>> {
    return toApiError(json)?.fieldErrors ?: emptyMap()
}

val Throwable.isUnauthorized: Boolean
    get() = this is HttpException && code() == 401
