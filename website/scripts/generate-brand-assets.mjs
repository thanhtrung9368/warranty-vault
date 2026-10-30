#!/usr/bin/env node
// Regenerate every raster/SVG brand asset in `public/` from `src/lib/brand.ts`.
//
//   node --experimental-strip-types scripts/generate-brand-assets.mjs
//
// Why headless Chrome and not an image library: the assets must be exactly what
// a browser paints. This renders each SVG at its FINAL pixel size (never a
// downscale) in Chrome, so the cut that ships is the cut the design specifies —
// the small cut for the 16px favicon, the full cut for everything >= 24px.
// `sharp` is only a transitive optional dependency of Next, so relying on it
// here would be a build hazard; Chrome is already required by the verification
// step and by the person running this.
//
// Rules encoded here (each one was a shipped defect):
//   * apple-touch-icon is opaque and full-bleed (iOS masks it; alpha = black ring);
//   * icon-512 is the unrounded opaque `any` icon; the maskable icon is a
//     separate 512 whose whole glyph fits the inner 80% safe circle;
//   * favicon.ico is a real multi-size ICO (16/32/48) and the 16px entry is the
//     SMALL cut; favicon.svg is the small cut too;
//   * the notification badge is monochrome white-on-transparent; the
//     notification icon is full colour;
//   * only these static assets (and /og) may carry literal colours.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CUT_16,
  knockoutPath,
  renderIconSvg,
  renderInAppMarkSvg,
  renderMarkSvg,
  renderNotificationBadgeSvg,
} from '../src/lib/brand.ts';

const WEBSITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(WEBSITE, 'public');

const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// The documented brand literals (the same values globals.css quotes). These are
// the ONLY places a literal colour is allowed.
const CREAM = '#FFF7EE';
const INK = '#1F1A14';
const CORAL = '#FF6B45';

// Glyph size as a fraction of the tile EDGE. 0.84 puts the silhouette at 67% of
// the tile height (the same optical size the previous 16×24 receipt had at its
// 0.882 glyph ratio), while the maskable cut is smaller so its 21.9×25.6
// silhouette stays inside the inner 80% safe circle: its circumscribed radius is
// 0.369 × 512 = 188.8px against the 204.8px limit.
const ANY_GLYPH = 0.84;
const MASKABLE_GLYPH = 0.7;

const CHROME_ARGS = [
  '--headless=new',
  '--remote-debugging-port=0',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  'about:blank',
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPort(userDataDir) {
  const file = join(userDataDir, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(file)) {
      const [port] = (await readFile(file, 'utf8')).split('\n');
      if (port) return Number(port);
    }
    await delay(50);
  }
  throw new Error('Chrome did not open a DevTools port');
}

/** A minimal CDP client: one page target, request/response by id, event waits. */
async function connect(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((target) => target.type === 'page');
  if (!page) throw new Error('Chrome has no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const waiters = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
      else resolve(message.result);
      return;
    }
    const waiting = waiters.get(message.method);
    if (waiting) {
      waiters.delete(message.method);
      waiting(message.params);
    }
  });

  return {
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    once(method) {
      return new Promise((resolve) => waiters.set(method, resolve));
    },
    close() {
      ws.close();
    },
  };
}

function htmlFor(svg) {
  return (
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;padding:0;background:transparent;overflow:hidden}' +
    'svg{display:block}' +
    '</style></head><body>' +
    svg +
    '</body></html>'
  );
}

/** Render one SVG string to PNG bytes at exactly `size` × `size`. */
async function renderPng(cdp, svg, size, { transparent = false } = {}) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: size,
    height: size,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Emulation.setDefaultBackgroundColorOverride', {
    color: transparent
      ? { r: 0, g: 0, b: 0, a: 0 }
      : { r: 255, g: 247, b: 238, a: 255 },
  });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', {
    url: `data:text/html;charset=utf-8,${encodeURIComponent(htmlFor(svg))}`,
  });
  await loaded;
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    omitBackground: transparent,
    clip: { x: 0, y: 0, width: size, height: size, scale: 1 },
  });
  return Buffer.from(data, 'base64');
}

