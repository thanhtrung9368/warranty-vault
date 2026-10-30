#if canImport(UIKit)
import AppTrackingTransparency
import GoogleMobileAds
import SwiftUI
import UIKit
import UserMessagingPlatform
import WarrlyKit

// ============================================================
// AdsController — the only place that talks to Google's ad + consent SDKs.
//
// The ORDER is the part that matters. The same sequence cost the owner's other
// iOS app three App Store rejections:
//
//   2026-07-27 (2.1)      ATT sat behind a UMP call with no timeout, so the
//                         reviewer never saw the prompt.
//   2026-10-12 (5.1.1(iv)) a flat 6 s timeout let ATT go up BEFORE UMP's GDPR
//                         form, which then appeared underneath it.
//   2026-10-13            UMP's "no form required" answer released ATT while
//                         Google's IDFA explainer was still on screen.
//
// The fix that survived review is state, not seconds — and the state machine
// lives in `WarrlyKit/AdsConsentOrdering.swift`, where `swift test` can pin it.
// This controller only drives it:
//
//      UMP requestConsentInfoUpdate
//        → form if owed, presented and dismissed
//        → ATT (only once the session's form window is closed)
//        → MobileAds.shared.start
//        → the banner may now request an ad
//
// Two budgets exist, and neither is an ordering rule:
//   * the UMP phase gets `consentFormWindowBudget` — if Google never answers,
//     the window closes (so no form can ever appear later) and ads start
//     non-personalised instead of not at all;
//   * the ATT prompt gets `trackingPromptBudget` — an unanswered prompt must
//     not block the free tier's ads forever.
//
// Everything is `@MainActor`: UMP requires the main queue, ATT requires the
// app to be active, and the published state is read by SwiftUI.
// ============================================================

@MainActor
final class AdsController: ObservableObject {

    static let shared = AdsController()

    /// `MobileAds.shared.start` has completed; a banner may request an ad.
    @Published private(set) var isSDKReady = false

    /// The next ad request must be non-personalised (`npa=1`).
    ///
    /// True until BOTH GDPR/TCF consent and ATT permission are in hand. The
    /// banner reads this per request, and `MobileAds.requestConfiguration` is
    /// kept in step for any request the SDK makes on its own (banner refresh).
    @Published private(set) var requestsNonPersonalisedAds = true

    /// Google's answer on whether this user must be offered a way to change the
    /// ad-consent decision they already made
    /// (`privacyOptionsRequirementStatus`).
    ///
    /// Published because Settings renders its "Tuỳ chọn quyền riêng tư" row
    /// from it and must render NOTHING when this is not `.required`. It is
    /// refreshed on every UMP answer, including the answer that follows the
    /// privacy options form.
    @Published private(set) var privacyOptionsRequirement: AdsPrivacyOptionsRequirement = .unknown

    /// Paid tier. The banner is not rendered at all when this is true.
    @Published private(set) var isAdFree: Bool

    // The ordering state (minutes of App Review rejections distilled into a
    // value type — see WarrlyKit/AdsConsentOrdering.swift).
    private var session = AdsConsentSession()

    private var consentDeadline: Task<Void, Never>?
    private var trackingDeadline: Task<Void, Never>?

    /// An ATT prompt is on screen and its callback has not returned.
    private var isRequestingTracking = false
    /// UMP's privacy options form is on screen and its callback has not
    /// returned. Guards against a second tap opening a second form.
    private var isPresentingPrivacyOptions = false
    private var didStartSDK = false

    private init() {
        isAdFree = AdsConfig.isAdFree
    }

    // MARK: - Entry points

    /// Start (or advance) the ads sequence.
    ///
    /// Called when the authenticated shell appears and again on every
    /// foreground. Safe to call repeatedly: every step is guarded by the
    /// session's state, and the SDK starts exactly once.
    func start() {
        // ATT cannot prompt while the app is not active, and UMP's form cannot
        // present. A call from a background transition is simply ignored; the
        // foreground call retries it.
        guard UIApplication.shared.applicationState == .active else { return }

        if session.phase == .idle {
            session.beginConsentRequest()
            requestConsentInfo()
        } else {
            advance()
        }
    }

    /// The paid tier's cut-off. Not called anywhere yet — no paid tier is on
    /// sale — but it is the one place a future plan check has to write.
    func setAdFree(_ value: Bool) {
        guard value != isAdFree else { return }
        UserDefaults.standard.set(value, forKey: AdsConfig.adFreeDefaultsKey)
        isAdFree = value
    }

