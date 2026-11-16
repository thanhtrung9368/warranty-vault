import Foundation
import SwiftUI
import WarrlyKit
import WidgetKit

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
///
/// ## What is written back, and why the third state is not `null`
///
/// The language shown on screen and the language stored for the account are
/// not the same decision. "Theo thiết bị" is a real third state: the app must
/// keep following the device, but the server still needs ONE answer it can
/// render a push or an email in, months later, with no device to ask. So the
/// store persists the **resolved** language — never "system" — while
/// `storedChoice` stays `nil` and the Settings row keeps showing "Theo thiết
/// bị".
///
/// That write is what makes a notification stop leaking English: an account
/// with `locale IS NULL` is rendered in the artifact fallback, and "Theo thiết
/// bị" used to leave the column NULL for everyone who never opened the picker.
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

    /// The value this device last wrote to `User.locale` while the user was on
    /// "Theo thiết bị".
    ///
    /// The server cannot tell "the person chose Vietnamese" from "this device
    /// mirrored Vietnamese because that is what the phone speaks", so the app
    /// remembers which value it wrote. Without this marker the mirrored value
    /// would come back on the next `/me` looking like an explicit choice and
    /// the Settings row would silently move from "Theo thiết bị" to "Tiếng
    /// Việt" — a UI change the write is not allowed to cause.
    private static let mirroredKey = "wv.mirroredLanguage"

    /// `nil` = the user is on "Theo thiết bị" (the row shows the device state).
    /// Kept separate from `language` on purpose: "device says Vietnamese" and
    /// "the user chose Vietnamese" are different states, and only the second
    /// one is an explicit choice. Both persist a language to the server; the
    /// first persists the RESOLVED one through `mirror`.
    private(set) var storedChoice: AppLanguage?

    init(client: APIClient, defaults: UserDefaults = .standard) {
        self.client = client
        self.defaults = defaults

        let cached = AppLanguage.parse(defaults.string(forKey: Self.cacheKey))
        self.storedChoice = cached
        self.language = cached ?? Self.deviceLanguage() ?? AppLanguage.productDefault
        L.language = self.language
        // The Share Extension runs in its own process and cannot read this
        // store. Mirror the *explicit* choice (not the device fallback) into the
        // App Group defaults so its small UI follows the same language.
        SharedInboxLanguage.publish(cached)
    }

    /// The device's own preference, resolved to a language this build ships.
    static func deviceLanguage() -> AppLanguage? {
        for identifier in Locale.preferredLanguages {
            if let match = AppLanguage.parse(identifier) { return match }
        }
        return nil
    }

    /// Adopts the account's language after `/me` or a login — and persists the
    /// resolved one when the account has none.
    ///
    /// A `nil` `User.locale` means "never stored". It must NOT reset the
    /// device-derived language, and it is exactly the state that leaves every
    /// push and both mails in the artifact fallback forever, because the cron
    /// has no request to read a language from. So the resolved language is
    /// written back here, once, as a concrete value: never `null`, never
    /// "system".
    ///
    /// A stored value equal to `mirroredKey` is this device's own mirror and
    /// keeps the row on "Theo thiết bị"; anything else is someone's deliberate
    /// choice (possibly from the web or another phone) and is adopted as one.
    func adopt(user: User) {
        let fromServer = user.preferredLanguage
        let mirrored = AppLanguage.parse(defaults.string(forKey: Self.mirroredKey))

        if let fromServer, fromServer != mirrored || storedChoice != nil {
            storedChoice = fromServer
            SharedInboxLanguage.publish(fromServer)
            defaults.set(fromServer.rawValue, forKey: Self.cacheKey)
            defaults.removeObject(forKey: Self.mirroredKey)
            apply(fromServer)
            return
        }

        // "Theo thiết bị": either the account stores nothing yet, or what it
        // stores is this device's mirror of the device language.
        storedChoice = nil
        SharedInboxLanguage.publish(nil)
        defaults.removeObject(forKey: Self.cacheKey)
        let resolved = Self.deviceLanguage() ?? AppLanguage.productDefault
        apply(resolved)
        mirror(resolved)
    }

    /// Forgets the account's language on sign-out so the next account on this
    /// device does not inherit it.
    func reset() {
        storedChoice = nil
        SharedInboxLanguage.publish(nil)
        defaults.removeObject(forKey: Self.cacheKey)
        // The mirror belongs to the account that was signed in, not to the
        // phone: leaving it behind would make the next account's stored
        // language look like this device's "Theo thiết bị" value.
        defaults.removeObject(forKey: Self.mirroredKey)
        apply(Self.deviceLanguage() ?? AppLanguage.productDefault)
    }

    /// Switches the app language and persists the RESOLVED language for the
    /// account.
    ///
    /// `nil` is the "Theo thiết bị" row. It deliberately no longer sends
    /// `PATCH {"locale": null}`: the server keeps the language the device
    /// resolved to (English if the device asks for something this build does
    /// not ship), so a notification built at 03:00 has an answer. The row is
    /// unaffected — `storedChoice` stays `nil` and the tick stays on "Theo
    /// thiết bị".
    ///
    /// The local switch happens first so the UI answers immediately, and is
    /// rolled back if the write fails: a language that is only local would make
    /// push notifications and emails keep arriving in the old one, which is the
    /// failure this whole feature exists to avoid.
    func select(_ choice: AppLanguage?) async {
        guard choice != storedChoice else { return }

        let previousChoice = storedChoice
        let previousLanguage = language
        let previousMirror = defaults.string(forKey: Self.mirroredKey)

        // Only two values are ever sent: the chosen language, or — for "Theo
        // thiết bị" — the one the device resolved to. "System" is not a value
        // `User.locale` can hold.
        let resolved = choice ?? Self.deviceLanguage() ?? AppLanguage.productDefault

        storedChoice = choice
        SharedInboxLanguage.publish(choice)
        if let choice {
            defaults.set(choice.rawValue, forKey: Self.cacheKey)
            defaults.removeObject(forKey: Self.mirroredKey)
        } else {
            defaults.removeObject(forKey: Self.cacheKey)
        }
        apply(resolved)

        isSaving = true
        defer { isSaving = false }
        do {
            let result = try await client.updateProfile(
                UpdateProfileInput(locale: .set(resolved.rawValue))
            )
            if choice == nil {
                // What the server now holds is a mirror, not a choice: remember
                // it so the next `/me` keeps the row on "Theo thiết bị".
                defaults.set(resolved.rawValue, forKey: Self.mirroredKey)
                storedChoice = nil
                SharedInboxLanguage.publish(nil)
                apply(resolved)
            } else {
                // The response carries the stored user; trust the server's echo
                // over our optimistic guess (it is also what normalises `vi-VN`
                // → `vi`).
                adopt(user: result.user)
            }
            saveError = nil
        } catch let APIError.server(_, envelope) {
            restore(choice: previousChoice, previousLanguage: previousLanguage, mirror: previousMirror)
            saveError = envelope.fieldErrors?["locale"]?.first
                ?? envelope.message
                ?? L.t("Không lưu được ngôn ngữ.")
        } catch {
            restore(choice: previousChoice, previousLanguage: previousLanguage, mirror: previousMirror)
            saveError = L.t("Không kết nối được máy chủ.")
        }
    }

    /// Persists the resolved language for an account that has no explicit
    /// choice.
    ///
    /// Silent and best-effort on purpose: the user did not ask for this write,
    /// so it must not show the save spinner or an error alert. A failure leaves
    /// the marker untouched and the next `adopt` tries again; until then the
    /// account keeps the artifact fallback (Vietnamese), which is the language
    /// the server should have used all along.
    private func mirror(_ resolved: AppLanguage) {
        // Already mirrored this exact value: a `/me` that changed nothing must
        // not produce a write.
        guard AppLanguage.parse(defaults.string(forKey: Self.mirroredKey)) != resolved else { return }
        Task { [weak self] in
            guard let self else { return }
            do {
                _ = try await self.client.updateProfile(
                    UpdateProfileInput(locale: .set(resolved.rawValue))
                )
                self.defaults.set(resolved.rawValue, forKey: Self.mirroredKey)
            } catch {
                // Retried by the next adopt. Nothing to surface: the UI is
                // already in the right language and the server keeps its
                // fallback until this succeeds.
            }
        }
    }

    /// Puts the local state back after a failed `PATCH`, including the mirror
    /// marker: a rolled-back "Theo thiết bị" that never reached the server must
    /// not leave a value the account does not hold.
    private func restore(choice: AppLanguage?, previousLanguage: AppLanguage, mirror: String?) {
        storedChoice = choice
        SharedInboxLanguage.publish(choice)
        if let choice {
            defaults.set(choice.rawValue, forKey: Self.cacheKey)
        } else {
            defaults.removeObject(forKey: Self.cacheKey)
        }
        if let mirror {
            defaults.set(mirror, forKey: Self.mirroredKey)
        } else {
            defaults.removeObject(forKey: Self.mirroredKey)
        }
        apply(previousLanguage)
    }

    /// Pushes a language into the library, which is what every `L.t` call reads.
    private func apply(_ next: AppLanguage) {
        guard next != language else { return }
        language = next
        L.language = next
        // The widget renders off-process from the mirrored App Group value.
        // Ask WidgetKit to rebuild now so the home screen follows the switch
        // instead of waiting for the next midnight timeline entry.
        WidgetCenter.shared.reloadTimelines(ofKind: WarrlySurface.widgetKind)
    }
}

/// The Settings rows, in order. `.device` is the "no stored choice" state: the
/// account still stores the RESOLVED language (so push and email have an
/// answer), but this device keeps following the phone's own language.
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
