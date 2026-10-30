// The generated brand assets, verified as bytes rather than by eye.
//
// The eight shipping defects were all invisible in a type check: transparent
// iOS corners, a transparent PNG pretending to be maskable, a missing
// favicon.ico, and a full-colour badge. This suite decodes the real PNGs and
// reads the real ICO directory, so "opaque", "full-bleed", "inside the 80%
// safe circle" and "white on alpha" are measurements.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { markGeometryForSize } from '@/lib/brand';

const WEBSITE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PUBLIC = join(WEBSITE, 'public');

type Decoded = {
  width: number;
  height: number;
  colorType: number;
  channels: number;
  pixels: Buffer;
  rgb(x: number, y: number): [number, number, number];
  alpha(x: number, y: number): number;
};

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePng(path: string): Decoded {
  return decodePngBuffer(readFileSync(path), path);
}

function decodePngBuffer(buffer: Buffer, label: string): Decoded {
  expect(buffer.subarray(0, 8).toString('hex'), `${label} signature`).toBe(
    '89504e470d0a1a0a',
  );
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  expect(bitDepth, `${label} bit depth`).toBe(8);
  expect(interlace, `${label} interlace`).toBe(0);
  expect([2, 6], `${label} colour type`).toContain(colorType);
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * channels);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const current = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? current[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += Math.floor((a + b) / 2);
      else if (filter === 4) value += paeth(a, b, c);
      else expect(filter, `${label} row ${y} filter`).toBe(0);
      current[x] = value & 0xff;
    }
    current.copy(pixels, y * stride);
    previous = current;
  }
  return {
    width,
    height,
    colorType,
    channels,
    pixels,
    rgb(x, y) {
      const i = (y * width + x) * channels;
      return [pixels[i], pixels[i + 1], pixels[i + 2]];
    },
    alpha(x, y) {
      return channels === 4 ? pixels[(y * width + x) * channels + 3] : 255;
    },
  };
}

const CREAM: [number, number, number] = [255, 247, 238];
const INK: [number, number, number] = [31, 26, 20];
const CORAL: [number, number, number] = [255, 107, 69];

/** The PNG entries inside `public/favicon.ico`, keyed by declared width. */
function icoEntries(path: string): Map<number, Decoded> {
  const ico = readFileSync(path);
  const count = ico.readUInt16LE(4);
  const entries = new Map<number, Decoded>();
  for (let i = 0; i < count; i += 1) {
    const entry = 6 + i * 16;
    const size = ico[entry] === 0 ? 256 : ico[entry];
    const bytes = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    entries.set(
      size,
      decodePngBuffer(
        Buffer.from(ico.subarray(offset, offset + bytes)),
        `favicon.ico ${size}px entry`,
      ),
    );
  }
  return entries;
}

function distance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function near(a: [number, number, number], b: [number, number, number], tolerance = 12): boolean {
  return distance(a, b) <= tolerance;
}

describe('apple-touch-icon.png (defect 1)', () => {
  const icon = decodePng(join(PUBLIC, 'apple-touch-icon.png'));

  it('is exactly 180×180 and fully opaque', () => {
    expect(icon.width).toBe(180);
    expect(icon.height).toBe(180);
    for (const [x, y] of [
      [0, 0],
      [179, 0],
      [0, 179],
      [179, 179],
    ]) {
      expect(icon.alpha(x, y), `corner ${x},${y}`).toBe(255);
    }
    // Every pixel opaque, not just the corners.
    for (let y = 0; y < icon.height; y += 1) {
      for (let x = 0; x < icon.width; x += 1) {
        expect(icon.alpha(x, y), `alpha ${x},${y}`).toBe(255);
      }
    }
  });

  it('is full-bleed cream (no transparent or white padding ring)', () => {
    for (const [x, y] of [
      [0, 0],
      [179, 0],
      [0, 179],
      [179, 179],
      [90, 2],
      [2, 90],
    ]) {
      expect(near(icon.rgb(x, y), CREAM), `${x},${y}`).toBe(true);
    }
  });
});

