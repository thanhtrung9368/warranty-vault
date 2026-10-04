import Foundation
import SwiftUI
import WarrantyVaultKit

/// Owns "which language is the app in" and is the only thing that writes
/// `L.language`.
///
/// ## Why a store and not `Bundle.main`
///
/// The choice is a **user preference stored on the server** (`User.locale`),
/// because the Go cron has no request to read a language from — push
/// notifications and email are rendered long after the app is gone
/// (docs/I18N_PLAN.md §2.3). A server-side preference is not something the
/// `NSLocalizedString` machinery can follow: it can only read the bundle's
/// `.lproj`, which is fixed at process start. So the app renders through
/// `L.t(...)`, which reads the catalog directly, and this store is what keeps
/// `L.language` in sync with the account.
///
/// ## Resolution order (highest first)
///
///   1. the cached choice from the last launch — so the first frame is already
///      in the right language instead of flashing the wrong one while `/me`
///      is in flight;
///   2. `User.locale` from the server, adopted on every authenticated `/me`;
///   3. the device's own preferred language (`Locale.preferredLanguages`);
///   4. `AppLanguage.productDefault` — English.
///
/// Step 3 is deliberate: a Vietnamese phone gets a Vietnamese app without
/// anyone opening Settings, which is the behaviour docs/I18N_PLAN.md §2.4 asks
/// for. Step 4 is the product default for everyone else.
@MainActor
final class LocalizationStore: ObservableObject {

    /// What the user sees, and what `Accept-Language` carries.
    @Published private(set) var language: AppLanguage

    /// `true` while a `PATCH /auth/me` is in flight.
    @Published private(set) var isSaving = false

    /// Set when the server refused the change. The UI reverts the switch and
    /// shows this; it is server copy already in the right language.
    ///
    /// Named `saveError` rather than the obvious `error` because `catch`
    /// implicitly binds a variable called `error`, which would shadow it
    /// inside the one method that has to write it.
    @Published var saveError: String?

    private let client: APIClient
    private let defaults: UserDefaults
    private static let cacheKey = "wv.selectedLanguage"

    /// `nil` = the user has never chosen (the row shows "Theo thiết bị").
    /// Kept separate from `language` on purpose: "device says Vietnamese" and
    /// "the user chose Vietnamese" are different states, and only the second
    /// one should ever be written to the server.
    private(set) var storedChoice: AppLanguage?

    init(client: APIClient, defaults: UserDefaults = .standard) {
        self.client = client
        self.defaults = defaults

        let cached = AppLanguage.parse(defaults.string(forKey: Self.cacheKey))
        self.storedChoice = cached
        self.language = cached ?? Self.deviceLanguage() ?? AppLanguage.productDefault
        L.language = self.language
    }

    /// The device's own preference, resolved to a language this build ships.
    static func deviceLanguage() -> AppLanguage? {
        for identifier in Locale.preferredLanguages {
            if let match = AppLanguage.parse(identifier) { return match }
        }
        return nil
    }

    /// Adopts the account's stored language after `/me` or a login.
    ///
    /// A `nil` `User.locale` means "never chosen", and it must NOT reset the
    /// device-derived language — it only clears the *stored* marker so the
    /// Settings row goes back to showing "Theo thiết bị".
    func adopt(user: User) {
        let fromServer = user.preferredLanguage
        storedChoice = fromServer
        if let fromServer {
            defaults.set(fromServer.rawValue, forKey: Self.cacheKey)
            apply(fromServer)
        } else {
            defaults.removeObject(forKey: Self.cacheKey)
            apply(Self.deviceLanguage() ?? AppLanguage.productDefault)
        }
    }

    /// Forgets the account's language on sign-out so the next account on this
    /// device does not inherit it.
    func reset() {
        storedChoice = nil
        defaults.removeObject(forKey: Self.cacheKey)
        apply(Self.deviceLanguage() ?? AppLanguage.productDefault)
    }

    /// Switches the app language and persists it for the account.
    ///
    /// `nil` clears the stored value (`PATCH {"locale": null}`), which sends the
    /// server back to deciding per request — the "Theo thiết bị" row.
    ///
    /// The local switch happens first so the UI answers immediately, and is
    /// rolled back if the write fails: a language that is only local would make
    /// push notifications and emails keep arriving in the old one, which is the
    /// failure this whole feature exists to avoid.
    func select(_ choice: AppLanguage?) async {
        guard choice != storedChoice else { return }
        let previous = storedChoice
        let previousLanguage = language

        storedChoice = choice
        if let choice {
            defaults.set(choice.rawValue, forKey: Self.cacheKey)
            apply(choice)
        } else {
            defaults.removeObject(forKey: Self.cacheKey)
            apply(Self.deviceLanguage() ?? AppLanguage.productDefault)
        }

        isSaving = true
        defer { isSaving = false }
        do {
            let result = try await client.updateProfile(
                UpdateProfileInput(locale: choice.map { .set($0.rawValue) } ?? .clear)
            )
            // The response carries the stored user; trust the server's echo over
            // our optimistic guess (it is also what normalises `vi-VN` → `vi`).
            adopt(user: result.user)
            saveError = nil
        } catch let APIError.server(_, envelope) {
            storedChoice = previous
            apply(previousLanguage)
            saveError = envelope.fieldErrors?["locale"]?.first
                ?? envelope.message
                ?? L.t("Không lưu được ngôn ngữ.")
        } catch {
            storedChoice = previous
            apply(previousLanguage)
            saveError = L.t("Không kết nối được máy chủ.")
        }
    }

    /// Pushes a language into the library, which is what every `L.t` call reads.
    private func apply(_ next: AppLanguage) {
        guard next != language else { return }
        language = next
        L.language = next
    }
}

/// The Settings rows, in order. `.device` is the "no stored choice" state and
/// maps to `PATCH {"locale": null}`.
enum LanguageChoice: CaseIterable, Identifiable {
    case device
    case vietnamese
    case english

    var id: Self { self }

    var language: AppLanguage? {
        switch self {
        case .device: return nil
        case .vietnamese: return .vi
        case .english: return .en
        }
    }

    /// Endonyms for the two real languages: a user who cannot read the current
    /// UI language must still be able to find their own.
    var label: String {
        switch self {
        case .device: return L.t("Theo thiết bị")
        case .vietnamese: return AppLanguage.vi.endonym
        case .english: return AppLanguage.en.endonym
        }
    }
}
