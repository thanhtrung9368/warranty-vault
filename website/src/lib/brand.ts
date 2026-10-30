// The Warrly brand geometry, as data.
//
// "The Warranty Tag" is the mark: a hanging tag — bevelled top-left corner, one
// punched hole, a V notch cut up into the bottom edge — with a swallowtail
// pennant on a pole rising from its shoulder. It is the object the product is
// about: the tag that hangs on a device you bought, the thing you keep so the
// date is not lost. The previous mark (a torn receipt with a date dot) told the
// same story twice; this one says it with the object itself.
//
// TWO DRAWN CUTS, NOT ONE DOWNSCALED
//
// A tag this thin turns to mush at 16px: the 1.5-unit corner radius, the
// 2.3-unit V and a 3.2-unit punch all land on sub-pixel edges. The small cut is
// therefore REDRAWN on the same 32-unit grid with a thicker plate
// (17.8×18.2 vs 17.0×17.6), a deeper V (2.8 vs 2.3), a wider punch (3.8 vs
// 3.2 across) and a longer pennant (9.7 vs 8.4 wide). The two are not related
// by a transform, and one must never be rendered from the other:
//
//   * `markCutForSize(n)` picks `full` for n >= 24 and `small` below that.
//     24 is the documented switch; sizes 17–23 use the small cut scaled up,
//     because downscaling the full cut below its 24px floor is exactly the
//     blur the second cut exists to prevent.
//   * Every raster asset (favicon.ico 16/32/48, icon-*.png, the badges) is
//     rendered from the cut chosen for ITS OWN pixel size, never resampled.
//
// COLOUR
//
// Body = `--brand-body` (ink in light mode, cream in dark). Pennant = the
// accent, `--brand-dot`. Mono = both paths in `currentColor` with ONE hole
// (the punch); the pennant is never knocked out of the plate, because it has to
// stay visible where it rises above the tag. These two custom properties are
// the only theme input: the mark reads no font, radius or density token, so
// changing those user settings cannot alter the logo (see
// `__tests__/brand-wiring.test.ts` and the pixel-identity check in the
// brand-assets suite).
//
// This module is pure geometry and string rendering. It has no React and no
// Next import, for three reasons:
//
//   * the React components (`components/brand/*`) and the generated assets
//     (`public/*.png`, `public/favicon.svg`, `/og`) all draw from ONE source, so
//     the favicon and the header cannot drift;
//   * the geometry can be unit-tested without a DOM;
//   * a script can render the raster cuts at their exact pixel sizes instead of
//     downscaling a 1024 canvas.
//
// The wordmark is fixed SVG outlines, not live text. The paths were generated
// from Plus Jakarta Sans ExtraBold (weight 800, cap height 745/1000 em) with
// `-0.02em` tracking, then normalised so the lettering ink starts at x=0 and
// the cap top is y=-100. The full stop is the typeface's own ExtraBold period
// (a 150×150 square glyph, scaled to 20.13 units), drawn as a separate path so
// it can carry the accent. Shipping outlines is what makes the logo immune to
// the user's font preset and to a web-font load flash — see `--font-brand` in
// globals.css for the pinned-family fallback.

/** The mark's native drawing grid. Both cuts below are drawn in these units. */
export const MARK_GRID = 32;

/**
 * A size cut. Both cuts are drawn on the 32-unit grid; the name describes when
 * the cut is used, not a different viewBox.
 */
export type MarkCut = 'full' | 'small';

export type MarkGeometry = {
  /** Which drawn cut this is. */
  cut: MarkCut;
  /** The SVG viewBox edge (square) — 32 for both cuts. */
  viewBox: number;
  /** The tag plate, one filled path. No stroke. */
  body: string;
  /** The punched hole, appended to `body` under `fill-rule="evenodd"`. */
  punch: string;
  /** Pole + swallowtail pennant, painted in the accent (or currentColor in mono). */
  flag: string;
  /**
   * The W, stroked in the punch's colour so it reads as a cut-out of the plate.
   * A stroked letter rather than a second filled path because the letter's job is
   * to be a line: a filled W at 20px closes into a solid triangle.
   */
  letter: string;
  /** Stroke width of `letter`, in grid units. Thicker on the small cut. */
  letterWidth: number;
  /** The punch as a circle — the same geometry, for measurements/tests. */
  punchCircle: { cx: number; cy: number; r: number };
  /** Tag plate height (top edge to bottom edge), excluding the pennant. */
  bodyHeight: number;
  /** Tag plate width (left edge to right edge), excluding the pennant. */
  bodyWidth: number;
  /** Depth of the V cut up into the bottom edge. */
  notchDepth: number;
  /** The flag path's ink width (pole + pennant) — the "accent's width" the clear space uses. */
  flagWidth: number;
  /** The whole silhouette (pennant tip → punch, tag bottom), i.e. what to centre. */
  ink: { x: number; y: number; width: number; height: number };
};