describe('icon-512.png and icon-maskable-512.png (defect 2)', () => {
  const any = decodePng(join(PUBLIC, 'icon-512.png'));
  const maskable = decodePng(join(PUBLIC, 'icon-maskable-512.png'));

  it('ships two distinct 512 files', () => {
    expect(any.width).toBe(512);
    expect(maskable.width).toBe(512);
    expect(
      readFileSync(join(PUBLIC, 'icon-512.png')).equals(
        readFileSync(join(PUBLIC, 'icon-maskable-512.png')),
      ),
    ).toBe(false);
  });

  it('keeps the `any` icon unrounded and full-bleed', () => {
    for (const [x, y] of [
      [0, 0],
      [511, 0],
      [0, 511],
      [511, 511],
    ]) {
      expect(near(any.rgb(x, y), CREAM), `corner ${x},${y}`).toBe(true);
      expect(any.alpha(x, y)).toBe(255);
    }
    // The glyph is larger than in the maskable cut: it is the `any` icon.
    let anyInk = 0;
    let maskInk = 0;
    for (let y = 0; y < 512; y += 4) {
      for (let x = 0; x < 512; x += 4) {
        if (near(any.rgb(x, y), INK, 30)) anyInk += 1;
        if (near(maskable.rgb(x, y), INK, 30)) maskInk += 1;
      }
    }
    expect(anyInk).toBeGreaterThan(maskInk);
  });

  it('keeps every maskable pixel inside the inner 80% safe circle', () => {
    const radius = 512 * 0.4; // 204.8
    const centre = 256;
    let glyphPixels = 0;
    for (let y = 0; y < 512; y += 1) {
      for (let x = 0; x < 512; x += 1) {
        expect(maskable.alpha(x, y)).toBe(255);
        const pixel = maskable.rgb(x, y);
        if (near(pixel, CREAM, 8)) continue;
        glyphPixels += 1;
        expect(
          Math.hypot(x + 0.5 - centre, y + 0.5 - centre),
          `glyph pixel ${x},${y} escaped the safe circle`,
        ).toBeLessThanOrEqual(radius);
      }
    }
    expect(glyphPixels).toBeGreaterThan(1000);
  });

  it('draws the cream + ink + coral brand palette, not a placeholder', () => {
    let ink = 0;
    let coral = 0;
    for (let y = 0; y < 512; y += 2) {
      for (let x = 0; x < 512; x += 2) {
        const pixel = maskable.rgb(x, y);
        if (near(pixel, INK, 20)) ink += 1;
        if (near(pixel, CORAL, 20)) coral += 1;
      }
    }
    expect(ink).toBeGreaterThan(1000);
    expect(coral).toBeGreaterThan(100);
  });
});

describe('favicon.ico + favicon.svg (defect 3)', () => {
  it('is a real 16/32/48 multi-size ICO with PNG entries', () => {
    const ico = readFileSync(join(PUBLIC, 'favicon.ico'));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1); // type: icon
    const count = ico.readUInt16LE(4);
    expect(count).toBe(3);
    const sizes: number[] = [];
    const entries = new Map<number, Buffer>();
    for (let i = 0; i < count; i += 1) {
      const entry = 6 + i * 16;
      const width = ico[entry] === 0 ? 256 : ico[entry];
      const height = ico[entry + 1] === 0 ? 256 : ico[entry + 1];
      const bytes = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      expect(width).toBe(height);
      sizes.push(width);
      expect(bytes).toBeGreaterThan(0);
      expect(ico.subarray(offset, offset + 8).toString('hex')).toBe(
        '89504e470d0a1a0a',
      );
      entries.set(width, Buffer.from(ico.subarray(offset, offset + bytes)));
    }
    expect(sizes).toEqual([16, 32, 48]);

    // The 16px entry is the SMALL cut, not a downscaled full one. The small
    // pennant starts at x=18.3/32 = 9.15px, so pixel (9,1) is ~85% covered
    // horizontally (× the ~70% coverage of the flag's top row) ≈ 156/255;
    // the full cut starts at 18.9 → ~55% × 70% ≈ 99/255. Measured, not assumed.
    const small = decodePngBuffer(entries.get(16)!, 'favicon.ico 16px entry');
    expect(small.width).toBe(16);
    expect(small.alpha(9, 1)).toBeGreaterThan(130);
    expect(small.alpha(10, 1)).toBeGreaterThan(160);
    const full = decodePngBuffer(entries.get(32)!, 'favicon.ico 32px entry');
    expect(full.width).toBe(32);
  });

  it('ships an adaptive SVG favicon with the SMALL cut', () => {
    const svg = readFileSync(join(PUBLIC, 'favicon.svg'), 'utf8');
    const small = markGeometryForSize(16);
    expect(svg).toContain('<svg');
    expect(svg).toContain('prefers-color-scheme: dark');
    expect(svg).toContain('forced-colors: active');
    // Three paths: the W's mask stroke, the pennant, then the plate. The W is
    // a cut-out, never a painted third path colour.
    expect(svg.match(/<path/g)).toHaveLength(3);
    expect(svg).not.toContain('<circle');
    // The small cut has no punch by design, so the plate is exactly its body.
    expect(small.punch).toBe('');
    expect(svg).toContain(small.body);
    expect(svg).toContain(small.flag);
    expect(svg).toContain(small.letter);
    expect(svg).toContain(`stroke-width="${small.letterWidth}"`);
    expect(svg).toContain('<mask');
    expect(svg).toContain('mask="url(#warrly-favicon-cut)"');
    // The full cut's plate must not be what a 16px tab renders.
    expect(svg).not.toContain(markGeometryForSize(32).body);
    expect(svg.length).toBeGreaterThan(400);
  });
});

