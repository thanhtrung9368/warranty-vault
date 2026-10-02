package com.warrantyvault.app.network

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import retrofit2.HttpException

/**
 * End-to-end checks over a real OkHttp/Retrofit stack against MockWebServer:
 * URL building, the bearer-token interceptor, request body encoding and the
 * error path that `Errors.kt` later formats.
 */
class ApiClientNetworkTest {

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun api(
        token: String? = "tok-123",
        baseUrl: String = server.url("/").toString(),
    ): ApiService = ApiClient.build(baseUrl) { token }

    private fun enqueueJson(body: String, code: Int = 200) {
        server.enqueue(
            MockResponse()
                .setResponseCode(code)
                .addHeader("Content-Type", "application/json")
                .setBody(body),
        )
    }

    @Test
    fun me_sendsBearerTokenAndDecodesTheUser() = runBlocking {
        enqueueJson("""{"user":{"id":"u1","email":"an@example.com","name":"Nguyễn An","aiOptIn":true}}""")

        val me = api().me()

        assertEquals("u1", me.user.id)
        assertEquals("Nguyễn An", me.user.name)
        assertTrue(me.user.aiOptIn)

        val recorded = server.takeRequest()
        assertEquals("GET", recorded.method)
        assertEquals("/api/v1/auth/me", recorded.path)
        assertEquals("Bearer tok-123", recorded.getHeader("Authorization"))

        // No token (or a blank one) must not send an empty Authorization header.
        enqueueJson("""{"user":{"id":"u1","email":"an@example.com"}}""")
        api(token = null).me()
        assertNull(server.takeRequest().getHeader("Authorization"))

        enqueueJson("""{"user":{"id":"u1","email":"an@example.com"}}""")
        api(token = "   ").me()
        assertNull(server.takeRequest().getHeader("Authorization"))
    }

    @Test
    fun postBody_isJsonEncodedAndBaseUrlWithoutTrailingSlashStillWorks() = runBlocking {
        enqueueJson("""{"accessToken":"tok","expiresAt":"2025-01-01T00:00:00Z","user":{"id":"u1","email":"an@example.com"}}""")

        // No trailing slash: ApiClient must add it before Retrofit sees the URL.
        val service = api(baseUrl = server.url("/").toString().removeSuffix("/"))
        service.login(LoginInput(email = "an@example.com", password = "s3cret"))

        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals("/api/v1/auth/login", recorded.path)
        assertTrue(
            "unexpected content type: ${recorded.getHeader("Content-Type")}",
            recorded.getHeader("Content-Type")!!.startsWith("application/json"),
        )

        val body = recorded.body.readUtf8()
        assertTrue("email must be sent: $body", body.contains("\"email\":\"an@example.com\""))
        assertTrue("platform default must be sent: $body", body.contains("\"platform\":\"android\""))
        assertTrue("null deviceLabel must be dropped: $body", !body.contains("deviceLabel"))
    }

    @Test
    fun queryParameters_areForwardedAndRemindersDefaultToThirtyDays() = runBlocking {
        enqueueJson("""{"devices":[]}""")
        api().listDevices(q = "mac", category = "LAPTOP", status = "ACTIVE", sort = "name", dir = "asc")
        assertEquals(
            "/api/v1/devices?q=mac&category=LAPTOP&status=ACTIVE&sort=name&dir=asc",
            server.takeRequest().path,
        )

        enqueueJson("""{"reminders":[]}""")
        api().listUpcomingReminders()
        assertEquals("/api/v1/reminders?withinDays=30", server.takeRequest().path)

        enqueueJson("""{"reminders":[]}""")
        api().listUpcomingReminders(withinDays = 7)
        assertEquals("/api/v1/reminders?withinDays=7", server.takeRequest().path)
    }

    @Test
    fun errorResponse_surfacesAsHttpExceptionCarryingTheVietnameseMessage() {
        enqueueJson("""{"error":"unauthorized","message":"Phiên đăng nhập đã hết hạn"}""", code = 401)

        val thrown = assertThrows(HttpException::class.java) {
            runBlocking { api().me() }
        }

        assertEquals(401, thrown.code())
        assertTrue(thrown.isUnauthorized)
        assertEquals("Phiên đăng nhập đã hết hạn", thrown.toUserMessage(ApiClient.json))
    }
}
