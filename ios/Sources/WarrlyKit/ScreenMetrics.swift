import CoreGraphics

// ScreenMetrics — layout numbers that must be the same everywhere.
//
// Kept in the Kit (not the app's design system) for the same reason the day
// rules are: it is a single value with a single meaning, and a test can pin it
// instead of a screenshot review.
public enum ScreenMetrics {

    /// Extra space below the last row of any screen inside the tab shell.
    ///
    /// On iOS 26 the floating tab bar contributes its **frame** to the tab
    /// content's safe area (83 pt on the 402×874 simulator), so a scroll view's
    /// `adjustedContentInset.bottom` already clears the bar itself. What that
    /// does not guarantee is a *readable margin*: the glass capsule is drawn
    /// inside that frame with its own padding, and a screen whose last row ends
    /// exactly at the safe-area edge looks glued to the bar.
    ///
    /// Every screen used to add its own trailing `Spacer().frame(height: 24)`
    /// to avoid that — a per-screen magic number that a new screen can forget.
    /// The tab shell now reserves this once, via `safeAreaPadding` on each
    /// tab's `NavigationStack`, so every pushed screen inherits it and sheets
    /// presented outside the shell do not.
    public static let tabBarContentInset: CGFloat = 24

    /// Height reserved for the AdMob banner at the bottom of the Devices list.
    ///
    /// Reserved BEFORE an ad loads and whether or not one ever loads: the slot
    /// is part of the layout, so the list does not jump when the creative
    /// arrives, when the SDK starts late, or when the request fails. Hiding the
    /// slot until fill is what makes a free app feel like it is glitching.
    ///
    /// 50 pt is the height of a 320×50 banner and the recommended maximum for
    /// `inlineAdaptiveBanner(width:maxHeight:)` — the adaptive creative is
    /// letterboxed INSIDE this slot rather than allowed to resize it, which is
    /// what lets the width adapt without the height shifting the list.
    public static let adBannerSlotHeight: CGFloat = 50
}