describe('notification icon + badge (defect 4)', () => {
  const icon = decodePng(join(PUBLIC, 'notification-icon-192.png'));
  const badge = decodePng(join(PUBLIC, 'notification-badge-96.png'));

  it('ships a 192 colour notification icon', () => {
    expect(icon.width).toBe(192);
    expect(icon.height).toBe(192);
    let coral = 0;
    for (let y = 0; y < 192; y += 1) {
      for (let x = 0; x < 192; x += 1) {
        if (near(icon.rgb(x, y), CORAL, 30)) coral += 1;
      }
    }
    expect(coral).toBeGreaterThan(100);
  });

  it('ships a 96px monochrome badge: every visible pixel is white', () => {
    expect(badge.width).toBe(96);
    expect(badge.height).toBe(96);
    expect(badge.channels).toBe(4);
    let visible = 0;
    let transparent = 0;
    for (let y = 0; y < 96; y += 1) {
      for (let x = 0; x < 96; x += 1) {
        const alpha = badge.alpha(x, y);
        if (alpha === 0) {
          transparent += 1;
          continue;
        }
        visible += 1;
        const [r, g, b] = badge.rgb(x, y);
        expect(Math.min(r, g, b), `badge pixel ${x},${y} is not white`).toBeGreaterThanOrEqual(250);
      }
    }
    expect(visible).toBeGreaterThan(1000);
    expect(transparent).toBeGreaterThan(1000);
  });

  it('knocks the punch out of the badge and keeps the pennant visible', () => {
    // The geometry is imported, not retyped: this checks the RENDERER against
    // the same source rather than against a second copy of the numbers.
    const geometry = markGeometryForSize(32);
    const scale = (96 * 0.92) / 32;
    const offsetX = (96 - geometry.ink.width * scale) / 2 - geometry.ink.x * scale;
    const offsetY = (96 - geometry.ink.height * scale) / 2 - geometry.ink.y * scale;
    const cx = Math.round(offsetX + geometry.punchCircle.cx * scale);
    const cy = Math.round(offsetY + geometry.punchCircle.cy * scale);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        expect(badge.alpha(cx + dx, cy + dy), `punch hole ${cx + dx},${cy + dy}`).toBe(0);
      }
    }
    // The plate between the punch and the W is solid. Derived from the geometry
    // rather than sampled at a fixed offset: the W's apex moved up when the
    // letter became a capital, and a hardcoded "+14px" landed inside it.
    const wTop = Math.round(offsetY + (18.9 - 0.95) * scale);
    const gapY = Math.round((cy + wTop) / 2);
    expect(gapY, 'gap between punch and W exists').toBeGreaterThan(cy);
    expect(badge.alpha(cx + 6, gapY), `plate ${cx + 6},${gapY}`).toBe(255);
    // The pennant above the plate is solid too — it is not knocked out, and
    // the sample sits clear of the swallowtail notch.
    const flagX = Math.round(offsetX + 23 * scale);
    const flagY = Math.round(offsetY + 3.5 * scale);
    expect(badge.alpha(flagX, flagY), `pennant ${flagX},${flagY}`).toBe(255);
  });
});

