import SwiftUI

// ============================================================
// Warrly iOS — typography tokens
//
// The app used to name every text size by its point value, with a
// raw fixed-size font call. A fixed point size does not read the
// system's preferred content size, so at Accessibility text sizes
// the UI kept its 390×844 layout while every system control around
// it grew — the text did not reflow, it clipped.
//
// `WVFont` keeps the same *look* at the default (Large) content
// size but expresses each run as a semantic `Font.TextStyle`.
// SwiftUI then scales it with Dynamic Type. A role name describes
// what the text is for, not what size it happens to be today:
// `body` can grow without a single call site changing.
//
// Mapping at the default content size (Large), old fixed size →
// style → rendered size:
//
//   32/36 bold      display        largeTitle   34 bold
//   24/26/28 bold   statValue      title        28 bold  (hero amounts)
//   28 bold         titleEmphasis  title        28 bold  (headings)
//   21/22           title2         title2       22
//   22 bold         title2Emphasis title2       22 bold
//   18/19/20        title3         title3       20
//   20 semibold     title3Emphasis title3       20 semibold
//   17              body           body         17
//   17 semibold     bodyEmphasis   body         17 semibold
//   16              callout        callout      16
//   16 semibold     calloutEmphasis callout     16 semibold
//   14/15           subheadline    subheadline  15   (14 rounds up 1 pt)
//   15 semibold     subheadlineEmphasis        15 semibold
//   13              footnote       footnote     13
//   13 semibold     footnoteEmphasis           13 semibold
//   12              caption        caption      12
//   12 semibold     captionEmphasis            12 semibold
//   10/11           caption2       caption2     11   (10 rounds up 1 pt)
//   11 semibold     caption2Emphasis           11 semibold
//
// Two deliberate exceptions keep a raw fixed-size font call:
//
//  * Chart axis labels (`Charts.swift`) are 9 pt because the chart
//    is a fixed geometry: the y-axis gutter is 34 pt wide and the
//    x-axis band is 16 pt tall. A semantic style would grow the
//    label without growing those reservations, and the chart would
//    clip instead of reflow. They stay geometry-driven.
//  * SF Symbol glyph sizes (`Image(systemName:)` plus a fixed font size)
//    are not text. Scaling a 44 pt camera glyph with `.body` would
//    make it a 17 pt glyph at default. They stay on the icon scale
//    (`WVIcon(size:)` / the explicit point size at the call site).
// ============================================================

/// Semantic text roles. Each role resolves to a `Font.TextStyle` so the
/// system applies the user's Dynamic Type setting.
enum WVFont {
    // MARK: Display / headings

    /// Hero amounts and the avatar initials. 34 pt at default.
    case display
    /// Large headings. 28 pt at default.
    case title
    /// Emphasized large headings. 28 pt bold at default.
    case titleEmphasis
    /// Secondary headings. 22 pt at default.
    case title2
    /// Emphasized secondary headings / hero names. 22 pt bold at default.
    case title2Emphasis
    /// Tertiary headings and large labels. 20 pt at default.
    case title3
    /// Emphasized tertiary headings. 20 pt semibold at default.
    case title3Emphasis

    // MARK: Body

    /// The default reading size. 17 pt at default.
    case body
    /// Emphasized body — row titles and primary buttons. 17 pt semibold.
    case bodyEmphasis
    /// Dense body copy and form values. 16 pt at default.
    case callout
    /// Emphasized callout / button labels. 16 pt semibold at default.
    case calloutEmphasis

    // MARK: Small

    /// Secondary text. 15 pt at default.
    case subheadline
    /// Emphasized secondary text. 15 pt semibold at default.
    case subheadlineEmphasis
    /// Metadata and footnotes. 13 pt at default.
    case footnote
    /// Emphasized metadata. 13 pt semibold at default.
    case footnoteEmphasis
    /// Captions and compact rows. 12 pt at default.
    case caption
    /// Emphasized captions. 12 pt semibold at default.
    case captionEmphasis
    /// The smallest label. 11 pt at default.
    case caption2
    /// Emphasized smallest label. 11 pt semibold at default.
    case caption2Emphasis

    // MARK: App roles

    /// Status pills and chips. Measured as 12 pt semibold, but named for
    /// the role so a pill is not a caption that happens to be bold.
    case pill
    /// A big number on a stat card or a hero amount. 28 pt bold at default.
    case statValue

    /// The text style this role scales from.
    var textStyle: Font.TextStyle {
        switch self {
        case .display:             return .largeTitle
        case .title, .titleEmphasis, .statValue:
                                   return .title
        case .title2, .title2Emphasis:
                                   return .title2
        case .title3, .title3Emphasis:
                                   return .title3
        case .body, .bodyEmphasis: return .body
        case .callout, .calloutEmphasis:
                                   return .callout
        case .subheadline, .subheadlineEmphasis:
                                   return .subheadline
        case .footnote, .footnoteEmphasis:
                                   return .footnote
        case .caption, .captionEmphasis, .pill:
                                   return .caption
        case .caption2, .caption2Emphasis:
                                   return .caption2
        }
    }

    /// The weight this role carries when the call site does not override it.
    /// `nil` means the text style's own regular weight.
    var defaultWeight: Font.Weight? {
        switch self {
        case .display, .titleEmphasis, .title2Emphasis, .statValue:
            return .bold
        case .title3Emphasis, .bodyEmphasis, .calloutEmphasis,
             .subheadlineEmphasis, .footnoteEmphasis, .captionEmphasis,
             .caption2Emphasis, .pill:
            return .semibold
        case .title, .title2, .title3, .body, .callout,
             .subheadline, .footnote, .caption, .caption2:
            return nil
        }
    }

    /// Resolve the role to a `Font`, optionally overriding the weight or the
    /// design (monospaced serials and URLs keep their monospaced look).
    func font(weight: Font.Weight? = nil, design: Font.Design? = nil) -> Font {
        .system(textStyle, design: design, weight: weight ?? defaultWeight)
    }
}

// Both overloads exist on purpose: `Text.font` returns `Text`, so a call site
// that keeps composing Text-only modifiers after the font (`.tracking`,
// `.textCase`, …) must not be widened to `some View`. The `View` overload
// covers rows, buttons, toggles and stacks whose children all inherit the font.

extension Text {
    /// Apply a semantic text role that scales with Dynamic Type.
    func wvFont(_ role: WVFont, weight: Font.Weight? = nil,
                design: Font.Design? = nil) -> Text {
        font(role.font(weight: weight, design: design))
    }
}

extension View {
    /// Apply a semantic text role that scales with Dynamic Type.
    func wvFont(_ role: WVFont, weight: Font.Weight? = nil,
                design: Font.Design? = nil) -> some View {
        font(role.font(weight: weight, design: design))
    }
}
