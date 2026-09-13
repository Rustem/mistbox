// Render the Mist Bird to the PNGs the emails actually ship.
//
//   node tools/bird-assets.mjs
//
// Gmail and Outlook strip inline SVG, which is why emblem.png is a PNG; the
// bird is no different. Everything lands in storefront/public/ at 2× with a
// transparent ground, so the hero art sits on the forest band without a halo.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { AUTOFRAME, FOIL, POSES } from './lib/bird.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'storefront', 'public');

// Display width in the email × 2, so the art is sharp on a retina screen.
const ASSETS = [
  { file: 'bird-climb', pose: 'climb', width: 400, use: 'order confirmed' },
  { file: 'bird-carry', pose: 'carry', width: 420, use: 'shipped' },
  { file: 'bird-perch', pose: 'perch', width: 400, use: 'delivered' },
  { file: 'bird-tag', pose: 'tag', width: 400, use: 'gift message' },
  { file: 'bird-hover', pose: 'hover', width: 400, use: 'newsletter, general' },
  // The signature mark is tiny, so it takes the foil cut: the gold contour
  // measures 1.96:1 on paper and dissolves at this size.
  { file: 'bird-sign', pose: 'hover', width: 92, opts: { tilt: 6, ...FOIL }, use: 'sign-off' },
];

const page = (a) => `<!doctype html><meta charset="utf-8">
<style>html,body { margin:0; background:transparent; }</style>
<svg data-auto id="art" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The Mist Bird"
     style="width:${a.width}px;height:auto;display:block"><g>${POSES[a.pose](a.opts ?? {})}</g></svg>
${AUTOFRAME}`;

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const a of ASSETS) {
  const src = path.join(OUT, `${a.file}.html`);
  fs.writeFileSync(src, page(a));
  const ctx = await browser.newContext({ viewport: { width: 700, height: 500 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(`file://${src}`, { waitUntil: 'networkidle' });
  await p.locator('#art').screenshot({
    path: path.join(OUT, `${a.file}.png`),
    omitBackground: true, // the band's forest shows through, not a bone rectangle
  });
  await ctx.close();
  fs.unlinkSync(src);
  const { size } = fs.statSync(path.join(OUT, `${a.file}.png`));
  console.log(`  public/${a.file}.png  ${a.width}px  ${(size / 1024).toFixed(1)} kB  · ${a.use}`);
}

await browser.close();
