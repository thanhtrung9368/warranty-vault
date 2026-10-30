import XCTest
@testable import WarrlyKit

// The ordering of the two ad-consent prompts, pinned.
//
// This is the file that exists because the owner's other iOS app was rejected
// three times over one ordering, in opposite directions: first ATT sat behind a
// UMP call with no timeout (Guideline 2.1, reviewer never saw the prompt), then
// a flat timeout let ATT go up before UMP's GDPR form (Guideline 5.1.1(iv)).
// The fix is state, not a number of seconds, so the tests below assert state
// transitions rather than elapsed time.
//
// What each group protects:
//   * `testATT*` — the prompt must not appear before UMP has answered, while a
//     form is on screen, or after UMP already showed a message.
//   * `testDeadline*` — a UMP that never answers must not leak a form into a
//     session where ATT has already been asked (the 5.1.1(iv) reject), yet must
//     not block the prompt either (the 2.1 reject).
//   * `testNonPersonalised*` — declining ATT or failing UMP yields
//     non-personalised ads, not zero ads.
final class AdsConsentOrderingTests: XCTestCase {

    // MARK: - Fixtures

    /// A session whose UMP answer has arrived with no form owed.
    private func settledWithoutForm() -> AdsConsentSession {
        var s = AdsConsentSession()
        s.beginConsentRequest()
        s.consentAnswered(form: .unavailable)
        return s
    }

    /// A session where UMP wants a form that has not been presented yet.
    private func settledWithForm() -> AdsConsentSession {
        var s = AdsConsentSession()
        s.beginConsentRequest()
        s.consentAnswered(form: .available)
        return s
    }

    // MARK: - Rule 1: nothing before UMP has answered

    func testATTIsBlockedBeforeConsentIsRequested() {
        let s = AdsConsentSession()
        XCTAssertFalse(s.mayRequestTracking(messageOnScreen: false))
    }

    func testATTIsBlockedWhileTheConsentInfoRequestIsInFlight() {
        var s = AdsConsentSession()
        s.beginConsentRequest()
        XCTAssertFalse(
            s.mayRequestTracking(messageOnScreen: false),
            "Asking for tracking while UMP is still deciding is the race that produced 5.1.1(iv)."
        )
    }

    func testATTIsAllowedOnlyAfterUMPAnsweredWithNoForm() {
        XCTAssertTrue(settledWithoutForm().mayRequestTracking(messageOnScreen: false))
    }

    func testATTIsBlockedWhileAFormIsOwedButNotYetOnScreen() {
        let s = settledWithForm()
        XCTAssertEqual(s.formAction, .present)
        XCTAssertFalse(
            s.mayRequestTracking(messageOnScreen: false),
            "UMP has said a GDPR form is coming; the ATT alert must wait for it, not beat it."
        )
    }

    // MARK: - Rule 2: nothing after tracking was asked

    func testFormIsSkippedOnceTrackingHasBeenAsked() {
        var s = settledWithForm()
        s.formPresented()
        s.formDismissed()
        // A later foreground must not resurrect a form.
        s.trackingPromptRequested()
        XCTAssertEqual(s.formAction, .skip)
    }

    func testTrackingPromptRequestClosesTheFormWindow() {
        var s = settledWithForm()
        s.closeFormWindow()             // e.g. presentation failed
        s.trackingPromptRequested()
        XCTAssertTrue(s.formWindowClosed)
        XCTAssertEqual(s.formAction, .skip)
    }

    func testFormCannotBePresentedTwice() {
        var s = settledWithForm()
        s.formPresented()
        s.formDismissed()
        s.formPresented()
        XCTAssertFalse(s.formCommitted, "A single-use form disappearing is not a reason to reopen the window.")
        XCTAssertEqual(s.formAction, .skip)
    }

    // MARK: - Rule 0: never over UMP's own message

    func testATTIsBlockedWhileAUMPMessageIsOnScreenEvenWhenThePhaseSettled() {
        let s = settledWithoutForm()
        XCTAssertFalse(
            s.mayRequestTracking(messageOnScreen: true),
            "This is the 2026-10-13 explainer: UMP reports no form, but its view is on screen."
        )
    }

    func testAUMPMessageOnScreenAlsoBlocksATrackingRetryAfterAFormWasDismissed() {
        var s = settledWithForm()
        s.formPresented()
        s.formDismissed()
        XCTAssertFalse(s.mayRequestTracking(messageOnScreen: true))
        XCTAssertTrue(s.mayRequestTracking(messageOnScreen: false))
    }