    /// Whether a Google consent prompt is on screen right now.
    ///
    /// Read by `PushRegistrar` before it asks for notification permission: a
    /// notification alert is a *third* system prompt, and stacking it on UMP's
    /// form or the ATT alert is the ordering mistake this app has already been
    /// rejected for twice. The ATT phase is a flag; UMP's form has no public
    /// observable, so it is detected in the view hierarchy like `advance()` does.
    var hasPromptOnScreen: Bool {
        isRequestingTracking || isPresentingPrivacyOptions || Self.isUMPMessageOnScreen()
    }

    // MARK: - Privacy options (withdraw consent)

    /// Re-reads whether UMP owes this user a privacy options form.
    ///
    /// Called by the launch flow (through `refreshPrivacyState()`), after the
    /// form closes, and when Settings appears. `@Published`, so a change makes
    /// the row appear or disappear without relaunching the app.
    func refreshPrivacyOptionsRequirement() {
        let requirement = Self.mappedPrivacyOptionsRequirement()
        guard requirement != privacyOptionsRequirement else { return }
        log("privacy options requirement: \(requirement.rawValue)")
        privacyOptionsRequirement = requirement
    }

    /// Opens UMP's privacy options form, where a user can change — or withdraw
    /// — the ad consent they gave earlier.
    ///
    /// GDPR Art. 7(3) requires withdrawing consent to be as easy as giving it,
    /// and App Review 5.1.1 looks for the same entry point when AdMob marks
    /// privacy options as required for the user's region. Without this, the only
    /// way out of an accepted consent form was reinstalling the app.
    ///
    /// Returns `false` when there is nothing to present: the requirement is not
    /// `.required`, the app is not active, another UMP prompt is already on
    /// screen, or there is no view controller. The caller does nothing rather
    /// than reporting an error for a row that should not exist.
    ///
    /// After the form closes, `refreshPrivacyState()` re-derives
    /// `requestsNonPersonalisedAds` from the live consent + ATT answers — the
    /// same rule as the launch flow. A withdrawal therefore flips `npa=1` and
    /// `publisherPrivacyPersonalizationState` without a second condition.
    @discardableResult
    public func presentPrivacyOptionsForm() -> Bool {
        // Same guard as `start()`: UMP cannot present from a scene that is not
        // active. Read the requirement LIVE rather than trusting the published
        // copy — Settings can outlive a region/console change.
        guard UIApplication.shared.applicationState == .active else { return false }
        refreshPrivacyOptionsRequirement()
        guard AdsConsentOrdering.canPresentPrivacyOptions(
            privacyOptionsRequirement,
            isApplicationActive: true
        ) else { return false }
        guard !isPresentingPrivacyOptions, !Self.isUMPMessageOnScreen() else { return false }
        guard let presenter = Self.topViewController() else {
            log("UMP privacy options requested but there is no view controller to present from")
            return false
        }

        isPresentingPrivacyOptions = true
        log("UMP presenting the privacy options form")
        ConsentForm.presentPrivacyOptionsForm(from: presenter) { [weak self] error in
            // UMP calls back on the main queue; hop through the actor anyway so
            // the compiler enforces what the docs merely promise.
            Task { @MainActor in
                self?.privacyOptionsFormFinished(error: error)
            }
        }
        return true
    }

    private func privacyOptionsFormFinished(error: Error?) {
        isPresentingPrivacyOptions = false
        if let error {
            // Worth saying out loud: UMP completes with an error on the next
            // run loop when it could not preload a form. Nothing to recover —
            // the ad state is re-derived below either way.
            log("UMP privacy options form finished with an error: \(error.localizedDescription)")
        }
        // Re-read BOTH answers. A withdrawal shows up in `consentStatus`, and
        // the requirement itself can change once the form has been answered;
        // `refreshPrivacyState()` owns both reads and the personalisation
        // rule, so this must not duplicate either.
        refreshPrivacyState()
    }

    // MARK: - UMP phase

    private func requestConsentInfo() {
        armConsentDeadline()
        let parameters = RequestParameters()
        ConsentInformation.shared.requestConsentInfoUpdate(with: parameters) { [weak self] error in
            // UMP calls back on the main queue; hop through the actor anyway so
            // the compiler enforces what the docs merely promise.
            Task { @MainActor in
                self?.consentInfoUpdated(error: error)
            }
        }
    }

    private func consentInfoUpdated(error: Error?) {
        guard session.phase == .requestingConsent else { return }
        consentDeadline?.cancel()
        consentDeadline = nil

        if let error {
            // UMP could not answer. Close the form window FIRST, so a late form
            // can never appear after ATT (the 2026-10-12 reject), then fall
            // through to non-personalised ads.
            log("UMP consent update failed: \(error.localizedDescription) — non-personalised ads")
            session.consentPhaseClosed()
            refreshPrivacyState()
            advance()
            return
        }

        session.consentAnswered(form: Self.mappedFormStatus())
        refreshPrivacyState()
        presentConsentFormIfOwed()
    }

