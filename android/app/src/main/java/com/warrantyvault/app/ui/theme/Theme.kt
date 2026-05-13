package com.warrantyvault.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * Colors mirror src/app/globals.css from the web app. HSL values from the
 * web are converted to RGB once at compile time below. Light + dark match
 * the web's :root and .dark CSS variable sets.
 */

private fun hsl(h: Float, s: Float, l: Float): Color {
    val c = (1f - kotlin.math.abs(2f * l - 1f)) * s
    val h6 = (h / 60f) % 6f
    val x = c * (1f - kotlin.math.abs(h6 % 2f - 1f))
    val (r, g, b) = when {
        h6 < 1 -> Triple(c, x, 0f)
        h6 < 2 -> Triple(x, c, 0f)
        h6 < 3 -> Triple(0f, c, x)
        h6 < 4 -> Triple(0f, x, c)
        h6 < 5 -> Triple(x, 0f, c)
        else   -> Triple(c, 0f, x)
    }
    val m = l - c / 2f
    return Color(r + m, g + m, b + m, 1f)
}

object WVColors {
    // Light
    val PrimaryLight       = hsl(224f, 0.76f, 0.40f)
    val PrimaryFgLight     = hsl(210f, 0.40f, 0.98f)
    val PrimaryContainerLight = hsl(224f, 0.76f, 0.92f)
    val OnPrimaryContainerLight = hsl(224f, 0.76f, 0.20f)
    val BgLight            = Color.White
    val FgLight            = hsl(222f, 0.47f, 0.11f)
    val CardLight          = Color.White
    val SurfaceContainerLight        = hsl(210f, 0.40f, 0.98f)
    val SurfaceContainerHighLight    = hsl(210f, 0.40f, 0.96f)
    val SurfaceContainerHighestLight = hsl(214f, 0.32f, 0.94f)
    val MutedLight         = hsl(210f, 0.40f, 0.96f)
    val MutedFgLight       = hsl(215f, 0.16f, 0.47f)
    val BorderLight        = hsl(214f, 0.32f, 0.91f)
    val WarningLight       = hsl(38f, 0.92f, 0.50f)
    val WarningContainerLight = hsl(38f, 0.92f, 0.92f)
    val OnWarningContainerLight = hsl(26f, 0.83f, 0.18f)
    val SuccessLight       = hsl(142f, 0.71f, 0.35f)
    val SuccessContainerLight = hsl(142f, 0.71f, 0.92f)
    val OnSuccessContainerLight = hsl(142f, 0.60f, 0.18f)
    val DestructiveLight   = hsl(0f, 0.84f, 0.60f)
    val DestructiveContainerLight = hsl(0f, 0.84f, 0.94f)
    val OnDestructiveContainerLight = hsl(0f, 0.65f, 0.30f)
    // Pink for wishlist (mirrors tailwind pink-500/600)
    val TertiaryLight      = hsl(330f, 0.81f, 0.50f)
    val TertiaryContainerLight = hsl(330f, 0.81f, 0.94f)
    val OnTertiaryContainerLight = hsl(330f, 0.81f, 0.22f)

    // Dark
    val PrimaryDark        = hsl(217f, 0.91f, 0.60f)
    val PrimaryContainerDark = hsl(224f, 0.60f, 0.22f)
    val OnPrimaryContainerDark = hsl(210f, 0.40f, 0.96f)
    val BgDark             = hsl(222f, 0.47f, 0.06f)
    val FgDark             = hsl(210f, 0.40f, 0.98f)
    val CardDark           = hsl(222f, 0.47f, 0.09f)
    val SurfaceContainerDark        = hsl(222f, 0.45f, 0.10f)
    val SurfaceContainerHighDark    = hsl(222f, 0.40f, 0.13f)
    val SurfaceContainerHighestDark = hsl(217f, 0.33f, 0.17f)
    val MutedDark          = hsl(217f, 0.33f, 0.17f)
    val MutedFgDark        = hsl(215f, 0.20f, 0.65f)
    val BorderDark         = hsl(217f, 0.33f, 0.17f)
    val SuccessDark        = hsl(142f, 0.60f, 0.40f)
    val SuccessContainerDark = hsl(142f, 0.50f, 0.18f)
    val OnSuccessContainerDark = hsl(142f, 0.60f, 0.85f)
    val WarningDark        = hsl(38f, 0.92f, 0.55f)
    val WarningContainerDark = hsl(38f, 0.60f, 0.20f)
    val OnWarningContainerDark = hsl(38f, 0.92f, 0.85f)
    val DestructiveDark    = hsl(0f, 0.63f, 0.45f)
    val DestructiveContainerDark = hsl(0f, 0.50f, 0.22f)
    val OnDestructiveContainerDark = hsl(0f, 0.70f, 0.85f)
    val TertiaryDark       = hsl(330f, 0.81f, 0.65f)
    val TertiaryContainerDark = hsl(330f, 0.55f, 0.22f)
    val OnTertiaryContainerDark = hsl(330f, 0.81f, 0.92f)
}

