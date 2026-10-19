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
}
