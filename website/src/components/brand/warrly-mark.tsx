import type { CSSProperties } from 'react';
import {
  BRAND_FILL,
  knockoutPath,
  markCutoutId,
  markGeometryForSize,
} from '@/lib/brand';

export type WarrlyMarkProps = {
  /** Rendered edge length in CSS pixels. Fixed: it does not scale with `em`. */
  size?: number;
  /**
   * `colour` paints the accent-coloured tag with the W cut out.
   * `mono` is the tag in `currentColor` with the W knocked out — for stamps,
   * watermarks and the white-on-alpha notification badge.
   */
  variant?: 'colour' | 'mono';
  /** Accessible name. Omit for decorative marks (the default is `aria-hidden`). */
  title?: string;
  className?: string;
  style?: CSSProperties;
};

/**
 * "W in the tag" — the single Warrly symbol.
 *
 * A price-tag silhouette (rounded top corners, torn zigzag bottom edge) with a W
 * cut out of it. The plate is `--brand-dot`, the accent.
 *
 * The W is cut out of the plate with a mask. It is NOT painted `currentColor` or
 * a surface colour: either would break on a gradient card, and a mono W painted
 * white would vanish on the white-on-alpha badge.
 *
 * `size` selects the DRAWN cut, never a downscale: 24px and above is the full
 * cut, below 24 is the separate small cut (two wide teeth, heavier W). There is
 * no background tile, no paint stroke, no radius token and no font token in here:
 * the mark is a trademark asset, not a themed UI chip. Its only variable is
 * `--brand-dot` (see globals.css), which exists so the plate keeps contrast when
 * the user changes accent.
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
  const plate = variant === 'mono' ? 'currentColor' : BRAND_FILL.dot;
  const cutout = markCutoutId(geometry);

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
        fill={plate}
        mask={`url(#${cutout})`}
      />
    </svg>
  );
}
