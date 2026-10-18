package com.warrly.auth

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The app lock's state machine — the Android twin of iOS `AppLockTests`
 * (`ios/Tests/WarrlyKitTests/AppLockTests.swift`), case for case where the
 * platforms line up.
 *
 * These tests never touch `androidx.biometric`: `AppLockAuthenticator`,
 * `AppLockStorage` and the capability snapshot are all faked, so every branch —
 * including the ones that must NOT lock the user out — is reachable
 * deterministically on the JVM.
 *
 * **What is NOT covered here, and cannot be:** the real system prompt. Whether
 * the fingerprint/face dialog appears, whether a device-credential fallback
 * actually shows up on a given OEM, and how the cover looks on screen all
 * require a device or an emulator and are untested. `BiometricAppLockAuthenticator`
 * and `AppLockScreen` have no unit test by design.
 */
class AppLockStoreTest {

    // ---- Fakes -------------------------------------------------------------

    private class FakeAuthenticator(
        var result: AppLockAuthResult = AppLockAuthResult.Success,
    ) : AppLockAuthenticator {

        var calls = 0
        var lastReason: String? = null

        /** When set, `authenticate` suspends until the test completes it. */
        var gate: CompletableDeferred<AppLockAuthResult>? = null

        override suspend fun authenticate(reason: String): AppLockAuthResult {
            calls++
            lastReason = reason
            gate?.let { return it.await() }
            return result
        }
    }

    private class MemoryStorage(override var isEnabled: Boolean = false) : AppLockStorage

    /** Mutable so a test can simulate the credential being removed at runtime. */
    private class Capabilities(var value: AppLockAvailability)

    private fun supported(
        biometricHardware: Boolean = true,
        biometricsEnrolled: Boolean = true,
        deviceSecured: Boolean = true,
    ) = AppLockAvailability(biometricHardware, biometricsEnrolled, deviceSecured)

    private fun noCredential() =
        AppLockAvailability(biometricHardware = false, biometricsEnrolled = false, deviceSecured = false)

    private data class Fixture(
        val store: AppLockStore,
        val auth: FakeAuthenticator,
        val storage: MemoryStorage,
        val capabilities: Capabilities,
    )

    private fun makeStore(
        enabled: Boolean = false,
        availability: AppLockAvailability = supported(),
        result: AppLockAuthResult = AppLockAuthResult.Success,
    ): Fixture {
        val auth = FakeAuthenticator(result)
        val storage = MemoryStorage(enabled)
        val capabilities = Capabilities(availability)
        val store = AppLockStore(
            authenticator = auth,
            storage = storage,
            capabilities = { capabilities.value },
        )
        return Fixture(store, auth, storage, capabilities)
    }

    private companion object {
        const val REASON = "Mở khoá Warrly để xem dữ liệu bảo hành."
    }

    // ---- Availability rules ------------------------------------------------

    @Test
    fun lockCanOnlyBeEnabledWithEnrolledBiometricsAndADeviceCredential() {
        val ok = supported()
        assertTrue(ok.canEnableLock)
        assertNull(ok.unavailable)

        val noCredential = noCredential()
        assertFalse(noCredential.canEnableLock)
        assertEquals(AppLockUnavailable.NO_DEVICE_CREDENTIAL, noCredential.unavailable)

        val noHardware = supported(biometricHardware = false, biometricsEnrolled = false)
        assertFalse(noHardware.canEnableLock)
        assertEquals(AppLockUnavailable.NO_BIOMETRIC_HARDWARE, noHardware.unavailable)

        val notEnrolled = supported(biometricsEnrolled = false)
        assertFalse(notEnrolled.canEnableLock)
        assertEquals(AppLockUnavailable.BIOMETRICS_NOT_ENROLLED, notEnrolled.unavailable)
    }

