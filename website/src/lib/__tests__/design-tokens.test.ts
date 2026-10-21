// Design-token guard.
//
// The bug this pins: `bg-surface` was used in 16 places but neither
// `globals.css` nor `tailwind.config.ts` ever defined `--surface` / a
// `surface` colour. Tailwind emitted no rule at all for those classes, so 14
// panels and pills silently rendered transparent, and
// `charts/category-pie.tsx` wrote `stroke="hsl(var(--surface))"` (invalid CSS)
// so its slice separators never drew. Nothing failed: an unknown utility class
// and an unresolved `var()` are both valid CSS at the syntax level.
//
// This test is a cheap source scan, not a Tailwind compiler. Two checks:
//
//   1. every `var(--x)` in `src/**/*.{ts,tsx,css}` names a custom property
//      declared in `globals.css` (or one of the runtime-injected families below);
//   2. every `bg-<name>` / `text-<name>` utility in `src/**/*.{ts,tsx}` names a
//      colour declared in `tailwind.config.ts`.
//
// What it does NOT cover, stated so nobody trusts it further than it goes:
//   * `border-*`, `fill-*`, `stroke-*`, `ring-*`, `from-*`, `via-*`, `to-*`,
//     `decoration-*`, `shadow-*` colour utilities are not checked. The one
//     stroke bug above was caught by check 1, not by class parsing.
//   * class names built at runtime (`'bg-' + tone`) are invisible to a scan.
//   * arbitrary values (`bg-[#fff]`) are skipped.
//   * non-colour `bg-*`/`text-*` utilities are allowlisted by shape; a typo in
//     one of those would be false-negative, not caught.
//   * CSS is only read from `globals.css`; a custom property declared by
//     inline style or a package would need an explicit allowance here.
//
// Within those limits it is exactly the guard this defect needed: it fails on
// the old `bg-surface` and on the old `var(--surface)`, and it names the file.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEBSITE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SRC = join(WEBSITE, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|css)$/.test(path)) out.push(path);
  }
  return out;
}

// Tests are excluded because they may deliberately contain broken examples.
const files = walk(SRC).filter((file) => !file.includes('__tests__'));
const tsxFiles = files.filter((file) => /\.(ts|tsx)$/.test(file));

const globalsCss = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8');
const tailwindConfig = readFileSync(join(WEBSITE, 'tailwind.config.ts'), 'utf8');

const declaredVars = new Set(
  [...globalsCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]),
);

// Injected at runtime, so they are intentionally absent from globals.css:
//   --font-*  next/font writes these on <html> through a generated class.
//   --radix-* Radix writes its measured sizes/offsets on the trigger.
const RUNTIME_VARS = [/^--font-(sans|inter|fraunces)$/, /^--radix-/];

const declaredColors = new Set(
  [...tailwindConfig.matchAll(/hsl\(var\((--[a-z0-9-]+)\)\)/g)].map((match) =>
    match[1].slice(2),
  ),
);

// Non-colour utilities the app actually uses. Keep this list small and shape-
// based: a false positive here is a test that has to be taught about a new
// utility; a false negative is a colour token that slips through.
const NON_COLOR_UTILITY =
  /^(transparent|white|black|current|inherit|none|clip-text|gradient-to-(t|tr|r|br|b|bl|l|tl)|cover|contain|auto|center|top|bottom|left|right|repeat|no-repeat|fixed|local|scroll|origin-.+|blend-.+|opacity-\d+|xs|sm|base|lg|xl|[2-9]xl|center|left|right|justify|start|end|balance|pretty|wrap|nowrap|ellipsis|clip|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/;

function unknownColorTokens(source: string): string[] {
  const unknown = new Set<string>();
  for (const match of source.matchAll(/\b(?:bg|text)-([a-z][a-z0-9-]*)/g)) {
    const token = match[1];
    if (declaredColors.has(token) || NON_COLOR_UTILITY.test(token)) continue;
    unknown.add(token);
  }
  return [...unknown].sort();
}

function unresolvedVars(source: string): string[] {
  const missing = new Set<string>();
  for (const match of source.matchAll(/var\((--[a-z0-9-]+)/g)) {
    const variable = match[1];
    if (declaredVars.has(variable)) continue;
    if (RUNTIME_VARS.some((pattern) => pattern.test(variable))) continue;
    missing.add(variable);
  }
  return [...missing].sort();
}

describe('design tokens resolve', () => {
  it('scans a plausible number of files and declarations', () => {
    // Same self-guard as i18n-coverage: a broken walk or a regex that stopped
    // matching would make the assertions below vacuously true.
    expect(files.length).toBeGreaterThan(100);
    expect(declaredVars.size).toBeGreaterThan(50);
    expect(declaredColors.size).toBeGreaterThan(30);
  });

  it('names only declared custom properties in var()', () => {
    const missing = files
      .map((file) => ({
        file: relative(SRC, file),
        vars: unresolvedVars(readFileSync(file, 'utf8')),
      }))
      .filter((entry) => entry.vars.length > 0);
    expect(missing).toEqual([]);
  });

  it('uses only real colour tokens in bg-* / text-* classes', () => {
    const missing = tsxFiles
      .map((file) => ({
        file: relative(SRC, file),
        tokens: unknownColorTokens(readFileSync(file, 'utf8')),
      }))
      .filter((entry) => entry.tokens.length > 0);
    expect(missing).toEqual([]);
  });

  it('would have caught the old ghost token', () => {
    // Guards the scanner itself: this is the exact pair that shipped.
    expect(unresolvedVars('stroke="hsl(var(--surface))"')).toEqual(['--surface']);
    expect(unknownColorTokens('rounded-xl bg-surface p-4')).toEqual(['surface']);
    // And a real token still passes.
    expect(unknownColorTokens('bg-surface-2 text-ink')).toEqual([]);
  });
});
