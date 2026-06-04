import Foundation
import SwiftUI
import WarrantyVaultKit

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
            }
            return
        }
#endif
        guard keychain.read() != nil else {
            status = .unauthenticated
            return
        }
        do {
            let user = try await client.me()
            status = .authenticated(user)
        } catch {
            keychain.clear()
            status = .unauthenticated
        }
    }

    public func login(email: String, password: String) async throws {
        let res = try await client.login(LoginInput(
            email: email, password: password,
            deviceLabel: deviceLabel(), platform: "ios"
        ))
        keychain.write(res.accessToken)
        status = .authenticated(res.user)
    }

    public func register(email: String, password: String, name: String?) async throws {
        let res = try await client.register(RegisterInput(
            email: email, password: password, name: name,
            deviceLabel: deviceLabel(), platform: "ios"
        ))
        keychain.write(res.accessToken)
        status = .authenticated(res.user)
    }

    public func logout() async {
        try? await client.logout()
        keychain.clear()
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
