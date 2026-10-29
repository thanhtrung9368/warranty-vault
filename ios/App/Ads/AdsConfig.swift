import Foundation
import WarrlyKit

// ============================================================
// AdsConfig — build-time settings and the paid-tier cut-off for the banner.
//
// Two different kinds of value live side by side here on purpose:
//
//  * `bannerUnitID` is BUILD configuration. It comes from the generated
//    Info.plist key `GADBannerUnitID`, fed by
//    `Config/{Debug,Release}.xcconfig`, so Debug carries Google's TEST ad unit
//    and Release the real one. It is a build setting rather than a
//    `#if DEBUG` in code because the wrong side of that choice is a policy
//    violation (clicking your own live ad), not a cosmetic difference.
//
//  * `isAdFree` is ENTITLEMENT. The banner is free-tier-only; the paid tier is
//    not on sale yet (the website's pricing/privacy copy says so), so nothing
//    in this build turns it off. The switch exists so the day the account
//    model carries a plan, there is one place to set it and one place the
//    banner reads.
// ============================================================

enum AdsConfig {

    /// Generated Info.plist key carrying the per-configuration ad-unit id.
    static let bannerUnitIDInfoKey = "GADBannerUnitID"

    /// The ad-unit id for this build, or `nil` when the generated Info.plist has
    /// no value (which means the xcconfig was not applied — a build mistake).
    ///
    /// `nil` is not fatal to the app: the reserved banner slot stays empty
    /// rather than crashing a shipping build. It IS fatal in Debug, via
    /// `assertionFailure`, because a banner that silently never loads is
    /// exactly the kind of configuration bug that survives to TestFlight.
    static var bannerUnitID: String? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: bannerUnitIDInfoKey) as? String else {
            assertionFailure("""
                Missing \(bannerUnitIDInfoKey) in Info.plist. Regenerate the project \
                (`cd ios && xcodegen generate`) after editing project.yml, and check \
                WV_ADMOB_BANNER_UNIT_ID in Config/{Debug,Release}.xcconfig.
                """)
            return nil
        }
        let id = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        // An unresolved `$(WV_ADMOB_BANNER_UNIT_ID)` means Info.plist expansion
        // did not run — treating that as an id would make the SDK fail later
        // with a much less useful message.
        guard !id.isEmpty, !id.hasPrefix("$(") else {
            assertionFailure("Unresolved \(bannerUnitIDInfoKey): \(raw)")
            return nil
        }
        return id
    }

    /// `UserDefaults` key for the paid-tier cut-off (`AdsController.setAdFree`).
    static let adFreeDefaultsKey = "wv.adsRemoved"

    /// Whether this account is entitled to an ad-free app.
    ///
    /// Debug can force it with `WV_ADS_FREE=1` in the launch environment so the
    /// "hidden for a paid account" path is testable before a paid tier exists.
    static var isAdFree: Bool {
#if DEBUG
        if ProcessInfo.processInfo.environment["WV_ADS_FREE"] == "1" { return true }
#endif
        return UserDefaults.standard.bool(forKey: adFreeDefaultsKey)
    }

    /// Test devices, from `WV_ADS_TEST_DEVICES=a,b` in a Debug launch
    /// environment.
    ///
    /// Why this exists on top of the test ad unit: the Debug build requests
    /// Google's test unit, so it can never serve (or click) a live ad. A device
    /// still needs registering when someone deliberately points a Debug build
    /// at a real unit to check fill — and the AdMob console's "test devices"
    /// list is per ad unit, not per app. Simulators are always test devices.
    ///
    /// The id to paste is printed to the console by the SDK on the first ad
    /// request ("To get test ads on this device, set …"). Empty in Release.
    static var testDeviceIdentifiers: [String]? {
#if DEBUG
        guard let raw = ProcessInfo.processInfo.environment["WV_ADS_TEST_DEVICES"] else { return nil }
        let ids = raw
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        return ids.isEmpty ? nil : ids
#else
        return nil
#endif
    }
}
