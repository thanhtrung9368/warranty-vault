import Foundation
import SwiftUI
import WarrlyKit

@MainActor
public final class AuthStore: ObservableObject {
    public enum Status: Equatable {
        case idle           // boot — checking keychain
        case unauthenticated
        /// Bootstrap reached neither a session nor a rejection: airplane mode,
        /// a timeout, a 5xx or a reply we could not decode.
        ///
        /// The Keychain token and the widget / Spotlight snapshot are kept —
        /// only a real `401` ends the session — so this is a retry screen, not
        /// a sign-out. `.unreachable` is deliberately distinct from `.idle`:
        /// idle is "checking", this is "checked, could not tell".
        case unreachable
        case authenticated(User)
    }

    @Published public private(set) var status: Status = .idle

    public let baseURL: URL
    public let keychain: KeychainStore
    public private(set) var client: APIClient

    /// Set once by `observeAuthenticatedUnauthorizedIfNeeded`. `bootstrap` is
    /// the one entry point every launch goes through, and it is re-entered by
    /// the retry screen, so the flag is what keeps the subscription single.
    private var hasUnauthorizedObserver = false

    public init(baseURL: URL, keychain: KeychainStore = .init()) {
        self.baseURL = baseURL
        self.keychain = keychain
        let kc = keychain
        self.client = APIClient(baseURL: baseURL) {
#if DEBUG
            // QA hook: a launch env token overrides the keychain (unavailable
            // on unsigned simulator builds). Never compiled into Release.
            if let qa = ProcessInfo.processInfo.environment["WV_QA_TOKEN"], !qa.isEmpty {
                return qa
            }
#endif
            return kc.read()
        }
    }

    /// Try to restore the session on app launch. If we have a token in
    /// keychain, hit /me to verify; otherwise unauthenticated.
    ///
    /// A failed `/auth/me` is **classified, not an automatic sign-out**:
    ///
    /// * a `401` is the server refusing the stored bearer — the one failure
    ///   that really ends the session, so the token and the out-of-app surfaces
    ///   are dropped just as they were before this change;
    /// * anything else (airplane mode, a timeout, a `5xx`, an undecodable
    ///   reply) publishes `.unreachable` and keeps both, because the token was
    ///   never refused and a retry can continue the session.
    ///
    /// The old code cleared the Keychain and the widget / Spotlight snapshot on
    /// every throw, so one dropped packet on launch signed the user out.
    public func bootstrap() async {
        // The one subscription for this store's lifetime: every request from
        // here on is made by the same session, so one handler is the whole
        // wiring (see `handleUnauthorizedSession`). Done before `/auth/me` so a
        // later flow — login included — can never run without it.
        await observeAuthenticatedUnauthorizedIfNeeded()
#if DEBUG
        // QA hook: a launch env token authenticates directly, bypassing the
        // keychain. Never compiled into Release.
        if let qaToken = ProcessInfo.processInfo.environment["WV_QA_TOKEN"],
           !qaToken.isEmpty {
            do {
                let user = try await client.me()
                status = .authenticated(user)
            } catch let error as APIError where error.isUnauthorized {
                // A rejected QA token, not a rejected stored session: the
                // Keychain is left alone on purpose.
                status = .unauthenticated
                await DeadlineSurface.shared.clear()
            } catch {
                status = .unreachable
            }
            return
        }
#endif
        guard keychain.read() != nil else {
            status = .unauthenticated
            // No session means no widget / Spotlight data either. This is also
            // the path after a reinstall that left the App Group container
            // behind: the next account must start from an empty surface.
            await DeadlineSurface.shared.clear()
            return
        }
        do {
            let user = try await client.me()
            status = .authenticated(user)
        } catch let error as APIError where error.isUnauthorized {
            // The stored bearer is dead server-side: this really is a sign-out.
            keychain.clear()
            status = .unauthenticated
            await DeadlineSurface.shared.clear()
        } catch {
            // Network, timeout, `5xx`, decoding. The server never said the
            // token was invalid, so keep it (and the widget / Spotlight
            // snapshot) and let the retry screen try `/auth/me` again.
            status = .unreachable
        }
    }

    /// Subscribes to the client's authenticated-`401` observer, once.
    ///
    /// `bootstrap` is the one entry point every launch and every retry goes
    /// through, so the flag — checked and set before the `await`, on the main
    /// actor — is enough to make it single.
    private func observeAuthenticatedUnauthorizedIfNeeded() async {
        guard !hasUnauthorizedObserver else { return }
        hasUnauthorizedObserver = true
        await client.setUnauthorizedObserver { [weak self] in
            Task { @MainActor in
                self?.handleUnauthorizedSession()
            }
        }
    }

    /// Runs when a request that carried the bearer came back `401`: the session
    /// was revoked or expired while the app was open (the pull-to-refresh
    /// case), and the app returns to Login exactly once.
    private func handleUnauthorizedSession() {
        // The one-shot guard. The status is claimed synchronously, on the main
        // actor, before anything can suspend — so a pull-to-refresh that fires
        // five lists at once signs out on the first 401 and every other one is
        // a no-op instead of a second transition or a loop.
        //
        // It also keeps the observer out of bootstrap: while `/auth/me` is in
        // flight the status is `.idle`, so a 401 there is owned by bootstrap's
        // own catch (which is the call that knows whether a token existed).
        guard case .authenticated = status else { return }
        status = .unauthenticated
        keychain.clear()
        // RootView's `.unauthenticated` path drops the widget / Spotlight
        // snapshot, the router and the app lock — the same cleanup a real
        // sign-out gets. The remembered email is kept: this is the same person
        // signing in again, not someone else picking up the phone.
    }

