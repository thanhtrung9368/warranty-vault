// The mark's geometry and the lockup's proportions, pinned as numbers.
//
// These are not "does the component render" tests. They are the brand
// contract: the receipt body, the torn top, the dot's size/position and the
// lockup ratios. A future edit that rounds the dot to r=2, centres it, adds a
// background tile or scales the logo with a theme token fails here.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BRAND_FILL,
  LOCKUP,
  LOCKUP_ASPECT,
  WORDMARK_BOX,
  WORDMARK_LETTERS,
  WORDMARK_PERIOD,
  knockoutPath,
  markCutForSize,
  markGeometryForSize,
  renderInAppMarkSvg,
  renderLockupSvg,
  renderMarkSvg,
  renderNotificationBadgeSvg,
  renderWordmarkSvg,
  smallestRenderedDotDiameter,
} from '@/lib/brand';

const WEBSITE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('the Kept Receipt geometry', () => {
  it('draws the 32 cut exactly as specified', () => {
    const g = markGeometryForSize(32);
    expect(g.viewBox).toBe(32);
    // A tall 16×24 receipt at x=8…24, y=3…27. The top is clean; the bottom is
    // torn. The tear dips to 27.2, hence the 24.2 ink height.
    expect(g.ink).toEqual({ x: 8, y: 3, width: 16, height: 24.2 });
    expect(g.bodyHeight).toBe(24);
    expect(g.body).toContain('M9.5 3');
    expect(g.body).toContain('H22.5A1.5 1.5 0 0 1 24 4.5'); // clean top-right
    expect(g.body).toContain('A1.5 1.5 0 0 1 9.5 3'); // clean top-left
    // Five asymmetric notches between y=25.7 and y=27.2, none deeper than 1.5.
    expect(g.body).toContain('L23 27.2L21.7 25.8');
    expect(g.body).toContain('L18.4 25.7L16.8 27.1');
    expect(g.body).toContain('L10.2 27L8.8 26.1L8 26.7');
    // One filled path: no stroke is expressible on the geometry at all.
    expect(g.body).not.toContain('stroke');
    // The date dot: 4/16 = 25% of the body width, low-right, not centred.
    expect(g.dot).toEqual({ cx: 19.9, cy: 21.6, r: 2 });
    expect((g.dot.r * 2) / 16).toBeGreaterThanOrEqual(0.24);
    expect((g.dot.r * 2) / 16).toBeLessThanOrEqual(0.26);
    expect(g.dot.cx).toBeGreaterThan(16);
    expect(g.dot.cy).toBeGreaterThan(16);
  });

  it('has dedicated 16 and 24 cuts with whole-pixel tear/dot centres', () => {
    const small = markGeometryForSize(16);
    expect(small.viewBox).toBe(16);
    // Slightly wider than a raw 0.5× scale (10×12.5), because 8px is too thin
    // for the tear to survive; the dot is still low-right and snapped.
    expect(small.bodyHeight).toBe(12.5);
    expect(small.dot).toEqual({ cx: 10, cy: 10, r: 1.4 });
    expect(Number.isInteger(small.dot.cx)).toBe(true);
    expect(Number.isInteger(small.dot.cy)).toBe(true);

    const mid = markGeometryForSize(24);
    expect(mid.viewBox).toBe(24);
    expect(mid.bodyHeight).toBe(18);
    expect(mid.dot).toEqual({ cx: 15, cy: 16, r: 1.6 });
  });

  it('selects the cut by rendered size, not by the asset filename', () => {
    expect(markCutForSize(16)).toBe(16);
    expect(markCutForSize(19)).toBe(16);
    expect(markCutForSize(20)).toBe(24);
    expect(markCutForSize(24)).toBe(24);
    expect(markCutForSize(27)).toBe(24);
    expect(markCutForSize(32)).toBe(32);
    expect(markCutForSize(512)).toBe(32);
  });

  it('never lets the dot fall below a 2.5px diameter', () => {
    expect(smallestRenderedDotDiameter()).toBeCloseTo(2.8, 5);
    expect(smallestRenderedDotDiameter()).toBeGreaterThanOrEqual(2.5);
    for (const size of [16, 20, 24, 32, 48, 64, 96, 128, 180, 192, 512, 1024]) {
      const cut = markGeometryForSize(size);
      const rendered = cut.dot.r * 2 * (size / cut.viewBox);
      expect(rendered, `${size}px dot`).toBeGreaterThanOrEqual(2.5);
    }
  });

  it('renders the mono variant as one compound path with the dot knocked out', () => {
    const d = knockoutPath(markGeometryForSize(32));
    expect(d.startsWith(markGeometryForSize(32).body)).toBe(true);
    // The body plus one extra subpath (the circle), not a second colour.
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d).toContain('A2 2');
    const badge = renderNotificationBadgeSvg(96);
    expect(badge).toContain('fill-rule="evenodd"');
    expect(badge).toContain('#FFFFFF');
    expect(badge).not.toContain('#1F1A14');
    expect(badge).not.toContain('#FF6B45');
  });
});

