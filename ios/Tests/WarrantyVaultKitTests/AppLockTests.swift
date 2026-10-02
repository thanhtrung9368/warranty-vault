import Foundation
import XCTest
@testable import WarrantyVaultKit

/// App lock ("Face ID & Touch ID") state machine.
///
/// These tests never touch `LAContext`: `BiometricAuthenticating` is faked, so
/// every branch — including the ones that must *not* lock the user out — is
/// reachable deterministically.
@MainActor
final class AppLockTests: XCTestCase {

    // MARK: - Fakes

    /// Records calls and answers with a scripted result.
    final class FakeAuthenticator: BiometricAuthenticating, @unchecked Sendable {
        var availabilityValue: AppLockAvailability
        var result: Result<Void, AppLockError>

        private(set) var availabilityCallCount = 0
        private(set) var authenticateCallCount = 0
        private(set) var lastReason: String?

        /// When set, `authenticate` suspends until `finish(_:)` is called, so
        /// tests can observe the in-flight state.
        private var continuation: CheckedContinuation<Void, Error>?
        var gateNextAuthentication = false

        init(availability: AppLockAvailability = .init(biometry: .faceID,
                                                       biometricsAvailable: true,
                                                       deviceOwnerAuthAvailable: true),
             result: Result<Void, AppLockError> = .success(())) {
            self.availabilityValue = availability
            self.result = result
        }

        func availability() -> AppLockAvailability {
            availabilityCallCount += 1
            return availabilityValue
        }

        func authenticate(reason: String) async throws {
            authenticateCallCount += 1
            lastReason = reason
            if gateNextAuthentication {
                gateNextAuthentication = false
                try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
                    continuation = c
                }
                return
            }
            try result.get()
        }

