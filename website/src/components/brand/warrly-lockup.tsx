import type { CSSProperties } from 'react';
import {
  BRAND_FILL,
  LOCKUP,
  LOCKUP_ASPECT,
  WORDMARK_LETTERS,
  WORDMARK_PERIOD,
  knockoutPath,
  markGeometryForSize,
} from '@/lib/brand';

export type WarrlyLockupProps = {
  /** Rendered height of the whole lockup in CSS pixels. */
  height?: number;
  variant?: 'colour' | 'mono';
  /** Accessible name. Omit when a surrounding link already carries one. */
  title?: string;
  className?: string;
  style?: CSSProperties;
};

/**
 * The one-lockup asset: symbol + outline wordmark, drawn as a single SVG so
 * they can never drift apart or be re-aligned by a theme.
 *
 * Relationships (at cap height 100):
 *   symbol height   = 1.15 × cap                → 115 units (pennant tip to
 *                                                 tag bottom, 25.6 grid units
 *                                                 at scale 115/25.6)
 *   gap             = 0.5 × symbol width        → 49.189453125 units (symbol
 *                                                 21.9 grid units → 98.37890625)
 *   clear space     = 2 × the accent's width    → 75.46875 units (the flag
 *                                                 path, pole + pennant, inks
 *                                                 8.4 grid units → 37.734375;
 *                                                 not drawn — the caller must
 *                                                 not crowd it)
 *
 * The 32-unit mark is translated so its ink starts at x=0 and the tag's bottom
 * edge (the symbol's baseline) sits on the wordmark baseline. The pennant tip
 * is the tallest thing in the box at y=-115; the wordmark's 'y' descender ends
 * at 29.53, hence the 144.53 viewBox height.
 */
export function WarrlyLockup({
  height = 36,
  variant = 'colour',
  title,
  className,
  style,
}: WarrlyLockupProps) {
  const width = height * LOCKUP_ASPECT;
  const geometry = markGeometryForSize(32);
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
      viewBox={`${LOCKUP.viewBox.x} ${LOCKUP.viewBox.y} ${LOCKUP.viewBox.width} ${LOCKUP.viewBox.height}`}
      className={className}
      style={style}
      data-brand-lockup
      {...a11y}
    >
      <g transform={`translate(${LOCKUP.markX} ${LOCKUP.markY}) scale(${LOCKUP.markScale})`}>
        <path d={geometry.flag} fill={dot} />
        <path d={knockoutPath(geometry)} fill={body} fillRule="evenodd" />
      </g>
      <g transform={`translate(${LOCKUP.wordmarkX} 0)`}>
        <path d={WORDMARK_LETTERS} fill={body} />
        <rect
          x={WORDMARK_PERIOD.x}
          y={WORDMARK_PERIOD.y}
          width={WORDMARK_PERIOD.size}
          height={WORDMARK_PERIOD.size}
          fill={dot}
        />
      </g>
    </svg>
  );
}
