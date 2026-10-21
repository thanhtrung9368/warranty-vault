// The Warrly brand geometry, as data.
//
// "The Kept Receipt" is the product's promise — keep the paper, remember the
// date — so the mark is a tall torn receipt with a date dot stamped low-right,
// not a vault (the repository's name) and not a shield (Warrly is not the
// warranty provider; see the landing FAQ).
//
// The silhouette was revised after real renders: a nearly square 20×23 body
// with two wide top teeth read as a battlemented slab / film strip at 60–1024,
// and the dot competed with it. A receipt's defining silhouette is TALL and
// NARROW (16×24 here), torn off the BOTTOM with five small irregular notches,
// and the dot is a 2.0 stamp rather than a 2.6 badge.
//
// This module is pure geometry and string rendering. It has no React and no
// Next import, for three reasons:
//
//   * the React components (`components/brand/*`) and the generated assets
//     (`public/*.png`, `public/icon.svg`, `/og`) all draw from ONE source, so
//     the favicon and the header cannot drift;
//   * the geometry can be unit-tested without a DOM;
//   * a script can render the raster cuts at their exact pixel sizes instead
//     of downscaling a 1024 canvas.
//
// The wordmark is fixed SVG outlines, not live text. The paths were generated
// from Plus Jakarta Sans ExtraBold (weight 800, cap height 745/1000 em) with
// `-0.02em` tracking, then normalised so the lettering ink starts at x=0 and
// the cap top is y=-100. The full stop is the typeface's own ExtraBold period
// (a 150×150 square glyph, scaled to 20.13 units), drawn as a separate path so
// it can be coral. Shipping outlines is what makes the logo immune to the
// user's font preset and to a web-font load flash — see `--font-brand` in
// globals.css for the pinned-family fallback.

/** The mark's native drawing grid. All cut values below are in these units. */
export const MARK_GRID = 32;

/**
 * A size cut. The 32 grid is the master; 16 and 24 are redrawn at their own
 * pixel grid (whole-pixel tear and dot centre) so a favicon is not a 0.5×
 * antialiased downscale of the master.
 */
export type MarkCut = 16 | 24 | 32;

export type MarkGeometry = {
  /** The SVG viewBox edge (square). */
  viewBox: MarkCut;
  /** One filled path: torn top, two rounded bottom corners. No stroke. */
  body: string;
  /** The date dot, stamped low-right rather than centred. */
  dot: { cx: number; cy: number; r: number };
  /** Rendered body height (bottom of the receipt to the lowest tear valley). */
  bodyHeight: number;
  /** The ink bounds (what a raster icon must centre, not the viewBox). */
  ink: { x: number; y: number; width: number; height: number };
};

// ── The 32 cut ─────────────────────────────────────────────────────────────
//
// Receipt body 16×24 at x=8…24, y=3…27 — tall and narrow, so it is paper, not
// a card. The TOP is a printer-clean edge with 1.5 corners. The BOTTOM is the
// torn end: five asymmetric notches between y=25.7 and y=27.2, none deeper
// than 1.5 units, alternating ~1.4–1.8 units apart. The nominal body bottom is
// y=27; the tear dips 0.2 below it. The path is clockwise, one fill, no stroke.
//
// The date dot is r=2.0 (4 units across = 25% of the 16-unit width) stamped at
// (19.9, 21.6): low-right, above the tear, with 2.1 units of margin to the
// right edge — a stamp, not a badge and not a centred bullet.
const CUT_32: MarkGeometry = {
  viewBox: 32,
  body:
    'M9.5 3H22.5A1.5 1.5 0 0 1 24 4.5V25.8' +
    'L23 27.2L21.7 25.8L20.2 26.7L18.4 25.7L16.8 27.1L15.2 25.9' +
    'L13.4 26.8L11.8 25.8L10.2 27L8.8 26.1L8 26.7V4.5A1.5 1.5 0 0 1 9.5 3Z',
  dot: { cx: 19.9, cy: 21.6, r: 2 },
  bodyHeight: 24,
  ink: { x: 8, y: 3, width: 16, height: 24.2 },
};

// ── The 16 cut ─────────────────────────────────────────────────────────────
//
// The 32 master is 8×12 at this size; at 8px wide the tear and the dot are
// sub-pixel, so the 16 cut is drawn a little wider (10×12.5 at x=3…13,
// y=2…14.5). The tear is redrawn at whole pixels with four notches ~2px deep
// — exaggerated on purpose so a favicon still reads as torn paper — and the
// dot is a 2.8px circle at (10,10), above the 2.5px floor.
const CUT_16: MarkGeometry = {
  viewBox: 16,
  body:
    'M3.7 2H12.3A0.7 0.7 0 0 1 13 2.7V12.3' +
    'L12 14.4L10.8 12.4L9.4 14L8 12.3L6.5 14.2L4.2 12.7L3 13.2V2.7' +
    'A0.7 0.7 0 0 1 3.7 2Z',
  dot: { cx: 10, cy: 10, r: 1.4 },
  bodyHeight: 12.5,
  ink: { x: 3, y: 2, width: 10, height: 12.4 },
};