// ── The full cut (≥24px) ───────────────────────────────────────────────────
//
// The plate is x=5.4…22.4, y=10.6…28.2. The top-left corner is a 45° bevel
// from (5.4, 15.5) to (10.3, 10.6) — the "cut corner" that makes a tag a tag —
// while the three other corners are the 1.5 radius (the bottom-right arc is
// deliberately degenerate in the source path: the V notch starts at the
// bottom-right corner, so that corner is square). The bottom edge carries a
// 2.3-unit V between (16.9, 28.2) and (10.9, 28.2), apexed at (13.9, 25.9).
//
// The 3.2-unit punch sits at (9.97, 15.17), tucked under the bevel — the hole
// the tag hangs by, not a decorative dot.
//
// The pennant rises from the plate's top edge at x=18.9…20.7 (the 1.8-unit
// pole), is 8.4 units wide and ends in a swallowtail: the fly edge runs out to
// x=27.3 at y=2.6 and y=8, and the notch between them is carved back to
// (25, 5.3). The flag path also runs 4 units down the pole inside the plate
// (to y=14.6) so the two fills overlap; the body is painted OVER the flag, so
// the pole emerges from behind the shoulder with no seam and no notch.
const CUT_FULL: MarkGeometry = {
  cut: 'full',
  viewBox: MARK_GRID,
  body:
    'M10.3 10.6L20.9 10.6A1.5 1.5 0 0 1 22.4 12.1L22.4 26.7A1.5 1.5 0 0 1 22.4 26.7L22.4 28.2L16.9 28.2L13.9 25.9L10.9 28.2L6.9 28.2A1.5 1.5 0 0 1 5.4 26.7L5.4 15.5L10.3 10.6Z',
  punch: 'M8.37 15.17A1.6 1.6 0 1 0 11.57 15.17A1.6 1.6 0 1 0 8.37 15.17Z',
  flag:
    'M18.9 14.6L18.9 2.6L27.3 2.6L25 5.3L27.3 8L20.7 8L20.7 14.6L18.9 14.6Z',
  // Sits below the punch (bottom y=16.77) and the flag's in-plate run (y=14.6),
  // spanning x=8.6…18.4, y=18.9…24.5. The 1.9 stroke clears the punch by 1.18
  // and the 2.3-unit V notch (apex y=25.9) by 0.45 without touching either.
  letter: 'M8.6 18.9l2.6 5.6 2-4.6 2 4.6 2.6-5.6',
  letterWidth: 1.9,
  punchCircle: { cx: 9.97, cy: 15.17, r: 1.6 },
  bodyHeight: 17.6,
  bodyWidth: 17,
  notchDepth: 2.3,
  flagWidth: 8.4,
  ink: { x: 5.4, y: 2.6, width: 21.9, height: 25.6 },
};

