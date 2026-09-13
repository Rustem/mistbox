// The Mist Bird, as geometry rather than as a picture.
//
// Everything that draws the bird — pose sheets, proportion studies, the email
// assets — builds it from here, so a change to the anatomy reaches every
// rendering at once and the poses cannot drift away from the mark.

export const FOREST = '#2B3A31';
export const GOLD = '#C6A462';
export const BONE = '#EFE9DE';
export const PAPER = '#F7F4ED';
export const FIR = '#4A5D4E';
export const SAGE = '#8FA394';
export const SANS = "'Futura','Century Gothic','Avenir Next',Helvetica,sans-serif";
export const SERIF = "Georgia,'Cormorant Garamond',serif";

// ---------------------------------------------------------------- anatomy

export const TAIL_UPPER = 'M298,252 C330,262 362,278 380,296 C358,300 324,288 296,270 Z';
export const TAIL_LOWER = 'M296,244 C330,230 370,224 394,232 C374,246 336,256 300,258 Z';
export const WING =
  'M202,160 C236,120 288,88 346,80 C344,98 320,128 284,156 C254,180 222,190 206,180 ' +
  'C198,174 198,166 202,160 Z';

export const EYE = { x: 152, y: 108, r: 6.5 };
export const SHOULDER = { x: 204, y: 170 }; // the wing rotates about this
export const CENTRE = { x: 190, y: 170 };   // the body tilts about this
export const GAPE = { x: 130, y: 137 };     // where the bill leaves the head
export const TAIL_BASE = { x: 298, y: 252 };
export const TAIL_TIP = { x: 394, y: 232 };
export const WING_TIP = { x: 346, y: 80 };

/**
 * Bill tips. The bill was the one part of the artboard that measured wrong
 * against a real hummingbird, so it is the one part that stays a parameter.
 * `true` is the adopted anatomy; the others are kept so the study that led to
 * it can be re-rendered. See tools/bird-proportions.mjs for the working.
 */
export const BILL = {
  long: { x: 22, y: 112 },  // the artboard as drawn — 29% of total length
  trim: { x: 42, y: 117 },  // 25%
  true: { x: 56, y: 120 },  // 22% — inside the range field guides give
};

/** The Mist Bird's bill. Every drawing uses this unless told otherwise. */
export const DEFAULT_BILL = BILL.true;

/** The body outline. `tip` sets the bill; `belly` deepens the mid-torso. */
export function bodyPath({ tip = DEFAULT_BILL, belly = 0 } = {}) {
  return (
    'M158,80 C180,80 196,98 196,120 C196,140 206,162 226,182 C252,206 280,228 300,242 ' +
    'C308,248 308,256 300,258 ' +
    `C274,${258 + belly * 0.4} 246,${250 + belly} 215,${236 + belly} ` +
    `C189,${222 + belly * 0.7} 168,202 158,180 ` +
    'C152,166 142,154 132,144 ' +
    `L${tip.x},${tip.y} ` +
    'L128,130 C120,116 122,90 140,82 C146,80 152,80 158,80 Z'
  );
}

// The wing's long axis, so it can be narrowed across its width rather than
// scaled as a whole.
const WING_AXIS_DEG =
  (Math.atan2(WING_TIP.y - SHOULDER.y, WING_TIP.x - SHOULDER.x) * 180) / Math.PI;

/** Positive tilt is nose-up: the bird faces left, so a clockwise screen
 *  rotation lifts the bill and drops the tail. */
export function turn(p, deg, about = CENTRE) {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - about.x;
  const dy = p.y - about.y;
  return { x: about.x + dx * cos - dy * sin, y: about.y + dx * sin + dy * cos };
}

export const beakAt = (tilt, tip = DEFAULT_BILL) => turn(tip, tilt);

/**
 * The bird.
 *   tilt   swings the whole body        wing   rotates the near wing only
 *   tip    which bill                   slim   narrows the wing across its axis
 *   belly  deepens the mid-torso        stroke/fill override the treatment
 */
