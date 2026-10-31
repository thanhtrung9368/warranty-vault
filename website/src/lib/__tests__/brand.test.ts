// The mark's geometry and the lockup's proportions, pinned as relationships.
//
// These are not "does the component render" tests. They are the brand
// contract of the chosen mark: a tag plate with a torn zigzag bottom edge and a
// W cut out of it — no pennant, no punched hole, no second ink shape. A future
// edit that reintroduces either, adds a background tile or changes the lockup
// ratios fails here.
//
// Every assertion is derived from `markGeometryForSize(n)` or from the rendered
// string. No path is retyped: an earlier revision of this file pinned the old
// pennant's coordinates verbatim, and it broke twice when the mark changed.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WarrlyLockup } from '@/components/brand/warrly-lockup';
import { WarrlyMark } from '@/components/brand/warrly-mark';
import {
  BRAND_FILL,
  CUT_16,
  CUT_32,
  LOCKUP,
  LOCKUP_ASPECT,
  MARK_GRID,
  WORDMARK_BOX,
  WORDMARK_LETTERS,
  WORDMARK_PERIOD,
  knockoutPath,
  markCutForSize,
  markGeometryForSize,
  renderIconSvg,
  renderInAppMarkSvg,
  renderLockupSvg,
  renderMarkSvg,
  renderNotificationBadgeSvg,
  renderWordmarkSvg,
} from '@/lib/brand';
import type { MarkGeometry } from '@/lib/brand';

const WEBSITE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

type Bounds = { x: number; y: number; width: number; height: number };

/**
 * The bounds of a path's endpoints. The plate is authored with only M/L/A/Z
 * commands and absolute coordinates, so the farthest points are the M/L pairs
 * and the arc endpoints. Reading them back is how `ink` stays honest without a
 * second copy of the numbers living in this file.
 */
function pathBounds(path: string): Bounds {
  const tokens = path.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g) ?? [];
  const xs: number[] = [];
  const ys: number[] = [];
  let command = '';
  for (let i = 0; i < tokens.length; ) {
    const token = tokens[i];
    if (/^[A-Za-z]$/.test(token)) {
      command = token;
      i += 1;
      continue;
    }
    if (command === 'M' || command === 'L') {
      xs.push(Number(tokens[i]));
      ys.push(Number(tokens[i + 1]));
      i += 2;
      // Repeated coordinate pairs after M are implicit linetos; not used by
      // the plate, but the parser stays correct if it is authored that way.
      command = 'L';
    } else if (command === 'A') {
      // rx ry rotation large-arc sweep x y — only the endpoint moves the box.
      xs.push(Number(tokens[i + 5]));
      ys.push(Number(tokens[i + 6]));
      i += 7;
    } else {
      i += 1;
    }
  }
  if (xs.length === 0) throw new Error('path has no coordinates');
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** The W's polyline points, resolving the relative `l` runs into absolutes. */
function letterPoints(path: string): Array<{ x: number; y: number }> {
  const tokens = path.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g) ?? [];
  const points: Array<{ x: number; y: number }> = [];
  let x = 0;
  let y = 0;
  let command = '';
  for (let i = 0; i < tokens.length; ) {
    if (/^[A-Za-z]$/.test(tokens[i])) {
      command = tokens[i];
      i += 1;
      continue;
    }
    const a = Number(tokens[i]);
    const b = Number(tokens[i + 1]);
    i += 2;
    if (command === 'M' || command === 'L') {
      x = a;
      y = b;
      command = 'L';
    } else {
      x += a;
      y += b;
    }
    points.push({ x, y });
  }
  return points;
}

