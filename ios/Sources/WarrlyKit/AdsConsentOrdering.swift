import Foundation

// ============================================================
// AdsConsentOrdering — the ORDER of the two ad-consent prompts, as a pure
// decision.
//
// The same ordering cost the owner's other iOS app (Stavely) three App Store
// rejections, in opposite directions, which is why it lives in its own file
// with its own tests instead of inside the controller that talks to Google's
// SDKs:
//
//   * 2026-07-27 (Guideline 2.1): the ATT request sat behind two network calls
//     with no timeout. On App Review's slow network the reviewer never saw the
//     tracking prompt. Fix: bound the UMP phase and ask for tracking anyway.
//   * 2026-10-12 (Guideline 5.1.1(iv)): a flat 6 s bound is a RACE, not an
//     order. UMP had not answered within 6 s, the ATT alert went up, and UMP
//     then presented the GDPR form underneath it — so after the reviewer chose
//     "Ask App Not to Track", a form asking to personalise advertising was
//     still on screen. Apple read that as asking for tracking again after it
//     had been refused.
//   * 2026-10-13 (non-EEA path): UMP answered "no form required" while Google's
//     IDFA explainer was still on screen, and the ATT alert landed on top of
//     the explainer.
//
// The invariants that satisfy all three, and the ones pinned by
// `AdsConsentOrderingTests`:
//
//   0. No ATT prompt while ANY UMP message is on screen. `formStatus` is form
//      *availability*, refreshed only by `requestConsentInfoUpdate`, and
//      `loadAndPresentIfRequired`'s completion fires "on the next run loop if
//      no form is presented" — so neither reports the explainer that UMP adds
//      to the app's main window. The view hierarchy is the only observable,
//      and `isUMPMessageViewClass` is its handle.
//   1. The ATT prompt is requested only once UMP has ANSWERED it has decided
//      whether a consent form is coming. An answer that never arrives CLOSES
//      the session's form window instead of racing the prompt.
//   2. No consent form may be presented after tracking has been asked for in
//      the same session ("form window closed"). That is 5.1.1(iv) exactly.
//   3. A user who declines ATT, or for whom UMP never answered, still gets
//      ads — non-personalised ones (`npa=1`), which `requestsNonPersonalisedAds`
//      decides. Consent absent is a targeting downgrade, not an outage.
//
// Deliberately free of `GoogleMobileAds`, `UserMessagingPlatform`,
// `AppTrackingTransparency` and UIKit imports: this file builds and is tested
// on macOS by `swift test`, where none of those exist. The app target maps the
// SDK's enums onto the ones here.
// ============================================================

// MARK: - ATT

/// `ATTrackingManager.AuthorizationStatus`, restated without AppTrackingTransparency.
public enum AdsTrackingStatus: String, Sendable, Equatable, CaseIterable {
    /// The user has not been asked yet — the state the prompt exists for.
    case notDetermined
    /// Tracking is blocked by policy (parental controls, MDM). Not a refusal we
    /// may ask past, and the IDFA is unavailable either way.
    case restricted
    /// The user chose "Ask App Not to Track".
    case denied
    /// The user allowed tracking; the IDFA may be read.
    case authorized

    /// Apple's letter speaks of "the user has already selected Ask App Not to
    /// Track". `.restricted` counts: it is a refusal we are not allowed to ask
    /// past, and the IDFA is unavailable either way.
    public var isRefusal: Bool { self == .denied || self == .restricted }

    /// Only `.authorized` lets an ad request carry the IDFA.
    ///
    /// `.notDetermined` is NOT permission: an ad requested before the prompt
    /// has been answered must be non-personalised. Treating "not answered yet"
    /// as consent is how an app ships personalised ads to someone who never
    /// agreed to them.
    public var allowsPersonalisedAdvertising: Bool { self == .authorized }
}

// MARK: - UMP

