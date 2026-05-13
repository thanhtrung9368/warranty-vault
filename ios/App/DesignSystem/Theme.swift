import SwiftUI

// Colors mirror the web app's CSS variables in src/app/globals.css.
// Web uses HSL; here we convert to RGB once at compile time. Both light
// and dark variants are defined so SwiftUI's color scheme switching works.

extension Color {
    /// Construct a Color from HSL components in [0, 1] (Hue uses 0...360 here for ergonomic use).
    static func hsl(_ h: Double, _ s: Double, _ l: Double, _ a: Double = 1) -> Color {
        let h1 = (h / 360).truncatingRemainder(dividingBy: 1)
        let c = (1 - abs(2 * l - 1)) * s
        let x = c * (1 - abs((h1 * 6).truncatingRemainder(dividingBy: 2) - 1))
        let m = l - c / 2
        let (r, g, b): (Double, Double, Double)
        switch h1 * 6 {
        case 0..<1: (r, g, b) = (c, x, 0)
        case 1..<2: (r, g, b) = (x, c, 0)
        case 2..<3: (r, g, b) = (0, c, x)
        case 3..<4: (r, g, b) = (0, x, c)
        case 4..<5: (r, g, b) = (x, 0, c)
        default:    (r, g, b) = (c, 0, x)
        }
        return Color(red: r + m, green: g + m, blue: b + m, opacity: a)
    }
}

public enum WV {
    /// Tokens — light/dark pairs. Use `WV.Color.primary` and SwiftUI flips by environment.
    public enum Palette {
        // Light
        public static let primaryLight       = Color.hsl(224, 0.76, 0.40)   // #1e40af-ish
        public static let primaryFgLight     = Color.hsl(210, 0.40, 0.98)
        public static let bgLight            = Color.white
        public static let fgLight            = Color.hsl(222, 0.47, 0.11)
        public static let cardLight          = Color.white
        public static let mutedLight         = Color.hsl(210, 0.40, 0.96)
        public static let mutedFgLight       = Color.hsl(215, 0.16, 0.47)
        public static let borderLight        = Color.hsl(214, 0.32, 0.91)
        public static let warningLight       = Color.hsl(38, 0.92, 0.50)    // amber #f59e0b
        public static let successLight       = Color.hsl(142, 0.71, 0.35)
        public static let destructiveLight   = Color.hsl(0, 0.84, 0.60)
        public static let infoLight          = Color.hsl(199, 0.89, 0.48)   // sky blue
        public static let pinkLight          = Color.hsl(330, 0.81, 0.60)   // wishlist
        public static let purpleLight        = Color.hsl(262, 0.83, 0.58)

        // Dark
        public static let primaryDark        = Color.hsl(217, 0.91, 0.60)   // #3b82f6
        public static let bgDark             = Color.hsl(222, 0.47, 0.06)
        public static let fgDark             = Color.hsl(210, 0.40, 0.98)
        public static let cardDark           = Color.hsl(222, 0.47, 0.09)
        public static let mutedDark          = Color.hsl(217, 0.33, 0.17)
        public static let mutedFgDark        = Color.hsl(215, 0.20, 0.65)
        public static let borderDark         = Color.hsl(217, 0.33, 0.17)
        public static let successDark        = Color.hsl(142, 0.60, 0.40)
        public static let destructiveDark    = Color.hsl(0, 0.63, 0.31)
        public static let infoDark           = Color.hsl(199, 0.89, 0.55)
        public static let pinkDark           = Color.hsl(330, 0.81, 0.66)
        public static let purpleDark         = Color.hsl(262, 0.83, 0.66)
    }

    public enum Tokens {
        public static let primary    = Color.adaptive(Palette.primaryLight, Palette.primaryDark)
        public static let primaryFg  = Color.adaptive(Palette.primaryFgLight, Palette.primaryFgLight)
        public static let bg         = Color.adaptive(Palette.bgLight, Palette.bgDark)
        public static let fg         = Color.adaptive(Palette.fgLight, Palette.fgDark)
        public static let card       = Color.adaptive(Palette.cardLight, Palette.cardDark)
        public static let muted      = Color.adaptive(Palette.mutedLight, Palette.mutedDark)
        public static let mutedFg    = Color.adaptive(Palette.mutedFgLight, Palette.mutedFgDark)
        public static let border     = Color.adaptive(Palette.borderLight, Palette.borderDark)
        public static let warning    = Color.adaptive(Palette.warningLight, Palette.warningLight)
        public static let success    = Color.adaptive(Palette.successLight, Palette.successDark)
        public static let destructive = Color.adaptive(Palette.destructiveLight, Palette.destructiveDark)
        public static let info        = Color.adaptive(Palette.infoLight, Palette.infoDark)
        public static let pink        = Color.adaptive(Palette.pinkLight, Palette.pinkDark)
        public static let purple      = Color.adaptive(Palette.purpleLight, Palette.purpleDark)
    }

    public enum Radius {
        public static let sm: CGFloat = 6
        public static let md: CGFloat = 10
        public static let lg: CGFloat = 16   // bumped for friendlier feel
        public static let xl: CGFloat = 20
        public static let pill: CGFloat = 999
    }

    public enum Spacing {
        public static let xs: CGFloat = 4
        public static let sm: CGFloat = 8
        public static let md: CGFloat = 12
        public static let lg: CGFloat = 16
        public static let xl: CGFloat = 24
        public static let xxl: CGFloat = 32
    }
}

extension Color {
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
