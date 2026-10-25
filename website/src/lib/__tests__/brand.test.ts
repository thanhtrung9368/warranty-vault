// The mark's geometry and the lockup's proportions, pinned as numbers.
//
// These are not "does the component render" tests. They are the brand
// contract: the tag plate, the bevel, the V notch, the punch, the swallowtail
// pennant and the lockup ratios. A future edit that rounds the punch, centres
// the flag, drops the bevel, adds a background tile or scales the logo with a
// theme token fails here.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BRAND_FILL,
  CUT_16,
  CUT_32,
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
  smallestRenderedPunchDiameter,
} from '@/lib/brand';

const WEBSITE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('The Warranty Tag geometry', () => {
  it('draws the full cut exactly as specified', () => {
    const g = markGeometryForSize(32);
    expect(g.cut).toBe('full');
    expect(g.viewBox).toBe(32);
    // The plate is x=5.4…22.4, y=10.6…28.2; the pennant tip is the ink top.
    expect(g.ink).toEqual({ x: 5.4, y: 2.6, width: 21.9, height: 25.6 });
    expect(g.bodyHeight).toBe(17.6);
    expect(g.bodyWidth).toBe(17);
    expect(g.notchDepth).toBe(2.3);
    // The bevelled top-left corner is a straight 45° cut, not a radius.
    expect(g.body).toContain('M10.3 10.6');
    expect(g.body).toContain('L5.4 15.5L10.3 10.6Z');
    expect(g.body).toContain('A1.5 1.5 0 0 1 22.4 12.1'); // rounded top-right
    // The V notch: bottom-right edge in to the apex, then back down.
    expect(g.body).toContain('L16.9 28.2L13.9 25.9L10.9 28.2');
    // One filled path: no stroke is expressible on the geometry at all.
    expect(g.body).not.toContain('stroke');
    // The punch: a 3.2-unit hole tucked under the bevel, not a badge.
    expect(g.punchCircle).toEqual({ cx: 9.97, cy: 15.17, r: 1.6 });
    expect(g.punch).toContain('A1.6 1.6 0 1 0');
    expect(g.punchCircle.cx - g.punchCircle.r).toBeGreaterThan(g.ink.x);
    expect(g.punchCircle.cy + g.punchCircle.r).toBeLessThan(28.2);
    // The pennant rises ABOVE the plate and ends in a swallowtail notch.
    expect(g.flag).toContain('L18.9 2.6L27.3 2.6');
    expect(g.flag).toContain('L25 5.3L27.3 8');
    expect(g.flagWidth).toBe(8.4);
    expect(g.ink.y).toBeLessThan(10.6);
  });

  it('has a separately drawn small cut that is not a scale of the full one', () => {
    const small = markGeometryForSize(16);
    const full = markGeometryForSize(32);
    expect(small.cut).toBe('small');
    // Same 32-unit drawing grid as the full cut — the cut is a redraw, not a
    // different coordinate system.
    expect(small.viewBox).toBe(32);
    expect(small.ink).toEqual({ x: 5.2, y: 2.6, width: 22.8, height: 25.6 });
    expect(small.bodyHeight).toBe(18.2);
    expect(small.punchCircle).toEqual({ cx: 10.3, cy: 15.1, r: 1.9 });
    // Every small-size change is in the direction the brief describes.
    expect(small.bodyHeight).toBeGreaterThan(full.bodyHeight);
    expect(small.bodyWidth).toBeGreaterThan(full.bodyWidth);
    expect(small.punchCircle.r).toBeGreaterThan(full.punchCircle.r);
    expect(small.notchDepth).toBeGreaterThan(full.notchDepth);
    expect(small.flagWidth).toBeGreaterThan(full.flagWidth);
    // If it were a 0.71× scale of the full cut the punch would be 1.14 units.
    expect(small.punchCircle.r).not.toBeCloseTo(full.punchCircle.r, 1);
    expect(CUT_16.cut).toBe('small');
    expect(CUT_32.cut).toBe('full');
  });

  it('selects the cut by rendered size, switching at exactly 24px', () => {
    expect(markCutForSize(16)).toBe('small');
    expect(markCutForSize(20)).toBe('small');
    expect(markCutForSize(23)).toBe('small');
    expect(markCutForSize(24)).toBe('full');
    expect(markCutForSize(32)).toBe('full');
    expect(markCutForSize(512)).toBe('full');
    // Both cuts use the 32 grid, so the switch is about stroke weight, not
    // viewBox size: no caller can infer the cut from the box.
    expect(markGeometryForSize(16).viewBox).toBe(markGeometryForSize(512).viewBox);
  });

  it('keeps the punch measurable at every supported size', () => {
    expect(smallestRenderedPunchDiameter()).toBeCloseTo(1.9, 6);
    expect(smallestRenderedDotDiameter()).toBeCloseTo(1.9, 6);
    // The small cut's punch is proportionally larger than the full cut's,
    // which is the point of redrawing it.
    expect(
      (markGeometryForSize(16).punchCircle.r * 2) / markGeometryForSize(16).bodyWidth,
    ).toBeGreaterThan(
      (markGeometryForSize(32).punchCircle.r * 2) / markGeometryForSize(32).bodyWidth,
    );
    for (const size of [16, 20, 24, 32, 48, 64, 96, 128, 180, 192, 512, 1024]) {
      const cut = markGeometryForSize(size);
      const rendered = (cut.punchCircle.r * 2 * size) / cut.viewBox;
      expect(rendered, `${size}px punch`).toBeGreaterThanOrEqual(1.9);
    }
  });

  it('renders mono as one compound path plus the pennant, with the punch knocked out', () => {
    const geometry = markGeometryForSize(32);
    const d = knockoutPath(geometry);
    // The punch is appended to the plate path; the pennant is its own path so
    // it stays visible where it rises above the tag.
    expect(d.startsWith(geometry.body)).toBe(true);
    expect(d.endsWith(geometry.punch)).toBe(true);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d).not.toContain(geometry.flag);
    const badge = renderNotificationBadgeSvg(96);
    expect(badge).toContain('fill-rule="evenodd"');
    expect(badge).toContain('#FFFFFF');
    expect(badge).toContain(geometry.flag);
    expect(badge.match(/fill="#FFFFFF"/g)).toHaveLength(2);
    expect(badge).not.toContain('#1F1A14');
    expect(badge).not.toContain('#FF6B45');
  });
});

