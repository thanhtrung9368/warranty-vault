// The Warrly brand geometry, as data.
//
// "W in the tag" is the mark: a price-tag silhouette — rounded top corners, a
// torn zigzag bottom edge — with a W cut out of the plate. No pennant, no punched
// hole, no bevel: the tag plate and the letter, nothing else. The plate is the
// accent (coral); the W is negative space, so whatever the mark sits on shows
// through it.
//
// TWO DRAWN CUTS, NOT ONE DOWNSCALED
//
// The zigzag teeth and the W's stroke turn to mush at 16px if the full cut is
// merely shrunk. The small cut is REDRAWN on the same 32-unit grid with a
// larger plate (22.8×19.2 vs 22×18.4), two teeth instead of three (each one
// twice as wide) and a heavier W (3.4 vs 2.8 stroke). The two are not related by
// a transform, and one must never be rendered from the other:
//
//   * `markCutForSize(n)` picks `full` for n >= 24 and `small` below that;
//   * every raster asset (favicon.ico 16/32/48, icon-*.png, the badges) is
//     rendered from the cut chosen for ITS OWN pixel size, never resampled.
//
// COLOUR
//
// Plate = `--brand-dot`, the accent. The W is a mask cut, not a paint: painting
// it a surface colour would break on gradient cards and on the white-on-alpha
// notification badge. Mono = the plate in `currentColor` with the W knocked out.
// These two custom properties (`--brand-body` still paints the wordmark ink) are
// the only theme input: the mark reads no font, radius or density token.
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
  /**
   * The W, stroked in the mask so it reads as a cut-out of the plate. A stroked
   * letter rather than a filled path because the letter's job is to be a line.
   */
  letter: string;
  /** Stroke width of `letter`, in grid units. Thicker on the small cut. */
  letterWidth: number;
  /** Tag plate height (top edge to the lowest tooth tip). */
  bodyHeight: number;
  /** Tag plate width (left edge to right edge). */
  bodyWidth: number;
  /** Depth of one tooth of the torn bottom edge. */
  notchDepth: number;
  /** The whole silhouette, i.e. what to centre. */
  ink: { x: number; y: number; width: number; height: number };
};

// ── The full cut (≥24px) ───────────────────────────────────────────────────
//
// The plate is x=5…27, y=7…25.4. The two top corners are a 1.6 radius; the
// sides are straight. The bottom edge is a torn zigzag: four low points at
// y=25.4 (x=5, 12.33, 19.67, 27) with three tooth tips between them at y=23.0
// (x=8.67, 16, 23.33) — three teeth, each 2.4 deep.
//
// The W is a 2.8 stroke with round caps and joins, x=9.2…22.8, y=10.0…20.2. It
// sits a little above the plate's centre: 3.0 clear of the top edge and 2.8 above
// the tooth tips.
const CUT_FULL: MarkGeometry = {
  cut: 'full',
  viewBox: MARK_GRID,
  body:
    'M6.6 7L25.4 7A1.6 1.6 0 0 1 27 8.6L27 25.4L23.33 23L19.67 25.4L16 23L12.33 25.4L8.67 23L5 25.4L5 8.6A1.6 1.6 0 0 1 6.6 7Z',
  letter: 'M10.6 11.4L13.3 18.8L16 13.4L18.7 18.8L21.4 11.4',
  letterWidth: 2.8,
  bodyHeight: 18.4,
  bodyWidth: 22,
  notchDepth: 2.4,
  ink: { x: 5, y: 7, width: 22, height: 18.4 },
};

// ── The small cut (<24px) ──────────────────────────────────────────────────
//
// At a 16px render one pixel is two grid units, so a 2.4-deep tooth is 1.2px and
// three of them are a smudge. The small cut keeps two wide teeth (lows at x=4.6,
// 16, 27.4; tips at 10.3 and 21.7, 3.0 deep), a plate 22.8×19.2, and a 3.4 W
// stroke (1.7px at 16px — a stroke rather than a hairline).
const CUT_SMALL: MarkGeometry = {
  cut: 'small',
  viewBox: MARK_GRID,
  body:
    'M6 6.4L26 6.4A1.4 1.4 0 0 1 27.4 7.8L27.4 25.6L21.7 22.6L16 25.6L10.3 22.6L4.6 25.6L4.6 7.8A1.4 1.4 0 0 1 6 6.4Z',
  letter: 'M10 11L13.2 19L16 12.6L18.8 19L22 11',
  letterWidth: 3.4,
  bodyHeight: 19.2,
  bodyWidth: 22.8,
  notchDepth: 3,
  ink: { x: 4.6, y: 6.4, width: 22.8, height: 19.2 },
};