    private func presentConsentFormIfOwed() {
        guard session.formAction == .present else {
            session.closeFormWindow()
            advance()
            return
        }
        guard let presenter = Self.topViewController() else {
            // No view controller means no form. Skipping is safer than leaving
            // the phase "about to present" forever: ATT would stay blocked and
            // the banner would never start.
            log("UMP wants a form but there is no view controller to present it from")
            session.closeFormWindow()
            advance()
            return
        }

        session.formPresented()
        log("UMP presenting the consent form")
        ConsentForm.loadAndPresentIfRequired(from: presenter) { [weak self] error in
            Task { @MainActor in
                self?.consentFormFinished(error: error)
            }
        }
    }

    private func consentFormFinished(error: Error?) {
        if let error {
            log("UMP form finished with an error: \(error.localizedDescription)")
        }
        // Idempotent: if the form was never really presented (UMP completes on
        // the next run loop when nothing is shown), this closes the window and
        // releases ATT instead of deadlocking the flow.
        session.formDismissed()
        session.closeFormWindow()
        refreshPrivacyState()
        advance()
    }

    private func armConsentDeadline() {
        consentDeadline?.cancel()
        consentDeadline = Task { [weak self] in
            try? await Task.sleep(
                nanoseconds: UInt64(AdsConsentOrdering.consentFormWindowBudget * 1_000_000_000)
            )
            guard !Task.isCancelled else { return }
            self?.consentDeadlineFired()
        }
    }

    private func consentDeadlineFired() {
        guard session.phase == .requestingConsent else { return }
        // The escape hatch from reject 2.1, written so it cannot reproduce
        // reject 5.1.1(iv): closing the window is what makes a late form
        // impossible, not the passage of time by itself.
        log("UMP did not answer within the form window — closing it, non-personalised ads")
        session.consentPhaseClosed()
        refreshPrivacyState()
        advance()
    }

    // MARK: - ATT phase

    private func advance() {
        attemptTrackingIfPossible()
        startAdsSDKIfPossible()
    }

    private func attemptTrackingIfPossible() {
        guard !isRequestingTracking else { return }
        guard UIApplication.shared.applicationState == .active else { return }

        let status = Self.currentTrackingStatus()
        guard status == .notDetermined else {
            refreshPrivacyState()
            return
        }

        // Read LIVE: UMP can have a message on screen while every other flag
        // says the consent phase is settled (2026-10-13's IDFA explainer).
        guard session.mayRequestTracking(messageOnScreen: Self.isUMPMessageOnScreen()) else {
            return
        }

        isRequestingTracking = true
        // Rule 2 of the ordering: from this instant no consent form may be
        // presented in this session.
        session.trackingPromptRequested()
        log("ATT requesting tracking authorization (UMP has answered)")

        ATTrackingManager.requestTrackingAuthorization { [weak self] _ in
            Task { @MainActor in
                self?.trackingPromptFinished()
            }
        }
        armTrackingDeadline()
    }

    private func armTrackingDeadline() {
        trackingDeadline?.cancel()
        trackingDeadline = Task { [weak self] in
            try? await Task.sleep(
                nanoseconds: UInt64(AdsConsentOrdering.trackingPromptBudget * 1_000_000_000)
            )
            guard !Task.isCancelled else { return }
            self?.trackingPromptDeadlineFired()
        }
    }

    private func trackingPromptDeadlineFired() {
        guard isRequestingTracking else { return }
        // The prompt is still on screen; the user (or a reviewer) simply has
        // not answered. Start ads without permission — non-personalised,
        // because the status is still .notDetermined — and retry the prompt on
        // the next foreground.
        log("ATT prompt unanswered — starting ads non-personalised")
        isRequestingTracking = false
        refreshPrivacyState()
        startAdsSDKIfPossible()
    }

    private func trackingPromptFinished() {
        trackingDeadline?.cancel()
        trackingDeadline = nil
        isRequestingTracking = false
        log("ATT finished with status \(Self.currentTrackingStatus().rawValue)")
        refreshPrivacyState()
        startAdsSDKIfPossible()
    }

    // MARK: - SDK start

    private func startAdsSDKIfPossible() {
        guard !didStartSDK else { return }
        // UMP has decided and no form can appear any more.
        guard session.isConsentPhaseFinished else { return }
        // The ATT answer decides whether the first request may carry the IDFA,
        // so the SDK waits for it — but not indefinitely (see the deadline).
        guard !isRequestingTracking else { return }

        didStartSDK = true
        configureMobileAds()
        log("starting the Google Mobile Ads SDK")
        MobileAds.shared.start { [weak self] _ in
            Task { @MainActor in
                self?.isSDKReady = true
            }
        }
    }