describe('the W is cut into the generated rasters', () => {
  const full = markGeometryForSize(32);

  /** The polyline points of a letter path (`M x y` then repeated `l dx dy`). */
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
      // SVG repeats the last command for every following coordinate pair, so
      // `l2.7 5.2 2-3.4 …` is four relative linetos, not one.
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

  /**
   * The W's ink position in a `renderIconSvg` tile, derived from the same
   * geometry the generator used: glyph = size × 0.84, centred on the ink box.
   */
  function wPoint(size: number): { x: number; y: number; plateX: number; plateY: number } {
    const scale = (size * 0.84) / full.viewBox;
    const offsetX = (size - full.ink.width * scale) / 2 - full.ink.x * scale;
    const offsetY = (size - full.ink.height * scale) / 2 - full.ink.y * scale;
    const points = letterPoints(full.letter);
    // Midpoint of the W's first down-stroke, whatever the geometry says today.
    const firstMid = {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2,
    };
    return {
      x: Math.round(offsetX + firstMid.x * scale),
      y: Math.round(offsetY + firstMid.y * scale),
      // A plate point above the W, clear of both the punch and the bevel.
      plateX: Math.round(offsetX + 7 * scale),
      plateY: Math.round(offsetY + 17 * scale),
    };
  }

  for (const [file, size] of [
    ['apple-touch-icon.png', 180],
    ['icon-192.png', 192],
    ['icon-512.png', 512],
  ] as const) {
    it(`cuts the W out of ${file}`, () => {
      const icon = decodePng(join(PUBLIC, file));
      const point = wPoint(size);
      expect(
        near(icon.rgb(point.x, point.y), CREAM, 12),
        `W pixel ${point.x},${point.y} in ${file}`,
      ).toBe(true);
      expect(
        near(icon.rgb(point.plateX, point.plateY), INK, 12),
        `plate pixel ${point.plateX},${point.plateY} in ${file}`,
      ).toBe(true);
    });
  }

  it('cuts the W out of the 16px favicon entry', () => {
    const small = icoEntries(join(PUBLIC, 'favicon.ico')).get(16);
    expect(small).toBeDefined();
    // Derive the W's window from the small cut itself, never from retyped
    // coordinates: the 16px entry renders the 32-grid cut at 0.5×.
    const geometry = markGeometryForSize(16);
    const points = letterPoints(geometry.letter);
    const half = geometry.letterWidth / 2;
    const minX = Math.min(...points.map((point) => point.x)) - half;
    const maxX = Math.max(...points.map((point) => point.x)) + half;
    const minY = Math.min(...points.map((point) => point.y)) - half;
    const maxY = Math.max(...points.map((point) => point.y)) + half;
    const scale = 16 / geometry.viewBox;
    let cut = 0;
    for (let y = Math.ceil(minY * scale); y <= Math.floor(maxY * scale); y += 1) {
      for (let x = Math.ceil(minX * scale); x <= Math.floor(maxX * scale); x += 1) {
        if (small!.alpha(x, y) < 200) cut += 1;
      }
    }
    expect(cut, 'transparent W pixels inside the plate').toBeGreaterThanOrEqual(6);
    // The W is a cut, not a hole that eats the tag: the plate to the right of
    // the letter stays opaque.
    expect(small!.alpha(Math.floor((maxX + 0.6) * scale), Math.floor((minY + 1) * scale))).toBe(255);
  });
});

describe('the icon set is complete and referenced', () => {
  it('has every file the manifest and the service worker name', () => {
    for (const file of [
      'favicon.ico',
      'favicon.svg',
      'icon.svg',
      'icon-192.png',
      'icon-512.png',
      'icon-1024.png',
      'icon-maskable-512.png',
      'apple-touch-icon.png',
      'notification-icon-192.png',
      'notification-badge-96.png',
    ]) {
      expect(existsSync(join(PUBLIC, file)), file).toBe(true);
    }
  });
});
