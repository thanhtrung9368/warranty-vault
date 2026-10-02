package com.warrantyvault.app.network

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

/**
 * `Errors.kt` turns a Retrofit failure into the Vietnamese string the UI shows.
 * The server writes `{"error":..,"message":..,"fieldErrors":{..}}`, so these
 * tests pin down every branch of the fallback ladder.
 */
class ErrorsTest {

    private val json = ApiClient.json

    private fun httpError(code: Int, body: String): HttpException =
        HttpException(Response.error<Unit>(code, body.toResponseBody("application/json".toMediaType())))

    @Test
    fun toApiError_returnsNullWhenThereIsNoHttpEnvelope() {
        assertNull(IOException("boom").toApiError(json))

        // HTTP failure, but the body is not our envelope (e.g. an HTML proxy page).
        assertNull(httpError(502, "<html><body>Bad gateway</body></html>").toApiError(json))
        assertNull(httpError(500, "").toApiError(json))
    }

    @Test
    fun toApiError_decodesTheStandardEnvelope() {
        val error = httpError(
            409,
            """{"error":"limit_reached","message":"Bạn đã đạt giới hạn 50 thiết bị","fieldErrors":{"name":["Tên không hợp lệ"]}}""",
        )

        val env = error.toApiError(json)

        assertEquals("limit_reached", env?.error)
        assertEquals("Bạn đã đạt giới hạn 50 thiết bị", env?.message)
        assertEquals(listOf("Tên không hợp lệ"), env?.fieldErrors?.get("name"))
    }

    @Test
    fun toUserMessage_prefersTheServerVietnameseMessage() {
        val error = httpError(400, """{"error":"bad_request","message":"Ngày mua không hợp lệ"}""")

        assertEquals("Ngày mua không hợp lệ", error.toUserMessage(json))
    }

    @Test
    fun toUserMessage_fallsBackToTheStatusThenToTheTransportMessage() {
        assertEquals("Lỗi máy chủ (500)", httpError(500, """{"error":"internal"}""").toUserMessage(json))
        assertEquals("Lỗi máy chủ (404)", httpError(404, """{"error":"not_found"}""").toUserMessage(json))

        assertEquals("Không có kết nối mạng", IOException("Không có kết nối mạng").toUserMessage(json))
        assertEquals("Lỗi mạng", IOException().toUserMessage(json))
    }

    @Test
    fun fieldErrors_exposesValidationMapAndIsEmptyOtherwise() {
        val withErrors = httpError(
            422,
            """{"error":"validation_failed","fieldErrors":{"email":["Email đã được sử dụng","Email không hợp lệ"]}}""",
        )
        assertEquals(2, withErrors.fieldErrors(json)["email"]?.size)

        // Envelope without fieldErrors, and a plain transport error.
        assertEquals(emptyMap<String, List<String>>(), httpError(400, """{"error":"bad"}""").fieldErrors(json))
        assertEquals(emptyMap<String, List<String>>(), IOException("boom").fieldErrors(json))
    }

    @Test
    fun isUnauthorized_isTrueOnlyFor401() {
        assertTrue(httpError(401, """{"error":"unauthorized"}""").isUnauthorized)
        assertFalse(httpError(403, """{"error":"forbidden"}""").isUnauthorized)
        assertFalse(httpError(500, """{"error":"internal"}""").isUnauthorized)
        assertFalse(IOException("boom").isUnauthorized)
    }
}