// ── The small cut (≤16px) ──────────────────────────────────────────────────
//
// The small cut DROPS the punch and the V notch, keeping only the plate, the
// pennant and the W. That is not a simplification for its own sake: at a 16px
// render one pixel is two grid units, and the four features need
//
//     1.9 (punch r) + 2 (gap) + 5.2 (W) + 2.6 (stroke) + 2 (gap) + 2.8 (notch)
//   = 20.5 units
//
// against a plate 18.2 units tall. It does not fit. And when it *does* fit the
// gaps are exactly one pixel by construction, which means invisible — the punch
// and the W's left arm fuse into a single keyhole, which is precisely what the
// 16px render showed. Dropping both leaves 4.3 units (2.15px) of clear plate
// above the W and 4.1 below, so the letter is what you see.
//
// The notch was 2.8 units = 1.4px at that size: it was never going to read. The
// pennant is unchanged — it is the one thing that survives at 16px.
const CUT_SMALL: MarkGeometry = {
  cut: 'small',
  viewBox: MARK_GRID,
  body:
    'M10.6 10H21.6A1.4 1.4 0 0 1 23 11.4V26.8A1.4 1.4 0 0 1 21.6 28.2H6.6A1.4 1.4 0 0 1 5.2 26.8V15.4Z',
  punch: '',
  flag:
    'M18.3 14.2L18.3 2.6L28 2.6L25.4 5.8L28 9L20.9 9L20.9 14.2L18.3 14.2Z',
  // 7.2 units tall against a plate 18.2 tall. Stroke 2.6 = 1.3px at 16px, which
  // is a stroke rather than a smudge.
  letter: 'M8.8 15.6l2.7 7.2 2-5.9 2 5.9 2.7-7.2',
  letterWidth: 2.6,
  punchCircle: { cx: 0, cy: 0, r: 0 },
  bodyHeight: 18.2,
  bodyWidth: 17.8,
  notchDepth: 0,
  flagWidth: 9.7,
  ink: { x: 5.2, y: 2.6, width: 22.8, height: 25.6 },
};

const CUTS: Record<MarkCut, MarkGeometry> = {
  full: CUT_FULL,
  small: CUT_SMALL,
};

/**
 * Pick a cut for a requested CSS size.
 *
 * The design switches at 24px: `>= 24` is the full cut, everything below uses
 * the separately drawn small cut. There is no third cut and no dead band — a
 * 20px mark is the small cut at 1.25×, which is sharper than downscaling the
 * full cut to 0.83×.
 */
export function markCutForSize(size: number): MarkCut {
  return size >= 24 ? 'full' : 'small';
}

export function markGeometryForSize(size: number): MarkGeometry {
  return CUTS[markCutForSize(size)];
}

/** The full cut, for assets that are always large (the lockup, the badge). */
export const CUT_32 = CUT_FULL;
/** The small cut, for assets that are always small (the 16px favicon). */
export const CUT_16 = CUT_SMALL;

/** The smallest punch diameter any supported cut can render, in CSS pixels. */
export function smallestRenderedPunchDiameter(): number {
  // 0, and that is the design. The small cut has no punch: at 16px one pixel is
  // two grid units, and a punch plus a gap plus the W plus a gap plus the notch
  // needs 20.5 units against a plate 18.2 tall. Something had to go, and the W
  // is the thing that carries the name.
  //
  // The full cut still has its punch and is used at every size >= 24, so the hole
  // is not gone from the mark — it is gone from the one render where it could not
  // be a hole.
  return ((CUT_SMALL.punchCircle.r * 2) * 16) / MARK_GRID;
}

/**
 * Historical name kept for API compatibility: the previous mark's accent was a
 * dot. The measurable minimum is still the same idea — the smallest hole the
 * mark can show at its smallest supported size.
 */
export function smallestRenderedDotDiameter(): number {
  return smallestRenderedPunchDiameter();
}

/**
 * The tag plate plus the punched hole as one compound path. `fill-rule="evenodd"`
 * makes the punch a hole, so the same path works on any background and needs no
 * mask. The pennant is NOT part of this compound path: it is a separate fill.
 */
export function knockoutPath(geometry: MarkGeometry): string {
  return `${geometry.body}${geometry.punch}`;
}

/**
 * The id of the mask that cuts the W out of the plate. Prefixed per renderer so
 * a lockup and a standalone mark on the same page cannot shadow each other's
 * `defs`; repeated marks of the same cut share an identical mask.
 */
export function markCutoutId(geometry: MarkGeometry, prefix = 'warrly-mark'): string {
  return `${prefix}-cut-${geometry.cut}`;
}