private val LightColors = lightColorScheme(
    primary = WVColors.PrimaryLight,
    onPrimary = WVColors.PrimaryFgLight,
    primaryContainer = WVColors.PrimaryContainerLight,
    onPrimaryContainer = WVColors.OnPrimaryContainerLight,
    secondary = WVColors.PrimaryLight,
    onSecondary = WVColors.PrimaryFgLight,
    secondaryContainer = WVColors.PrimaryContainerLight,
    onSecondaryContainer = WVColors.OnPrimaryContainerLight,
    tertiary = WVColors.TertiaryLight,
    onTertiary = WVColors.PrimaryFgLight,
    tertiaryContainer = WVColors.TertiaryContainerLight,
    onTertiaryContainer = WVColors.OnTertiaryContainerLight,
    background = WVColors.BgLight,
    onBackground = WVColors.FgLight,
    surface = WVColors.CardLight,
    onSurface = WVColors.FgLight,
    surfaceVariant = WVColors.MutedLight,
    onSurfaceVariant = WVColors.MutedFgLight,
    surfaceContainer = WVColors.SurfaceContainerLight,
    surfaceContainerHigh = WVColors.SurfaceContainerHighLight,
    surfaceContainerHighest = WVColors.SurfaceContainerHighestLight,
    outline = WVColors.BorderLight,
    outlineVariant = WVColors.BorderLight,
    error = WVColors.DestructiveLight,
    errorContainer = WVColors.DestructiveContainerLight,
    onErrorContainer = WVColors.OnDestructiveContainerLight,
)

private val DarkColors = darkColorScheme(
    primary = WVColors.PrimaryDark,
    onPrimary = WVColors.FgLight,
    primaryContainer = WVColors.PrimaryContainerDark,
    onPrimaryContainer = WVColors.OnPrimaryContainerDark,
    secondary = WVColors.PrimaryDark,
    onSecondary = WVColors.FgLight,
    secondaryContainer = WVColors.PrimaryContainerDark,
    onSecondaryContainer = WVColors.OnPrimaryContainerDark,
    tertiary = WVColors.TertiaryDark,
    onTertiary = WVColors.FgLight,
    tertiaryContainer = WVColors.TertiaryContainerDark,
    onTertiaryContainer = WVColors.OnTertiaryContainerDark,
    background = WVColors.BgDark,
    onBackground = WVColors.FgDark,
    surface = WVColors.CardDark,
    onSurface = WVColors.FgDark,
    surfaceVariant = WVColors.MutedDark,
    onSurfaceVariant = WVColors.MutedFgDark,
    surfaceContainer = WVColors.SurfaceContainerDark,
    surfaceContainerHigh = WVColors.SurfaceContainerHighDark,
    surfaceContainerHighest = WVColors.SurfaceContainerHighestDark,
    outline = WVColors.BorderDark,
    outlineVariant = WVColors.BorderDark,
    error = WVColors.DestructiveDark,
    errorContainer = WVColors.DestructiveContainerDark,
    onErrorContainer = WVColors.OnDestructiveContainerDark,
)

/** Semantic accent colors that don't map cleanly to Material's palette. */
data class WVAccentColors(
    val warning: Color,
    val warningContainer: Color,
    val onWarningContainer: Color,
    val success: Color,
    val successContainer: Color,
    val onSuccessContainer: Color,
)

private val LightAccent = WVAccentColors(
    warning = WVColors.WarningLight,
    warningContainer = WVColors.WarningContainerLight,
    onWarningContainer = WVColors.OnWarningContainerLight,
    success = WVColors.SuccessLight,
    successContainer = WVColors.SuccessContainerLight,
    onSuccessContainer = WVColors.OnSuccessContainerLight,
)

private val DarkAccent = WVAccentColors(
    warning = WVColors.WarningDark,
    warningContainer = WVColors.WarningContainerDark,
    onWarningContainer = WVColors.OnWarningContainerDark,
    success = WVColors.SuccessDark,
    successContainer = WVColors.SuccessContainerDark,
    onSuccessContainer = WVColors.OnSuccessContainerDark,
)

val LocalWVAccent = androidx.compose.runtime.staticCompositionLocalOf { LightAccent }

object WVAccent {
    val current: WVAccentColors
        @Composable
        @androidx.compose.runtime.ReadOnlyComposable
        get() = LocalWVAccent.current
}

@Composable
fun WarrantyVaultTheme(
    preference: ThemePreference = ThemePreference.System,
    content: @Composable () -> Unit,
) {
    val darkTheme = when (preference) {
        ThemePreference.System -> isSystemInDarkTheme()
        ThemePreference.Light  -> false
        ThemePreference.Dark   -> true
    }
    androidx.compose.runtime.CompositionLocalProvider(
        LocalWVAccent provides if (darkTheme) DarkAccent else LightAccent,
    ) {
        MaterialTheme(
            colorScheme = if (darkTheme) DarkColors else LightColors,
            content = content,
        )
    }
}