export function bird({
  tilt = 0,
  wing = 0,
  tip = DEFAULT_BILL,
  slim = 1,
  belly = 0,
  stroke = GOLD,
  fill = BONE,
  eye = FOREST,
  width = 3,
} = {}) {
  const narrow =
    slim === 1
      ? ''
      : ` translate(${SHOULDER.x} ${SHOULDER.y}) rotate(${WING_AXIS_DEG.toFixed(2)})` +
        ` scale(1 ${slim}) rotate(${(-WING_AXIS_DEG).toFixed(2)})` +
        ` translate(${-SHOULDER.x} ${-SHOULDER.y})`;
  const wingT =
    wing || narrow
      ? ` transform="rotate(${wing} ${SHOULDER.x} ${SHOULDER.y})${narrow}"`
      : '';

  return `<g transform="rotate(${tilt} ${CENTRE.x} ${CENTRE.y})"
             fill="${fill}" stroke="${stroke}" stroke-width="${width}"
             stroke-linejoin="round" stroke-linecap="round">
    <path d="${TAIL_UPPER}"/>
    <path d="${TAIL_LOWER}"/>
    <path d="${bodyPath({ tip, belly })}"/>
    <path d="${WING}"${wingT}/>
    <circle cx="${EYE.x}" cy="${EYE.y}" r="${EYE.r}" fill="${eye}" stroke="none"/>
  </g>`;
}

/**
 * The foil cut: forest filled, gold edged, bone eye. The contour bird is
 * 1.96:1 on bone and dissolves below ~180px, so anything small — a signature,
 * a favicon, an avatar — uses this instead. Same geometry, heavier weight.
 */
export const FOIL = { fill: FOREST, stroke: GOLD, eye: BONE, width: 4 };

/**
 * A Mistbox parcel — lidded box, cross band, ribbon knot. Drawn so the knot
 * sits at local (50,20), which is the point it hangs by.
 */
export function parcel({ at, scale = 1, lean = 0, bow = true }) {
  const t = `translate(${at.x - 50 * scale} ${at.y - 20 * scale}) scale(${scale})`;
  // Standing on the lid, the bow would sit under the bird's feet, so the perch
  // pose drops it and keeps only the cross band.
  const knot = bow
    ? `<path d="M50,22 C33,7 15,10 17,20 C19,30 39,28 50,22 Z"/>
       <path d="M50,22 C67,7 85,10 83,20 C81,30 61,28 50,22 Z"/>
       <circle cx="50" cy="20" r="3.6" fill="${GOLD}" stroke="none"/>`
    : '';
  return `<g transform="${t}" fill="${BONE}" stroke="${GOLD}" stroke-width="${(2.6 / scale).toFixed(2)}"
             stroke-linejoin="round" stroke-linecap="round">
    <g transform="rotate(${lean} 50 20)">
      <rect x="4" y="26" width="92" height="64" rx="7"/>
      <path d="M4,46 H96" fill="none"/>
      <path d="M50,26 V90" fill="none"/>
      ${knot}
    </g>
  </g>`;
}

export const ribbon = (from, to) =>
  `<path d="M${from.x},${from.y} L${to.x},${to.y}" fill="none" stroke="${GOLD}"
         stroke-width="2.4" stroke-linecap="round"/>`;

// ------------------------------------------------------------------ poses

/**
 * The seven poses, each a body tilt and a wing rotation about the shoulder
 * plus whatever the bird is carrying. Every consumer — the contact sheets, the
 * email mocks, the PNG assets that ship — composes from here, so a pose cannot
 * mean one thing in a mock and another in the sent mail.
 *
 * Each takes the same options `bird()` does, so a caller can restyle (FOIL) or
 * swap the bill without the pose knowing about it.
 */
