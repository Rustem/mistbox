// Where does the bird go? Four arrangements, each rendered as a real 600px
// email top so they are judged at the size an inbox shows them.
//
//   node tools/bird-masthead.mjs
//
// The masthead markup here mirrors `shell()` in
// storefront/src/lib/email/layout.ts — same widths, same padding, same type —
// so what you see is what that file would produce, not an idealised mock.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { AUTOFRAME, bird, shoot } from './lib/bird.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs', 'bird');

// Straight from layout.ts, so the comparison cannot drift from the real thing.
const FOREST = '#2b3a31';
const FIR = '#4a5d4e';
const SAGE = '#8fa394';
const GOLD = '#c6a462';
const BONE = '#efe9de';
const PAPER = '#f7f4ed';
const SERIF = "Georgia, 'Cormorant Garamond', 'Times New Roman', serif";
const SANS = "'Futura', 'Century Gothic', 'Avenir Next', Helvetica, Arial, sans-serif";

const emblem64 = fs
  .readFileSync(path.join(ROOT, 'storefront/public/emblem.png'))
  .toString('base64');

const EMBLEM = `<img src="data:image/png;base64,${emblem64}" width="66" height="84" alt=""
     style="display:block;margin:0 auto 24px;border:0;outline:none;">`;

const BIRD = (width, opts = {}) =>
  `<svg data-auto xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mist Bird"
        style="width:${width}px;height:auto;display:block;margin:0 auto 24px"><g>${bird(opts)}</g></svg>`;

const WORDMARK = `<div style="font-family:${SERIF};font-weight:400;font-size:30px;line-height:1.1;
     letter-spacing:0.38em;text-indent:0.38em;text-transform:uppercase;color:${FOREST};">Mistbox</div>
  <div style="height:1px;width:52px;background:${GOLD};margin:22px auto 0;line-height:1px;font-size:0;">&nbsp;</div>`;

const NEWS = `
  <tr>
    <td align="center" style="padding:34px 40px 0;">
      <div style="font-family:${SERIF};font-size:34px;line-height:1.2;color:${FOREST};">Your box is confirmed.</div>
      <div style="padding-top:16px;font-family:${SANS};font-size:16px;line-height:1.75;color:${FIR};max-width:400px;margin:0 auto;">
        Thank you — this is the receipt. We will write to you once more on the day it ships.
      </div>
    </td>
  </tr>`;

/** One 600px email top, built the way layout.ts builds it. */
const email = ({ masthead, hero = '' }) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
         style="width:600px;background:${PAPER};">
    <tr><td align="center" style="padding:48px 40px 0;">${masthead}</td></tr>
    ${NEWS}
    ${hero}
    <tr><td style="height:44px;line-height:44px;font-size:0;">&nbsp;</td></tr>
  </table>`;

const PANELS = [
  {
    key: 'A',
    name: 'As we send today',
    verdict: 'the baseline',
    ok: null,
    note: 'Emblem at 66×84, wordmark, hairline. No bird at all — this is what goes out now.',
    html: email({ masthead: EMBLEM + WORDMARK }),
  },
  {
    key: 'B',
    name: 'Bird replaces the emblem, same size',
    verdict: 'does not work',
    ok: false,
    note:
      'The obvious swap, and the one to rule out. At 66px the gold contour is below its legibility floor — it reads as a smudge where the arch read as a mark.',
    html: email({ masthead: BIRD(66) + WORDMARK }),
  },
  {
    key: 'C',
    name: 'Bird replaces the emblem, sized up',
    verdict: 'bird-led masthead',
    ok: true,
    note:
      'The bird at 180px, the size it actually needs. Confident and unmistakably ours, but the masthead is now the bird every single time — and the arch retires.',
    html: email({ masthead: BIRD(180) + WORDMARK }),
  },
  {
    key: 'D',
    name: 'Emblem keeps the masthead, bird is the hero',
    verdict: 'both, with jobs',
    ok: true,
    note:
      'Masthead untouched — the emblem stays the constant that says Mistbox. The bird appears once below the news, at 200px, in the pose that fits that email. Here: Climb, for a confirmation.',
    html: email({
      masthead: EMBLEM + WORDMARK,
      hero: `<tr><td align="center" style="padding:38px 40px 0;">
               ${BIRD(200, { tilt: 26, wing: -26 })}</td></tr>`,
    }),
  },
];

const cells = PANELS.map(
  (p) => `<div>
    <div style="background:${FOREST};padding:12px 18px;display:flex;justify-content:space-between;align-items:baseline">
      <span style="font:600 11px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${GOLD}">
        ${p.key} · ${p.name}</span>
      <span style="font:11px ${SANS};letter-spacing:.1em;text-transform:uppercase;
                   color:${p.ok === false ? '#E0A08C' : '#9FB2A4'}">${p.verdict}</span>
    </div>
    <div style="background:${BONE};padding:26px 0;display:flex;justify-content:center">${p.html}</div>
    <div style="background:#fff;padding:16px 20px;font:14px/1.65 ${SANS};color:${FIR}">${p.note}</div>
  </div>`,
).join('');

const page = `<!doctype html><meta charset="utf-8">
<style>body { margin:0; background:${BONE}; font-family:${SANS}; }</style>
<div style="width:1380px;margin:0 auto;padding:34px 0 40px">
  <div style="font:600 11px ${SANS};letter-spacing:.18em;text-transform:uppercase;
              color:${GOLD};background:${FOREST};padding:12px 18px">
    Where the bird goes · four arrangements at true email width
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:22px;align-items:start">${cells}</div>
  <div style="background:#fff;padding:18px 22px;margin-top:26px;font:14px/1.7 ${SANS};color:${FIR}">
    <strong>One constraint that decides more than taste:</strong> the gold contour needs roughly 180px
    to hold, and the emblem's slot is 66px. So "put the bird in the masthead" is really "make the
    masthead about three times taller" — B shows why there is no small version. Note also that the bird
    would ship as a PNG, not inline SVG: Gmail and Outlook strip SVG, which is why
    <code>emblem.png</code> is a PNG today.
  </div>
</div>${AUTOFRAME}`;

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
await shoot(browser, { html: page, file: 'masthead-options', width: 1380, dir: OUT });
await browser.close();
