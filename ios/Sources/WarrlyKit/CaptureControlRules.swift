import Foundation

// MARK: - CaptureControlRules

/// The Control Center / Lock Screen control's copy, kept in the kit so the
/// extension file contains only the `ControlWidget` declaration.
///
/// **Honesty rule:** the control opens the capture sheet — it does not take the
/// photo. The photo is the next tap, and when App Lock is on, Face ID sits
/// between the control tap and the sheet. The gallery description says so; no
/// surface here may claim "one tap" capture.
public enum CaptureControlRules {

    /// What the Controls gallery lists and the control's button reads.
    public static func displayName(language: AppLanguage) -> String {
        L.t("Chụp hoá đơn", language: language)
    }

    /// The button's text. Short: Control Center gives the control a small tile.
    public static func buttonLabel(language: AppLanguage) -> String {
        L.t("Chụp hoá đơn", language: language)
    }

    public static func galleryDescription(language: AppLanguage) -> String {
        L.t("Mở màn hình chụp hoá đơn trong Warrly. Bước tiếp theo là chụp ảnh; nếu bật Face ID bạn sẽ mở khoá trước.",
            language: language)
    }
}
