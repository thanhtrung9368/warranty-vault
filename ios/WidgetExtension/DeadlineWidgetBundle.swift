import SwiftUI
import WidgetKit

// MARK: - DeadlineWidgetBundle

/// The widget extension's single entry point.
///
/// **Why a bundle at all.** One extension now hosts two surfaces: the deadline
/// widget (iOS 17+, home screen and Lock Screen) and the receipt-capture
/// Control Center control (iOS 18+). A `WidgetBundle` is the only way to expose
/// both from one extension; the control is included through a conditional
/// expression that the result builder understands.
///
/// **Why the guard is `iOSApplicationExtension 18.0` and wraps only the
/// control.** The extension's deployment target is 17.0. Annotating this bundle
/// — or raising `IPHONEOS_DEPLOYMENT_TARGET` for `WarrlyWidget` to 18.0 — makes
/// the whole extension unavailable on iOS 17, i.e. it deletes every widget for
/// everyone on iOS 17. Keeping the guard on the control type
/// (`@available(iOSApplicationExtension 18.0, *)` in `ReceiptCaptureControl.swift`)
/// and on this one branch leaves the iOS 17 widget untouched. See the comment
/// in `ios/project.yml`; do not "simplify" it to a top-level iOS 18 guard.
@main
struct DeadlineWidgetBundle: WidgetBundle {
    var body: some Widget {
        WarrlyDeadlineWidget()
        if #available(iOSApplicationExtension 18.0, *) {
            ReceiptCaptureControl()
        }
    }
}