    @Test
    fun aDeviceWithoutAScreenLockNeverLocksEvenIfThePreferenceSaysSo() {
        val f = makeStore(enabled = true, availability = noCredential())
        assertFalse(f.store.isLocked.value)
        assertFalse(f.store.isEnabled.value)
        assertFalse("the unusable preference is cleared", f.storage.isEnabled)
        assertEquals(AppLockNotice.DEVICE_CREDENTIAL_LOST, f.store.autoDisabledNotice.value)
    }

    // ---- Defaults / cold launch -------------------------------------------

    @Test
    fun lockIsOffByDefaultAndNeverPrompts() {
        val f = makeStore()
        assertFalse(f.store.isEnabled.value)
        assertFalse(f.store.isLocked.value)
        assertEquals("no prompt without an opt-in", 0, f.auth.calls)
    }

    @Test
    fun coldLaunchWithLockEnabledStartsLockedWithoutPrompting() {
        val f = makeStore(enabled = true)
        assertTrue(f.store.isEnabled.value)
        assertTrue(
            "protected content must never render before authentication",
            f.store.isLocked.value,
        )
        assertEquals("the lock screen / ON_START owns the prompt", 0, f.auth.calls)
    }

    // ---- Turning it on / off ----------------------------------------------

    @Test
    fun enablingRequiresOneSuccessfulAuthentication() = runTest {
        val f = makeStore()
        f.store.setEnabled(true, REASON)

        assertEquals(1, f.auth.calls)
        assertTrue(f.store.isEnabled.value)
        assertTrue("the preference is persisted", f.storage.isEnabled)
        assertFalse("just authenticated — don't immediately re-prompt", f.store.isLocked.value)
        assertNull(f.store.lastFailure.value)
        assertEquals(REASON, f.auth.lastReason)
    }

    @Test
    fun enablingIsRefusedWhenAuthenticationFails() = runTest {
        val f = makeStore(result = AppLockAuthResult.Failed(AppLockFailure.AUTHENTICATION_FAILED))
        f.store.setEnabled(true, REASON)

        assertFalse(f.store.isEnabled.value)
        assertFalse(f.storage.isEnabled)
        assertEquals(AppLockFailure.AUTHENTICATION_FAILED, f.store.lastFailure.value)
    }

    @Test
    fun enablingIsRefusedWithoutPromptingWhenBiometricsAreNotEnrolled() = runTest {
        val f = makeStore(availability = supported(biometricsEnrolled = false))
        f.store.setEnabled(true, REASON)

        assertEquals("never prompt for a lock that cannot be satisfied", 0, f.auth.calls)
        assertFalse(f.store.isEnabled.value)
        assertFalse(f.storage.isEnabled)
    }

    @Test
    fun enablingIsRefusedWithoutPromptingWhenTheDeviceHasNoCredential() = runTest {
        val f = makeStore(availability = noCredential())
        f.store.setEnabled(true, REASON)

        assertEquals(0, f.auth.calls)
        assertFalse(f.store.isEnabled.value)
        assertFalse(f.storage.isEnabled)
    }

    @Test
    fun disablingRequiresAuthenticationAndKeepsTheLockOnWhenItFails() = runTest {
        val f = makeStore(enabled = true)
        f.auth.result = AppLockAuthResult.Failed(AppLockFailure.AUTHENTICATION_FAILED)

        f.store.setEnabled(false, REASON)

        assertTrue("a failed attempt must not leave the app unprotected", f.store.isEnabled.value)
        assertTrue(f.storage.isEnabled)
        assertEquals(1, f.auth.calls)
    }

    @Test
    fun disablingSucceedsAfterAuthentication() = runTest {
        val f = makeStore(enabled = true)
        f.store.setEnabled(false, REASON)

        assertFalse(f.store.isEnabled.value)
        assertFalse(f.storage.isEnabled)
        assertNull(f.store.lastFailure.value)
        assertEquals(1, f.auth.calls)
    }