    func testOnlyUMPViewIsTreatedAsAMessage() {
        XCTAssertTrue(AdsConsentOrdering.isUMPMessageViewClass("UMPView"))
        XCTAssertFalse(
            AdsConsentOrdering.isUMPMessageViewClass("UMPMainWindowView"),
            "A container that outlives its message would hold ATT for the whole session."
        )
        XCTAssertFalse(AdsConsentOrdering.isUMPMessageViewClass("UMPConsentViewController"))
        XCTAssertFalse(AdsConsentOrdering.isUMPMessageViewClass(""))
    }

    // MARK: - The deadline: an escape hatch that cannot reorder

    func testADeadlineClosesTheFormWindowAndReleasesATT() {
        var s = AdsConsentSession()
        s.beginConsentRequest()
        s.consentPhaseClosed()

        XCTAssertTrue(s.isConsentPhaseFinished)
        XCTAssertTrue(s.formWindowClosed)
        XCTAssertTrue(s.mayRequestTracking(messageOnScreen: false))
    }

    func testAFormOfferedAfterTheDeadlineIsNeverPresented() {
        var s = AdsConsentSession()
        s.beginConsentRequest()
        s.consentPhaseClosed()
        // The late answer from a slow UMP — this is the 2026-10-12 sequence.
        s.consentAnswered(form: .available)

        XCTAssertEqual(s.phase, .consentClosed, "A late answer must not undo the closed window.")
        XCTAssertEqual(s.formAction, .skip)
    }

    func testLateAnswerCannotReopenTheWindowAfterTrackingWasAsked() {
        var s = settledWithoutForm()
        s.trackingPromptRequested()
        s.consentAnswered(form: .available)
        XCTAssertEqual(s.formAction, .skip)
    }

    func testTheDeadlineDoesNotInterruptASettledPhase() {
        var s = settledWithForm()
        s.consentPhaseClosed()
        XCTAssertEqual(s.phase, .consentSettled)
        XCTAssertFalse(s.formWindowClosed, "A form already owed must still be shown.")
    }

    func testTheFormWindowBudgetIsFiniteAndSane() {
        // Not the ordering rule — the number only has to exist, and be long
        // enough for a slow EEA form fetch yet short enough for a reviewer on a
        // bad network to still see the prompt.
        XCTAssertGreaterThanOrEqual(AdsConsentOrdering.consentFormWindowBudget, 5)
        XCTAssertLessThanOrEqual(AdsConsentOrdering.consentFormWindowBudget, 30)
    }

    // MARK: - Transitions are idempotent

    func testConsentRequestStartsOnce() {
        var s = AdsConsentSession()
        s.beginConsentRequest()
        s.consentAnswered(form: .available)
        s.beginConsentRequest()
        XCTAssertEqual(s.phase, .consentSettled)
        XCTAssertEqual(s.form, .available)
    }

    func testDismissingWithoutPresentingDoesNothing() {
        var s = settledWithForm()
        s.formDismissed()
        XCTAssertFalse(s.formCommitted)
        XCTAssertFalse(s.formWindowClosed, "Only a real dismissal may close the window.")
    }

    func testConsentPhaseClosedIsIgnoredAfterSettling() {
        var s = settledWithoutForm()
        s.consentPhaseClosed()
        XCTAssertEqual(s.phase, .consentSettled)
    }

    // MARK: - Personalised vs non-personalised

    func testPersonalisedNeedsBothConsentAndTrackingPermission() {
        XCTAssertFalse(
            AdsConsentOrdering.requestsNonPersonalisedAds(consent: .obtained, tracking: .authorized),
            "Both lawful bases present is the only state that allows personalisation."
        )
    }

    func testDecliningATTAfterAcceptingGDPRStillYieldsAds() {
        XCTAssertTrue(
            AdsConsentOrdering.requestsNonPersonalisedAds(consent: .obtained, tracking: .denied),
            "GDPR consent without ATT permission is non-personalised, not no ads."
        )
    }

    func testRestrictedTrackingIsNonPersonalised() {
        XCTAssertTrue(
            AdsConsentOrdering.requestsNonPersonalisedAds(consent: .obtained, tracking: .restricted)
        )
    }

    func testAnUnansweredATTPromptIsNotConsent() {
        XCTAssertTrue(
            AdsConsentOrdering.requestsNonPersonalisedAds(consent: .obtained, tracking: .notDetermined),
            "The banner may load while the prompt is still up; it must not personalise on a guess."
        )
    }

    func testTrackingPermissionWithoutGDPRConsentIsStillNonPersonalised() {
        XCTAssertTrue(
            AdsConsentOrdering.requestsNonPersonalisedAds(consent: .required, tracking: .authorized)
        )
    }

