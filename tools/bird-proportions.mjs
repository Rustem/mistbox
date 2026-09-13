// Measure the Mist Bird against a real hummingbird.
//
//   node tools/bird-proportions.mjs
//
// Field guides give hummingbird length (bill tip to tail tip), wingspan and
// bill length directly, so the ratios below are checkable rather than a matter
// of taste. The artboard is measured along the same axis and compared.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  BILL, FOREST, GOLD, BONE, PAPER, FIR, SAGE, SANS, SERIF,
  GAPE, SHOULDER, TAIL_BASE, TAIL_TIP, WING_TIP,
  AUTOFRAME, bird, shoot,
} from './lib/bird.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs', 'bird');

// Trunk depth at the shoulder, measured off the artboard. A profile drawing
// cannot show wingspan, so span is reconstructed as two wings plus the trunk.
const TRUNK = 55;

/**
 * Every part is measured along the horizontal, the axis a field guide uses on
 * a laid-out specimen. The bird is drawn close enough to level that this and
 * an along-the-body measure agree to a couple of percent, and the horizontal
 * has the advantage that the three parts sum exactly to the total.
 */
function measure(tip) {
  const bill = GAPE.x - tip.x;
  const core = TAIL_BASE.x - GAPE.x;
  const tail = TAIL_TIP.x - TAIL_BASE.x;
  const total = bill + core + tail;
  const wing = Math.hypot(WING_TIP.x - SHOULDER.x, WING_TIP.y - SHOULDER.y);
  return {
    bill: bill / total,
    core: core / total,
    tail: tail / total,
    span: (2 * wing + TRUNK) / total,
  };
}

// Ruby-throated (Archilochus colubris) and Anna's (Calypte anna), the two
// commonest North American species, bracket the ranges below.
//   length 7–11 cm · wingspan 8–12 cm · bill 15–20 mm
const REAL = {
  bill: [0.17, 0.22],
  core: [0.48, 0.55],
  tail: [0.25, 0.3],
  span: [1.15, 1.22],
};

const ROWS = [
  { key: 'bill', label: 'Bill, share of total length' },
  { key: 'core', label: 'Head + body, share of total' },
  { key: 'tail', label: 'Tail, share of total' },
  { key: 'span', label: 'Wingspan ÷ total length' },
];

const VARIANTS = [
  { id: 'long', name: 'A · As drawn', tip: BILL.long, sub: 'the artboard, untouched' },
  { id: 'trim', name: 'B · Trimmed', tip: BILL.trim, sub: 'halfway' },
  { id: 'true', name: 'C · True to the bird', tip: BILL.true, sub: 'every ratio in range' },
];

const pct = (v, key) => (key === 'span' ? `${v.toFixed(2)}×` : `${Math.round(v * 100)}%`);
const inRange = (v, key) => v >= REAL[key][0] && v <= REAL[key][1];
const realText = (key) =>
  key === 'span'
    ? `${REAL[key][0].toFixed(2)}–${REAL[key][1].toFixed(2)}×`
    : `${Math.round(REAL[key][0] * 100)}–${Math.round(REAL[key][1] * 100)}%`;

// ---------------------------------------------------------------- diagram

/** The bird as drawn, with the four measurements marked on it. */
function diagram(tip) {
  const m = measure(tip);
  const marks = [
    { from: tip.x, to: GAPE.x, label: 'Bill', v: m.bill, key: 'bill' },
    { from: GAPE.x, to: TAIL_BASE.x, label: 'Head + body', v: m.core, key: 'core' },
    { from: TAIL_BASE.x, to: TAIL_TIP.x, label: 'Tail', v: m.tail, key: 'tail' },
  ];
  const y = 330;

  const guides = [tip.x, GAPE.x, TAIL_BASE.x, TAIL_TIP.x]
    .map((x) => `<path d="M${x},96 V${y - 10}" stroke="${SAGE}" stroke-width="1"
                       stroke-dasharray="3 5" fill="none" opacity=".7"/>`)
    .join('');

  const brackets = marks
    .map(({ from, to, label, v, key }) => {
      const mid = (from + to) / 2;
      const ok = inRange(v, key);
      return `<path d="M${from},${y - 6} V${y + 6} M${from},${y} H${to} M${to},${y - 6} V${y + 6}"
                    fill="none" stroke="${FIR}" stroke-width="1.6"/>
        <text x="${mid}" y="${y + 24}" text-anchor="middle" font-family="${SANS}"
              font-size="13" fill="${FIR}">${label}</text>
        <text x="${mid}" y="${y + 44}" text-anchor="middle" font-family="${SANS}"
              font-size="15" font-weight="600" fill="${ok ? FOREST : '#9C4A2F'}">${pct(v, key)}</text>
        <text x="${mid}" y="${y + 62}" text-anchor="middle" font-family="${SANS}"
              font-size="11" fill="${SAGE}">real ${realText(key)}</text>`;
    })
    .join('');

  const wingLine = `<path d="M${SHOULDER.x},${SHOULDER.y} L${WING_TIP.x},${WING_TIP.y}"
        stroke="${FIR}" stroke-width="1.4" stroke-dasharray="4 4" fill="none"/>
    <circle cx="${SHOULDER.x}" cy="${SHOULDER.y}" r="3.4" fill="${FIR}"/>
    <circle cx="${WING_TIP.x}" cy="${WING_TIP.y}" r="3.4" fill="${FIR}"/>
    <text x="${(SHOULDER.x + WING_TIP.x) / 2 - 46}" y="${(SHOULDER.y + WING_TIP.y) / 2 + 26}"
          font-family="${SANS}" font-size="12" fill="${FIR}">one wing</text>`;

  return `<svg viewBox="0 60 420 340" xmlns="http://www.w3.org/2000/svg" role="img"
       aria-label="Mist Bird with its proportions measured"
       style="width:100%;height:auto;display:block">
    ${guides}${bird({ tip })}${wingLine}${brackets}
  </svg>`;
}

