// WCAG AA guard for the primary button, computed from the REAL tokens.
//
// The bug this pins: the four `[data-accent]` blocks in `globals.css` changed
// `--primary` but never `--primary-foreground`, so the label stayed white. White
// on the light-mode coral fill is 2.76:1 and on the hover fill 2.25:1 — well
// under the 4.5:1 AA threshold for the 14px semibold primary button. The dark
// palettes already used a dark ink and passed.
//
// The test does not repeat hex values from a comment. It parses
// `app/globals.css`, replays the cascade for the two selectors that matter
// (`:root` → `[data-accent=x]` in light; `:root` → `.dark` →
// `[data-accent=x]` → `.dark[data-accent=x]` in dark), and computes the ratio
// for both the resting fill (`--primary`) and the hover fill (`--primary-2`).
//
// Honest limit: this covers the four named accents only. An unknown
// `data-accent` value has no block to parse here, and JS-disabled first paint
// uses `:root` (coral), which is covered. It does not check every combination
// of `--primary-foreground` with soft/tint backgrounds; those pair
// `--primary-ink` with `--primary-soft` and are outside the button's contract.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatioOfHslTriples } from '@/lib/contrast';

const WEBSITE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GLOBALS = readFileSync(join(WEBSITE, 'src', 'app', 'globals.css'), 'utf8');

const ACCENTS = ['coral', 'emerald', 'violet', 'sky'] as const;
type Accent = (typeof ACCENTS)[number];
type Mode = 'light' | 'dark';

type Declarations = Record<string, string>;

// The four selectors whose declarations make up an accent's palette. The
// generic CSS parser below is deliberately narrow: it only needs these blocks,
// and skipping `@layer`/nested rules keeps it honest about what it read.
const SELECTOR = new RegExp(
  String.raw`(?:^|\n)\s*(:root|(\.dark)?\[data-accent="(${ACCENTS.join('|')})"\]|\.dark)\s*\{([^}]*)\}`,
  'g',
);

const rules: Array<{ selector: string; accent: Accent | null; vars: Declarations }> =
  [];
for (const match of GLOBALS.matchAll(SELECTOR)) {
  const vars: Declarations = {};
  for (const declaration of match[4].matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    vars[declaration[1]] = declaration[2].trim();
  }
  const accent = (match[3] ?? null) as Accent | null;
  const selector = accent
    ? `${match[2] ? '.dark' : ''}[data-accent="${accent}"]`
    : match[1];
  rules.push({ selector, accent, vars });
}

function ruleFor(selector: string, accent?: Accent): Declarations {
  const match = rules.find(
    (rule) =>
      rule.selector === selector &&
      (accent === undefined || rule.accent === accent),
  );
  if (!match) {
    throw new Error(
      `globals.css is missing the "${selector}"${accent ? ` block for ${accent}` : ''}`,
    );
  }
  return match.vars;
}

function resolve(accent: Accent, mode: Mode): Declarations {
  // Cascade order for these selectors, as written in globals.css. A dark
  // visitor with a chosen accent matches all four.
  const layers = [ruleFor(':root')];
  if (mode === 'dark') layers.push(ruleFor('.dark'));
  layers.push(ruleFor(`[data-accent="${accent}"]`, accent));
  if (mode === 'dark') {
    layers.push(ruleFor(`.dark[data-accent="${accent}"]`, accent));
  }
  return Object.assign({}, ...layers);
}

function ratio(label: string, fill: string | undefined, ink: string | undefined): number {
  expect(fill, `${label}: fill token`).toBeTruthy();
  expect(ink, `${label}: label token`).toBeTruthy();
  const value = contrastRatioOfHslTriples(fill!, ink!);
  expect(value, `${label}: the two tokens must be HSL triples`).not.toBeNull();
  return value!;
}

describe('primary button contrast (WCAG AA, 4.5:1)', () => {
  for (const accent of ACCENTS) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${accent} / ${mode}: resting and hover fills clear AA`, () => {
        const vars = resolve(accent, mode);
        const resting = ratio(
          `${accent}/${mode}/primary`,
          vars['primary'],
          vars['primary-foreground'],
        );
        const hover = ratio(
          `${accent}/${mode}/primary-2`,
          vars['primary-2'],
          vars['primary-foreground'],
        );

        // The numbers are part of the failure message so a future regression
        // says "4.21:1", not just "expected true to be true".
        expect(resting, `${accent}/${mode} resting ratio ${resting.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        expect(hover, `${accent}/${mode} hover ratio ${hover.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('defines the tokenised bottom shadow for every accent and mode', () => {
    for (const accent of ACCENTS) {
      for (const mode of ['light', 'dark'] as const) {
        const shadow = resolve(accent, mode)['primary-shadow'];
        expect(shadow, `${accent}/${mode} --primary-shadow`).toMatch(
          /^\d+(?:\.\d+)?\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%$/,
        );
      }
    }
  });

  it('the button draws its label and bottom shadow from those tokens', () => {
    const button = readFileSync(
      join(WEBSITE, 'src', 'components', 'ui', 'button.tsx'),
      'utf8',
    );
    expect(button).toContain('text-primary-foreground');
    expect(button).toContain('shadow-button');
    // The old hardcoded warm-brown edge: right on coral, wrong on the other
    // three accents, and invisible to every contrast check because it is not a
    // token at all.
    expect(button).not.toMatch(/rgba\(\s*120\s*,\s*40\s*,\s*15/);
  });
});
