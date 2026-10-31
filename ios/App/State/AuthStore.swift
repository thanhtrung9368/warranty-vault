import Foundation
import SwiftUI
import WarrlyKit

@MainActor
public final class AuthStore: ObservableObject {
    public enum Status: Equatable {
        case idle           // boot — checking keychain
        case unauthenticated
        case authenticated(User)
    }

    @Published public private(set) var status: Status = .idle

    public let baseURL: URL
    public let keychain: KeychainStore
    public private(set) var client: APIClient

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
    public func bootstrap() async {
#if DEBUG
        // QA hook: a launch env token authenticates directly, bypassing the
        // keychain. Never compiled into Release.
        if let qaToken = ProcessInfo.processInfo.environment["WV_QA_TOKEN"],
           !qaToken.isEmpty {
            do {
                let user = try await client.me()
                status = .authenticated(user)
            } catch {
                status = .unauthenticated
                await DeadlineSurface.shared.clear()
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
        } catch {
            keychain.clear()
            status = .unauthenticated
            await DeadlineSurface.shared.clear()
        }
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
