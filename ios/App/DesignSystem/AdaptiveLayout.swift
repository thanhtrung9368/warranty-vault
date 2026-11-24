import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

// ============================================================
// Warrly iOS — window-width adaptation (iPhone Duo, iPad)
//
// The app is a phone app that now runs on three very different canvases:
//
//   * the iPhone Duo's **outer** display, 466 × 678 pt, of which only
//     **382 pt** of width is content (`safeAreaInsets.right == 84` — the
//     camera/hinge strip iOS keeps clear on the cover panel),
//   * the Duo's **inner** display, 669 × 951 pt, when the phone is unfolded,
//   * an iPad, whose width the app has never been designed against.
//
// A single `horizontalSizeClass` check is not enough here. On iPhone, the
// size class is derived from the *idiom* as much as from the width, so the
// unfolded 669 pt window can still report `.compact`, while the folded 382 pt
// one is `.compact` for a different reason. The one number that is always
// true is the width SwiftUI actually proposes, so that is what this file
// classifies — measured once at the root and passed down through the
// environment.
//
// The old behaviour — lay every screen out edge to edge — is correct on the
// outer display and wrong on the other two: a 669 pt row with a 17 pt title on
// the left and its date 600 pt away on the right is unreadable, and a form
// stretched to 1000 pt is worse. `WVLayout.readableMaxWidth` caps the reading
// column; the screen background still fills the window.
// ============================================================

/// The width tier a screen is laid out in.
///
/// Named after what the layout does, not after a device: the Duo's two panels
/// are `.compact` and `.regular`, and an iPad is `.regular` or `.wide` — one
/// rule, no device table to keep in sync with Apple's roadmap.
enum WVWindowTier: String, Equatable {
    /// One phone column, edge to edge. The Duo's outer display (382 pt).
    case compact
    /// The Duo's inner display (669 pt), an iPad in a split view.
    case regular
    /// An iPad in portrait/landscape, or any window wider than the Duo.
    case wide
}

/// The numbers behind `WVWindowTier`. A single source, so a screen cannot
/// disagree with the shell about which tier it is in.
enum WVLayout {
    /// Above this width the window is no longer a phone in portrait.
    ///
    /// Every iPhone in portrait is ≤ 440 pt (17 Pro Max) and the Duo's outer
    /// panel is 382 pt of content; the unfolded Duo is 669 pt. 560 sits in the
    /// gap with room on both sides, so a future 500 pt phone would still be
    /// `.compact`.
    static let regularMinWidth: CGFloat = 560

    /// Above this width there is enough room to stop centring one column of
    /// text. Nothing in the app grows a second column at this width yet; the
    /// tier exists so a screen can opt in without re-deriving the number.
    static let wideMinWidth: CGFloat = 900

    /// The widest a single column of rows, cards or form fields is allowed to
    /// get.
    ///
    /// 620 pt is Apple's usual upper bound for a readable line length and is
    /// just under the Duo's inner display (669 pt), so the unfolded layout
    /// keeps a deliberate margin instead of running text to the hinge. On the
    /// outer display the cap is inert (382 < 620), which is what keeps the
    /// compact layout byte-for-byte what it was.
    static let readableMaxWidth: CGFloat = 620

    /// Whether the app is running with the phone idiom.
    ///
    /// The Duo is a phone on both of its panels, so the width tier decides its
    /// layout; the idiom is only used to keep an *iPad* out of decisions that
    /// were made for a foldable (see `WVSidebarAdaptableShell`).
    static var isPhoneIdiom: Bool {
#if canImport(UIKit)
        UIDevice.current.userInterfaceIdiom == .phone
#else
        true
#endif
    }

    /// The tier for a measured window width in points.
    ///
    /// A zero width is the first layout pass before the geometry reader has
    /// reported (and a sheet presented from a view that never measured):
    /// treat it as `.compact`, which lays content out at the full proposed
    /// width — the pre-Duo behaviour, so an unmeasured window can never be
    /// narrower than it looks.
    static func tier(forWidth width: CGFloat) -> WVWindowTier {
        guard width > 0 else { return .compact }
        if width >= wideMinWidth { return .wide }
        if width >= regularMinWidth { return .regular }
        return .compact
    }

