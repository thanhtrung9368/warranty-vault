import AppIntents
import SwiftUI
import WarrlyKit
import WidgetKit

// MARK: - ReceiptCaptureControl

/// The Control Center / Lock Screen control (iOS 18+) that opens receipt
/// capture.
///
/// **Availability guard.** `@available(iOSApplicationExtension 18.0, *)` — the
/// extension platform name, not `iOS 18.0` — and only on this control. The
/// extension's deployment target stays 17.0 (see `project.yml`), so the
/// deadline widget keeps rendering on iOS 17; this type simply does not exist
/// in that process. Annotating the whole `WidgetBundle` (or raising the
/// extension target) would drop every widget on iOS 17.
///
/// **Honesty.** The control opens the capture screen; taking the photo is the
/// next tap and App Lock's Face ID prompt sits in between when the lock is on.
/// The gallery copy says exactly that (`CaptureControlRules`), because "one tap
/// receipt" would be false on a locked phone.
@available(iOSApplicationExtension 18.0, *)
struct ReceiptCaptureControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        let language = SharedInboxLanguage.resolved()
        return StaticControlConfiguration(kind: WarrlySurface.captureControlKind) {
            ControlWidgetButton(action: CaptureReceiptIntent()) {
                Label {
                    Text(CaptureControlRules.buttonLabel(language: language))
                } icon: {
                    // The same viewfinder the inbox capture row uses.
                    Image(systemName: "doc.viewfinder")
                }
            }
        }
        .displayName(
            LocalizedStringResource(
                stringLiteral: CaptureControlRules.displayName(language: language)
            )
        )
        .description(
            LocalizedStringResource(
                stringLiteral: CaptureControlRules.galleryDescription(language: language)
            )
        )
    }
}
