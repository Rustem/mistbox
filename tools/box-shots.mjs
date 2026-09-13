// Fallback card art for a box nobody has photographed.
//
//   node tools/box-shots.mjs
//
// Daniya composes boxes in the Saleor dashboard, and she is not going to
// photograph a box she invented five minutes ago. Without a shot those cards
// collapse to text beside photographed ones and read as broken. These are the
// stand-in: the same bird, on the same forest ground as the email hero band, so
// an unphotographed box looks deliberate instead of unfinished.
//
// Forest and not bone, for the reason everything else in this palette is:
// gold measures 5.07:1 on forest and 1.96:1 on bone.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { AUTOFRAME, FOREST, GOLD, POSES } from './lib/bird.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'storefront', 'public');

// 4:3, matching `.tier__shot`'s aspect-ratio so nothing is cropped.
const W = 1200;
const H = 900;

// Three, so a shop with several unphotographed boxes does not show one picture
// three times. Which one a box gets is decided by its slug, not at random —
// the same box keeps the same art on every render.
const SHOTS = [
  { file: 'box-shot-1', pose: 'perch', scale: 0.62 },
  { file: 'box-shot-2', pose: 'carry', scale: 0.72 },
  { file: 'box-shot-3', pose: 'tag', scale: 0.66 },
];

const page = (s) => `<!doctype html><meta charset="utf-8">
<style>
  html,body { margin:0; }
  .card { width:${W}px; height:${H}px; background:${FOREST};
          display:flex; align-items:center; justify-content:center; position:relative; }
  /* A hairline inset, the same device the real box photography uses. */
  .card::after { content:''; position:absolute; inset:34px; border:1px solid ${GOLD}; opacity:.34; }
  svg { width:${Math.round(W * s.scale)}px; height:auto; display:block; }
</style>
<div class="card"><svg data-auto xmlns="http://www.w3.org/2000/svg" role="img"
     aria-label="A Mistbox, illustrated"><g>${POSES[s.pose]()}</g></svg></div>
${AUTOFRAME}`;

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const s of SHOTS) {
  const src = path.join(OUT, `${s.file}.html`);
  fs.writeFileSync(src, page(s));
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(`file://${src}`, { waitUntil: 'networkidle' });
  await p.locator('.card').screenshot({ path: path.join(OUT, `${s.file}.png`) });
  await ctx.close();
  fs.unlinkSync(src);
  const { size } = fs.statSync(path.join(OUT, `${s.file}.png`));
  console.log(`  public/${s.file}.png  ${W}×${H}  ${(size / 1024).toFixed(1)} kB  · ${s.pose}`);
}

await browser.close();