function num(value: number): string {
  // Two decimals is enough at a 32-unit grid and keeps the emitted SVG small.
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * The mask that turns the stroked `letter` into negative space — the same
 * treatment the punch gets.
 *
 * In a mask, black is the punch's colour: it is what removes paint, so the
 * surface behind the mark shows through the W exactly as it does through the
 * punched hole. Painting the letter with `fill.body` would draw an ink W on an
 * ink plate (invisible), and painting it with a surface colour would break on
 * the landing's gradient card and in the white-on-alpha notification badge. The
 * mask is the only paint that matches the punch on every surface.
 */
function letterCutout(geometry: MarkGeometry, id: string): string {
  return (
    `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" ` +
    `width="${geometry.viewBox}" height="${geometry.viewBox}">` +
    `<rect x="0" y="0" width="${geometry.viewBox}" height="${geometry.viewBox}" fill="white"/>` +
    `<path d="${geometry.letter}" fill="none" stroke="black" ` +
    `stroke-width="${geometry.letterWidth}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</mask></defs>`
  );
}

// ── Wordmark outlines ──────────────────────────────────────────────────────
//
// "Warrly", Plus Jakarta Sans ExtraBold 800, tracking -0.02em. Coordinates are
// cap-height-normalised: the 'W' cap is 100 units tall, the baseline is y=0,
// and the lettering ink starts at x=0. Generated once from the real font; do
// not retype these numbers by eye.
export const WORDMARK_LETTERS =
  'M26.17 0.00 0.00 -100.00H22.55L42.28 -16.24H36.24L57.05 -100.00H78.52L99.33 -16.24H93.29L113.02 -100.00H135.57L109.40 0.00H85.23L64.30 -80.54H71.28L50.34 0.00Z M164.43 1.61Q156.51 1.61 150.74 -0.94Q144.97 -3.49 141.88 -8.26Q138.79 -13.02 138.79 -19.60Q138.79 -25.77 141.61 -30.54Q144.43 -35.30 150.27 -38.52Q156.11 -41.74 164.83 -43.09L187.25 -46.71V-31.95L168.46 -28.59Q164.16 -27.79 161.88 -25.84Q159.60 -23.89 159.60 -20.27Q159.60 -16.91 162.15 -15.03Q164.70 -13.15 168.46 -13.15Q173.42 -13.15 177.18 -15.30Q180.94 -17.45 183.02 -21.14Q185.10 -24.83 185.10 -29.26V-48.32Q185.10 -52.48 181.81 -55.30Q178.52 -58.12 172.89 -58.12Q167.52 -58.12 163.42 -55.17Q159.33 -52.21 157.45 -47.38L141.34 -55.03Q143.49 -61.21 148.19 -65.64Q152.89 -70.07 159.46 -72.48Q166.04 -74.90 173.83 -74.90Q183.09 -74.90 190.20 -71.54Q197.32 -68.19 201.28 -62.21Q205.23 -56.24 205.23 -48.32V0.00H186.44V-11.81L191.01 -12.62Q187.79 -7.79 183.89 -4.63Q180.00 -1.48 175.17 0.07Q170.34 1.61 164.43 1.61Z M217.32 0.00V-73.29H236.11V-55.70L234.77 -58.26Q237.18 -67.52 242.75 -70.81Q248.32 -74.09 255.97 -74.09H260.27V-56.64H253.96Q246.58 -56.64 242.01 -52.15Q237.45 -47.65 237.45 -39.46V0.00Z M266.44 0.00V-73.29H285.23V-55.70L283.89 -58.26Q286.31 -67.52 291.88 -70.81Q297.45 -74.09 305.10 -74.09H309.40V-56.64H303.09Q295.70 -56.64 291.14 -52.15Q286.58 -47.65 286.58 -39.46V0.00Z M315.57 0.00V-101.61H335.70V0.00Z M359.19 29.53Q355.97 29.53 352.95 28.99Q349.93 28.46 347.65 27.25V10.74Q349.53 11.28 352.08 11.68Q354.63 12.08 356.78 12.08Q362.68 12.08 365.23 9.33Q367.79 6.58 369.40 3.09L374.36 -8.32L374.09 8.46L341.88 -73.29H363.49L384.83 -15.17H376.78L398.12 -73.29H419.73L388.32 6.85Q385.37 14.36 381.07 19.46Q376.78 24.56 371.34 27.05Q365.91 29.53 359.19 29.53Z';

/**
 * The full stop: Plus Jakarta Sans ExtraBold's period glyph, positioned after
 * the 'y' (+ its advance and tracking) and kept as its own path so it can carry
 * the accent while the letters are ink. 20.13 units square at cap height 100 —
 * proportionally the typeface's own period, not a drawn bullet.
 */
export const WORDMARK_PERIOD = {
  x: 435.84,
  y: -20.13,
  size: 20.13,
} as const;

/** Lettering ink width (period excluded): the 'y' tail overhangs its advance. */
export const WORDMARK_LETTERS_WIDTH = 419.73;
/** The whole "Warrly." ink box, in the wordmark coordinate system. */
export const WORDMARK_BOX = {
  /** viewBox origin x */
  x: 0,
  /** viewBox origin y — the tallest lowercase ascender ('l'), not the cap. */
  y: -101.61,
  width: 455.97,
  /** 'l' top to 'y' descender. */
  height: 131.14,
  /** The baseline, which is y=0 in this coordinate system. */
  capHeight: 100,
} as const;

// ── Lockup ─────────────────────────────────────────────────────────────────
//
// Geometry from the brand brief, applied to this mark:
//   * mark body height = 1.15 × cap height → the mark's full silhouette (the
//     pennant tip at y=2.6 down to the tag's bottom at y=28.2, 25.6 grid units)
//     is drawn 115 units tall, i.e. scale = 115 / 25.6. The tag plate itself is
//     therefore 79.06 units tall and the pennant accounts for the rest. This is
//     the same intent as the previous mark, whose "body height" was its whole
//     silhouette (the 0.2-unit tear overshoot was ignored);
//   * gap = 0.5 × symbol width → the symbol is 21.9 grid units wide, so at
//     scale 4.4921875 it is 98.37890625 wide and the gap is 49.189453125;
//   * clear space = 2 × the accent's width → the flag path (pole + pennant)
//     inks 8.4 grid units wide (37.734375 here), so 75.46875. It is not drawn:
//     the caller must not crowd it.
//
// The symbol is translated so its ink starts at x=0 and the tag's bottom edge
// (y=28.2) sits on the wordmark baseline (y=0). Its top then lands exactly on
// y=-115, the same top line the old lockup had, so the fixed box height
// (115 + the 'y' descender 29.53 = 144.53) is unchanged. The design handoff
// drew the same rules at wordmark scale 0.44 (cap 44): 1.15 × 44 = 50.6 =
// 25.6 × 1.97, and the wordmark at x = 1.5 × 22.5 × 1.97 — it used a 22.5-unit
// symbol width, while the shipped paths ink 21.9, which is why the recomputed
// width below is 603.54 instead of the handoff's 267.12 / 0.44 = 607.09.
export const LOCKUP = {
  /** Cap height of the outline wordmark, in lockup units. */
  capHeight: 100,
  /** The full 32-grid mark is drawn at this scale inside the lockup (115 / 25.6). */
  markScale: 115 / 25.6,
  /** Translation applied to the mark so its ink starts at x=0 and its bottom sits at y=0. */
  markX: -(5.4 * 115) / 25.6,
  markY: -(28.2 * 115) / 25.6,
  /** x where the wordmark group starts: 98.37890625 (symbol) + 49.189453125 (gap). */
  wordmarkX: (1.5 * 21.9 * 115) / 25.6,
  /** viewBox — top is the pennant tip (2.6 × scale − 126.6796875 = −115). */
  viewBox: {
    x: 0,
    y: -115,
    width: (1.5 * 21.9 * 115) / 25.6 + 455.97,
    height: 144.53,
  },
  /** 2 × the flag path's rendered ink width (2 × 8.4 × scale = 75.46875 units). */
  clearSpace: (2 * 8.4 * 115) / 25.6,
} as const;

/** Aspect ratio for a standalone lockup sized by its height. */
export const LOCKUP_ASPECT = LOCKUP.viewBox.width / LOCKUP.viewBox.height;
export const WORDMARK_ASPECT = WORDMARK_BOX.width / WORDMARK_BOX.height;

/**
 * Minimal CSS custom properties the in-app components paint with. `dot` is the
 * accent slot the previous mark used for its date dot; on this mark it paints
 * the pennant. The name is kept so every caller and the OG route keep working.
 */
export const BRAND_FILL = {
  body: 'hsl(var(--brand-body))',
  dot: 'hsl(var(--brand-dot))',
} as const;

// ── String renderers ───────────────────────────────────────────────────────
//
// These are for the favicon/app-icon generator, the service-worker badge and
// the OG card. The React components render the same geometry as elements, but
// every raster asset is produced from these strings so there is one geometry.

export type SvgFill = { body: string; dot: string };

export type RenderMarkOptions = {
  size: number;
  variant?: 'colour' | 'mono';
  fills?: Partial<SvgFill>;
  /** Paint a full-bleed square behind the mark (app icons only). */
  background?: string;
  /** Background corner radius, in rendered pixels. */
  backgroundRadius?: number;
};

/**
 * The mark's paint, in order: the cutout mask, then the pennant, then the plate
 * (with its punched hole and the W cut out of it). Painting the plate last makes
 * the pole run BEHIND the tag's shoulder — the flag path reaches down to y=14.6
 * only so the two fills overlap; if it were painted on top it would end in a
 * coral stub halfway down the tag.
 *
 * The letter is always stroked into the mask, on both cuts and in both
 * variants. `fill.body` is used for the plate and never for the letter: a W
 * painted in the plate's colour would disappear into it, and a mono W painted
 * in `currentColor` would do the same.
 */
function markPaths(
  geometry: MarkGeometry,
  fill: SvgFill,
  variant: 'colour' | 'mono',
  cutoutPrefix = 'warrly-mark',
): string {
  const accent = variant === 'mono' ? fill.body : fill.dot;
  const cutout = markCutoutId(geometry, cutoutPrefix);
  return (
    letterCutout(geometry, cutout) +
    `<path d="${geometry.flag}" fill="${accent}"/>` +
    `<path d="${knockoutPath(geometry)}" fill="${fill.body}" fill-rule="evenodd" mask="url(#${cutout})"/>`
  );
}

/**
 * A mark as a complete standalone SVG string. `background` is opt-in: the
 * symbol itself never carries a tile, and only the app icon/notification
 * assets ask for one.
 */
export function renderMarkSvg({
  size,
  variant = 'colour',
  fills = BRAND_FILL,
  background,
  backgroundRadius = 0,
}: RenderMarkOptions): string {
  // Small sizes use their dedicated cut; large ones use the exact full cut.
  const geometry = markGeometryForSize(size);
  const fill = { body: fills.body ?? BRAND_FILL.body, dot: fills.dot ?? BRAND_FILL.dot };
  const bg =
    background === undefined
      ? ''
      : `<rect width="${size}" height="${size}" rx="${num(backgroundRadius)}" fill="${background}"/>`;
  const scale = size / geometry.viewBox;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}" role="img" aria-label="Warrly">` +
    bg +
    `<g transform="scale(${num(scale)})">` +
    markPaths(geometry, fill, variant) +
    `</g>` +
    `</svg>`
  );
}

