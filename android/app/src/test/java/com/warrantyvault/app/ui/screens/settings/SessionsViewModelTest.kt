package com.warrantyvault.app.ui.screens.settings

import com.warrantyvault.app.network.SessionListResponse
import com.warrantyvault.app.network.SessionRevokeResult
import com.warrantyvault.app.network.SessionSummary
import com.warrantyvault.app.testing.FakeApiService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException

/** `SessionsViewModel` + the pure copy/decision helpers behind the screen. */
@OptIn(ExperimentalCoroutinesApi::class)
class SessionsViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun session(
        id: String,
        label: String? = "Pixel 8",
        platform: String? = "android",
        current: Boolean = false,
        lastSeenAt: String = "2026-03-01T09:30:00Z",
        expiresAt: String = "2026-04-01T09:30:00Z",
    ) = SessionSummary(
        id = id,
        deviceLabel = label,
        platform = platform,
        current = current,
        lastSeenAt = lastSeenAt,
        createdAt = "2026-02-01T09:30:00Z",
        expiresAt = expiresAt,
    )

    private class FakeSessionsApi(
        private val list: suspend () -> SessionListResponse,
    ) : FakeApiService() {
        override suspend fun listSessions(): SessionListResponse = list()
    }

    // ---- ViewModel ----

    @Test
    fun load_publishesTheActiveSessions() = runTest(dispatcher) {
        val sessions = listOf(session("s-1", current = true), session("s-2", label = "MacBook"))
        val vm = SessionsViewModel(FakeSessionsApi { SessionListResponse(sessions) })

        vm.load()
        advanceUntilIdle()

        assertEquals(SessionsViewModel.State.Loaded(sessions), vm.state.value)
        assertEquals(1, (vm.state.value as SessionsViewModel.State.Loaded).sessions.count { it.current })
    }

    @Test
    fun load_reportsFailuresWithTheVietnameseMessage() = runTest(dispatcher) {
        val vm = SessionsViewModel(FakeSessionsApi { throw IOException("Không có kết nối mạng") })

        vm.load()
        advanceUntilIdle()

        assertEquals(SessionsViewModel.State.Error("Không có kết nối mạng"), vm.state.value)
    }

    @Test
    fun removeLocally_dropsOnlyTheRevokedRow() = runTest(dispatcher) {
        val vm = SessionsViewModel(
            FakeSessionsApi { SessionListResponse(listOf(session("s-1"), session("s-2"))) },
        )
        vm.load()
        advanceUntilIdle()

        vm.removeLocally("s-2")

        val left = (vm.state.value as SessionsViewModel.State.Loaded).sessions
        assertEquals(listOf("s-1"), left.map { it.id })
    }

    // ---- deviceLabel fallback (the API documents null → "Không rõ thiết bị") ----

    @Test
    fun deviceLabel_nullOrBlank_usesTheDocumentedFallback() {
        assertEquals(UNKNOWN_DEVICE_LABEL, sessionDeviceLabel(null))
        assertEquals(UNKNOWN_DEVICE_LABEL, sessionDeviceLabel(""))
        assertEquals(UNKNOWN_DEVICE_LABEL, sessionDeviceLabel("   "))
    }

    @Test
    fun deviceLabel_isTrimmedAndKeptWhenPresent() {
        assertEquals("iPhone của A", sessionDeviceLabel("  iPhone của A "))
        assertEquals("Không rõ thiết bị", UNKNOWN_DEVICE_LABEL)
    }

    // ---- platform → Vietnamese ----

    @Test
    fun platformLabel_mapsSessionAndLegacyPushCodes() {
        assertEquals("Android", sessionPlatformLabel("android"))
        assertEquals("Android", sessionPlatformLabel("FCM"))
        assertEquals("iOS", sessionPlatformLabel("ios"))
        assertEquals("iOS", sessionPlatformLabel("apns"))
        assertEquals("Web", sessionPlatformLabel("web"))
    }

    @Test
    fun platformLabel_hidesNothingToSayAndKeepsUnknownCodesReadable() {
        assertNull(sessionPlatformLabel(null))
        assertNull(sessionPlatformLabel("  "))
        // An unseen code is data, not a broken label — show it rather than lie.
        assertEquals("windows", sessionPlatformLabel("windows"))
    }

    // ---- expiry date label ----

    @Test
    fun dateLabel_readsTheDateHalfOnly() {
        assertEquals("01/03/2026", sessionDateLabel("2026-03-01T09:30:00Z"))
        assertEquals("01/03/2026", sessionDateLabel("2026-03-01"))
    }

    @Test
    fun dateLabel_degradesToADashInsteadOfThrowing() {
        assertEquals("—", sessionDateLabel(null))
        assertEquals("—", sessionDateLabel(""))
        assertEquals("—", sessionDateLabel("not-a-date"))
        assertEquals("—", sessionDateLabel("2026-3-1"))
    }

    // ---- revoke outcome ----

    @Test
    fun revokeOutcome_currentSession_signsOutAndPrefersTheServerMessage() {
        val outcome = sessionRevokeOutcome(
            SessionRevokeResult(
                current = true,
                message = "Đã thu hồi phiên đăng nhập. Đây là phiên bạn đang dùng — hãy đăng nhập lại.",
            ),
        )

        assertTrue(outcome.signOut)
        assertEquals(
            "Đã thu hồi phiên đăng nhập. Đây là phiên bạn đang dùng — hãy đăng nhập lại.",
            outcome.message,
        )
    }

    @Test
    fun revokeOutcome_siblingSession_keepsThisDeviceSignedIn() {
        val outcome = sessionRevokeOutcome(
            SessionRevokeResult(current = false, message = "Đã thu hồi phiên đăng nhập."),
        )

        assertFalse(outcome.signOut)
        assertEquals("Đã thu hồi phiên đăng nhập.", outcome.message)
    }

    @Test
    fun revokeOutcome_alreadyRevoked_isSuccessNotAnError() {
        val outcome = sessionRevokeOutcome(
            SessionRevokeResult(
                current = false,
                alreadyRevoked = true,
                message = "Phiên đăng nhập này đã được thu hồi trước đó.",
            ),
        )

        assertFalse(outcome.signOut)
        assertEquals("Phiên đăng nhập này đã được thu hồi trước đó.", outcome.message)
    }

    @Test
    fun revokeOutcome_blankServerMessage_fallsBackToVietnameseCopy() {
        assertEquals(
            "Đã thu hồi phiên đăng nhập.",
            sessionRevokeOutcome(SessionRevokeResult(message = "  ")).message,
        )
        assertEquals(
            "Phiên đăng nhập này đã được thu hồi trước đó.",
            sessionRevokeOutcome(SessionRevokeResult(alreadyRevoked = true)).message,
        )
        // A current-session revoke with no copy still has to sign the caller out.
        assertTrue(sessionRevokeOutcome(SessionRevokeResult(current = true)).signOut)
    }
}
