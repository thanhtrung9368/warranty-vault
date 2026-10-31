// The brand tokens' contrast contract, computed from the REAL globals.css.
//
// `--brand-body` paints the wordmark ink; `--brand-dot` paints the tag plate
// (and the wordmark's full stop). The plate is the whole trademark: if it
// disappeared into the surface, the mark would be a blank silhouette. The W is
// a mask cut, so it shows the surface through and is never a painted second
// colour. This test replays the cascade for the four accents in both modes and
// computes the actual ratio.
//
// It also pins the accent overrides: emerald's primary is 2.85:1 and violet's
// is 3.04:1 against ink, so in light mode both redirect the dot to
// `--primary-2` (3.41 / 3.46). Dark mode is the other way round: the plate is
// the bright accent against the page, never the soft tint (1.30:1 on #0E1018).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { markGeometryForSize } from '@/lib/brand';
import { contrastRatioOfHslTriples, parseHslTriple } from '@/lib/contrast';

const WEBSITE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GLOBALS = readFileSync(join(WEBSITE, 'src', 'app', 'globals.css'), 'utf8');

const ACCENTS = ['coral', 'emerald', 'violet', 'sky'] as const;
type Accent = (typeof ACCENTS)[number];
type Vars = Record<string, string>;

function block(selector: string): Vars {
  // The stylesheet is hand-written and flat: find the exact selector at the
  // start of a line, then read until its closing brace. Comments may contain
  // selector-like text, so the selector must be followed by `{`.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(GLOBALS);
  if (!match) throw new Error(`globals.css has no ${selector} block`);
  const vars: Vars = {};
  for (const declaration of match[1].matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    vars[declaration[1]] = declaration[2].trim();
  }
  return vars;
}

function resolve(vars: Vars, name: string, seen: string[] = []): string {
  if (seen.includes(name)) throw new Error(`custom-property cycle at --${name}`);
  const value = vars[name];
  if (value === undefined) throw new Error(`--${name} is not declared in this cascade`);
  const reference = /^var\(--([a-z0-9-]+)\)$/.exec(value.trim());
  if (!reference) return value;
  return resolve(vars, reference[1], [...seen, name]);
}

function ratio(a: string, b: string): number {
  const value = contrastRatioOfHslTriples(a, b);
  if (value === null) throw new Error(`not HSL triples: ${a} / ${b}`);
  return value;
}

function light(accent: Accent): Vars {
  return { ...block(':root'), ...block(`[data-accent="${accent}"]`) };
}

function dark(accent: Accent): Vars {
  return {
    ...block(':root'),
    ...block('.dark'),
    ...block(`[data-accent="${accent}"]`),
    ...block(`.dark[data-accent="${accent}"]`),
  };
}

describe('brand dot contrast (body vs dot)', () => {
  it('declares the brand tokens and pins the font family', () => {
    const root = block(':root');
    expect(root['brand-body']).toBe('var(--ink)');
    expect(root['brand-dot']).toBe('var(--primary)');
    expect(root['font-brand']).toContain('var(--font-sans)');
    expect(root['font-brand']).toContain('Plus Jakarta Sans');
  });

  for (const accent of ACCENTS) {
    it(`${accent} / light: ink wordmark + accent plate clears 3:1`, () => {
      const vars = light(accent);
      const body = resolve(vars, 'brand-body');
      const dot = resolve(vars, 'brand-dot');
      expect(body).toBe(resolve(vars, 'ink'));
      expect(ratio(body, dot)).toBeGreaterThanOrEqual(3);
    });

    // The mark is one accent plate, not an accent sitting inside a tag: every
    // visible pixel of the plate sits on the dark page, so the requirement is
    // page-vs-dot. `--primary-soft` on #0E1018 measures 1.30:1 and would be
    // invisible; this pins the bright accent and measures it against the page.
    it(`${accent} / dark: the bright accent plate clears 3:1 on the page`, () => {
      const vars = dark(accent);
      expect(resolve(vars, 'brand-body')).toBe('32 100% 96%');
      const dot = resolve(vars, 'brand-dot');
      expect(dot).toBe(resolve(vars, 'primary'));
      const page = resolve(vars, 'background');
      expect(ratio(page, dot)).toBeGreaterThanOrEqual(3);
      // And the soft tint is NOT what paints the plate any more.
      expect(dot).not.toBe(resolve(vars, 'primary-soft'));
    });
  }

  it('records the raw primary failures that forced the accent overrides', () => {
    const ink = resolve(light('coral'), 'ink');
    // The numbers quoted in the brief, computed rather than trusted.
    expect(ratio(ink, resolve(light('coral'), 'primary'))).toBeCloseTo(6.1, 0);
    expect(ratio(ink, resolve(light('sky'), 'primary'))).toBeCloseTo(6.2, 0);
    expect(ratio(ink, resolve(light('violet'), 'primary'))).toBeCloseTo(3.0, 0);
    expect(ratio(ink, resolve(light('emerald'), 'primary'))).toBeCloseTo(2.85, 1);
    // The chosen replacements.
    expect(ratio(ink, resolve(light('emerald'), 'primary-2'))).toBeGreaterThan(3);
    expect(ratio(ink, resolve(light('violet'), 'primary-2'))).toBeGreaterThan(3);
  });

  it('never uses the bright dark-mode accent on the cream body', () => {
    const cream = '32 100% 96%';
    for (const accent of ACCENTS) {
      const vars = dark(accent);
      expect(ratio(cream, resolve(vars, 'primary'))).toBeLessThan(3);
    }
  });

  it('has no literal colour in the in-app mark asset', () => {
    const svg = readFileSync(join(WEBSITE, 'public', 'icon.svg'), 'utf8');
    // One painted shape, the accent plate. The W is a mask cut, so there is no
    // `currentColor` second shape and no even-odd compound path.
    expect(svg).toContain('hsl(var(--brand-dot))');
    expect(svg).not.toContain('currentColor');
    expect(svg).not.toContain('fill-rule');
    expect(svg.match(/<path/g)).toHaveLength(2);
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(svg).not.toMatch(/filter|gradient/i);
    // The W is cut out with a mask, whose one black stroke is a stencil rather
    // than a painted third colour. A painted stroke would be a new brand
    // colour, which the mark must not have.
    expect(svg.match(/stroke="/g)).toHaveLength(1);
    expect(svg).toContain('stroke="black"');
    // The full cut's width, from the geometry rather than a copied number.
    expect(svg).toContain(`stroke-width="${markGeometryForSize(32).letterWidth}"`);
  });

  it('parses every brand token as an HSL triple after resolution', () => {
    for (const accent of ACCENTS) {
      for (const vars of [light(accent), dark(accent)]) {
        expect(parseHslTriple(resolve(vars, 'brand-body'))).not.toBeNull();
        expect(parseHslTriple(resolve(vars, 'brand-dot'))).not.toBeNull();
      }
    }
  });
});