describe('the wordmark is fixed outlines', () => {
  it('carries real letter outlines and a separate coral full stop', () => {
    expect(WORDMARK_LETTERS.length).toBeGreaterThan(1000);
    // Six glyph outlines (W, a, r, r, l, y) in one path, no <text>.
    expect(WORDMARK_LETTERS.match(/M/g)).toHaveLength(6);
    expect(WORDMARK_BOX.capHeight).toBe(100);
    expect(WORDMARK_PERIOD.size).toBeCloseTo(20.13, 2);
    // The period starts after the last letter and is its own path so it can
    // be coral without colouring the letters.
    expect(WORDMARK_PERIOD.x).toBeGreaterThan(419.73);
    const svg = renderWordmarkSvg({ height: 24 });
    expect(svg.match(/<path/g)).toHaveLength(1);
    expect(svg.match(/<rect/g)).toHaveLength(1);
    expect(svg).not.toContain('<text');
  });

  it('does not depend on a font, a radius or a density token', () => {
    const svg = renderWordmarkSvg({ height: 24 });
    expect(svg).not.toMatch(/font-family|font-size|letter-spacing|--radius|--density/);
    // The lockup and mark must likewise never read the themeable type/radius.
    for (const source of [
      'src/components/brand/warrly-mark.tsx',
      'src/components/brand/warrly-wordmark.tsx',
      'src/components/brand/warrly-lockup.tsx',
    ]) {
      const text = readFileSync(join(WEBSITE, source), 'utf8');
      expect(text, source).not.toMatch(/--font-display|--radius|--density/);
      expect(text, source).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });
});

describe('the lockup proportions', () => {
  it('uses body height 1.15× cap, gap 0.5× symbol width and 2× dot clear space', () => {
    const bodyHeight = markGeometryForSize(32).bodyHeight * LOCKUP.markScale;
    const bodyWidth = markGeometryForSize(32).ink.width * LOCKUP.markScale;
    expect(bodyHeight).toBeCloseTo(1.15 * WORDMARK_BOX.capHeight, 6);
    expect(LOCKUP.wordmarkX).toBeCloseTo(bodyWidth + 0.5 * bodyWidth, 6);
    const dotDiameter = markGeometryForSize(32).dot.r * 2 * LOCKUP.markScale;
    expect(LOCKUP.clearSpace).toBeCloseTo(2 * dotDiameter, 6);
    expect(LOCKUP_ASPECT).toBeCloseTo(LOCKUP.viewBox.width / LOCKUP.viewBox.height, 8);
  });

  it('ships as a single SVG with one mark and one wordmark group', () => {
    const svg = renderLockupSvg({ height: 36 });
    expect(svg.match(/<path/g)).toHaveLength(2); // receipt body + lettering
    expect(svg.match(/<circle/g)).toHaveLength(1); // date dot
    expect(svg.match(/<rect/g)).toHaveLength(1); // full stop
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('background');
  });
});

describe('the in-app mark uses tokens, never literals', () => {
  it('has no background tile unless the caller asks for one', () => {
    const bare = renderMarkSvg({ size: 32 });
    expect(bare).not.toContain('<rect');
    const tiled = renderMarkSvg({ size: 32, background: '#FFF7EE' });
    expect(tiled).toContain('<rect');
  });

  it('paints with currentColor + --brand-dot and no stroke/filter/gradient/hex', () => {
    const svg = renderInAppMarkSvg();
    expect(svg).toContain('currentColor');
    expect(svg).toContain('var(--brand-dot)');
    for (const forbidden of ['stroke', 'filter', 'Gradient', 'gradient', '#']) {
      expect(svg, forbidden).not.toContain(forbidden);
    }
    expect(BRAND_FILL.body).toBe('hsl(var(--brand-body))');
    expect(BRAND_FILL.dot).toBe('hsl(var(--brand-dot))');
  });

  it('never emits a background square by default', () => {
    for (const size of [16, 20, 24, 32, 48, 64]) {
      expect(renderMarkSvg({ size })).not.toContain('<rect');
    }
  });
});