function expectPlateOnly(geometry: MarkGeometry): void {
  // The type itself carries the removal: a renderer that still asked for these
  // fields would not compile, and a future edit that adds them back fails here.
  expect(geometry, `${geometry.cut} flag`).not.toHaveProperty('flag');
  expect(geometry, `${geometry.cut} punch`).not.toHaveProperty('punch');
  expect(geometry, `${geometry.cut} punchCircle`).not.toHaveProperty('punchCircle');
  expect(geometry, `${geometry.cut} flagWidth`).not.toHaveProperty('flagWidth');

  // `ink` is the plate's own bounds — no pennant tip, no punch radius. Both are
  // derived from the body path rather than restated as numbers.
  const body = pathBounds(geometry.body);
  expect(geometry.ink.x).toBeCloseTo(body.x, 6);
  expect(geometry.ink.y).toBeCloseTo(body.y, 6);
  expect(geometry.ink.width).toBeCloseTo(body.width, 6);
  expect(geometry.ink.height).toBeCloseTo(body.height, 6);
  expect(geometry.bodyWidth).toBeCloseTo(body.width, 6);
  expect(geometry.bodyHeight).toBeCloseTo(body.height, 6);

  // One filled path. The plate has no stroke of its own; the only stroke in a
  // rendered mark is the black stencil inside the mask.
  expect(geometry.body.startsWith('M'), `${geometry.cut} starts`).toBe(true);
  expect(geometry.body.endsWith('Z'), `${geometry.cut} closes`).toBe(true);
  expect(geometry.body, `${geometry.cut} paint stroke`).not.toContain('stroke');

  // The torn bottom edge stays part of the body on both cuts.
  expect(geometry.notchDepth).toBeGreaterThan(0);
  expect(geometry.notchDepth).toBeLessThan(geometry.bodyHeight / 2);
}

