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
 *   symbol body height = 1.15 × cap                → 115 units
 *   gap                = 0.5 × symbol body width   → 50 units
 *   clear space        = 2 × dot diameter          → 52 units (not drawn; the
 *                                                     caller must not crowd it)
 *
 * The 32-unit mark is drawn at 5× and translated so its ink starts at x=0 and
 * the receipt bottom (the symbol's baseline) sits on the wordmark baseline.
 * The tear peak is the tallest thing in the box, not the wordmark cap — that is
 * why the viewBox top is -127.
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
        {variant === 'mono' ? (
          <path
            d={knockoutPath(geometry)}
            fill={body}
            fillRule="evenodd"
          />
        ) : (
          <>
            <path d={geometry.body} fill={body} />
            <circle
              cx={geometry.dot.cx}
              cy={geometry.dot.cy}
              r={geometry.dot.r}
              fill={dot}
            />
          </>
        )}
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
