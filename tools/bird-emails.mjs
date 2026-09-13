// The Mist Bird doing the job MINT's fox does — three real emails.
//
//   node tools/bird-emails.mjs
//
// The MINT pattern, reduced to its three working parts:
//   1. the brand wordmark sits at the top; the mascot is NOT the logo
//   2. a full-bleed hero band carries the headline and the mascot in a pose
//      that means something for this particular email
//   3. the mascot SIGNS the email — brand voice in the body, character at the
//      sign-off. That signature is what makes it a correspondent rather than
//      a decoration, and it is what carries across to newsletters.
//
// What we do not take is the volume. MINT is orange, condensed and shouting;
// Mistbox is forest, Georgia and quiet. Same structure, our register.
//
// One deliberate improvement on MINT: they bake the headline into the hero
// image, so with images off their emails are blank. Ours keeps the headline as
// live text on a background colour and ships only the bird as a PNG.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { AUTOFRAME, FOIL, bird, parcel, ribbon, turn, shoot } from './lib/bird.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs', 'bird', 'emails');

// Straight from storefront/src/lib/email/layout.ts.
const FOREST = '#2b3a31';
const FIR = '#4a5d4e';
const SAGE = '#8fa394';
const PALE = '#b9c7bc';
const GOLD = '#c6a462';
const GOLD_INK = '#7a5f22';
const BONE = '#efe9de';
const PAPER = '#f7f4ed';
const SERIF = "Georgia, 'Cormorant Garamond', 'Times New Roman', serif";
const SANS = "'Futura', 'Century Gothic', 'Avenir Next', Helvetica, Arial, sans-serif";

const emblem64 = fs
  .readFileSync(path.join(ROOT, 'storefront/public/emblem.png'))
  .toString('base64');

/**
 * Gold on forest measures 5.07:1; gold on bone measures 1.96:1. That single
 * fact is why the hero is a dark band — it is the only ground on which the
 * contour bird has any presence at all.
 */
const BIRD = (width, opts = {}, extra = '') =>
  `<svg data-auto xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The Mist Bird"
        style="width:${width}px;height:auto;display:block"><g>${extra}${bird(opts)}</g></svg>`;

const MASTHEAD = `
  <tr>
    <td align="center" style="padding:44px 40px 34px;background:${PAPER};">
      <img src="data:image/png;base64,${emblem64}" width="52" height="66" alt=""
           style="display:block;margin:0 auto 20px;border:0;outline:none;">
      <div style="font-family:${SERIF};font-weight:400;font-size:24px;line-height:1.1;
                  letter-spacing:0.38em;text-indent:0.38em;text-transform:uppercase;color:${FOREST};">Mistbox</div>
    </td>
  </tr>`;

/** The hero band: headline as live text, bird as artwork, forest ground. */
const HERO = ({ eyebrow, headline, art }) => `
  <tr>
    <td bgcolor="${FOREST}" style="background:${FOREST};padding:0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td valign="middle" style="padding:38px 8px 38px 40px;">
            <div style="font-family:${SANS};font-size:11px;letter-spacing:0.24em;
                        text-transform:uppercase;color:${GOLD};padding-bottom:14px;">${eyebrow}</div>
            <div style="font-family:${SERIF};font-size:31px;line-height:1.22;color:${BONE};">${headline}</div>
          </td>
          <td valign="middle" width="215" style="padding:26px 30px 26px 0;">${art}</td>
        </tr>
      </table>
    </td>
  </tr>`;