    public func login(email: String, password: String) async throws {
        let res = try await client.login(LoginInput(
            email: email, password: password,
            deviceLabel: deviceLabel(), platform: "ios"
        ))
        keychain.write(res.accessToken)
        RememberedEmail.save(res.user.email)
        status = .authenticated(res.user)
    }

    public func register(email: String, password: String, name: String?) async throws {
        let res = try await client.register(RegisterInput(
            email: email, password: password, name: name,
            deviceLabel: deviceLabel(), platform: "ios"
        ))
        keychain.write(res.accessToken)
        RememberedEmail.save(res.user.email)
        status = .authenticated(res.user)
    }

    public func logout() async {
        try? await client.logout()
        keychain.clear()
        // The next person at this phone must not find the previous account's
        // address waiting in the login field.
        RememberedEmail.clear()
        await DeadlineSurface.shared.clear()
        status = .unauthenticated
    }

    /// Re-proves the signed-in account for the app lock.
    ///
    /// `POST /api/v1/auth/login` with the account's own email and the typed
    /// password is the only thing that can check an account password — the app
    /// stores no hash and compares nothing locally. A **401** is the server
    /// saying the password is wrong; the lock screen maps it (see
    /// `AppLockPasswordError.from`).
    ///
    /// ## The session
    ///
    /// A successful login **issues a fresh session**, and this method adopts it:
    /// the bearer already in the Keychain is the one the app has been using, and
    /// it may be the very token the server has already expired — that is one of
    /// the reasons the lock screen is in the way. Keeping it would open the UI
    /// and leave every following request 401.
    ///
    /// Adoption happens **only after the answer is checked**, and the existing
    /// session survives every failure:
    ///
    /// * a transport / decoding failure throws before anything is written;
    /// * a 2xx with a blank bearer, or one for a different account, throws
    ///   `.cannotVerify` and leaves the Keychain and `status` exactly as they
    ///   were — an unlock must never silently sign the user out;
    /// * a sign-out that lands while the request is in flight wins: the response
    ///   is discarded rather than signing the user back in.
    public func verifyAccountPassword(_ password: String) async throws {
        guard case .authenticated(let current) = status else {
            throw AppLockPasswordError.cannotVerify
        }
        let result = try await client.login(LoginInput(
            email: current.email, password: password,
            deviceLabel: deviceLabel(), platform: "ios"
        ))
        let token = result.accessToken.trimmingCharacters(in: .whitespacesAndNewlines)
        // Re-checked after the await: the user may have signed out (or the
        // session may have been replaced) while the server was answering.
        guard case .authenticated(let stillCurrent) = status,
              stillCurrent.id == current.id,
              result.user.id == current.id,
              !token.isEmpty
        else {
            throw AppLockPasswordError.cannotVerify
        }
        keychain.write(token)
        RememberedEmail.save(result.user.email)
        status = .authenticated(result.user)
    }

    /// `PATCH /api/v1/auth/me` → `displayName`.
    ///
    /// `raw` is exactly what the user typed: blank/whitespace clears the stored
    /// name (`DisplayNameRules` maps that to an explicit `null`). The server's
    /// 80-byte cap is deliberately not re-checked here — the caller shows the
    /// server's own Vietnamese `fieldErrors.displayName`, which is the single
    /// source of truth for the limit.
    ///
    /// The response carries the updated user, and adopting it here is what makes
    /// the profile header, the row and the "Thêm" screen refresh without a
    /// re-fetch.
    public func updateDisplayName(_ raw: String) async throws {
        let result = try await client.updateProfile(
            UpdateProfileInput(displayName: DisplayNameRules.field(for: raw))
        )
        status = .authenticated(result.user)
    }

    /// `PATCH /api/v1/auth/me` → the reminder email fallback opt-in (#8).
    ///
    /// Sent on its own so it can never disturb the display name or the stored
    /// language (all three fields are independent on the server). The reply's
    /// user is adopted, so the switch and the Settings footer read the value
    /// the account actually holds — a failed save throws and leaves the old
    /// value visible with the server's message in an alert.
    public func updateReminderEmailFallback(_ enabled: Bool) async throws {
        let result = try await client.updateProfile(
            UpdateProfileInput(reminderEmailFallback: enabled)
        )
        status = .authenticated(result.user)
    }

    /// Permanently deletes the account (requires the current password), then
    /// clears the keychain and drops to the unauthenticated state. Throws on
    /// failure (e.g. wrong password) so the caller can surface the error.
    public func deleteAccount(password: String) async throws {
        try await client.deleteAccount(password: password)
        keychain.clear()
        RememberedEmail.clear()
        await DeadlineSurface.shared.clear()
        status = .unauthenticated
    }

    private func deviceLabel() -> String {
#if canImport(UIKit)
        return UIDevice.current.model
#else
        return "macOS"
#endif
    }
}

/// The last account that successfully signed in on this device.
///
/// Direction 1 borrows one thing from Direction 2: the email is already in the
/// field for the returning user, so the screen never asks them to remember
/// which address they used. **Only the email.** The password is never written
/// here (or anywhere outside the Keychain session) — Apple's rule for a login
/// form is explicit: never prepopulate a password field.
///
/// Written after a successful login/registration and cleared on the two paths
/// that hand the phone to someone else (`logout`, `deleteAccount`).
enum RememberedEmail {
    private static let key = "warrly.login.rememberedEmail"

    static func load() -> String {
        UserDefaults.standard.string(forKey: key) ?? ""
    }

    static func save(_ email: String) {
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        if address.isEmpty {
            UserDefaults.standard.removeObject(forKey: key)
        } else {
            UserDefaults.standard.set(address, forKey: key)
        }
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}