    func testUnknownConsentIsNotConsent() {
        XCTAssertTrue(
            AdsConsentOrdering.requestsNonPersonalisedAds(consent: .unknown, tracking: .authorized),
            "UMP failing or hanging must degrade to non-personalised ads, never personalise on a guess."
        )
    }

    func testConsentNotRequiredOutsideTheEEAAllowsPersonalisation() {
        XCTAssertFalse(
            AdsConsentOrdering.requestsNonPersonalisedAds(consent: .notRequired, tracking: .authorized),
            "A Vietnamese user sees no UMP form; consent is not required there, and ATT decides."
        )
    }

    func testATimedOutSessionIsNonPersonalised() {
        var s = AdsConsentSession()
        s.beginConsentRequest()
        s.consentPhaseClosed()
        XCTAssertTrue(
            AdsConsentOrdering.requestsNonPersonalisedAds(consent: .unknown, tracking: .authorized)
        )
    }

    // MARK: - Consent status semantics

    func testOnlyObtainedAndNotRequiredCountAsConsent() {
        XCTAssertTrue(AdsConsentStatus.obtained.allowsPersonalisedAdvertising)
        XCTAssertTrue(AdsConsentStatus.notRequired.allowsPersonalisedAdvertising)
        XCTAssertFalse(AdsConsentStatus.required.allowsPersonalisedAdvertising)
        XCTAssertFalse(AdsConsentStatus.unknown.allowsPersonalisedAdvertising)
    }

    func testOnlyAuthorizedTrackingAllowsTheIDFA() {
        XCTAssertTrue(AdsTrackingStatus.authorized.allowsPersonalisedAdvertising)
        XCTAssertFalse(AdsTrackingStatus.notDetermined.allowsPersonalisedAdvertising)
        XCTAssertFalse(AdsTrackingStatus.denied.allowsPersonalisedAdvertising)
        XCTAssertFalse(AdsTrackingStatus.restricted.allowsPersonalisedAdvertising)
    }

    func testRefusalCoversDeniedAndRestrictedOnly() {
        XCTAssertTrue(AdsTrackingStatus.denied.isRefusal)
        XCTAssertTrue(AdsTrackingStatus.restricted.isRefusal)
        XCTAssertFalse(AdsTrackingStatus.notDetermined.isRefusal)
        XCTAssertFalse(AdsTrackingStatus.authorized.isRefusal)
    }

    // MARK: - Privacy options: withdrawing a consent that was already given

    func testThePrivacyOptionsEntryExistsOnlyWhenUMPRequiresIt() {
        XCTAssertTrue(
            AdsConsentOrdering.showsPrivacyOptionsEntry(.required),
            "AdMob marked privacy options required: the user must have a way to change their answer."
        )
        XCTAssertFalse(
            AdsConsentOrdering.showsPrivacyOptionsEntry(.notRequired),
            "There is no form to open in this region — a disabled row or an error would still be wrong."
        )
        XCTAssertFalse(
            AdsConsentOrdering.showsPrivacyOptionsEntry(.unknown),
            "UMP has not answered yet; the entry point must not appear on a guess."
        )
    }

    func testThePrivacyOptionsFormCannotBePresentedFromTheBackground() {
        XCTAssertFalse(
            AdsConsentOrdering.canPresentPrivacyOptions(.required, isApplicationActive: false),
            "UMP presents a view controller; a scene that is not active has nowhere to put it."
        )
        XCTAssertTrue(AdsConsentOrdering.canPresentPrivacyOptions(.required, isApplicationActive: true))
    }

    func testThePrivacyOptionsFormNeedsTheRequirementEvenWhenTheAppIsActive() {
        XCTAssertFalse(AdsConsentOrdering.canPresentPrivacyOptions(.notRequired, isApplicationActive: true))
        XCTAssertFalse(AdsConsentOrdering.canPresentPrivacyOptions(.unknown, isApplicationActive: true))
    }

    func testWithdrawingConsentAfterTheFormFallsBackToNonPersonalisedAds() {
        // The form's dismissal re-reads UMP's consent status; when the user
        // withdraws, that status is `.required` again. The SAME launch rule
        // must then produce `npa=1`, even though ATT was granted earlier —
        // otherwise a withdrawal would only change the stored UMP flag and the
        // banner would keep personalising.
        XCTAssertTrue(
            AdsConsentOrdering.requestsNonPersonalisedAds(consent: .required, tracking: .authorized)
        )
    }
}
