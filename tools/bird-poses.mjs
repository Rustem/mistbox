// Poses of the Mist Bird in the chosen treatment (Option 3, gold contour).
//
//   node tools/bird-poses.mjs                 # the adopted anatomy
//   BIRD_BILL=long node tools/bird-poses.mjs  # the artboard's original bill
//
// Each pose is the same geometry under two levers — a body tilt and a wing
// rotation about the shoulder — plus whatever it is carrying. No anatomy is
// redrawn, so every pose is provably the same bird rather than a lookalike.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  BILL, DEFAULT_BILL, POSES as ART, FOREST, GOLD, PAPER, FIR, SAGE, SANS,
  AUTOFRAME, shoot,
} from './lib/bird.mjs';

const ROOT = path.join(import.meta.dirname, '..');
// The adopted bill renders to docs/bird/poses/; any other variant gets its own
// folder, so a comparison never overwrites the real set.
const VARIANT = process.env.BIRD_BILL ?? 'true';
const OUT = path.join(ROOT, 'docs', 'bird', VARIANT === 'true' ? 'poses' : `poses-${VARIANT}`);
const TIP = BILL[VARIANT] ?? DEFAULT_BILL;

// Every pose is composed in lib/bird.mjs; this file only frames and labels
// them. `tip` is threaded through so the bill-variant folders still work.
const art = (name) => () => ART[name]({ tip: TIP });

// ------------------------------------------------------------------- poses

const POSES = [
  {
    id: '1-hover',
    name: 'Hover',
    use: 'The mark itself',
    note:
      'Option 3 exactly as you chose it. This is the masthead bird and the one every other pose is derived from.',
    art: art('hover'),
  },
  {
    id: '2-carry-parcel',
    name: 'Carry — the box on a ribbon',
    use: 'Shipped / on its way',
    note:
      'Nose up under the weight, the box swinging below on a ribbon. The ribbon is drawn before the bird so it disappears under the bill rather than crossing it.',
    art: art('carry'),
  },
  {
    id: '3-carry-tucked',
    name: 'Carry — held close',
    use: 'Shipped, at small sizes',
    note:
      'The same delivery, but the box is smaller and rides just forward of the bill. A compact silhouette that still reads when the whole bird is 120px wide.',
    art: art('tucked'),
  },
  {
    id: '4-carry-tag',
    name: 'Carry — the gift tag',
    use: 'Gift message / a gift is on its way',
    note:
      'The pose from the original canvas, in gold contour: a strung gift tag rather than a box. Lighter than the parcel, and it says "gift" rather than "parcel".',
    art: art('tag'),
  },
  {
    id: '5-climb',
    name: 'Climb',
    use: 'Welcome / order confirmed',
    note:
      'Steep nose-up with the wing on a full upstroke. Reads as beginning, not arriving — the right bird for the top of a first email.',
    art: art('climb'),
  },
  {
    id: '6-alight',
    name: 'Alight',
    use: 'Out for delivery / arriving today',
    note:
      'Nose down on the approach, wing held high to brake. Same wing as Climb, opposite body angle — the pair reads as departure and arrival.',
    art: art('alight'),
  },
  {
    id: '7-perch',
    name: 'Perched on the box',
    use: 'Delivered',
    note:
      'Body swung upright, wing folded back along the tail, standing on a closed parcel. The only pose that needed a part the artboard did not have — the two legs.',
    art: art('perch'),
  },
];

// ------------------------------------------------------------------ render

const svgOf = (pose, attrs) =>
  `<svg data-auto ${attrs} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mist Bird, ${pose.name}"><g>${pose.art()}</g></svg>`;

const SHELL = (body) => `<!doctype html><meta charset="utf-8">
<style>
  body { margin:0; background:#EFE9DE; font-family:${SANS}; }
  .label { font:600 11px ${SANS}; letter-spacing:.18em; text-transform:uppercase;
           color:${GOLD}; background:${FOREST}; padding:12px 18px; }
  .use { color:${SAGE}; }
  .stage { background:${PAPER}; padding:44px 40px; display:flex; justify-content:center; }
  .note { background:#fff; padding:16px 20px; font:14px/1.65 ${SANS}; color:${FIR}; }
</style>${body}${AUTOFRAME}`;

const posePage = (pose) => SHELL(`<div style="width:720px;margin:0 auto;padding:34px 0 40px">
  <div class="label">${pose.name} <span class="use">· ${pose.use}</span></div>
  <div class="stage">${svgOf(pose, 'style="width:520px;height:auto;display:block"')}</div>
  <div class="note" style="margin-top:22px">${pose.note}</div>
</div>`);

function sheetPage() {
  const cells = POSES.map(
    (p) => `<div style="display:flex;flex-direction:column;align-items:center;gap:14px">
      <div style="height:150px;display:flex;align-items:center">
        ${svgOf(p, 'style="height:150px;width:auto;display:block"')}
      </div>
      <div style="font:600 10px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${FOREST};text-align:center">${p.name}</div>
      <div style="font:11px ${SANS};color:${SAGE};text-align:center;margin-top:-8px">${p.use}</div>
    </div>`,
  ).join('');

  return SHELL(`<div style="width:1240px;margin:0 auto;padding:34px 0 44px">
  <div class="label">All seven, same scale, same bird</div>
  <div style="background:${PAPER};padding:44px 34px;display:grid;
              grid-template-columns:repeat(4,1fr);gap:48px 24px">${cells}</div>
  <div class="note" style="margin-top:22px">
    Every pose is the Option&nbsp;3 geometry under a body tilt and a wing rotation about the shoulder —
    no anatomy was redrawn, so these are one bird in seven attitudes rather than seven drawings of a bird.
  </div>
</div>`);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
for (const pose of POSES) await shoot(browser, { html: posePage(pose), file: pose.id, width: 720, dir: OUT });
await shoot(browser, { html: sheetPage(), file: '0-all-poses', width: 1240, dir: OUT });
await browser.close();

console.log(`\n${POSES.length} poses + contact sheet in ${path.relative(ROOT, OUT)}/ (bill: ${VARIANT})`);
