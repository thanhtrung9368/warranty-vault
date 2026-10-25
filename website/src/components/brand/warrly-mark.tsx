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
   * `colour` paints an ink/cream tag with a contrasting accent pennant.
   * `mono` is both paths in `currentColor` with the punch knocked out — for
   * stamps, watermarks and the white-on-alpha notification badge.
   */
  variant?: 'colour' | 'mono';
  /** Accessible name. Omit for decorative marks (the default is `aria-hidden`). */
  title?: string;
  className?: string;
  style?: CSSProperties;
};

/**
 * "The Warranty Tag" — the single Warrly symbol.
 *
 * A hanging tag: bevelled top-left corner, one punched hole, a V notch in the
 * bottom edge, and a swallowtail pennant on a pole rising from its shoulder.
 * The plate is `--brand-body` (ink on light, cream on dark); the pennant is
 * `--brand-dot`, the accent. The pole is painted first and the plate over it,
 * so it emerges from behind the shoulder rather than ending in a stub on the
 * tag.
 *
 * `size` selects the DRAWN cut, never a downscale: 24px and above is the full
 * cut, below 24 is the separate small cut (thicker plate, deeper V, larger
 * punch, longer pennant). There is no background tile, no stroke, no radius
 * token and no font token in here: the mark is a trademark asset, not a themed
 * UI chip. Its only variables are `--brand-body` and `--brand-dot` (see
 * globals.css), which exist so the pennant keeps contrast when the user changes
 * accent.
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
  const accent = variant === 'mono' ? 'currentColor' : BRAND_FILL.dot;
  const body = variant === 'mono' ? 'currentColor' : BRAND_FILL.body;

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
      <path d={geometry.flag} fill={accent} />
      <path d={knockoutPath(geometry)} fill={body} fillRule="evenodd" />
    </svg>
  );
}