const BODY = (paras) => `
  <tr>
    <td align="center" style="padding:40px 40px 0;background:${PAPER};">
      ${paras
        .map(
          (p) =>
            `<div style="font-family:${SANS};font-size:16px;line-height:1.78;color:${FIR};
                 max-width:420px;margin:0 auto 18px;">${p}</div>`,
        )
        .join('')}
    </td>
  </tr>`;

/**
 * The signature. The body is brand voice; this line is the bird's. Both the
 * closing line and the name belong in content.ts so Daniya can reword them.
 */
const SIGNOFF = (line) => `
  <tr>
    <td align="center" style="padding:14px 40px 44px;background:${PAPER};">
      <div style="font-family:${SANS};font-size:15px;color:${FIR};padding-bottom:14px;">${line}</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
        <tr>
          <td valign="middle" width="46" style="padding-right:14px;">
            ${BIRD(46, { tilt: 6, ...FOIL })}
          </td>
          <td valign="middle" style="font-family:${SERIF};font-style:italic;font-size:23px;color:${FOREST};">
            the Mist Bird
          </td>
        </tr>
      </table>
    </td>
  </tr>`;

const RULE = `
  <tr><td style="background:${PAPER};padding:0 40px;">
    <div style="border-top:1px solid ${PALE};height:1px;line-height:1px;font-size:0;">&nbsp;</div>
  </td></tr>`;

const DETAIL = (rows) => `
  <tr>
    <td style="padding:30px 40px 40px;background:${PAPER};">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table>
    </td>
  </tr>`;

const line = (name, value) => `
  <tr>
    <td style="padding:7px 0;font-family:${SANS};font-size:15px;color:${FIR};">${name}</td>
    <td align="right" style="padding:7px 0;font-family:${SANS};font-size:15px;color:${FOREST};">${value}</td>
  </tr>`;

const CTA = (label) => `
  <tr>
    <td align="center" style="padding:6px 40px 44px;background:${PAPER};">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
        <tr><td bgcolor="${GOLD}" style="background:${GOLD};padding:14px 30px;">
          <a href="#" style="font-family:${SANS};font-size:13px;letter-spacing:0.16em;
             text-transform:uppercase;color:${FOREST};text-decoration:none;">${label}</a>
        </td></tr>
      </table>
    </td>
  </tr>`;

const FOOTER = `
  <tr>
    <td align="center" bgcolor="${FOREST}" style="background:${FOREST};padding:30px 40px;">
      <div style="font-family:${SANS};font-size:12px;line-height:1.7;color:${PALE};">
        Mistbox · Seattle, Washington<br>You are receiving this because you ordered from us.
      </div>
    </td>
  </tr>`;

// --------------------------------------------------------------- the three

// The carry pose, composed the way the pose sheet composes it.
function carryArt(width) {
  const tilt = 8;
  const from = turn({ x: 56, y: 120 }, tilt);
  const knot = { x: from.x - 2, y: from.y + 48 };
  return BIRD(width, { tilt, wing: -14 }, ribbon(from, knot)) .replace(
    '</g></svg>',
    `${parcel({ at: knot, scale: 0.72, lean: -5 })}</g></svg>`,
  );
}

const EMAILS = [
  {
    id: '1-confirmed',
    label: 'Transactional · order confirmed',
    hero: {
      eyebrow: 'Order MB-4417',
      headline: 'Your box is<br>confirmed.',
      art: BIRD(200, { tilt: 26, wing: -26 }),
    },
    body: [
      'Thank you — this is your receipt. Every box is packed by hand in Seattle, so it takes us a day or two before it goes anywhere.',
      'We will write to you once more on the day it ships, with something you can follow.',
    ],
    signoff: 'Packed with care,',
    detail: line('The Mistbox · Signature', '$88.00') + line('Standard delivery', '$12.00') +
      `<tr><td colspan="2" style="padding-top:10px;border-top:1px solid ${PALE};"></td></tr>` +
      line('<strong>Total</strong>', '<strong>$100.00</strong>'),
    cta: null,
  },
  {
    id: '2-shipped',
    label: 'Transactional · on its way',
    hero: {
      eyebrow: 'Shipped today',
      headline: 'It has left<br>the bench.',
      art: carryArt(210),
    },
    body: [
      'Your box went out this afternoon by USPS Ground Advantage, and should reach you in three to five days.',
      'Nothing is required of you — this is just so you know it is moving.',
    ],
    signoff: 'On my way,',
    detail: line('Carrier', 'USPS Ground Advantage') + line('Tracking', '9400 1112 0000 0000 00') +
      line('Expected', 'Thu 11 Sep'),
    cta: 'Follow the parcel',
  },
  {
    id: '3-newsletter',
    label: 'Newsletter · the monthly',
    hero: {
      eyebrow: 'September',
      headline: 'Smith Tea, and<br>the first cold night.',
      art: BIRD(200, { tilt: -13 }),
    },
    body: [
      'This month we added three loose teas from Smith in Portland, and a Franz bar with alder-smoked salt that we have been quietly keeping for ourselves.',
      'Everything is in stock now, and the Signature box takes five of them.',
    ],
    signoff: 'Something new in the box,',
    detail: '',
    cta: 'See what is new',
  },
];

// ------------------------------------------------------------------ render

const emailHtml = (e) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
         style="width:600px;background:${PAPER};">
    ${MASTHEAD}${HERO(e.hero)}${BODY(e.body)}${SIGNOFF(e.signoff)}
    ${e.detail ? RULE + DETAIL(e.detail) : ''}${e.cta ? CTA(e.cta) : ''}${FOOTER}
  </table>`;

const SHELL = (inner, width) => `<!doctype html><meta charset="utf-8">
<style>body { margin:0; background:${BONE}; font-family:${SANS}; }</style>
${inner}${AUTOFRAME}`;

const framed = (e) => SHELL(`<div style="width:700px;margin:0 auto;padding:30px 0 36px">
  <div style="font:600 11px ${SANS};letter-spacing:.18em;text-transform:uppercase;
              color:${GOLD};background:${FOREST};padding:12px 18px">${e.label}</div>
  <div style="padding:28px 0;display:flex;justify-content:center">${emailHtml(e)}</div>
</div>`, 700);

const sheet = SHELL(`<div style="width:1980px;margin:0 auto;padding:30px 0 36px">
  <div style="font:600 11px ${SANS};letter-spacing:.18em;text-transform:uppercase;
              color:${GOLD};background:${FOREST};padding:12px 18px">
    One bird, three jobs · order confirmed, on its way, the monthly
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,640px);justify-content:center;
              gap:20px;padding:28px 0">
    ${EMAILS.map((e) => `<div style="display:flex;justify-content:center">${emailHtml(e)}</div>`).join('')}
  </div>
  <div style="background:#fff;padding:18px 22px;font:14px/1.7 ${SANS};color:${FIR}">
    <strong>The three parts we took from MINT:</strong> the wordmark stays the logo and the mascot is
    not it; a full-bleed hero band carries the headline beside the bird in a pose that means something
    for <em>this</em> email; and the bird <strong>signs off</strong> — brand voice in the body, character
    at the signature. The band is forest because gold on forest is 5.07:1 where gold on bone is 1.96:1.
    Unlike MINT, the headline is live text on a background colour rather than baked into the image, so
    the email still reads with images turned off.
  </div>
</div>`, 1980);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
for (const e of EMAILS) await shoot(browser, { html: framed(e), file: e.id, width: 700, dir: OUT });
await shoot(browser, { html: sheet, file: '0-all-three', width: 1980, dir: OUT });
await browser.close();