/** Build a real ICO container with PNG-compressed entries (16/32/48). */
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = 6 + directory.length;
  entries.forEach(({ size, png }, index) => {
    const at = index * 16;
    directory[at] = size === 256 ? 0 : size;
    directory[at + 1] = size === 256 ? 0 : size;
    directory[at + 2] = 0; // palette colours
    directory[at + 3] = 0; // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)]);
}

/**
 * The adaptive SVG favicon: the SMALL cut, because a tab favicon is a 16px
 * surface. It is a static asset, so its colours are the documented literals;
 * the coral plate holds on light and dark tabs alike.
 *
 * The W is a mask cut: the tab shows through it, in light and dark alike.
 */
function faviconSvg() {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 32 32" role="img" aria-label="Warrly">\n' +
    '  <style>\n' +
    '    .plate { fill: #FF6B45; }\n' +
    '    @media (forced-colors: active) {\n' +
    '      .plate { fill: CanvasText; }\n' +
    '    }\n' +
    '  </style>\n' +
    '  <defs>\n' +
    '    <mask id="warrly-favicon-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">\n' +
    '      <rect x="0" y="0" width="32" height="32" fill="#fff"/>\n' +
    `      <path d="${CUT_16.letter}" fill="none" stroke="#000" stroke-width="${CUT_16.letterWidth}" stroke-linecap="round" stroke-linejoin="round"/>\n` +
    '    </mask>\n' +
    '  </defs>\n' +
    `  <path class="plate" mask="url(#warrly-favicon-cut)" d="${knockoutPath(CUT_16)}"/>\n` +
    '</svg>\n'
  );
}

const iconSvg = (size, glyphRatio) =>
  renderIconSvg({
    size,
    glyphRatio,
    background: CREAM,
    fills: { body: INK, dot: CORAL },
  });

async function main() {
  if (!existsSync(CHROME)) {
    throw new Error(`Chrome not found at ${CHROME}; set CHROME_PATH`);
  }
  const userDataDir = await mkdtemp(join(tmpdir(), 'warrly-brand-'));
  const chrome = spawn(CHROME, [...CHROME_ARGS, `--user-data-dir=${userDataDir}`], {
    stdio: 'ignore',
  });

  let cdp;
  try {
    const port = await waitForPort(userDataDir);
    cdp = await connect(port);
    await cdp.send('Page.enable');

    const written = [];

    // App icons: opaque, full-bleed, unrounded. The glyph is centred on its
    // visible silhouette (renderIconSvg) at the cut chosen for the glyph size.
    for (const size of [180, 192, 512, 1024]) {
      const png = await renderPng(cdp, iconSvg(size, ANY_GLYPH), size);
      const file = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
      await writeFile(join(PUBLIC, file), png);
      written.push(`${file} ${size}x${size}`);
    }

    // The maskable cut is a DIFFERENT file, not a different manifest field.
    const maskable = await renderPng(cdp, iconSvg(512, MASKABLE_GLYPH), 512);
    await writeFile(join(PUBLIC, 'icon-maskable-512.png'), maskable);
    written.push('icon-maskable-512.png 512x512');

    // Colour notification icon (full-bleed cream, like the app icon).
    const notification = await renderPng(cdp, iconSvg(192, ANY_GLYPH), 192);
    await writeFile(join(PUBLIC, 'notification-icon-192.png'), notification);
    written.push('notification-icon-192.png 192x192');

    // Monochrome white-on-transparent badge. White plate, W knocked out.
    const badge = await renderPng(cdp, renderNotificationBadgeSvg(96), 96, {
      transparent: true,
    });
    await writeFile(join(PUBLIC, 'notification-badge-96.png'), badge);
    written.push('notification-badge-96.png 96x96 (white on alpha)');

    // favicon.ico: three PNG entries, each rendered from the cut for its own
    // pixel size. The 16px entry is the separate small cut.
    const icoEntries = [];
    for (const size of [16, 32, 48]) {
      const png = await renderPng(
        cdp,
        renderMarkSvg({
          size,
          fills: { body: INK, dot: CORAL },
        }),
        size,
        { transparent: true },
      );
      icoEntries.push({ size, png });
    }
    await writeFile(join(PUBLIC, 'favicon.ico'), ico(icoEntries));
    written.push('favicon.ico (16 small cut, 32/48 full cut)');

    // Static SVGs straight from the same geometry.
    await writeFile(join(PUBLIC, 'favicon.svg'), faviconSvg());
    written.push('favicon.svg (small cut, 16px)');
    await writeFile(join(PUBLIC, 'icon.svg'), renderInAppMarkSvg());
    written.push('icon.svg (full cut, currentColor + --brand-dot)');

    for (const line of written) console.log(`  ${line}`);
  } finally {
    if (cdp) cdp.close();
    chrome.kill('SIGKILL');
    await rm(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