export const POSES = {
  hover: (o = {}) => bird(o),
  climb: (o = {}) => bird({ tilt: 26, wing: -26, ...o }),
  alight: (o = {}) => bird({ tilt: -24, wing: -36, ...o }),

  carry: (o = {}) => {
    const tilt = 8;
    const from = turn(o.tip ?? DEFAULT_BILL, tilt);
    const knot = { x: from.x - 2, y: from.y + 48 };
    return ribbon(from, knot) + bird({ tilt, wing: -14, ...o }) +
      parcel({ at: knot, scale: 0.72, lean: -5 });
  },

  tucked: (o = {}) => {
    const tilt = 4;
    const from = turn(o.tip ?? DEFAULT_BILL, tilt);
    const knot = { x: from.x - 4, y: from.y + 42 };
    return ribbon(from, knot) + bird({ tilt, wing: 8, ...o }) +
      parcel({ at: knot, scale: 0.52, lean: -6 });
  },

  tag: (o = {}) => {
    const tilt = -13;
    const b = turn(o.tip ?? DEFAULT_BILL, tilt);
    return bird({ tilt, ...o }) + `<g stroke="${GOLD}" stroke-linejoin="round" stroke-linecap="round">
      <path d="M${b.x},${b.y} L${b.x},${b.y + 78}" stroke-width="2" fill="none"/>
      <rect x="${b.x - 31}" y="${b.y + 76}" width="62" height="58" rx="8" fill="${BONE}" stroke-width="2.4"/>
      <circle cx="${b.x}" cy="${b.y + 89}" r="4.5" fill="none" stroke-width="2"/>
      <path d="M${b.x},${b.y + 100} l9,14 h-5 l9,12 h-26 l9,-12 h-5 Z" fill="${GOLD}" stroke="none"/>
      <rect x="${b.x - 2}" y="${b.y + 125}" width="4" height="6" fill="${GOLD}" stroke="none"/>
    </g>`;
  },

  perch: (o = {}) => {
    const tilt = 10;
    const lid = 292; // top of the parcel, where the feet land
    // The two points on the belly the legs hang from, carried through the tilt.
    const legs = [
      { x: 230, y: 242 },
      { x: 262, y: 250 },
    ]
      .map((p) => turn(p, tilt))
      .map(
        (f) =>
          `<path d="M${f.x.toFixed(1)},${f.y.toFixed(1)} L${(f.x + 3).toFixed(1)},${lid}" fill="none"
                 stroke="${GOLD}" stroke-width="2.4" stroke-linecap="round"/>` +
          `<path d="M${(f.x - 4).toFixed(1)},${lid} h14" fill="none"
                 stroke="${GOLD}" stroke-width="2.4" stroke-linecap="round"/>`,
      )
      .join('');
    // Parcel behind, legs over its lid, bird in front — so the feet read as
    // standing on the box rather than beside it.
    return parcel({ at: { x: 236, y: lid + 6 }, scale: 1, bow: false }) + legs +
      bird({ tilt, wing: 50, ...o });
  },
};

// ----------------------------------------------------------------- render

// getBBox() ignores stroke, so every frame carries a little padding.
export const AUTOFRAME = `<script>
  for (const svg of document.querySelectorAll('svg[data-auto]')) {
    const b = svg.firstElementChild.getBBox();
    const p = 14;
    svg.setAttribute('viewBox', (b.x - p) + ' ' + (b.y - p) + ' ' + (b.width + p * 2) + ' ' + (b.height + p * 2));
  }
</script>`;

/** Screenshot one generated page, clipped to its content. */
export async function shoot(browser, { html, file, width, dir }) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = path.join(dir, `${file}.html`);
  fs.writeFileSync(src, html);
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`file://${src}`, { waitUntil: 'networkidle' });
  const box = await page.locator('body > div').boundingBox();
  await page.screenshot({
    path: path.join(dir, `${file}.png`),
    fullPage: true, // so the clip may run past the viewport instead of truncating
    clip: { x: 0, y: 0, width, height: Math.ceil(box.y + box.height) },
  });
  await ctx.close();
  fs.unlinkSync(src);
  console.log(`  ${path.relative(process.cwd(), path.join(dir, `${file}.png`))}`);
}
