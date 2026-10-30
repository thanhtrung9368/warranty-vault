import type { CSSProperties } from 'react';
import {
  BRAND_FILL,
  LOCKUP,
  LOCKUP_ASPECT,
  WORDMARK_LETTERS,
  WORDMARK_PERIOD,
  knockoutPath,
  markCutoutId,
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
 *   symbol          = 22 × 18.4 grid units at scale 5 → 110 × 92 units
 *   gap             = 0.5 × symbol width              → 55 units
 *   clear space     = the gap; not drawn — the caller must not crowd it
 *
 * The 32-unit mark is translated so its ink starts at x=0 and the tag's lowest
 * point sits on the wordmark baseline. The box is the wordmark's own (the 'l'
 * ascender down to the 'y' descender).
 *
 * The W is cut out of the plate inside the same scaled group, so it scales with
 * the symbol and shows the surface through it.
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
  const cutout = markCutoutId(geometry, 'warrly-lockup');
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
        <defs>
          <mask
            id={cutout}
            maskUnits="userSpaceOnUse"
            x={0}
            y={0}
            width={geometry.viewBox}
            height={geometry.viewBox}
          >
            <rect
              x={0}
              y={0}
              width={geometry.viewBox}
              height={geometry.viewBox}
              fill="white"
            />
            <path
              d={geometry.letter}
              fill="none"
              stroke="black"
              strokeWidth={geometry.letterWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </mask>
        </defs>
        <path
          d={knockoutPath(geometry)}
          fill={dot}
          mask={`url(#${cutout})`}
        />
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