/**
 * An app-icon-style asset: a full-bleed tile with the mark centred at
 * `glyphRatio` of the icon edge. Used for icon-192/512/1024, the maskable
 * icon, apple-touch-icon and the colour notification icon.
 */
export function renderIconSvg({
  size,
  glyphRatio,
  background,
  backgroundRadius = 0,
  fills,
  variant = 'colour',
}: {
  size: number;
  glyphRatio: number;
  background: string;
  backgroundRadius?: number;
  fills?: Partial<SvgFill>;
  variant?: 'colour' | 'mono';
}): string {
  const glyph = size * glyphRatio;
  // The raster cut follows the GLYPH's rendered size, not the tile size: a
  // 48px favicon gets the full cut, a 16px one gets the small cut.
  const geometry = markGeometryForSize(glyph);
  const fill = { body: fills?.body ?? BRAND_FILL.body, dot: fills?.dot ?? BRAND_FILL.dot };
  const scale = glyph / geometry.viewBox;
  // Centre the VISIBLE silhouette, not its 32-unit drawing box: the box has
  // 5.2–5.4 units of padding on the left and 4–4.8 on the right, and 2.6 above
  // the pennant / 3.8 below the tag, so centring the box would push the glyph
  // up and left inside the tile.
  const offsetX = (size - geometry.ink.width * scale) / 2 - geometry.ink.x * scale;
  const offsetY = (size - geometry.ink.height * scale) / 2 - geometry.ink.y * scale;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}" role="img" aria-label="Warrly">` +
    `<rect width="${size}" height="${size}" rx="${num(backgroundRadius)}" fill="${background}"/>` +
    `<g transform="translate(${num(offsetX)} ${num(offsetY)}) scale(${num(scale)})">` +
    markPaths(geometry, fill, variant) +
    `</g>` +
    `</svg>`
  );
}