/// `UMPConsentStatus`, restated without UserMessagingPlatform.
public enum AdsConsentStatus: String, Sendable, Equatable, CaseIterable {
    /// `requestConsentInfoUpdate` has never run, or it failed.
    case unknown
    /// A consent form is owed and has not been answered.
    case required
    /// No consent is required for this user and region (e.g. Vietnam).
    case notRequired
    /// The user answered the form.
    case obtained

    /// GDPR/TCF consent covers personalised advertising.
    ///
    /// `.unknown` is deliberately NOT consent: UMP failing is the case this
    /// whole file exists for, and the fallback is non-personalised ads.
    public var allowsPersonalisedAdvertising: Bool {
        self == .obtained || self == .notRequired
    }
}

/// `UMPFormStatus`, restated without UserMessagingPlatform.
public enum AdsFormStatus: String, Sendable, Equatable, CaseIterable {
    /// UMP has not answered yet.
    case unknown
    /// A consent form is available for this user and region.
    case available
    /// There is no form to show.
    case unavailable

    public var isAvailable: Bool { self == .available }
}

// MARK: - Session state

/// Where the UMP phase is.
public enum AdsConsentPhase: String, Sendable, Equatable, CaseIterable {
    /// Nothing requested yet.
    case idle
    /// `requestConsentInfoUpdate` is in flight, and the deadline is armed.
    case requestingConsent
    /// UMP answered. A form may or may not be owed.
    case consentSettled
    /// UMP failed or overran its budget. No form may be presented in this
    /// session; ads fall back to non-personalised.
    case consentClosed
}

/// What the UMP phase may do now.
public enum AdsFormAction: String, Sendable, Equatable, CaseIterable {
    /// Present the form.
    case present
    /// Show nothing.
    case skip
}

/// The mutable state the controller drives, with the ordering rules as
/// methods on it.
///
/// Every transition is idempotent and guarded, so a double callback from a
/// Google SDK cannot push the state into a shape the rules do not cover.
public struct AdsConsentSession: Equatable, Sendable {

    public private(set) var phase: AdsConsentPhase = .idle
    public private(set) var form: AdsFormStatus = .unknown
    /// A form (or UMP's own message) has been handed to the screen and has not
    /// finished dismissing. Outranks every timer.
    public private(set) var formCommitted = false
    /// No consent form may be presented for the rest of this session. Set when
    /// the phase settles without a form, when the phase closes without an
    /// answer, when a form is dismissed, and immediately before ATT is asked.
    public private(set) var formWindowClosed = false

    public init() {}

    // MARK: Transitions

    public mutating func beginConsentRequest() {
        guard phase == .idle else { return }
        phase = .requestingConsent
    }

    /// UMP answered: it told us whether a form is coming.
    public mutating func consentAnswered(form: AdsFormStatus) {
        guard phase == .requestingConsent else { return }
        phase = .consentSettled
        self.form = form
        // No form owed → nothing can ever be presented, so the window can close
        // now and ATT is free to follow.
        if form != .available { formWindowClosed = true }
    }

    /// UMP failed, or it did not answer inside its budget.
    ///
    /// This is the escape hatch that keeps 2026-07-27's 2.1 rejection from
    /// coming back, written so it cannot reproduce 2026-10-12: the window
    /// closes at the same moment, so a form that arrives late is never shown.
    public mutating func consentPhaseClosed() {
        guard phase == .requestingConsent else { return }
        phase = .consentClosed
        formWindowClosed = true
    }

    public mutating func formPresented() {
        guard phase == .consentSettled, form.isAvailable, !formWindowClosed else { return }
        formCommitted = true
    }

    public mutating func formDismissed() {
        guard formCommitted else { return }
        formCommitted = false
        formWindowClosed = true
    }

    /// Closes the window without claiming a form was dismissed — used when
    /// presentation could not happen (no view controller) or was skipped.
    public mutating func closeFormWindow() {
        formWindowClosed = true
    }