    // ---- Background / foreground ------------------------------------------

    @Test
    fun backgroundingLocksAndForegroundUnlocksAfterAuthentication() = runTest {
        val f = makeStore(enabled = true)
        // Simulate the user having unlocked on a cold launch.
        f.store.unlock(REASON)
        assertFalse(f.store.isLocked.value)

        f.store.handleEnterBackground()
        assertTrue(f.store.isLocked.value)

        f.store.handleForeground(REASON)
        assertEquals(2, f.auth.calls)
        assertFalse(f.store.isLocked.value)
    }

    @Test
    fun backgroundingDoesNotLockWhenThePreferenceIsOff() {
        val f = makeStore(enabled = false)
        f.store.handleEnterBackground()
        assertFalse(f.store.isLocked.value)
    }

    @Test
    fun backgroundingDoesNotLockWhenTheDeviceLostItsCredential() {
        val f = makeStore(enabled = true)
        f.capabilities.value = noCredential()
        f.store.refreshAvailability()

        f.store.handleEnterBackground()
        assertFalse(f.store.isLocked.value)
    }

    // ---- Unlock outcomes ---------------------------------------------------

    @Test
    fun cancellingTheSystemPromptKeepsTheAppLockedWithoutAnErrorBanner() = runTest {
        val f = makeStore(enabled = true, result = AppLockAuthResult.Cancelled)
        f.store.unlock(REASON)

        assertTrue("cancel means cancel — stay locked", f.store.isLocked.value)
        assertNull("backing out is not an error worth shouting about", f.store.lastFailure.value)
    }

    @Test
    fun failedAuthenticationKeepsTheAppLockedAndExplainsWhy() = runTest {
        val f = makeStore(
            enabled = true,
            result = AppLockAuthResult.Failed(AppLockFailure.AUTHENTICATION_FAILED),
        )
        f.store.unlock(REASON)

        assertTrue(f.store.isLocked.value)
        assertEquals(AppLockFailure.AUTHENTICATION_FAILED, f.store.lastFailure.value)
    }

    @Test
    fun lockoutIsSurfacedWithItsOwnReason() = runTest {
        val f = makeStore(
            enabled = true,
            result = AppLockAuthResult.Failed(AppLockFailure.BIOMETRICS_LOCKED_OUT),
        )
        f.store.unlock(REASON)

        assertTrue(f.store.isLocked.value)
        assertEquals(AppLockFailure.BIOMETRICS_LOCKED_OUT, f.store.lastFailure.value)
    }

    @Test
    fun unlockIsANoOpWhenNotLockedAndNeverPrompts() = runTest {
        val f = makeStore(enabled = true)
        f.store.clearLock()
        f.store.unlock(REASON)

        assertEquals(0, f.auth.calls)
        assertFalse(f.store.isLocked.value)
    }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    @Test
    fun overlappingUnlockCallsProduceASinglePrompt() = runTest {
        val f = makeStore(enabled = true)
        val gate = CompletableDeferred<AppLockAuthResult>()
        f.auth.gate = gate

        val first = launch { f.store.unlock(REASON) }
        runCurrent()
        assertEquals(1, f.auth.calls)

        // e.g. a second ON_START while the system sheet is already up.
        f.store.unlock(REASON)
        assertEquals("system prompts must not stack", 1, f.auth.calls)
        assertTrue(f.store.isLocked.value)

        gate.complete(AppLockAuthResult.Success)
        first.join()
        assertFalse(f.store.isLocked.value)
    }

    // ---- The "cannot strand the user" safety net --------------------------

