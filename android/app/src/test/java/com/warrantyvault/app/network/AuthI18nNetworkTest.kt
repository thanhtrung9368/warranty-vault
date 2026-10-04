package com.warrantyvault.app.network

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The i18n plumbing and the email-change flow, over a real OkHttp/Retrofit stack
 * against MockWebServer.
 *
 * Two things here can break silently in a refactor and are worth a wire-level
 * test rather than a unit test of a helper:
 *
 *  - `Accept-Language` — if it stops being attached, nothing fails; the API just
 *    quietly answers in its English default (`docs/I18N_PLAN.md` §2.2) inside a
 *    Vietnamese screen. `AuthInterceptor` reads it per request through a
 *    provider, and this pins that the provider is actually consulted.
 *  - the two email-change endpoints — they are the flow Android was missing
 *    entirely, and `PATCH /auth/me` is where a client that gets the shape wrong
 *    would put `newEmail` (a 400 there, a 200 here).
 */
class AuthI18nNetworkTest {

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
        language: String? = "vi",
        baseUrl: String = server.url("/").toString(),
    ): ApiService = ApiClient.build(
        baseUrl = baseUrl,
        tokenProvider = { token },
        languageProvider = { language },
    )

    private fun enqueueJson(body: String, code: Int = 200) {
        server.enqueue(
            MockResponse()
                .setResponseCode(code)
                .addHeader("Content-Type", "application/json")
                .setBody(body),
        )
    }

    private val userJson = """{"user":{"id":"u1","email":"an@example.com","name":"Nguyễn An"}}"""

    // ---- Accept-Language ----

    @Test
    fun everyRequestCarriesTheUiLanguageAsAcceptLanguage() = runBlocking {
        enqueueJson(userJson)

        api(language = "vi").me()

        val recorded = server.takeRequest()
        assertEquals("vi", recorded.getHeader("Accept-Language"))
        // And it does not disturb the auth header.
        assertEquals("Bearer tok-123", recorded.getHeader("Authorization"))
    }

    /**
     * The provider is read PER REQUEST, not captured when Retrofit is built — the
     * whole point of passing a lambda from `App.onCreate`, which runs once. A
     * captured value would freeze the language until the process died.
     */
    @Test
    fun languageIsReadFreshOnEveryRequest() = runBlocking {
        var language = "vi"
        val service = ApiClient.build(
            baseUrl = server.url("/").toString(),
            tokenProvider = { "tok-123" },
            languageProvider = { language },
        )

        enqueueJson(userJson)
        service.me()
        assertEquals("vi", server.takeRequest().getHeader("Accept-Language"))

        language = "en"
        enqueueJson(userJson)
        service.me()
        assertEquals("en", server.takeRequest().getHeader("Accept-Language"))
    }

    @Test
    fun blankOrMissingLanguageSendsNoHeaderAtAll() = runBlocking {
        // A blank `Accept-Language:` is a different request from no header, and
        // the API would have to decide what it means. It is simply not sent.
        enqueueJson(userJson)
        api(language = null).me()
        assertNull(server.takeRequest().getHeader("Accept-Language"))

        enqueueJson(userJson)
        api(language = "   ").me()
        assertNull(server.takeRequest().getHeader("Accept-Language"))
    }

    // ---- PATCH /auth/me ----

    /**
     * The language switch sends `locale` ALONE. If `displayName` rode along — the
     * other half of this endpoint — a language change would also rewrite the
     * user's name (and the server treats the two keys independently, so it would
     * not complain).
     */
    @Test
    fun updateLocaleSendsOnlyTheLocaleKey() = runBlocking {
        enqueueJson(userJson)

        api().updateLocale(UpdateLocaleInput("vi"))

        val recorded = server.takeRequest()
        assertEquals("PATCH", recorded.method)
        assertEquals("/api/v1/auth/me", recorded.path)
        val body = recorded.body.readUtf8()
        assertEquals("""{"locale":"vi"}""", body)
        assertTrue("must not carry displayName: $body", !body.contains("displayName"))
    }

    /** Saving a name must not carry a `locale` either — same rule, other side. */
    @Test
    fun updateProfileStillSendsDisplayNameAlone() = runBlocking {
        enqueueJson(userJson)

        api().updateProfile(UpdateProfileInput("Nguyễn An"))

        val body = server.takeRequest().body.readUtf8()
        assertEquals("""{"displayName":"Nguyễn An"}""", body)
        assertTrue("must not carry locale: $body", !body.contains("locale"))
    }

    /** `User.locale` decodes when present and defaults to null when absent. */
    @Test
    fun userLocaleDecodesAndIsOptional() {
        val withLocale = ApiClient.json.decodeFromString(
            User.serializer(),
            """{"id":"u1","email":"an@example.com","locale":"vi"}""",
        )
        assertEquals("vi", withLocale.locale)

        val withoutLocale = ApiClient.json.decodeFromString(
            User.serializer(),
            """{"id":"u1","email":"an@example.com"}""",
        )
        // `omitempty` server-side: an account that never chose sends no byte, and
        // "absent" must not become "chose English".
        assertNull(withoutLocale.locale)
    }

    // ---- Email change (the flow Android was missing) ----

    @Test
    fun changeEmailPostsTheNewAddressWithTheCurrentPassword() = runBlocking {
        enqueueJson("""{"ok":true,"message":"Đã ghi nhận yêu cầu"}""")

        val res = api().changeEmail(
            ChangeEmailRequest(newEmail = "moi@example.com", currentPassword = "s3cret"),
        )

        assertEquals("Đã ghi nhận yêu cầu", res.message)
        assertTrue(res.ok)

        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals("/api/v1/auth/change-email", recorded.path)
        assertEquals(
            """{"newEmail":"moi@example.com","currentPassword":"s3cret"}""",
            recorded.body.readUtf8(),
        )

        // Regression guard for the bug this feature fixes: the address must go to
        // /auth/change-email, never to PATCH /auth/me (which answers 400).
        assertTrue(recorded.path != "/api/v1/auth/me")
    }

    @Test
    fun confirmEmailChangePostsTheTokenAndNeedsNoBearer() = runBlocking {
        enqueueJson("""{"ok":true,"message":"Đã đổi email"}""")

        // The token IS the credential here — the contract takes no bearer token
        // because the mailed link is usually opened on another device.
        val res = api(token = null).confirmEmailChange(ConfirmEmailChangeRequest("abc123"))

        assertEquals("Đã đổi email", res.message)

        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals("/api/v1/auth/confirm-email-change", recorded.path)
        assertEquals("""{"token":"abc123"}""", recorded.body.readUtf8())
    }
}
