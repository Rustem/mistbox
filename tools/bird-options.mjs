// Render the three Mist Bird treatments as real email mastheads, one image
// each, so the choice is made on what an inbox shows rather than on a canvas.
//
//   node tools/bird-options.mjs
//
// The bird artwork is lifted from the "Mist Bird" design canvas artboards
// (Ink / Foil / Main .dc.html), which are the source of truth for the geometry.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.join(import.meta.dirname, '..');
const ART = process.env.BIRD_ART ?? path.join(ROOT, 'docs', 'bird', 'art');
const OUT = path.join(ROOT, 'docs', 'bird');

const FOREST = '#2B3A31';
const GOLD = '#C6A462';
const BONE = '#EFE9DE';
const PAPER = '#F7F4ED';
const FIR = '#4A5D4E';
const SAGE = '#8FA394';
const SERIF = "Georgia,'Cormorant Garamond',serif";
const SANS = "'Futura','Century Gothic','Avenir Next',Helvetica,sans-serif";

const svgOf = (file) =>
  /(<svg[\s\S]*?<\/svg>)/.exec(fs.readFileSync(path.join(ART, file), 'utf8'))[1];

const emblem = fs.readFileSync(path.join(ROOT, 'storefront/public/emblem.png')).toString('base64');

const OPTIONS = [
  {
    id: '1-ink-and-gold',
    name: 'Ink & gold',
    art: 'Ink.dc.html',
    verdict: 'Recommended for email',
    why: 'Forest line at 9.9:1 against the ground, with the gold beak as the single metal accent. Holds at hero size and still reads at 120px. Its one weakness is that the gold beak fades before the body does when it goes small.',
  },
  {
    id: '2-foil-silhouette',
    name: 'Foil silhouette',
    art: 'Foil.dc.html',
    verdict: 'The only one that survives small',
    why: 'The lid colourway exactly — forest filled, gold edged. Legible at every size including 32px, so it is the natural favicon and avatar mark. Heavier and less airy than the line versions.',
  },
  {
    id: '3-gold-contour',
    name: 'Gold contour',
    art: 'Main.dc.html',
    verdict: 'Beautiful in print, weak on screen',
    why: 'The canvas lead. As foil on paper it is metallic and catches light; as #C6A462 pixels on bone it measures 1.96:1 and starts ghosting by 180px. Included so the difference is visible rather than argued.',
  },
];

const SIZES = [180, 120, 64, 32];

function page(option) {
  const bird = svgOf(option.art);
  const ladder = SIZES.map(
    (w) => `
      <td style="padding:0 22px;vertical-align:bottom;text-align:center">
        <div style="width:${w}px">${bird}</div>
        <div style="font:11px ${SANS};color:${SAGE};padding-top:8px">${w}px</div>
      </td>`,
  ).join('');

  return `<!doctype html><meta charset="utf-8">
<style>
  body { margin:0; background:${BONE}; font-family:${SANS}; }
  svg { width:100%; height:auto; display:block; }
  .frame { width:760px; margin:0 auto; padding:34px 0 40px; }
  .label { font:600 11px ${SANS}; letter-spacing:.18em; text-transform:uppercase;
           color:${GOLD}; background:${FOREST}; padding:12px 18px; }
  .mail { background:${PAPER}; width:600px; margin:0 auto; padding:48px 40px 40px;
          text-align:center; box-sizing:border-box; }
  .note { width:600px; margin:0 auto; background:#fff; padding:16px 20px; box-sizing:border-box;
          font:14px/1.65 ${SANS}; color:${FIR}; }
  .verdict { font:600 11px ${SANS}; letter-spacing:.14em; text-transform:uppercase;
             color:${FOREST}; margin-bottom:6px; }
  .sizes { width:600px; margin:26px auto 0; background:#fff; padding:22px 10px 16px;
           box-sizing:border-box; }
  .sizes h3 { font:600 10px ${SANS}; letter-spacing:.16em; text-transform:uppercase;
              color:${SAGE}; margin:0 0 14px; padding-left:12px; }
</style>
<div class="frame">
  <div class="label" style="width:600px;margin:0 auto">Option ${option.id[0]} · ${option.name}</div>

  <div class="mail">
    <div style="width:190px;margin:0 auto 22px">${bird}</div>
    <div style="font-family:${SERIF};font-weight:400;font-size:30px;line-height:1.1;
                letter-spacing:.38em;text-indent:.38em;text-transform:uppercase;color:${FOREST}">Mistbox</div>
    <div style="height:1px;width:52px;background:${GOLD};margin:22px auto 0"></div>

    <div style="font-family:${SERIF};font-size:34px;line-height:1.2;color:${FOREST};padding-top:34px">
      Your box is confirmed.
    </div>
    <div style="font-family:${SANS};font-size:16px;line-height:1.75;color:${FIR};
                max-width:400px;margin:16px auto 0">
      Thank you — this is the receipt. We will write to you once more on the day it ships.
    </div>
  </div>

  <div class="sizes">
    <h3>The same mark at the sizes an inbox uses — 1×, no retina help</h3>
    <table style="border-collapse:collapse;margin:0 auto"><tr>${ladder}</tr></table>
  </div>

  <div class="note" style="margin-top:26px">
    <div class="verdict">${option.verdict}</div>
    ${option.why}
  </div>
</div>`;
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const option of OPTIONS) {
  const file = path.join(OUT, `${option.id}.html`);
  fs.writeFileSync(file, page(option));
  const ctx = await browser.newContext({ viewport: { width: 760, height: 1200 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(`file://${file}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  // Clip to the frame so the image ends where the content does, rather than
  // carrying the viewport's leftover height as dead ground.
  const frame = await p.locator('.frame').boundingBox();
  await p.screenshot({
    path: path.join(OUT, `${option.id}.png`),
    clip: { x: 0, y: 0, width: 760, height: Math.ceil(frame.y + frame.height) },
  });
  await ctx.close();
  fs.unlinkSync(file);
  console.log(`  docs/bird/${option.id}.png`);
}

await browser.close();
console.log(`\n${OPTIONS.length} options in docs/bird/`);