// ── The 24 cut ─────────────────────────────────────────────────────────────
//
// Body 12×18 at x=6…18, y=2…20. The bottom tear is redrawn on whole pixels
// with four notches ~1.6px deep, and the dot is r=1.6 at (15,16) — 3.2px,
// 27% of the width, still low-right.
const CUT_24: MarkGeometry = {
  viewBox: 24,
  body:
    'M7 2H17A1 1 0 0 1 18 3V19.2' +
    'L17 20.4L15.9 18.7L14.4 20L13 18.6L11.5 20.2L9.8 18.8L8.4 20.1L6 19.4' +
    'V3A1 1 0 0 1 7 2Z',
  dot: { cx: 15, cy: 16, r: 1.6 },
  bodyHeight: 18,
  ink: { x: 6, y: 2, width: 12, height: 18.4 },
};

const CUTS: Record<MarkCut, MarkGeometry> = {
  16: CUT_16,
  24: CUT_24,
  32: CUT_32,
};

/**
 * Pick a cut for a requested CSS size.
 *
 * Up to 19px the 16px cut is rendered (a 20px mark on a high-DPI tab uses the
 * 24 cut at 0.83×, which is still sharper than scaling the 32 master); up to
 * 27px the 24 cut; everything larger uses the exact 32 master. The dot is
 * never allowed below a 2.5px diameter: the smallest rendered case is the 16
 * cut scaled to 16px, i.e. 3.2px.
 */
export function markCutForSize(size: number): MarkCut {
  if (size <= 19) return 16;
  if (size <= 27) return 24;
  return 32;
}

export function markGeometryForSize(size: number): MarkGeometry {
  return CUTS[markCutForSize(size)];
}

/** The smallest dot diameter any supported cut can render, in CSS pixels. */
export function smallestRenderedDotDiameter(): number {
  return CUT_16.dot.r * 2; // 2.8px at the 16px cut
}

/**
 * A compound path for the monochrome variant: the receipt plus the dot as a
 * second, reversed subpath. `fill-rule="evenodd"` knocks the dot out, so the
 * same glyph works on any background and needs no mask, no second colour and
 * no filter.
 */
export function knockoutPath(geometry: MarkGeometry): string {
  const { cx, cy, r } = geometry.dot;
  // Two half arcs, drawn counter-clockwise, then Z. Evenodd makes the dot a
  // hole; the direction is irrelevant to evenodd but keeps the subpath valid.
  const circle =
    `M${num(cx - r)} ${num(cy)}` +
    `A${num(r)} ${num(r)} 0 1 0 ${num(cx + r)} ${num(cy)}` +
    `A${num(r)} ${num(r)} 0 1 0 ${num(cx - r)} ${num(cy)}Z`;
  return `${geometry.body}${circle}`;
}

