import type { CSSProperties } from 'react';
import {
  BRAND_FILL,
  knockoutPath,
  markGeometryForSize,
} from '@/lib/brand';

export type WarrlyMarkProps = {
  /** Rendered edge length in CSS pixels. Fixed: it does not scale with `em`. */
  size?: number;
  /**
   * `colour` paints an ink/cream receipt with a contrasting accent dot.
   * `mono` is one path with the dot knocked out — for stamps, watermarks and
   * the white-on-alpha notification badge.
   */
  variant?: 'colour' | 'mono';
  /** Accessible name. Omit for decorative marks (the default is `aria-hidden`). */
  title?: string;
  className?: string;
  style?: CSSProperties;
};

/**
 * "The Kept Receipt" — the single Warrly symbol.
 *
 * The receipt is the paper; the dot is the date. At 32 units it is a tall
 * 16×24 body at x=8…24, y=3…27: a clean 1.5-radius top, and a torn BOTTOM with
 * five small asymmetric notches (25.7…27.2). The 2.0-radius dot is stamped at
 * (19.9, 21.6) — low-right, above the tear, not centred. Dedicated 16/24 cuts
 * keep the tear and the dot legible at favicon sizes. There is no background
 * tile, no stroke, no radius token and no font token in here: the mark is a
 * trademark asset, not a themed UI chip. Its only variables are
 * `--brand-body` and `--brand-dot` (see globals.css), which exist so the dot
 * keeps contrast when the user changes accent.
 */
export function WarrlyMark({
  size = 32,
  variant = 'colour',
  title,
  className,
  style,
}: WarrlyMarkProps) {
  const geometry = markGeometryForSize(size);
  const box = `0 0 ${geometry.viewBox} ${geometry.viewBox}`;
  const a11y = title
    ? { role: 'img' as const, 'aria-label': title }
    : { 'aria-hidden': true as const, focusable: false };

  if (variant === 'mono') {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox={box}
        className={className}
        style={style}
        data-brand-mark={variant}
        {...a11y}
      >
        <path
          d={knockoutPath(geometry)}
          fill="currentColor"
          fillRule="evenodd"
        />
      </svg>
    );
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={box}
      className={className}
      style={style}
      data-brand-mark={variant}
      {...a11y}
    >
      <path d={geometry.body} fill={BRAND_FILL.body} />
      <circle
        cx={geometry.dot.cx}
        cy={geometry.dot.cy}
        r={geometry.dot.r}
        fill={BRAND_FILL.dot}
      />
    </svg>
  );
}