const CUTS: Record<MarkCut, MarkGeometry> = {
  full: CUT_FULL,
  small: CUT_SMALL,
};

/**
 * Pick a cut for a requested CSS size.
 *
 * The design switches at 24px: `>= 24` is the full cut, everything below uses
 * the separately drawn small cut. There is no third cut and no dead band.
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

/** The plate as one filled path; the W is cut out of it by the mask, not by this path. */
export function knockoutPath(geometry: MarkGeometry): string {
  return geometry.body;
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
 * treatment as any other knocked-out shape.
 *
 * In a mask, black is what removes paint, so the surface behind the mark shows
 * through the W. Painting the letter with `fill.body` would draw an ink W on an
 * ink plate (invisible), and painting it with a surface colour would break on
 * the landing's gradient card and in the white-on-alpha notification badge. The
 * mask is the only paint that works on every surface.
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
//   * the symbol is drawn at scale 5 (22 grid units wide → 110, 18.4 tall → 92),
//     a little under the 100-unit cap height of the wordmark;
//   * gap = 0.5 × symbol width = 55 units; clear space equals the gap;
//   * the symbol is translated so its ink starts at x=0 and the tag's lowest
//     point (y=25.4) sits on the wordmark baseline (y=0).
//
// The box is the wordmark's own: the 'l' ascender (y=-101.61) down to the 'y'
// descender (29.53), 131.14 tall.
const LOCKUP_MARK_SCALE = 5;
const LOCKUP_MARK_WIDTH = 22 * LOCKUP_MARK_SCALE;
export const LOCKUP = {
  /** Cap height of the outline wordmark, in lockup units. */
  capHeight: 100,
  /** The full 32-grid mark is drawn at this scale inside the lockup. */
  markScale: LOCKUP_MARK_SCALE,
  /** Translation applied to the mark so its ink starts at x=0 and its bottom sits at y=0. */
  markX: -5 * LOCKUP_MARK_SCALE,
  markY: -25.4 * LOCKUP_MARK_SCALE,
  /** x where the wordmark group starts: symbol width + gap. */
  wordmarkX: LOCKUP_MARK_WIDTH * 1.5,
  viewBox: {
    x: 0,
    y: WORDMARK_BOX.y,
    width: LOCKUP_MARK_WIDTH * 1.5 + WORDMARK_BOX.width,
    height: WORDMARK_BOX.height,
  },
  /** Equal to the gap: 0.5 × the symbol width. Not drawn — the caller must not crowd it. */
  clearSpace: LOCKUP_MARK_WIDTH * 0.5,
} as const;

/** Aspect ratio for a standalone lockup sized by its height. */
export const LOCKUP_ASPECT = LOCKUP.viewBox.width / LOCKUP.viewBox.height;
export const WORDMARK_ASPECT = WORDMARK_BOX.width / WORDMARK_BOX.height;

/**
 * Minimal CSS custom properties the in-app components paint with. `dot` is the
 * accent slot; on this mark it paints the plate. The name is kept so every caller and the OG route keep working.
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
 * The mark's paint, in order: the cutout mask, then the plate with the W cut out
 * of it. The plate takes the accent (`fill.dot`); in mono it takes `fill.body`
 * (a single colour). The W is always stroked into the mask, on both cuts and in
 * both variants — a W painted in the plate's colour would disappear into it.
 */
function markPaths(
  geometry: MarkGeometry,
  fill: SvgFill,
  variant: 'colour' | 'mono',
  cutoutPrefix = 'warrly-mark',
): string {
  const plate = variant === 'mono' ? fill.body : fill.dot;
  const cutout = markCutoutId(geometry, cutoutPrefix);
  return (
    letterCutout(geometry, cutout) +
    `<path d="${knockoutPath(geometry)}" fill="${plate}" mask="url(#${cutout})"/>`
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
  // Centre the VISIBLE silhouette, not its 32-unit drawing box: the box carries
  // different padding on each side, so centring the box would push the glyph off
  // centre inside the tile.
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
 * white, the W cut out of the plate. Monochrome by construction — and the W is cut
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
 * colour: the plate is the app's
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