    private func configureMobileAds() {
        let configuration = MobileAds.shared.requestConfiguration
        // Debug only: the SDK prints each device's test id on the first request.
        configuration.testDeviceIdentifiers = AdsConfig.testDeviceIdentifiers
        configuration.publisherPrivacyPersonalizationState =
            requestsNonPersonalisedAds ? .disabled : .default
    }

    // MARK: - State

    /// Recomputes the personalisation decision from the two lawful bases.
    ///
    /// Also re-reads UMP's privacy-options requirement first: the same answer
    /// that updates `consentStatus` (a form dismissal, including the privacy
    /// options form) updates both, and Settings renders its row from the
    /// published requirement.
    private func refreshPrivacyState() {
        refreshPrivacyOptionsRequirement()
        let value = AdsConsentOrdering.requestsNonPersonalisedAds(
            consent: Self.mappedConsentStatus(),
            tracking: Self.currentTrackingStatus()
        )
        guard value != requestsNonPersonalisedAds else { return }
        requestsNonPersonalisedAds = value
        if didStartSDK {
            // Keeps the SDK's own refreshes (banners auto-refresh) in step with
            // the request the app makes explicitly.
            MobileAds.shared.requestConfiguration.publisherPrivacyPersonalizationState =
                value ? .disabled : .default
        }
    }

    // MARK: - SDK enum mapping

    private static func currentTrackingStatus() -> AdsTrackingStatus {
        switch ATTrackingManager.trackingAuthorizationStatus {
        case .notDetermined: return .notDetermined
        case .restricted: return .restricted
        case .denied: return .denied
        case .authorized: return .authorized
        @unknown default: return .notDetermined
        }
    }

    private static func mappedConsentStatus() -> AdsConsentStatus {
        switch ConsentInformation.shared.consentStatus {
        case .obtained: return .obtained
        case .notRequired: return .notRequired
        case .required: return .required
        default: return .unknown
        }
    }

    private static func mappedFormStatus() -> AdsFormStatus {
        switch ConsentInformation.shared.formStatus {
        case .available: return .available
        case .unavailable: return .unavailable
        default: return .unknown
        }
    }

    private static func mappedPrivacyOptionsRequirement() -> AdsPrivacyOptionsRequirement {
#if DEBUG
        // Screenshot-QA hook: the privacy options form exists only where AdMob
        // marks it required, and this simulator is not in such a region — so
        // the Settings row would correctly never render here. The flag forces
        // it on for rendering verification, the same way `WV_ADS_FREE` forces
        // the paid-tier path. Never compiled into Release.
        if AdsConfig.qaPrivacyOptionsRequired { return .required }
#endif
        switch ConsentInformation.shared.privacyOptionsRequirementStatus {
        case .required: return .required
        case .notRequired: return .notRequired
        default: return .unknown
        }
    }

    // MARK: - UIKit geometry

    /// The topmost presented view controller — what UMP needs to present on.
    private static func topViewController(from start: UIViewController? = nil) -> UIViewController? {
        var top = start ?? keyWindow?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        if let navigation = top as? UINavigationController {
            return topViewController(from: navigation.visibleViewController)
        }
        if let tab = top as? UITabBarController {
            return topViewController(from: tab.selectedViewController)
        }
        return top
    }

    private static var keyWindow: UIWindow? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }
    }

    /// Whether UMP currently has its own message on screen.
    ///
    /// There is no public API for this. `formStatus` is form *availability*,
    /// refreshed only by `requestConsentInfoUpdate`, and
    /// `loadAndPresentIfRequired`'s completion fires "on the next run loop if no
    /// form is presented" — so neither reports Google's IDFA explainer, which
    /// UMP adds to the app's main window as `UMPView`. The view hierarchy is
    /// the only observable, which is why the class-name test is pinned in
    /// WarrlyKit (`AdsConsentOrdering.isUMPMessageViewClass`).
    private static func isUMPMessageOnScreen() -> Bool {
        guard let window = keyWindow else { return false }
        return containsView(matching: AdsConsentOrdering.isUMPMessageViewClass, in: window)
    }

    private static func containsView(
        matching isMatch: (String) -> Bool,
        in view: UIView
    ) -> Bool {
        if isMatch(String(describing: type(of: view))) { return true }
        return view.subviews.contains { containsView(matching: isMatch, in: $0) }
    }

    // MARK: - Logging

    private func log(_ message: String) {
#if DEBUG
        print("[Ads] \(message)")
#endif
    }
}
#endif
