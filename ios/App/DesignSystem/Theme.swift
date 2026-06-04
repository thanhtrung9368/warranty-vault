import SwiftUI

// ============================================================
// WarrantyVault iOS — design tokens
//
// Ported 1:1 from the Claude Design handoff prototype
// (project/ios/styles.css `:root` + `[data-theme="dark"]`).
// Native-iOS look: systemGroupedBackground, SF Pro, coral brand.
// ============================================================

extension Color {
    /// Construct a Color from a 6-digit hex string (`"#FF6B45"` or `"FF6B45"`).
    init(hex: String) {
        let raw = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        var value: UInt64 = 0
        Scanner(string: raw).scanHexInt64(&value)
        let r = Double((value >> 16) & 0xFF) / 255
        let g = Double((value >> 8) & 0xFF) / 255
        let b = Double(value & 0xFF) / 255
        self.init(.sRGB, red: r, green: g, blue: b, opacity: 1)
    }

    /// Translucent color expressed as RGB 0-255 plus an alpha — matches the
    /// `rgba(...)` system fills in the prototype CSS.
    static func rgba(_ r: Double, _ g: Double, _ b: Double, _ a: Double) -> Color {
        Color(.sRGB, red: r / 255, green: g / 255, blue: b / 255, opacity: a)
    }

    /// Picks `light` or `dark` based on the active `UITraitCollection`, so the
    /// same token re-resolves when the system / app color scheme flips.
    static func adaptive(_ light: Color, _ dark: Color) -> Color {
#if canImport(UIKit)
        return Color(UIColor { trait in
            UIColor(trait.userInterfaceStyle == .dark ? dark : light)
        })
#else
        return light
#endif
    }
}

/// Semantic color tokens. Every value is light/dark adaptive.
enum WVColor {
    // Backgrounds
    static let bg      = Color.adaptive(Color(hex: "F2F2F7"), Color(hex: "000000"))
    static let bg2     = Color.adaptive(Color(hex: "FFFFFF"), Color(hex: "1C1C1E"))
    static let bg3     = Color.adaptive(Color(hex: "EFEFF4"), Color(hex: "2C2C2E"))
    static let bgElev  = Color.adaptive(Color(hex: "FFFFFF"), Color(hex: "1C1C1E"))

    // Labels
    static let label   = Color.adaptive(.black, .white)
    static let label2  = Color.adaptive(.rgba(60, 60, 67, 0.85), .rgba(235, 235, 245, 0.85))
    static let label3  = Color.adaptive(.rgba(60, 60, 67, 0.60), .rgba(235, 235, 245, 0.60))
    static let label4  = Color.adaptive(.rgba(60, 60, 67, 0.30), .rgba(235, 235, 245, 0.30))

    // Separators
    static let sep     = Color.adaptive(.rgba(60, 60, 67, 0.18), .rgba(84, 84, 88, 0.65))
    static let sepThin = Color.adaptive(.rgba(60, 60, 67, 0.10), .rgba(84, 84, 88, 0.40))

    // System fills (used for chips, segmented, search backgrounds)
    static let fill1   = Color.adaptive(.rgba(120, 120, 128, 0.20), .rgba(120, 120, 128, 0.36))
    static let fill2   = Color.adaptive(.rgba(120, 120, 128, 0.16), .rgba(120, 120, 128, 0.32))
    static let fill3   = Color.adaptive(.rgba(120, 120, 128, 0.12), .rgba(120, 120, 128, 0.24))
    static let fill4   = Color.adaptive(.rgba(118, 118, 128, 0.08), .rgba(118, 118, 128, 0.18))

    // Brand (coral) + the accent tint used for interactive elements
    static let brand     = Color.adaptive(Color(hex: "FF6B45"), Color(hex: "FF8060"))
    static let brand2    = Color.adaptive(Color(hex: "FF8B6A"), Color(hex: "FF8B6A"))
    static let brandSoft = Color.adaptive(Color(hex: "FFE3D7"), Color(hex: "4A1A0C"))
    static let tint      = brand

    // iOS system palette (identical light/dark except gray)
    static let blue   = Color(hex: "007AFF")
    static let green  = Color(hex: "34C759")
    static let orange = Color(hex: "FF9500")
    static let red    = Color(hex: "FF3B30")
    static let purple = Color(hex: "AF52DE")
    static let pink   = Color(hex: "FF2D55")
    static let teal   = Color(hex: "5AC8FA")
    static let indigo = Color(hex: "5856D6")
    static let yellow = Color(hex: "FFCC00")
    static let gray   = Color(hex: "8E8E93")
    static let gray2  = Color(hex: "AEAEB2")
    static let gray3  = Color(hex: "C7C7CC")
}

/// Corner radii (styles.css `--r-*`).
enum WVRadius {
    static let card: CGFloat = 14
    static let list: CGFloat = 12
    static let widget: CGFloat = 18
    static let sm: CGFloat = 8
    static let pill: CGFloat = 999
}

/// Common spacing steps. The prototype hangs grouped content off a 16pt
/// horizontal gutter, with 20pt for large-title rows.
enum WVSpacing {
    static let gutter: CGFloat = 16
    static let titleGutter: CGFloat = 20
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 24
}

// MARK: - Named accent colors

/// The category/icon accent names the prototype uses (`tintBg` in ios-ui.jsx)
/// mapped to a concrete iOS system color.
enum WVAccent: String, CaseIterable {
    case brand, blue, green, orange, red, purple, pink, teal, indigo, yellow, gray

    var color: Color {
        switch self {
        case .brand:  return WVColor.brand
        case .blue:   return WVColor.blue
        case .green:  return WVColor.green
        case .orange: return WVColor.orange
        case .red:    return WVColor.red
        case .purple: return WVColor.purple
        case .pink:   return WVColor.pink
        case .teal:   return WVColor.teal
        case .indigo: return WVColor.indigo
        case .yellow: return WVColor.yellow
        case .gray:   return WVColor.gray
        }
    }
}