describe('the wordmark is fixed outlines', () => {
  it('carries real letter outlines and a separate accent full stop', () => {
    expect(WORDMARK_LETTERS.length).toBeGreaterThan(1000);
    // Six glyph outlines (W, a, r, r, l, y) in one path, no <text>.
    expect(WORDMARK_LETTERS.match(/M/g)).toHaveLength(6);
    expect(WORDMARK_BOX.capHeight).toBe(100);
    expect(WORDMARK_PERIOD.size).toBeCloseTo(20.13, 2);
    // The period starts after the last letter and is its own path so it can
    // carry the accent without colouring the letters.
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
  it('uses mark height 1.15× cap, gap 0.5× symbol width and 2× accent clear space', () => {
    const g = markGeometryForSize(32);
    const symbolHeight = g.ink.height * LOCKUP.markScale;
    const symbolWidth = g.ink.width * LOCKUP.markScale;
    expect(symbolHeight).toBeCloseTo(1.15 * WORDMARK_BOX.capHeight, 6);
    expect(LOCKUP.wordmarkX - symbolWidth).toBeCloseTo(0.5 * symbolWidth, 6);
    expect(LOCKUP.clearSpace).toBeCloseTo(2 * g.flagWidth * LOCKUP.markScale, 6);
    // The ink starts at x=0 and the tag's bottom sits on the wordmark baseline.
    expect(LOCKUP.markX + g.ink.x * LOCKUP.markScale).toBeCloseTo(0, 6);
    expect(LOCKUP.markY + 28.2 * LOCKUP.markScale).toBeCloseTo(0, 6);
    // The pennant tip is the top of the box, exactly 1.15 cap above baseline.
    expect(LOCKUP.markY + g.ink.y * LOCKUP.markScale).toBeCloseTo(-115, 6);
    expect(LOCKUP.viewBox.width).toBeCloseTo(LOCKUP.wordmarkX + WORDMARK_BOX.width, 6);
    // 115 above the baseline to the wordmark's 'y' descender at +29.53.
    expect(LOCKUP.viewBox.y).toBe(-115);
    expect(LOCKUP.viewBox.height).toBeCloseTo(115 + 29.53, 6);
    expect(LOCKUP_ASPECT).toBeCloseTo(LOCKUP.viewBox.width / LOCKUP.viewBox.height, 8);
  });

  it('ships as a single SVG with the plate, the pennant and the wordmark', () => {
    const svg = renderLockupSvg({ height: 36 });
    // pennant + plate (with its punched hole) + lettering
    expect(svg.match(/<path/g)).toHaveLength(3);
    expect(svg.match(/<circle/g)).toBeNull();
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
    expect(svg).toContain('fill-rule="evenodd"');
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
