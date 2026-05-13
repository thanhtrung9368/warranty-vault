package com.warrantyvault.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.warrantyvault.app.ui.theme.WVAccent

enum class PillKind { Success, Warning, Danger, Neutral, Info, Accent }

/**
 * A small color-coded pill used for warranty / subscription / wishlist status.
 * Includes a leading icon for at-a-glance scanning.
 */
@Composable
fun StatusPill(
    label: String,
    kind: PillKind,
    icon: ImageVector? = null,
    modifier: Modifier = Modifier,
) {
    val cs = MaterialTheme.colorScheme
    val accent = WVAccent.current
    val (fg, bg) = when (kind) {
        PillKind.Success -> accent.success to accent.successContainer
        PillKind.Warning -> accent.warning to accent.warningContainer
        PillKind.Danger  -> cs.error to cs.errorContainer
        PillKind.Neutral -> cs.onSurfaceVariant to cs.surfaceContainerHighest
        PillKind.Info    -> cs.primary to cs.primaryContainer
        PillKind.Accent  -> cs.tertiary to cs.tertiaryContainer
    }
    val resolvedIcon = icon ?: defaultIconFor(kind)
    Row(
        modifier
            .clip(RoundedCornerShape(999.dp))
            .background(bg)
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (resolvedIcon != null) {
            Icon(
                resolvedIcon, null,
                tint = fg,
                modifier = Modifier.size(12.dp),
            )
            Spacer(Modifier.width(4.dp))
        }
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            color = fg,
        )
    }
}

private fun defaultIconFor(kind: PillKind): ImageVector? = when (kind) {
    PillKind.Success -> Icons.Filled.CheckCircle
    PillKind.Warning -> Icons.Filled.Schedule
    PillKind.Danger  -> Icons.Outlined.WarningAmber
    PillKind.Neutral -> null
    PillKind.Info    -> Icons.Filled.Info
    PillKind.Accent  -> Icons.Filled.Info
}

/** Decorative dot used as a low-emphasis status marker. */
@Composable
fun StatusDot(color: Color, modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(8.dp)
            .clip(RoundedCornerShape(50))
            .background(color),
    )
}