    /// The cap a screen's content column gets in this tier, or `nil` when the
    /// column should keep filling the window (the compact tier).
    static func contentMaxWidth(for tier: WVWindowTier) -> CGFloat? {
        switch tier {
        case .compact: return nil
        case .regular, .wide: return readableMaxWidth
        }
    }
}

// MARK: - Environment

private struct WVWindowTierKey: EnvironmentKey {
    /// Before the root has measured, a screen behaves exactly as it did
    /// before this file existed.
    static let defaultValue: WVWindowTier = .compact
}

extension EnvironmentValues {
    /// The width tier of the window this view is being laid out in.
    ///
    /// Published once by `RootView` (`.wvWindowTierReader()`) and read by
    /// `wvScreen()`; sheets inherit it, because a sheet is a presentation of
    /// this hierarchy, not a sibling of it.
    var wvWindowTier: WVWindowTier {
        get { self[WVWindowTierKey.self] }
        set { self[WVWindowTierKey.self] = newValue }
    }
}

// MARK: - Measuring the window

private struct WVWindowWidthPreferenceKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        // A window has one width; a deeper child reporting a different number
        // (a horizontally scrolling strip, a fixed-width tile) must not win.
        value = max(value, nextValue())
    }
}

/// Measure the window once and publish its `WVWindowTier` to every descendant.
///
/// `GeometryReader` in a `.background` rather than around the content: the
/// reader must never take part in the layout it is measuring, or the shell
/// would be sized by the reader (which proposes nothing) instead of by its
/// content.
private struct WVWindowTierReader: ViewModifier {
    @State private var width: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .background {
                GeometryReader { proxy in
                    Color.clear.preference(key: WVWindowWidthPreferenceKey.self,
                                           value: proxy.size.width)
                }
                // Measure the **window**, not the safe-area rect. On the Duo's
                // outer panel iOS reserves 84 pt on the right for the camera
                // and hinge, so the content is 382 pt wide inside a 466 pt
                // window; classifying 382 would make the cover panel and a
                // narrow inner panel indistinguishable.
                .ignoresSafeArea()
            }
            .onPreferenceChange(WVWindowWidthPreferenceKey.self) { measured in
                // Only fires on a real width change (fold/unfold, rotation,
                // iPad split view), so a 1 pt jitter cannot churn the tree.
                guard measured > 0, abs(measured - width) > 0.5 else { return }
                width = measured
            }
            .environment(\.wvWindowTier, WVLayout.tier(forWidth: width))
    }
}

extension View {
    /// Publishes the window's width tier. Apply **once**, at the root of the
    /// authenticated tree (`RootView`).
    func wvWindowTierReader() -> some View { modifier(WVWindowTierReader()) }

    /// Caps the reading column on a wide window and centres it.
    ///
    /// The cap is applied *inside* `wvScreen()`'s background, so the grouped
    /// background still covers the whole window while the rows stop at 620 pt.
    /// On the compact tier this is a no-op, which is why every existing screen
    /// keeps its exact compact layout.
    func wvReadableContentWidth() -> some View { modifier(WVReadableContentWidth()) }
}

private struct WVReadableContentWidth: ViewModifier {
    @Environment(\.wvWindowTier) private var tier

    func body(content: Content) -> some View {
        // One `frame` expression for every tier, with `nil` meaning "no cap",
        // rather than an `if let` around two branches: a conditional here would
        // swap the view type on a fold and rebuild the screen's subtree,
        // dropping scroll position and half-filled form state. Changing a
        // number keeps the same identity.
        let cap = WVLayout.contentMaxWidth(for: tier) ?? .infinity
        content
            .frame(maxWidth: cap)
            .frame(maxWidth: .infinity)
    }
}