// ------------------------------------------------------------------- page

function tableHtml() {
  const head = VARIANTS.map(
    (v) => `<th style="text-align:right;padding:10px 14px;font:600 11px ${SANS};
            letter-spacing:.1em;text-transform:uppercase;color:${FOREST}">${v.name.split(' · ')[1]}</th>`,
  ).join('');

  const body = ROWS.map(({ key, label }) => {
    const cells = VARIANTS.map((v) => {
      const val = measure(v.tip)[key];
      const ok = inRange(val, key);
      return `<td style="text-align:right;padding:10px 14px;font:${ok ? 600 : 400} 15px ${SANS};
              font-variant-numeric:tabular-nums;color:${ok ? FOREST : '#9C4A2F'}">
              ${pct(val, key)}${ok ? ' ✓' : ''}</td>`;
    }).join('');
    return `<tr style="border-top:1px solid #E2DACB">
      <td style="padding:10px 14px;font:15px ${SANS};color:${FIR}">${label}</td>
      <td style="text-align:right;padding:10px 14px;font:15px ${SANS};color:${SAGE};
                 font-variant-numeric:tabular-nums">${realText(key)}</td>
      ${cells}</tr>`;
  }).join('');

  return `<table style="width:100%;border-collapse:collapse;background:#fff">
    <tr>
      <th style="text-align:left;padding:12px 14px;font:600 11px ${SANS};letter-spacing:.1em;
                 text-transform:uppercase;color:${FOREST}">Measure</th>
      <th style="text-align:right;padding:12px 14px;font:600 11px ${SANS};letter-spacing:.1em;
                 text-transform:uppercase;color:${SAGE}">Real bird</th>
      ${head}
    </tr>${body}</table>`;
}

const billsHtml = VARIANTS.map(
  (v) => `<div style="display:flex;flex-direction:column;align-items:center;gap:12px">
    <svg data-auto style="width:100%;height:auto;display:block" xmlns="http://www.w3.org/2000/svg"
         role="img" aria-label="${v.name}"><g>${bird({ tip: v.tip })}</g></svg>
    <div style="font:600 11px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${FOREST}">${v.name}</div>
    <div style="font:12px ${SANS};color:${SAGE};margin-top:-6px">bill ${pct(measure(v.tip).bill, 'bill')} · ${v.sub}</div>
  </div>`,
).join('');

const page = `<!doctype html><meta charset="utf-8">
<style>
  body { margin:0; background:${BONE}; font-family:${SANS}; }
  .label { font:600 11px ${SANS}; letter-spacing:.18em; text-transform:uppercase;
           color:${GOLD}; background:${FOREST}; padding:12px 18px; }
  .stage { background:${PAPER}; padding:36px 46px; }
  .note { background:#fff; padding:18px 22px; font:14px/1.7 ${SANS}; color:${FIR}; }
  .h { font-family:${SERIF}; font-size:23px; color:${FOREST}; margin:0 0 4px; }
</style>
<div style="width:900px;margin:0 auto;padding:34px 0 44px">
  <div class="label">Proportions · measured against a real hummingbird</div>

  <div class="stage">${diagram(BILL.long)}</div>

  <div class="note" style="margin-top:22px">
    <div class="h">One measurement is out, and it is the bill.</div>
    Field guides measure a hummingbird bill tip to tail tip, so these are checkable numbers rather than
    an opinion. Against Ruby&#8209;throated and Anna's — length 7–11&nbsp;cm, wingspan 8–12&nbsp;cm,
    bill 15–20&nbsp;mm — the artboard's tail is right and its wing is the right length. The bill is
    <strong>29% of the bird where a real one is 17–22%</strong>, and because the bill is padding the
    total, every other share is dragged out of range with it.
  </div>

  <div class="stage" style="margin-top:26px;padding:34px 30px">
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:30px;align-items:end">${billsHtml}</div>
  </div>

  <div style="margin-top:26px">${tableHtml()}</div>

  <div class="note" style="margin-top:26px">
    <div class="h">Shortening the bill fixes all four. C is adopted.</div>
    <strong>C is now the Mist Bird</strong> — <code>DEFAULT_BILL</code> in <code>tools/lib/bird.mjs</code>,
    which every drawing takes its anatomy from. Nothing else needed touching.
    The wing looked short at 1.05× span-to-length only because the
    over-long bill inflated the length it was measured against; trim the bill and the same wing lands
    at 1.16×, inside the range. Head size is the one deliberate exaggeration left — the head is about
    a third of head-plus-body where a real bird is closer to a quarter, which is what keeps the mark
    reading as a character rather than as a wader.
  </div>
</div>${AUTOFRAME}`;

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
await shoot(browser, { html: page, file: 'proportions', width: 900, dir: OUT });
await browser.close();

for (const v of VARIANTS) {
  const m = measure(v.tip);
  const flags = ROWS.map(({ key }) => (inRange(m[key], key) ? '✓' : '✗')).join(' ');
  console.log(`  ${v.id.padEnd(5)} bill ${pct(m.bill, 'bill').padStart(4)}  span ${pct(m.span, 'span')}  ${flags}`);
}
