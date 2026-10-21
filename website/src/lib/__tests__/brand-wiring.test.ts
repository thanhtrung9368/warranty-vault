// The brand wiring, pinned against the source tree.
//
// Defect 6 was a CSS rule that let Settings restyle the logo; defect 8 was seven
// screens that each built their own mark out of a lucide `Vault` and a
// `.brand-mark` span. Neither is visible to a type check — every one of those
// spans compiled and rendered. These assertions fail on a regression to any
// hand-built logo and on a future `.brand-mark` selector.

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
    else out.push(path);
  }
  return out;
}

const files = walk(SRC).filter((file) => !file.includes('__tests__'));
const tsx = files.filter((file) => file.endsWith('.tsx'));

const globals = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8');

describe('one mark, one implementation', () => {
  it('has no `.brand-mark` selector left anywhere', () => {
    // The old rule (and its -sm/-lg variants) is gone from the stylesheet…
    expect(globals).not.toMatch(/\.brand-mark\b\s*[,{]/);
    // …and no component builds one by hand.
    // Match the old class usage, not the new `data-brand-mark` attribute or
    // the `warrly-mark.tsx` filename.
    const offenders = tsx.filter((file) =>
      /className="brand-mark/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders.map((file) => relative(SRC, file))).toEqual([]);
  });

  it('imports no lucide Vault as a logo anywhere', () => {
    const offenders = tsx.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /from 'lucide-react'/.test(source) && /\bVault\b/.test(source);
    });
    expect(offenders.map((file) => relative(SRC, file))).toEqual([]);
  });

  it('routes every branded screen through WarrlyMark/WarrlyLockup', () => {
    const screens: Array<[string, RegExp]> = [
      ['app/page.tsx', /WarrlyLockup/],
      ['app/(public)/layout.tsx', /WarrlyLockup/],
      ['app/(auth)/layout.tsx', /WarrlyLockup/],
      ['app/not-found.tsx', /WarrlyLockup/],
      ['app/offline/page.tsx', /WarrlyLockup/],
      ['components/sidebar.tsx', /WarrlyMark/],
      ['components/topbar.tsx', /WarrlyMark/],
      ['components/landing-product.tsx', /WarrlyMark/],
    ];
    for (const [file, pattern] of screens) {
      expect(readFileSync(join(SRC, file), 'utf8'), file).toMatch(pattern);
    }
  });

  it('keeps exactly one lockup on the landing screen and the wordmark alone in the footer', () => {
    const landing = readFileSync(join(SRC, 'app', 'page.tsx'), 'utf8');
    expect(landing.match(/<WarrlyLockup\b/g)).toHaveLength(1);
    expect(landing.match(/<WarrlyWordmark\b/g)).toHaveLength(1);
    // The footer wordmark link is separate from the header lockup.
    expect(landing.indexOf('<WarrlyLockup')).toBeLessThan(landing.indexOf('<WarrlyWordmark'));
  });

  it('keeps the 404 vault as an illustration, not as the logo', () => {
    const notFound = readFileSync(join(SRC, 'app', 'not-found.tsx'), 'utf8');
    expect(notFound).toContain('Vault404Illustration');
    expect(notFound).toContain('<WarrlyLockup');
    expect(notFound).not.toMatch(/brand-mark|Vault\s+className=/);
  });
});

describe('the logo is a trademark asset, not a text style', () => {
  it('has a dedicated --font-brand and never binds it to a display preset', () => {
    expect(globals).toMatch(/--font-brand\s*:/);
    expect(globals).toContain('Plus Jakarta Sans');
    // [data-font] rewrites --font-display only. If a future rule rewrites
    // --font-brand, choosing Fraunces would turn the logo into a serif again.
    const fontBlocks = [...globals.matchAll(/\[data-font="[^"]+"\]\s*\{([^}]*)\}/g)].map(
      (match) => match[1],
    );
    expect(fontBlocks.length).toBeGreaterThan(0);
    for (const body of fontBlocks) expect(body).not.toContain('--font-brand');
  });

  it('does not read --font-display in any brand component', () => {
    for (const file of [
      'components/brand/warrly-mark.tsx',
      'components/brand/warrly-wordmark.tsx',
      'components/brand/warrly-lockup.tsx',
    ]) {
      expect(readFileSync(join(SRC, file), 'utf8'), file).not.toContain('--font-display');
    }
  });

  it('keeps the brand module free of theme shape/density tokens', () => {
    const brand = readFileSync(join(SRC, 'lib', 'brand.ts'), 'utf8');
    expect(brand).not.toMatch(/--radius|--density|--font-display/);
  });
});

describe('feature illustrations', () => {
  const visuals = readFileSync(join(SRC, 'components/landing/feature-visuals.tsx'), 'utf8');

  it('draws six household subjects, one accent dot each', () => {
    for (const subject of [
      'rice-cooker',
      'ac-remote',
      'motorbike-key',
      'warranty-booklet',
      'red-invoice',
      'phone',
    ]) {
      expect(visuals).toContain(`'${subject}'`);
    }
    // One `fill={ACCENT}` per composition and no other accent use.
    expect(visuals.match(/fill=\{ACCENT\}/g)).toHaveLength(6);
  });

  it('uses solid token fills only: no strokes, gradients or literal hex', () => {
    expect(visuals).not.toMatch(/stroke[=:]/);
    expect(visuals).not.toMatch(/<(linearGradient|radialGradient|filter)/);
    expect(visuals).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    for (const token of ['--ink', '--primary', '--primary-soft']) {
      expect(visuals).toContain(`var(${token})`);
    }
  });

  it('carries alt text through the i18n catalog, never an English literal', () => {
    const landing = readFileSync(join(SRC, 'app', 'page.tsx'), 'utf8');
    for (const key of ['Sổ bảo hành', 'Chìa khoá xe máy', 'Điều khiển điều hoà', 'Hoá đơn đỏ', 'Nồi cơm điện']) {
      expect(landing).toContain(`alt: t('${key}')`);
    }
  });
});

describe('empty-state art and the OG card', () => {
  it('uses the art only for the cold-start reason, never for a filtered list', () => {
    const component = readFileSync(join(SRC, 'components', 'empty-state.tsx'), 'utf8');
    expect(component).toContain("emptyReason === 'no-data'");
    expect(component).toContain('<EmptyStateArt');
    const art = readFileSync(join(SRC, 'components', 'empty-state-art.tsx'), 'utf8');
    expect(art.match(/fill=\{accent\}/g) ?? []).toHaveLength(1);
    expect(art).not.toMatch(/stroke[=:]/);
    expect(art).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('renders the OG card with the outline lockup and the Vietnamese brand line', () => {
    const ox = readFileSync(join(SRC, 'app', 'og', 'route.tsx'), 'utf8');
    expect(ox).toContain('renderLockupSvg');
    expect(ox).toContain("translate('vi', 'Giữ ngày. Giữ giấy.')");
    expect(ox).not.toContain('>W<');
    // The old card drew a coral tile with a W; the new one embeds the same
    // lockup asset the header uses.
    expect(ox).not.toContain('backgroundColor: OG_COLORS.primary');
  });
});

describe('no brand asset is a font-dependent text node', () => {
  it('keeps <text> out of every brand SVG source', () => {
    const brand = readFileSync(join(SRC, 'lib', 'brand.ts'), 'utf8');
    expect(brand).not.toContain('<text');
    const ox = readFileSync(join(SRC, 'app', 'og', 'route.tsx'), 'utf8');
    expect(ox).toContain('renderLockupSvg');
    expect(ox).not.toContain('>W<');
  });
});