/**
 * The white-on-alpha shape Android uses as a notification badge. Both paths in
 * white, ONE punch hole; the pennant must stay visible above the tag, so there
 * is no knockout between them. Monochrome by construction — and the W is cut
 * out of the plate rather than painted white, which would make it vanish.
 */
export function renderNotificationBadgeSvg(size = 96): string {
  const geometry = CUT_FULL;
  const scale = (size * 0.92) / MARK_GRID;
  const offsetX = (size - geometry.ink.width * scale) / 2 - geometry.ink.x * scale;
  const offsetY = (size - geometry.ink.height * scale) / 2 - geometry.ink.y * scale;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}" role="img" aria-label="Warrly">` +
    `<g transform="translate(${num(offsetX)} ${num(offsetY)}) scale(${num(scale)})">` +
    markPaths(geometry, { body: '#FFFFFF', dot: '#FFFFFF' }, 'mono') +
    `</g></svg>`
  );
}

/** The outline wordmark as an SVG string; `fills.body` paints both ink and period in mono. */
export function renderWordmarkSvg({
  height,
  fills = BRAND_FILL,
  variant = 'colour',
}: {
  height: number;
  fills?: Partial<SvgFill>;
  variant?: 'colour' | 'mono';
}): string {
  const body = fills.body ?? BRAND_FILL.body;
  const dot = variant === 'mono' ? body : fills.dot ?? BRAND_FILL.dot;
  const width = (height * WORDMARK_BOX.width) / WORDMARK_BOX.height;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" ` +
    `viewBox="${WORDMARK_BOX.x} ${WORDMARK_BOX.y} ${WORDMARK_BOX.width} ${WORDMARK_BOX.height}" ` +
    `role="img" aria-label="Warrly">` +
    `<path d="${WORDMARK_LETTERS}" fill="${body}"/>` +
    `<rect x="${WORDMARK_PERIOD.x}" y="${WORDMARK_PERIOD.y}" width="${WORDMARK_PERIOD.size}" height="${WORDMARK_PERIOD.size}" fill="${dot}"/>` +
    `</svg>`
  );
}