    /// Called immediately before `ATTrackingManager.requestTrackingAuthorization`.
    /// Belt and braces for rule 2: after this, `formAction` is `.skip` for the
    /// rest of the session.
    public mutating func trackingPromptRequested() {
        formWindowClosed = true
    }

    // MARK: Derived rules

    /// UMP is done deciding: it answered, or its window was closed.
    public var isConsentPhaseFinished: Bool {
        switch phase {
        case .idle, .requestingConsent: return false
        case .consentSettled: return formWindowClosed
        case .consentClosed: return true
        }
    }

    /// What to do about a consent form right now.
    public var formAction: AdsFormAction {
        guard phase == .consentSettled, form.isAvailable, !formWindowClosed else { return .skip }
        return .present
    }

    /// Rules 0 and 1: whether ATT may be requested.
    ///
    /// - Parameter messageOnScreen: UMP currently has a message on screen
    ///   (Google's IDFA explainer, or a form). Read LIVE and checked before
    ///   anything else: UMP reports no form on the explainer path, so a settled
    ///   phase with an explainer still up would otherwise release the prompt on
    ///   top of it. Only the message going away clears this — no timer buys a
    ///   way past it, and no latch is kept.
    ///
    /// A finite budget is still needed for the `requestingConsent` phase: it is
    /// what turns "UMP never answered" into `consentClosed`, which is the only
    /// state in which ATT may precede an answer. At that point no form can be
    /// presented any more, so the 2026-10-12 overlap is impossible.
    public func mayRequestTracking(messageOnScreen: Bool) -> Bool {
        if messageOnScreen { return false }
        if formCommitted { return false }
        return isConsentPhaseFinished
    }
}

// MARK: - Pure decisions

public enum AdsConsentOrdering {

    /// UMP's message UI, recognised by the one class that carries it:
    /// `UMPView`, the view that owns the form's web view.
    ///
    /// Not a prefix test on purpose — the SDK also has `UMPMainWindowView`, a
    /// container/placeholder, and a container that outlives its message would
    /// hold ATT for the whole session.
    public static func isUMPMessageViewClass(_ className: String) -> Bool {
        className == umpMessageViewClassName
    }

    /// The single class name `isUMPMessageViewClass` accepts.
    public static let umpMessageViewClassName = "UMPView"

    /// Whether the next ad request must be non-personalised (`npa=1`).
    ///
    /// Personalised advertising needs BOTH lawful bases:
    ///   * GDPR/TCF consent for personalised advertising (UMP), and
    ///   * ATT permission, because personalising on iOS means reading the IDFA.
    ///
    /// Missing either one yields non-personalised ads — never no ads. This is
    /// the requirement that a user who accepts the GDPR form but declines ATT
    /// still sees a banner.
    public static func requestsNonPersonalisedAds(
        consent: AdsConsentStatus,
        tracking: AdsTrackingStatus
    ) -> Bool {
        !(consent.allowsPersonalisedAdvertising && tracking.allowsPersonalisedAdvertising)
    }

    /// How long the UMP phase may take before `consentPhaseClosed()` fires.
    ///
    /// This is NOT the ordering rule (that is `AdsConsentSession`); it is only
    /// how long we wait for an answer before declaring that none is coming.
    /// Ten seconds: long enough for a slow EEA form fetch, short enough that a
    /// reviewer on a bad network still sees the ATT prompt (reject 2.1).
    public static let consentFormWindowBudget: TimeInterval = 10

    /// How long the ATT prompt may sit unanswered before the ad SDK starts
    /// anyway (non-personalised, because the status is still `.notDetermined`).
    ///
    /// Nothing Apple requires: it keeps a forgotten prompt from blocking the
    /// free tier's ads forever. The prompt itself stays on screen; a later
    /// foreground retries it.
    public static let trackingPromptBudget: TimeInterval = 20
}
