// Measures the things a screenshot can only hint at: vertical gaps between
// sections, type scale, colour contrast, and tap-target sizes.
// Run: node tools/audit.mjs [path] [width]
import { chromium } from 'playwright';

const PATHS = process.argv[2] ? [process.argv[2]] : ['/', '/about', '/order'];
const WIDTH = Number(process.argv[3] ?? 1440);
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

function srgb(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance([r, g, b]) {
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
const parse = (s) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 900 } });
const page = await ctx.newPage();

for (const path of PATHS) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  console.log(`\n=== ${path} @${WIDTH}px ===`);

  const gaps = await page.evaluate(() => {
    const out = [];
    const secs = [...document.querySelectorAll('body > section, body > footer')];
    for (let i = 0; i < secs.length; i++) {
      const r = secs[i].getBoundingClientRect();
      const cs = getComputedStyle(secs[i]);
      out.push({
        tag: secs[i].tagName.toLowerCase() + '.' + (secs[i].className || '—'),
        height: Math.round(r.height),
        padTop: cs.paddingTop,
        padBottom: cs.paddingBottom,
      });
    }
    return out;
  });
  console.log('  sections:');
  for (const g of gaps) {
    console.log(`    ${g.tag.padEnd(34)} h=${String(g.height).padStart(5)}  pad ${g.padTop} / ${g.padBottom}`);
  }

  // Whitespace between the last painted text of one section and the first of
  // the next — the gap a reader actually perceives.
  const perceived = await page.evaluate(() => {
    const paint = (el) => {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let lo = Infinity, hi = -Infinity, n;
      while ((n = walk.nextNode())) {
        if (!n.nodeValue.trim()) continue;
        const rg = document.createRange();
        rg.selectNodeContents(n);
        const r = rg.getBoundingClientRect();
        if (r.height === 0) continue;
        lo = Math.min(lo, r.top + scrollY);
        hi = Math.max(hi, r.bottom + scrollY);
      }
      for (const img of el.querySelectorAll('img,svg')) {
        const r = img.getBoundingClientRect();
        if (!r.height) continue;
        lo = Math.min(lo, r.top + scrollY);
        hi = Math.max(hi, r.bottom + scrollY);
      }
      return [lo, hi];
    };
    const secs = [...document.querySelectorAll('body > section, body > footer')];
    const out = [];
    for (let i = 0; i < secs.length - 1; i++) {
      const [, aHi] = paint(secs[i]);
      const [bLo] = paint(secs[i + 1]);
      if (Number.isFinite(aHi) && Number.isFinite(bLo)) {
        out.push(`${secs[i].className || secs[i].tagName} -> ${secs[i + 1].className || secs[i + 1].tagName}: ${Math.round(bLo - aHi)}px`);
      }
    }
    return out;
  });
  console.log('  perceived gaps:');
  for (const g of perceived) console.log('    ' + g);

  const type = await page.evaluate(() => {
    const sel = ['h1', 'h2', 'h3', 'p', '.support', '.tagline', '.button', '.price', 'ul.contents li'];
    return sel.flatMap((s) => {
      const el = document.querySelector(s);
      if (!el) return [];
      const cs = getComputedStyle(el);
      return [{
        sel: s,
        size: cs.fontSize,
        lh: cs.lineHeight,
        ls: cs.letterSpacing,
        color: cs.color,
        bg: cs.backgroundColor,
      }];
    });
  });
  console.log('  type:');
  for (const t of type) {
    console.log(`    ${t.sel.padEnd(16)} ${t.size.padStart(7)} / lh ${t.lh.padStart(8)} / ls ${t.ls.padStart(8)}  ${t.color}`);
  }

  // Contrast against the nearest opaque ancestor background.
  const cc = await page.evaluate(() => {
    const bgOf = (el) => {
      let n = el;
      while (n) {
        const b = getComputedStyle(n).backgroundColor;
        if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b;
        n = n.parentElement;
      }
      return 'rgb(255,255,255)';
    };
    const sel = ['p', '.support', '.tagline', '.stock', 'ul.contents li', '.button', '.field .hint', 'footer p'];
    return sel.flatMap((s) => {
      const el = document.querySelector(s);
      if (!el) return [];
      return [{ sel: s, fg: getComputedStyle(el).color, bg: bgOf(el), size: getComputedStyle(el).fontSize }];
    });
  });
  console.log('  contrast (WCAG AA needs 4.5, or 3.0 at >=18.66px bold / 24px):');
  for (const c of cc) {
    const ratio = contrast(parse(c.fg), parse(c.bg));
    const px = parseFloat(c.size);
    const need = px >= 24 ? 3 : 4.5;
    const flag = ratio < need ? '  <-- LOW' : '';
    console.log(`    ${c.sel.padEnd(16)} ${ratio.toFixed(2)}:1  (${c.size})${flag}`);
  }
}

// Tap targets at mobile width.
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mp = await mctx.newPage();
console.log('\n=== tap targets @390px (WCAG 2.2 wants >=24px, comfortable is 44px) ===');
for (const path of PATHS) {
  await mp.goto(BASE + path, { waitUntil: 'networkidle' });
  const small = await mp.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('a, button, input, select, textarea')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 44) {
        out.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 28)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return out;
  });
  console.log(`  ${path}: ${small.length ? '' : 'all >=44px'}`);
  for (const s of small) console.log('    ' + s);
}

await browser.close();