/** The one-lockup asset (symbol + outline wordmark), used by the header, auth and OG. */
export function renderLockupSvg({
  height,
  fills = BRAND_FILL,
  variant = 'colour',
}: {
  height: number;
  fills?: Partial<SvgFill>;
  variant?: 'colour' | 'mono';
}): string {
  const body = fills.body ?? BRAND_FILL.body;
  const dot = variant === 'mono' ? body : fills.dot ?? BRAND_FILL.dot;
  const fill = { body, dot };
  const width = height * LOCKUP_ASPECT;
  const mark =
    `<g transform="translate(${num(LOCKUP.markX)} ${num(LOCKUP.markY)}) scale(${num(LOCKUP.markScale)})">` +
    markPaths(CUT_FULL, fill, variant, 'warrly-lockup') +
    `</g>`;
  const wordmark =
    `<g transform="translate(${num(LOCKUP.wordmarkX)} 0)">` +
    `<path d="${WORDMARK_LETTERS}" fill="${body}"/>` +
    `<rect x="${WORDMARK_PERIOD.x}" y="${WORDMARK_PERIOD.y}" width="${WORDMARK_PERIOD.size}" height="${WORDMARK_PERIOD.size}" fill="${dot}"/>` +
    `</g>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" ` +
    `viewBox="${LOCKUP.viewBox.x} ${LOCKUP.viewBox.y} ${LOCKUP.viewBox.width} ${LOCKUP.viewBox.height}" ` +
    `role="img" aria-label="Warrly">${mark}${wordmark}</svg>`
  );
}

/**
 * The in-app mark asset (`public/icon.svg`). It deliberately has no literal
 * colour: the plate is `currentColor` and the pennant is the app's
 * `--brand-dot` custom property, so the same file works on cream, white, ink
 * and every accent without a second copy. No paint stroke, filter or gradient:
 * the only stroke is the black one inside the mask that cuts the W out.
 */
export function renderInAppMarkSvg(): string {
  const g = CUT_FULL;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="Warrly">` +
    `<title>Warrly</title>` +
    markPaths(g, { body: 'currentColor', dot: 'hsl(var(--brand-dot))' }, 'colour') +
    `</svg>\n`
  );
}