    @Test
    fun losingTheCredentialAtRuntimeDisablesTheLockInsteadOfStrandingTheUser() = runTest {
        val f = makeStore(enabled = true)
        f.store.handleEnterBackground()
        assertTrue(f.store.isLocked.value)

        // The user removed the screen lock in system Settings while away.
        f.capabilities.value = noCredential()
        f.store.handleForeground(REASON)

        assertFalse("there is no way to authenticate — fail open", f.store.isLocked.value)
        assertFalse(f.store.isEnabled.value)
        assertFalse(f.storage.isEnabled)
        assertEquals(AppLockNotice.DEVICE_CREDENTIAL_LOST, f.store.autoDisabledNotice.value)
        assertEquals(0, f.auth.calls)
    }

    @Test
    fun aThrowingAuthenticatorFailsClosedInsteadOfUnlocking() = runTest {
        val store = AppLockStore(
            authenticator = { throw IllegalStateException("prompt crashed") },
            storage = MemoryStorage(isEnabled = true),
            capabilities = { supported() },
        )
        store.unlock(REASON)

        assertTrue(store.isLocked.value)
        assertEquals(AppLockFailure.UNKNOWN, store.lastFailure.value)
    }

    // ---- Sign-out ----------------------------------------------------------

    @Test
    fun clearingTheLockOnSignOutDoesNotForgetThePreference() = runTest {
        val f = makeStore(enabled = true)
        f.store.unlock(REASON)
        f.store.clearLock()

        assertFalse(f.store.isLocked.value)
        assertTrue("signing out must not disable the opt-in", f.store.isEnabled.value)

        // The next cold launch re-locks from the stored preference.
        val fresh = makeStore(enabled = true)
        assertTrue(fresh.store.isLocked.value)
    }

    @Test
    fun acknowledgingTheAutoDisabledNoticeConsumesItOnce() {
        val f = makeStore(enabled = true, availability = noCredential())
        assertEquals(AppLockNotice.DEVICE_CREDENTIAL_LOST, f.store.autoDisabledNotice.value)
        f.store.acknowledgeAutoDisabledNotice()
        assertNull(f.store.autoDisabledNotice.value)
    }

    // ---- Prompt error mapping ---------------------------------------------

    @Test
    fun backingOutOfThePromptMapsToASilentCancellation() {
        // ERROR_USER_CANCELED, ERROR_NEGATIVE_BUTTON, ERROR_CANCELED
        assertEquals(AppLockAuthResult.Cancelled, appLockResultForBiometricError(10))
        assertEquals(AppLockAuthResult.Cancelled, appLockResultForBiometricError(13))
        assertEquals(AppLockAuthResult.Cancelled, appLockResultForBiometricError(5))
    }

    @Test
    fun everyOtherPromptErrorMapsToAUserVisibleFailure() {
        assertEquals(
            AppLockAuthResult.Failed(AppLockFailure.BIOMETRICS_NOT_ENROLLED),
            appLockResultForBiometricError(11),
        )
        assertEquals(
            AppLockAuthResult.Failed(AppLockFailure.BIOMETRICS_UNAVAILABLE),
            appLockResultForBiometricError(12),
        )
        assertEquals(
            AppLockAuthResult.Failed(AppLockFailure.BIOMETRICS_UNAVAILABLE),
            appLockResultForBiometricError(1),
        )
        assertEquals(
            AppLockAuthResult.Failed(AppLockFailure.BIOMETRICS_LOCKED_OUT),
            appLockResultForBiometricError(7),
        )
        assertEquals(
            AppLockAuthResult.Failed(AppLockFailure.BIOMETRICS_LOCKED_OUT),
            appLockResultForBiometricError(9),
        )
        assertEquals(
            AppLockAuthResult.Failed(AppLockFailure.NO_DEVICE_CREDENTIAL),
            appLockResultForBiometricError(14),
        )
        assertEquals(
            AppLockAuthResult.Failed(AppLockFailure.AUTHENTICATION_FAILED),
            appLockResultForBiometricError(2),
        )
        assertEquals(
            AppLockAuthResult.Failed(AppLockFailure.AUTHENTICATION_FAILED),
            appLockResultForBiometricError(9999),
        )
    }
}