        func finish(_ result: Result<Void, AppLockError>) {
            let c = continuation
            continuation = nil
            c?.resume(with: result)
        }
    }

    final class MemoryStorage: AppLockStorage {
        var isEnabled: Bool
        init(isEnabled: Bool = false) { self.isEnabled = isEnabled }
    }

    private func makeStore(enabled: Bool = false,
                           availability: AppLockAvailability = .init(biometry: .faceID,
                                                                    biometricsAvailable: true,
                                                                    deviceOwnerAuthAvailable: true),
                           result: Result<Void, AppLockError> = .success(()))
    -> (AppLockStore, FakeAuthenticator, MemoryStorage) {
        let auth = FakeAuthenticator(availability: availability, result: result)
        let storage = MemoryStorage(isEnabled: enabled)
        let store = AppLockStore(authenticator: auth, storage: storage)
        return (store, auth, storage)
    }

    // MARK: - Availability rules

    func testCanEnableLockRequiresEnrolledBiometricsAndAPasscodeFallback() {
        let ok = AppLockAvailability(biometry: .faceID, biometricsAvailable: true,
                                     deviceOwnerAuthAvailable: true)
        XCTAssertTrue(ok.canEnableLock)
        XCTAssertNil(ok.unavailableReason)

        let notEnrolled = AppLockAvailability(biometry: .faceID, biometricsAvailable: false,
                                              deviceOwnerAuthAvailable: true)
        XCTAssertFalse(notEnrolled.canEnableLock)
        XCTAssertEqual(notEnrolled.unavailableReason,
                       "Chưa cài đặt Face ID trên thiết bị — hãy bật trong Cài đặt iOS.")

        let unsupported = AppLockAvailability(biometry: .none, biometricsAvailable: false,
                                              deviceOwnerAuthAvailable: true)
        XCTAssertFalse(unsupported.canEnableLock)
        XCTAssertEqual(unsupported.unavailableReason,
                       "Thiết bị này không hỗ trợ Face ID/Touch ID.")

        let noPasscode = AppLockAvailability(biometry: .touchID, biometricsAvailable: false,
                                             deviceOwnerAuthAvailable: false, passcodeNotSet: true)
        XCTAssertFalse(noPasscode.canEnableLock)
        XCTAssertEqual(noPasscode.unavailableReason,
                       "Thiết bị chưa đặt mã mở khoá — hãy đặt mã trong Cài đặt iOS trước.")
    }

    // MARK: - Defaults / cold launch

    func testLockIsOffByDefault() {
        let (store, auth, _) = makeStore()
        XCTAssertFalse(store.isEnabled)
        XCTAssertFalse(store.isLocked)
        XCTAssertEqual(auth.authenticateCallCount, 0, "no prompt without an opt-in")
    }

    func testColdLaunchWithLockEnabledStartsLockedWithoutPrompting() {
        let (store, auth, _) = makeStore(enabled: true)
        XCTAssertTrue(store.isEnabled)
        XCTAssertTrue(store.isLocked, "protected content must never render before authentication")
        XCTAssertEqual(auth.authenticateCallCount, 0, "the lock screen owns the prompt")
    }

    // MARK: - Turning it on / off

    func testEnablingRequiresOneSuccessfulAuthentication() async {
        let (store, auth, storage) = makeStore()
        await store.setEnabled(true)
        XCTAssertEqual(auth.authenticateCallCount, 1)
        XCTAssertTrue(store.isEnabled)
        XCTAssertTrue(storage.isEnabled, "preference is persisted")
        XCTAssertFalse(store.isLocked, "just authenticated — don't immediately re-prompt")
        XCTAssertNil(store.lastError)
        XCTAssertEqual(auth.lastReason, appLockPromptReason)
    }

    func testEnablingIsRefusedWhenAuthenticationFails() async {
        let (store, _, storage) = makeStore(result: .failure(.failed("Xác thực không thành công. Thử lại.")))
        await store.setEnabled(true)
        XCTAssertFalse(store.isEnabled)
        XCTAssertFalse(storage.isEnabled)
        XCTAssertEqual(store.lastError, "Xác thực không thành công. Thử lại.")
    }

    func testEnablingIsRefusedWithoutPromptingWhenBiometricsAreUnenrolled() async {
        let availability = AppLockAvailability(biometry: .faceID, biometricsAvailable: false,
                                               deviceOwnerAuthAvailable: true)
        let (store, auth, storage) = makeStore(availability: availability)
        await store.setEnabled(true)
        XCTAssertEqual(auth.authenticateCallCount, 0, "never prompt for a lock that can't be satisfied")
        XCTAssertFalse(store.isEnabled)
        XCTAssertFalse(storage.isEnabled)
        XCTAssertEqual(store.lastError, availability.unavailableReason)
    }

    func testDisablingRequiresAuthenticationAndKeepsTheLockOnWhenItFails() async {
        let (store, auth, storage) = makeStore(enabled: true)
        auth.result = .failure(.failed("Xác thực không thành công. Thử lại."))
        await store.setEnabled(false)
        XCTAssertTrue(store.isEnabled, "a failed attempt must not leave the app unprotected")
        XCTAssertTrue(storage.isEnabled)
        XCTAssertEqual(auth.authenticateCallCount, 1)
    }

    func testDisablingSucceedsAfterAuthentication() async {
        let (store, _, storage) = makeStore(enabled: true)
        await store.setEnabled(false)
        XCTAssertFalse(store.isEnabled)
        XCTAssertFalse(storage.isEnabled)
        XCTAssertNil(store.lastError)
    }

    // MARK: - Background / foreground

    func testBackgroundingLocksAndForegroundUnlocksAfterAuthentication() async {
        let (store, auth, _) = makeStore(enabled: true)
        store.handleEnterBackground()
        XCTAssertTrue(store.isLocked)

        await store.handleForeground()
        XCTAssertEqual(auth.authenticateCallCount, 1)
        XCTAssertFalse(store.isLocked)
    }

    func testBackgroundingDoesNotLockWhenThePreferenceIsOff() {
        let (store, _, _) = makeStore(enabled: false)
        store.handleEnterBackground()
        XCTAssertFalse(store.isLocked)
    }

    func testCancellingTheSystemPromptKeepsTheAppLockedWithoutAnErrorBanner() async {
        let (store, _, _) = makeStore(enabled: true, result: .failure(.userCancelled))
        await store.unlock()
        XCTAssertTrue(store.isLocked, "cancel means cancel — stay locked")
        XCTAssertNil(store.lastError, "backing out of Face ID is not an error worth shouting about")
    }

    func testFailedAuthenticationKeepsTheAppLockedAndExplainsWhy() async {
        let (store, _, _) = makeStore(enabled: true, result: .failure(.failed("Xác thực không thành công. Thử lại.")))
        await store.unlock()
        XCTAssertTrue(store.isLocked)
        XCTAssertEqual(store.lastError, "Xác thực không thành công. Thử lại.")
    }

    func testNoDevicePasscodeErrorIsSurfacedInVietnamese() async {
        let (store, _, _) = makeStore(enabled: true,
                                      result: .failure(.unavailable("Thiết bị chưa đặt mã mở khoá.")))
        await store.unlock()
        XCTAssertTrue(store.isLocked)
        XCTAssertEqual(store.lastError, "Thiết bị chưa đặt mã mở khoá.")
    }

    func testUnlockIsANoOpWhenNotLockedAndNeverPrompts() async {
        let (store, auth, _) = makeStore(enabled: true)
        store.clearLock()
        await store.unlock()
        XCTAssertEqual(auth.authenticateCallCount, 0)
        XCTAssertFalse(store.isLocked)
    }

    func testOverlappingUnlockCallsProduceASinglePrompt() async {
        let (store, auth, _) = makeStore(enabled: true)
        auth.gateNextAuthentication = true
        auth.result = .success(())

        let first = Task { await store.unlock() }
        await waitFor { auth.authenticateCallCount == 1 }

        await store.unlock()   // e.g. a second `.active` notification
        XCTAssertEqual(auth.authenticateCallCount, 1, "system prompts must not stack")
        XCTAssertTrue(store.isLocked)

        auth.finish(.success(()))
        await first.value
        XCTAssertFalse(store.isLocked)
    }

    // MARK: - The "cannot strand the user" safety net

    func testLockIsDroppedAtLaunchWhenTheDeviceHasNoPasscode() {
        let noPasscode = AppLockAvailability(biometry: .faceID, biometricsAvailable: false,
                                             deviceOwnerAuthAvailable: false, passcodeNotSet: true)
        let (store, _, storage) = makeStore(enabled: true, availability: noPasscode)
        XCTAssertFalse(store.isLocked, "there is no way to authenticate — fail open, never strand")
        XCTAssertFalse(store.isEnabled)
        XCTAssertFalse(storage.isEnabled, "the unusable preference is cleared")
        XCTAssertEqual(store.autoDisabledNotice,
                       "Đã tắt khoá ứng dụng vì thiết bị không còn mã mở khoá để xác thực.")
    }

    func testLosingThePasscodeAtRuntimeDisablesTheLockInsteadOfStrandingTheUser() async {
        let (store, auth, storage) = makeStore(enabled: true)
        store.handleEnterBackground()
        XCTAssertTrue(store.isLocked)

        // The user removed their passcode in Cài đặt iOS while the app was away.
        auth.availabilityValue = AppLockAvailability(biometry: .none,
                                                     biometricsAvailable: false,
                                                     deviceOwnerAuthAvailable: false,
                                                     passcodeNotSet: true)
        await store.handleForeground()

        XCTAssertFalse(store.isLocked)
        XCTAssertFalse(store.isEnabled)
        XCTAssertFalse(storage.isEnabled)
        XCTAssertEqual(auth.authenticateCallCount, 0, "prompting would have been futile")
        XCTAssertNotNil(store.autoDisabledNotice)
    }

    func testRemovingFaceIDButKeepingAPasscodeKeepsTheLockWithPasscodeFallback() async {
        let (store, auth, storage) = makeStore(enabled: true)
        store.handleEnterBackground()

        auth.availabilityValue = AppLockAvailability(biometry: .none,
                                                     biometricsAvailable: false,
                                                     deviceOwnerAuthAvailable: true)
        await store.handleForeground()

        XCTAssertTrue(store.isEnabled, "the passcode fallback still works")
        XCTAssertTrue(storage.isEnabled)
        XCTAssertEqual(auth.authenticateCallCount, 1)
        XCTAssertFalse(store.isLocked)
    }

    func testAutoDisabledNoticeIsOneShot() {
        let noPasscode = AppLockAvailability(biometry: .none, biometricsAvailable: false,
                                             deviceOwnerAuthAvailable: false, passcodeNotSet: true)
        let (store, _, _) = makeStore(enabled: true, availability: noPasscode)
        XCTAssertNotNil(store.autoDisabledNotice)
        store.acknowledgeAutoDisabledNotice()
        XCTAssertNil(store.autoDisabledNotice)
    }

    func testClearLockOnLogoutDoesNotTouchThePreference() async {
        let (store, _, storage) = makeStore(enabled: true)
        store.clearLock()
        XCTAssertFalse(store.isLocked)
        XCTAssertTrue(store.isEnabled, "the switch stays on for the next sign-in")
        XCTAssertTrue(storage.isEnabled)
    }

    // MARK: - Helpers

    /// Spins the main actor until `condition` holds (or fails the test).
    private func waitFor(_ condition: () -> Bool,
                         file: StaticString = #filePath,
                         line: UInt = #line) async {
        for _ in 0..<200 {
            if condition() { return }
            await Task.yield()
        }
        XCTFail("condition never became true", file: file, line: line)
    }
}