function num(value: number): string {
  // Two decimals is enough at a 32-unit grid and keeps the emitted SVG small.
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
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
 * the 'y' (+ its advance and tracking) and kept as its own path so it can be
 * coral while the letters are ink. 20.13 units square at cap height 100 —
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
// Geometry from the brand brief:
//   * symbol body height = 1.15 × cap height → 115 units at cap 100;
//   * gap = 0.5 × symbol width → the receipt body is 76.667 wide, so 38.333;
//   * clear space = 2 × dot diameter → dot is 19.167 units across, so 38.333.
//
// The symbol is the 32 master drawn at 115/24 ≈ 4.7917× (153.33 box, 76.667 ×
// 115 body). Its box is shifted left by 38.333 and down by 129.375 so the
// receipt's visual left edge sits at x=0 and its nominal bottom sits on the
// wordmark baseline (y=0). The tear dips 0.958 below that baseline. The result
// is one SVG, so the mark and the outline wordmark scale and align together.
export const LOCKUP = {
  /** The 32-grid mark is drawn at this scale inside the lockup (115 / 24). */
  markScale: 115 / 24,
  /** Translation applied to the mark so its ink starts at x=0 and baseline at y=0. */
  markX: -(8 * 115) / 24,
  markY: -(27 * 115) / 24,
  /** x where the wordmark group starts. 76.667 (body width) + 38.333 (gap). */
  wordmarkX: 115,
  /** viewBox — top is the receipt top (3 × S - 129.375 = -115). */
  viewBox: { x: 0, y: -115, width: 570.97, height: 144.53 },
  /** 2 × the dot's rendered diameter (2 × 19.167 = 38.333 units). */
  clearSpace: 230 / 6,
} as const;

/** Aspect ratio for a standalone lockup sized by its height. */
export const LOCKUP_ASPECT = LOCKUP.viewBox.width / LOCKUP.viewBox.height;
export const WORDMARK_ASPECT = WORDMARK_BOX.width / WORDMARK_BOX.height;

/** Minimal CSS custom properties the in-app components paint with. */
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

function geometryGroup(
  geometry: MarkGeometry,
  size: number,
  fills: SvgFill,
  variant: 'colour' | 'mono',
): string {
  const scale = size / geometry.viewBox;
  if (variant === 'mono') {
    return (
      `<g transform="scale(${num(scale)})">` +
      `<path d="${knockoutPath(geometry)}" fill="${fills.body}" fill-rule="evenodd"/>` +
      `</g>`
    );
  }
  return (
    `<g transform="scale(${num(scale)})">` +
    `<path d="${geometry.body}" fill="${fills.body}"/>` +
    `<circle cx="${num(geometry.dot.cx)}" cy="${num(geometry.dot.cy)}" r="${num(geometry.dot.r)}" fill="${fills.dot}"/>` +
    `</g>`
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
  // Small sizes use their dedicated cut (whole-pixel tear/dot); large ones use
  // the exact 32 master. Either way the rendered box is `size × size`.
  const geometry = markGeometryForSize(size);
  const fill = { body: fills.body ?? BRAND_FILL.body, dot: fills.dot ?? BRAND_FILL.dot };
  const bg =
    background === undefined
      ? ''
      : `<rect width="${size}" height="${size}" rx="${num(backgroundRadius)}" fill="${background}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}" role="img" aria-label="Warrly">` +
    bg +
    geometryGroup(geometry, size, fill, variant) +
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
  // 48px favicon gets the whole-pixel 32 master, a 16px one gets the 16 cut.
  const geometry = markGeometryForSize(glyph);
  const fill = { body: fills?.body ?? BRAND_FILL.body, dot: fills?.dot ?? BRAND_FILL.dot };
  const scale = glyph / geometry.viewBox;
  // Centre the VISIBLE receipt, not its 32-unit drawing box: the box has 6
  // units of horizontal padding and 1.6/5 units above/below the tear, so
  // centring the box would push the glyph up and left inside the tile.
  const offsetX = (size - geometry.ink.width * scale) / 2 - geometry.ink.x * scale;
  const offsetY = (size - geometry.ink.height * scale) / 2 - geometry.ink.y * scale;
  const inner =
    variant === 'mono'
      ? `<path d="${knockoutPath(geometry)}" fill="${fill.body}" fill-rule="evenodd"/>`
      : `<path d="${geometry.body}" fill="${fill.body}"/>` +
        `<circle cx="${num(geometry.dot.cx)}" cy="${num(geometry.dot.cy)}" r="${num(geometry.dot.r)}" fill="${fill.dot}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}" role="img" aria-label="Warrly">` +
    `<rect width="${size}" height="${size}" rx="${num(backgroundRadius)}" fill="${background}"/>` +
    `<g transform="translate(${num(offsetX)} ${num(offsetY)}) scale(${num(scale)})">${inner}</g>` +
    `</svg>`
  );
}

/**
 * The white-on-alpha shape Android uses as a notification badge. One path, a
 * knockout hole for the dot: monochrome by construction, no second colour.
 */
export function renderNotificationBadgeSvg(size = 96): string {
  const geometry = CUT_32;
  const scale = (size * 0.92) / MARK_GRID;
  const offsetX = (size - geometry.ink.width * scale) / 2 - geometry.ink.x * scale;
  const offsetY = (size - geometry.ink.height * scale) / 2 - geometry.ink.y * scale;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}" role="img" aria-label="Warrly">` +
    `<g transform="translate(${num(offsetX)} ${num(offsetY)}) scale(${num(scale)})">` +
    `<path d="${knockoutPath(geometry)}" fill="#FFFFFF" fill-rule="evenodd"/>` +
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
  const width = height * LOCKUP_ASPECT;
  const mark = `<g transform="translate(${LOCKUP.markX} ${LOCKUP.markY}) scale(${LOCKUP.markScale})">` +
    `<path d="${CUT_32.body}" fill="${body}"/>` +
    `<circle cx="${num(CUT_32.dot.cx)}" cy="${num(CUT_32.dot.cy)}" r="${num(CUT_32.dot.r)}" fill="${dot}"/>` +
    `</g>`;
  const wordmark =
    `<g transform="translate(${LOCKUP.wordmarkX} 0)">` +
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
 * colour: the body is `currentColor` and the dot is the app's
 * `--brand-dot` custom property, so the same file works on cream, white, ink
 * and every accent without a second copy. No stroke, filter or gradient.
 */
export function renderInAppMarkSvg(): string {
  const g = CUT_32;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="Warrly">` +
    `<title>Warrly</title>` +
    `<path d="${g.body}" fill="currentColor"/>` +
    `<circle cx="${num(g.dot.cx)}" cy="${num(g.dot.cy)}" r="${num(g.dot.r)}" fill="hsl(var(--brand-dot))"/>` +
    `</svg>\n`
  );
}
