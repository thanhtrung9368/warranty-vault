// Colour maths for the WCAG contrast guard.
//
// The design tokens in `app/globals.css` are HSL triples without the `hsl()`
// wrapper (`--primary: 13 100% 64%`), because Tailwind composes them as
// `hsl(var(--primary))`. This module turns such a triple into sRGB and then
// into a WCAG 2.x contrast ratio, so the test can assert the real numbers
// instead of repeating a comment.
//
// Pure and dependency-free on purpose: it is imported by
// `__tests__/primary-contrast.test.ts` and by nothing else at runtime, so it
// also cannot acquire a Next.js dependency by accident.

/** A CSS HSL triple, e.g. `13 100% 64%`. */
export type HslTriple = { h: number; s: number; l: number };

export type Rgb = readonly [number, number, number];

/**
 * Parse a raw CSS custom-property value like `13 100% 64%` (the form used by
 * every colour token in this app). Returns `null` for anything else, including
 * `hsl(...)` wrappers, so a malformed token fails the contrast test loudly
 * rather than silently producing black.
 */
export function parseHslTriple(value: string): HslTriple | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*$/.exec(
    value,
  );
  if (!match) return null;
  const h = Number(match[1]);
  const s = Number(match[2]);
  const l = Number(match[3]);
  if (![h, s, l].every(Number.isFinite)) return null;
  return { h, s, l };
}

/** HSL → 8-bit sRGB, using the same formula browsers use for `hsl()`. */
export function hslToRgb({ h, s, l }: HslTriple): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const light = Math.min(100, Math.max(0, l)) / 100;
  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - chroma / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [chroma, x, 0];
  else if (hue < 120) [r, g, b] = [x, chroma, 0];
  else if (hue < 180) [r, g, b] = [0, chroma, x];
  else if (hue < 240) [r, g, b] = [0, x, chroma];
  else if (hue < 300) [r, g, b] = [x, 0, chroma];
  else [r, g, b] = [chroma, 0, x];

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/** WCAG relative luminance (sRGB, gamma-corrected). */
export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, always ≥ 1 and usually reported to two decimals. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Contrast between two raw CSS custom-property values (`"13 100% 64%"`).
 * Returns `null` when either value is not a parseable HSL triple.
 */
export function contrastRatioOfHslTriples(a: string, b: string): number | null {
  const first = parseHslTriple(a);
  const second = parseHslTriple(b);
  if (!first || !second) return null;
  return contrastRatio(hslToRgb(first), hslToRgb(second));
}
