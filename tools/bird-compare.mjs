// The three bills side by side, at one shared scale.
//
//   node tools/bird-compare.mjs
//
// Deliberately NOT auto-framed: every panel uses the same fixed viewBox, so a
// longer bill reads as a longer bill instead of being quietly scaled down to
// match the others.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  BILL, FOREST, GOLD, BONE, PAPER, FIR, SAGE, SANS, SERIF,
  GAPE, TAIL_BASE, TAIL_TIP, bird, shoot,
} from './lib/bird.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs', 'bird');

// One frame for all three panels — the whole point of the comparison.
const VIEW = '4 62 410 250';

const billPct = (tip) =>
  Math.round(((GAPE.x - tip.x) / (GAPE.x - tip.x + TAIL_TIP.x - GAPE.x)) * 100);

const PANELS = [
  { key: 'A', name: 'As drawn', tip: BILL.long, sub: 'the artboard, untouched', ok: false },
  { key: 'B', name: 'Trimmed', tip: BILL.trim, sub: 'halfway', ok: false },
  { key: 'C', name: 'True to the bird', tip: BILL.true, sub: 'every ratio in range', ok: true },
];

/** What the shorter bills give up, drawn as a ghost out to the original tip. */
const ghost = (tip) =>
  tip === BILL.long
    ? ''
    : `<path d="M${tip.x},${tip.y} L${BILL.long.x},${BILL.long.y}" fill="none"
             stroke="${SAGE}" stroke-width="2" stroke-dasharray="4 5" opacity=".85"/>
       <circle cx="${BILL.long.x}" cy="${BILL.long.y}" r="3" fill="${SAGE}"/>`;

const panels = PANELS.map(
  (p) => `<div style="display:flex;flex-direction:column;gap:16px">
    <svg viewBox="${VIEW}" xmlns="http://www.w3.org/2000/svg" role="img"
         aria-label="Mist Bird, ${p.name}"
         style="width:100%;height:auto;display:block">${ghost(p.tip)}${bird({ tip: p.tip })}</svg>
    <div style="border-top:1px solid #DED5C4;padding-top:14px">
      <div style="font:600 12px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${FOREST}">
        ${p.key} · ${p.name}
      </div>
      <div style="font:13px ${SANS};color:${SAGE};margin-top:6px">${p.sub}</div>
      <div style="font:600 26px ${SERIF};color:${p.ok ? FOREST : '#9C4A2F'};margin-top:12px;
                  font-variant-numeric:tabular-nums">
        ${billPct(p.tip)}%<span style="font:13px ${SANS};color:${SAGE};font-weight:400"> bill</span>
      </div>
      <div style="font:12px ${SANS};color:${p.ok ? FIR : '#9C4A2F'};margin-top:4px">
        ${p.ok ? 'all four measures in range' : 'outside 17–22%'}
      </div>
    </div>
  </div>`,
).join('');

const page = `<!doctype html><meta charset="utf-8">
<style>
  body { margin:0; background:${BONE}; font-family:${SANS}; }
</style>
<div style="width:1320px;margin:0 auto;padding:34px 0 40px">
  <div style="font:600 11px ${SANS};letter-spacing:.18em;text-transform:uppercase;
              color:${GOLD};background:${FOREST};padding:12px 18px">
    The bill, three lengths · one shared scale
  </div>
  <div style="background:${PAPER};padding:44px 44px 40px;display:grid;
              grid-template-columns:repeat(3,1fr);gap:44px">${panels}</div>
  <div style="background:#fff;padding:18px 22px;margin-top:22px;font:14px/1.7 ${SANS};color:${FIR}">
    Same body, same head, same wing, same tail — only the bill tip moves. The dotted line shows what
    B and C give up. A real hummingbird's bill is 17–22% of its total length; at 29% the artboard's
    inflates the total, which is why the wing measured short at 1.05× span-to-length. At C the wing
    is untouched and lands at 1.16×, inside the range.
  </div>
</div>`;

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
await shoot(browser, { html: page, file: 'bill-comparison', width: 1320, dir: OUT });
await browser.close();
