import AppIntents
import WarrlyKit

// MARK: - CaptureReceiptIntent

/// The Control Center control's action.
///
/// `OpenIntent` (not a plain `AppIntent`) because the point is to open Warrly.
/// `perform()` writes the App Group `wv.pendingCapture` flag *before* returning,
/// so a cold launch still finds the request even though the control ran in a
/// process whose UI did not exist yet. `AppRouter` consumes the flag on the next
/// activation and `RootView` presents the capture sheet only when the session
/// is authenticated and the App Lock cover is down — Face ID therefore stays
/// authoritative.
///
/// This file is a member of **both** the app and the widget extension
/// (see `ios/project.yml`): a control's intent may be run in either process, so
/// both binaries must know the type.
@available(iOS 18.0, iOSApplicationExtension 18.0, *)
struct CaptureReceiptIntent: OpenIntent {
    static var title: LocalizedStringResource = "Capture a receipt"
    static var description = IntentDescription("Opens Warrly's receipt capture.")

    /// `OpenIntent` requires a target value and requires it to be an intent
    /// parameter. The control always means the same thing, so `init()` fixes it
    /// to `.inbox` and the Controls gallery never shows a parameter sheet.
    @Parameter(title: "Target")
    var target: CaptureTarget

    init() {
        self.target = .inbox
    }

    func perform() async throws -> some IntentResult {
        WarrlyIntentBridge.requestCapture()
        return .result()
    }
}

// MARK: - CaptureTarget

/// The destination `CaptureReceiptIntent` opens. One case today; the enum shape
/// is what `OpenIntent` asks for and leaves room for "capture a warranty card"
/// later without changing the control's identity.
@available(iOS 18.0, iOSApplicationExtension 18.0, *)
enum CaptureTarget: String, AppEnum {
    case inbox

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Capture target")
    static var caseDisplayRepresentations: [CaptureTarget: DisplayRepresentation] = [
        .inbox: DisplayRepresentation(title: "Inbox"),
    ]
}
