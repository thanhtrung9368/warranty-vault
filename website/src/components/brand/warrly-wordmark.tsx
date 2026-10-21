import type { CSSProperties } from 'react';
import {
  BRAND_FILL,
  WORDMARK_BOX,
  WORDMARK_LETTERS,
  WORDMARK_PERIOD,
} from '@/lib/brand';

export type WarrlyWordmarkProps = {
  /** Rendered height in CSS pixels (the outline box, not the cap height). */
  height?: number;
  variant?: 'colour' | 'mono';
  /** Accessible name. Omit for decorative use. */
  title?: string;
  className?: string;
  style?: CSSProperties;
};

/**
 * `Warrly` in fixed Plus Jakarta Sans ExtraBold 800 outlines, `-0.02em` track,
 * ending in a coral full stop.
 *
 * The wordmark is NOT live text. The paths are the real ExtraBold outlines
 * (cap height 100, baseline y=0) generated once from the font, so:
 *   * switching the UI font to Fraunces cannot turn the logo into a serif;
 *   * the logo cannot flash or reflow while a web font loads;
 *   * no `font-display`, `letter-spacing` or preset can change it.
 * `--font-brand` in globals.css is pinned to Plus Jakarta Sans as a defensive
 * fallback for any future surface that genuinely needs live brand text, but
 * the logo itself never asks the browser for a font.
 *
 * The full stop is the typeface's own period glyph, kept as a separate rect so
 * it can carry the accent. The size is fixed; only the colour tokens move.
 */
export function WarrlyWordmark({
  height = 24,
  variant = 'colour',
  title,
  className,
  style,
}: WarrlyWordmarkProps) {
  const width = (height * WORDMARK_BOX.width) / WORDMARK_BOX.height;
  const body = variant === 'mono' ? 'currentColor' : BRAND_FILL.body;
  const dot = variant === 'mono' ? 'currentColor' : BRAND_FILL.dot;
  const a11y = title
    ? { role: 'img' as const, 'aria-label': title }
    : { 'aria-hidden': true as const, focusable: false };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`${WORDMARK_BOX.x} ${WORDMARK_BOX.y} ${WORDMARK_BOX.width} ${WORDMARK_BOX.height}`}
      className={className}
      style={style}
      data-brand-wordmark={variant}
      {...a11y}
    >
      <path d={WORDMARK_LETTERS} fill={body} />
      <rect
        x={WORDMARK_PERIOD.x}
        y={WORDMARK_PERIOD.y}
        width={WORDMARK_PERIOD.size}
        height={WORDMARK_PERIOD.size}
        fill={dot}
      />
    </svg>
  );
}