describe('The Warranty Tag geometry', () => {
  it('draws the plate alone on both cuts: no pennant, no punch', () => {
    for (const geometry of [CUT_32, CUT_16]) {
      expect(geometry.viewBox).toBe(MARK_GRID);
      expectPlateOnly(geometry);
    }
  });

  it('draws the small cut as a redraw, not a scale of the full one', () => {
    const small = markGeometryForSize(16);
    const full = markGeometryForSize(32);
    expect(small.cut).toBe('small');
    // Same 32-unit drawing grid as the full cut — the cut is a redraw, not a
    // different coordinate system.
    expect(small.viewBox).toBe(full.viewBox);
    expectPlateOnly(small);
    // The small cut is redrawn larger and heavier so it survives 16px: a wider
    // and taller plate, a deeper tooth and a thicker W stroke.
    expect(small.bodyHeight).toBeGreaterThan(full.bodyHeight);
    expect(small.bodyWidth).toBeGreaterThan(full.bodyWidth);
    expect(small.letterWidth).toBeGreaterThan(full.letterWidth);
    expect(small.notchDepth).toBeGreaterThan(full.notchDepth);
    expect(small.letter).not.toBe(full.letter);
    expect(CUT_16.cut).toBe('small');
    expect(CUT_32.cut).toBe('full');
  });

  it('cuts a W out of both plates, clear of every edge', () => {
    for (const geometry of [CUT_32, CUT_16]) {
      expect(geometry.letter.length, `${geometry.cut} letter`).toBeGreaterThan(0);
      expect(geometry.letterWidth, `${geometry.cut} stroke`).toBeGreaterThan(0);
      const half = geometry.letterWidth / 2;
      const left = geometry.ink.x;
      const right = geometry.ink.x + geometry.ink.width;
      const top = geometry.ink.y;
      const bottom = geometry.ink.y + geometry.ink.height;
      for (const point of letterPoints(geometry.letter)) {
        expect(point.x - half, `${geometry.cut} W left`).toBeGreaterThan(left);
        expect(point.x + half, `${geometry.cut} W right`).toBeLessThan(right);
        expect(point.y - half, `${geometry.cut} W top`).toBeGreaterThan(top);
        // Clear of the torn edge, not just the bounding box: the lowest tooth
        // rises `notchDepth` into the plate.
        expect(point.y + half, `${geometry.cut} W bottom`).toBeLessThan(
          bottom - geometry.notchDepth,
        );
      }
    }
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

  it('renders the plate once, with the W knocked out by the mask', () => {
    for (const size of [16, 24, 32, 96]) {
      const geometry = markGeometryForSize(size);
      const svg = renderMarkSvg({ size });
      // Exactly two paths: the W's mask stroke and the plate. The removed mark
      // shipped a third path (the pennant) and a circle (the punch).
      expect(svg.match(/<path/g), `${size}px paths`).toHaveLength(2);
      expect(svg, `${size}px circle`).not.toContain('<circle');
      expect(svg, `${size}px compound fill`).not.toContain('fill-rule="evenodd"');
      expect(svg).toContain(geometry.body);
      expect(svg).toContain(geometry.letter);
      // The plate is the only painted shape, and it is painted after the mask.
      // With no pennant painted first, paint order cannot matter any more.
      const maskAt = svg.indexOf('<defs>');
      const plateAt = svg.indexOf(`d="${geometry.body}"`);
      expect(maskAt).toBeGreaterThanOrEqual(0);
      expect(plateAt).toBeGreaterThan(maskAt);
    }
  });
});

describe('the W survives every renderer', () => {
  it('strokes the cut letter into a mask, using each cut’s own width', () => {
    for (const size of [16, 32]) {
      const geometry = markGeometryForSize(size);
      const svg = renderMarkSvg({ size });
      expect(svg, `${size}px letter path`).toContain(geometry.letter);
      expect(svg, `${size}px stroke`).toContain(`stroke-width="${geometry.letterWidth}"`);
      expect(svg, `${size}px caps`).toContain('stroke-linecap="round"');
      expect(svg, `${size}px joins`).toContain('stroke-linejoin="round"');
      expect(svg, `${size}px fill`).toContain('fill="none"');
      expect(svg, `${size}px mask`).toContain(
        `mask="url(#warrly-mark-cut-${geometry.cut})"`,
      );
    }
    // Each cut carries its own weight; never reuse one cut's width on the
    // other. Both numbers come from the geometry, never from this test.
    const full = markGeometryForSize(32);
    const small = markGeometryForSize(16);
    expect(small.letterWidth).not.toBe(full.letterWidth);
    expect(renderMarkSvg({ size: 16 })).toContain(`stroke-width="${small.letterWidth}"`);
    expect(renderMarkSvg({ size: 16 })).not.toContain(
      `stroke-width="${full.letterWidth}"`,
    );
  });

  it('draws the letter in the icon, lockup, badge and in-app assets', () => {
    const full = markGeometryForSize(32);
    const small = markGeometryForSize(16);
    expect(
      renderIconSvg({ size: 192, glyphRatio: 0.84, background: '#FFF7EE' }),
    ).toContain(full.letter);
    expect(
      renderIconSvg({ size: 180, glyphRatio: 0.84, background: '#FFF7EE' }),
    ).toContain(full.letter);
    expect(renderLockupSvg({ height: 36 })).toContain(full.letter);
    expect(renderNotificationBadgeSvg(96)).toContain(full.letter);
    expect(renderInAppMarkSvg()).toContain(full.letter);
    // The lockup has its own mask id so it can share a page with a mark.
    expect(renderLockupSvg({ height: 36 })).toContain('warrly-lockup-cut-full');
    expect(renderMarkSvg({ size: 16 })).toContain(small.letter);
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
  it('uses gap 0.5× symbol width, and the gap is the clear space', () => {
    const g = markGeometryForSize(32);
    const symbolWidth = g.ink.width * LOCKUP.markScale;
    const symbolHeight = g.ink.height * LOCKUP.markScale;
    expect(LOCKUP.wordmarkX - symbolWidth).toBeCloseTo(0.5 * symbolWidth, 6);
    expect(LOCKUP.clearSpace).toBeCloseTo(LOCKUP.wordmarkX - symbolWidth, 6);

    // The symbol is a little under the wordmark's cap height — close enough to
    // read as one lockup, not stretched to fill the box.
    expect(symbolHeight).toBeLessThan(WORDMARK_BOX.capHeight);
    expect(symbolHeight).toBeGreaterThan(0.8 * WORDMARK_BOX.capHeight);

    // The ink starts at x=0 and the tag's lowest point sits on the baseline.
    expect(LOCKUP.markX + g.ink.x * LOCKUP.markScale).toBeCloseTo(0, 6);
    expect(
      LOCKUP.markY + (g.ink.y + g.ink.height) * LOCKUP.markScale,
    ).toBeCloseTo(0, 6);
    // The top of the box is the wordmark ascender, not a removed pennant tip.
    expect(LOCKUP.markY + g.ink.y * LOCKUP.markScale).toBeCloseTo(-symbolHeight, 6);
    expect(LOCKUP.viewBox.y).toBe(WORDMARK_BOX.y);
    expect(LOCKUP.viewBox.height).toBe(WORDMARK_BOX.height);
    expect(LOCKUP.viewBox.width).toBeCloseTo(LOCKUP.wordmarkX + WORDMARK_BOX.width, 6);
    expect(LOCKUP_ASPECT).toBeCloseTo(LOCKUP.viewBox.width / LOCKUP.viewBox.height, 8);
  });

  it('ships as a single SVG with the plate, the W and the wordmark', () => {
    const svg = renderLockupSvg({ height: 36 });
    // the W's mask stroke + the plate + the wordmark lettering. The removed
    // pennant would be a fourth path.
    expect(svg.match(/<path/g)).toHaveLength(3);
    expect(svg.match(/<circle/g)).toBeNull();
    expect(svg.match(/<rect/g)).toHaveLength(2); // mask ground + full stop
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('background');
  });
});

describe('the in-app mark uses tokens, never literals', () => {
  it('has no background tile unless the caller asks for one', () => {
    const bare = renderMarkSvg({ size: 32 });
    // The only `<rect>` in a bare mark is the mask's white ground (no `rx`).
    expect(bare).not.toContain('rx=');
    const tiled = renderMarkSvg({ size: 32, background: '#FFF7EE' });
    expect(tiled).toContain('<rect width="32" height="32" rx="0"');
  });

  it('paints the plate with --brand-dot and no second ink shape', () => {
    const svg = renderInAppMarkSvg();
    // One painted shape: the accent plate. The W is a mask cut, so there is no
    // second `currentColor` shape and no even-odd compound path.
    expect(svg).toContain('hsl(var(--brand-dot))');
    expect(svg).not.toContain('currentColor');
    expect(svg).not.toContain('fill-rule');
    expect(svg.match(/<path/g)).toHaveLength(2);
    for (const forbidden of ['filter', 'Gradient', 'gradient']) {
      expect(svg, forbidden).not.toContain(forbidden);
    }
    // The `#` in `mask="url(#…)"` is a reference, not a colour literal.
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // The one stroke in the file is the mask cut (black = punched out), not a
    // painted outline: an outline would be a third colour on the mark.
    expect(svg.match(/stroke="/g)).toHaveLength(1);
    expect(svg).toContain('stroke="black"');
    expect(BRAND_FILL.body).toBe('hsl(var(--brand-body))');
    expect(BRAND_FILL.dot).toBe('hsl(var(--brand-dot))');
  });

  it('never emits a background square by default', () => {
    for (const size of [16, 20, 24, 32, 48, 64]) {
      expect(renderMarkSvg({ size })).not.toContain('rx=');
    }
  });
});

describe('the React components draw the W as well', () => {
  it('cuts the letter in both variants and both cuts', () => {
    const full = markGeometryForSize(32);
    const small = markGeometryForSize(16);

    const colour = renderToStaticMarkup(React.createElement(WarrlyMark, { size: 32 }));
    expect(colour).toContain(full.letter);
    expect(colour).toContain(`stroke-width="${full.letterWidth}"`);
    expect(colour).toContain('stroke-linecap="round"');
    expect(colour).toContain('stroke-linejoin="round"');
    expect(colour).toContain('mask="url(#warrly-mark-cut-full)"');
    // One plate path; the W's mask stroke is the only other path.
    expect(colour.match(/<path/g)).toHaveLength(2);

    const mono = renderToStaticMarkup(
      React.createElement(WarrlyMark, { size: 32, variant: 'mono' }),
    );
    expect(mono).toContain(full.letter);
    // A mono W painted `currentColor` would sit in a `currentColor` plate and
    // disappear; only a cut-out keeps it visible in a one-colour mark.
    expect(mono).not.toContain('stroke="currentColor"');
    expect(mono).toContain('stroke="black"');

    const smallMark = renderToStaticMarkup(React.createElement(WarrlyMark, { size: 16 }));
    expect(smallMark).toContain(small.letter);
    expect(smallMark).toContain(`stroke-width="${small.letterWidth}"`);
    expect(smallMark).toContain('mask="url(#warrly-mark-cut-small)"');
  });

  it('cuts the letter inside the lockup too', () => {
    const html = renderToStaticMarkup(React.createElement(WarrlyLockup, { height: 36 }));
    const geometry = markGeometryForSize(32);
    expect(html).toContain(geometry.letter);
    expect(html).toContain(`stroke-width="${geometry.letterWidth}"`);
    expect(html).toContain('mask="url(#warrly-lockup-cut-full)"');
  });
});
