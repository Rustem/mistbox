// Capture the screenshots for docs/screens, one folder per flow.
//
// Each shot records the on-page position of whatever is worth pointing at, so
// `tools/annotate.py` can draw the callouts afterwards rather than guessing
// coordinates. Run:  node tools/screens.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const ROOT = path.join(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screens');
const RAW = path.join(OUT, '.raw');

const env = fs.readFileSync(path.join(ROOT, 'storefront', '.env.local'), 'utf8');
const secret = env.match(/^ADMIN_SESSION_SECRET=(.*)$/m)[1].trim();
const token = env.match(/^SALEOR_APP_TOKEN=(.*)$/m)[1].trim();
const exp = Math.floor(Date.now() / 1000) + 86400;
const payload = `rustem@mist.box|${exp}`;
const adminCookie = `${payload}|${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;

const gql = (query) =>
  fetch('http://localhost:8000/graphql/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query }),
  }).then((r) => r.json());

fs.mkdirSync(RAW, { recursive: true });
const manifest = [];

const browser = await chromium.launch();

/** Screenshot `page`, remembering where the callout targets sit. */
async function shot(page, name, { flow, title, note, callouts = [], clip, fullPage = false }) {
  const marks = [];
  for (const c of callouts) {
    const el = page.locator(c.selector).first();
    if ((await el.count()) === 0) continue;
    const box = await el.boundingBox();
    if (!box) continue;
    // Coordinates are page-absolute; the annotator subtracts the clip origin.
    marks.push({ text: c.text, x: box.x, y: box.y, w: box.width, h: box.height });
  }
  const file = path.join(RAW, `${name}.png`);
  await page.screenshot({ path: file, fullPage, ...(clip ? { clip } : {}) });
  manifest.push({
    name,
    flow,
    title,
    note,
    marks,
    origin: clip ? { x: clip.x, y: clip.y } : { x: 0, y: 0 },
  });
  console.log(`  ${flow}/${name}`);
}

const order = (
  await gql(
    '{ orders(first:1, sortBy:{field:CREATION_DATE,direction:DESC}){ edges{ node{ id number userEmail } } } }',
  )
).data.orders.edges[0].node;

/* ---------------------------------------------------------------- 1. shop */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const p = await ctx.newPage();
  await p.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await p.locator('#boxes').scrollIntoViewIfNeeded();
  await p.waitForTimeout(600);
  const boxes = await p.locator('#boxes').boundingBox();
  await shot(p, 'shop-1-boxes', {
    flow: 'shop',
    title: 'Three boxes, one built in Saleor',
    note: 'The Afternoon Box was composed in the dashboard — no code, no re-seed — and appeared here on its own.',
    clip: { x: 0, y: boxes.y, width: 1280, height: 980 },
    callouts: [
      { selector: '.tier:first-child h3', text: 'Built by Daniya in Saleor' },
      { selector: '.tier:nth-child(2) .contents', text: 'Contents come from the recipe, not the copy' },
    ],
  });
  await ctx.close();
}

/* --------------------------------------------------------------- 2. build */
{
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
  const p = await ctx.newPage();
  await p.goto('http://localhost:3000/order', { waitUntil: 'networkidle' });
  const grand = await p.locator('#box option', { hasText: 'Grand' }).first().getAttribute('value');
  await p.selectOption('#box', grand);
  await p.waitForTimeout(700);

  await shot(p, 'build-1-curated', {
    flow: 'build',
    title: 'The curated box is the starting state',
    note: 'Nothing to configure. A customer who changes nothing gets exactly what the shop photographed.',
    clip: { x: 0, y: 120, width: 1000, height: 720 },
    callouts: [
      { selector: '.builder__count', text: '“Our selection” until something changes' },
      { selector: '.builder__toggle', text: 'One tap to change what is inside' },
    ],
  });

  await p.click('.builder__toggle');
  await p.waitForTimeout(500);
  await shot(p, 'build-2-editor', {
    flow: 'build',
    title: 'Every slot is editable in place',
    note: 'Change the item, or keep the item and change its flavour. Same gesture, two depths.',
    clip: { x: 0, y: 330, width: 1000, height: 800 },
    callouts: [
      { selector: '.slot:first-child .slot__shot', text: 'The chosen flavour’s own photo' },
      { selector: '.slot:first-child select:nth-of-type(1)', text: 'Which item' },
      { selector: '.slot:nth-child(2) select:nth-of-type(2)', text: 'Which flavour of it' },
    ],
  });

  await p.locator('.slot').nth(0).locator('select').nth(0).selectOption({ label: 'Soy candle, 4 oz' });
  await p.waitForTimeout(300);
  await p.locator('.slot').nth(0).locator('select').nth(1).selectOption({ label: 'First rain' });
  await p.waitForTimeout(300);
  await p.locator('.slot').nth(1).locator('select').nth(1).selectOption({ label: 'Truffle mix' });
  await p.waitForTimeout(500);
  await shot(p, 'build-3-swapped', {
    flow: 'build',
    title: 'Swapping updates the weight, live',
    note: 'A tea became a candle, so the parcel got heavier. The number is summed from real per-variant weights.',
    clip: { x: 0, y: 330, width: 1000, height: 700 },
    callouts: [
      { selector: '.builder__count', text: 'Count and real parcel weight' },
      { selector: '.builder__reset', text: 'Back to our selection' },
    ],
  });
  await ctx.close();
}

/* -------------------------------------------------------------- 3. limits */
{
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
  const p = await ctx.newPage();
  await p.goto('http://localhost:3000/order', { waitUntil: 'networkidle' });
  const sig = await p.locator('#box option', { hasText: 'The Mistbox —' }).first().getAttribute('value');
  await p.selectOption('#box', sig);
  await p.waitForTimeout(700);
  await p.click('.builder__toggle');
  await p.waitForTimeout(400);
  // The recipe already holds one chocolate bar; making a second reaches the
  // cap, and the option then greys out in every other slot. Attempting to
  // select it a third time would simply fail — which is the point.
  await p.locator('.slot').nth(0).locator('select').nth(0).selectOption({ label: 'Chocolate bar, 3 oz' });
  await p.waitForTimeout(600);
  const thirdBar = await p
    .locator('.slot')
    .nth(2)
    .locator('select')
    .nth(0)
    .locator('option', { hasText: 'Chocolate bar' })
    .first()
    .isDisabled();
  console.log(`    (a third chocolate bar is disabled: ${thirdBar})`);
  await shot(p, 'limits-1-cap', {
    flow: 'limits',
    title: 'Caps are per product, across flavours',
    note: 'Two chocolate bars is the limit, so the item greys out elsewhere — a box cannot become five bars.',
    clip: { x: 0, y: 330, width: 1000, height: 780 },
    callouts: [{ selector: '.slot:nth-child(4) select:nth-of-type(1)', text: '“(limit 2)” — cannot add a third bar' }],
  });
  await ctx.close();
}

/* ------------------------------------------------------------- 4. receipt */
{
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1400 } });
  const p = await ctx.newPage();
  await p.goto(`http://localhost:3000/order/${order.id}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  await shot(p, 'receipt-1-locked', {
    flow: 'receipt',
    title: 'Details stay behind the buyer’s email',
    note: 'Status and tracking are open to anyone with the link; prices, address and gift message are not.',
    clip: { x: 0, y: 700, width: 900, height: 560 },
    callouts: [{ selector: '.panel--locked', text: 'A forwarded link cannot spoil the surprise' }],
  });

  await p.fill('input[type="email"]', order.userEmail);
  await p.click('button[type="submit"]');
  await p.waitForTimeout(1600);
  const receipt = await p.locator('.receipt').boundingBox();
  await shot(p, 'receipt-2-itemised', {
    flow: 'receipt',
    title: 'The box is priced; its contents are named',
    note: 'Items ride at zero, so they are listed rather than printed as “$0.00” beside a hand-made bar.',
    clip: { x: 0, y: receipt.y - 60, width: 900, height: 460 },
    callouts: [
      { selector: '.receipt li:first-child', text: 'The only priced line' },
      { selector: '.receipt__included', text: 'Chosen flavours, unpriced' },
    ],
  });
  await ctx.close();
}

/* --------------------------------------------------------------- 5. email */
{
  const ctx = await browser.newContext({ viewport: { width: 760, height: 1250 } });
  const p = await ctx.newPage();
  await p.goto(`http://localhost:3000/api/dev/email-preview?type=confirmed&order=${order.id}`, {
    waitUntil: 'networkidle',
  });
  await p.waitForTimeout(400);
  await shot(p, 'email-1-confirmation', {
    flow: 'email',
    title: 'The confirmation carries the same split',
    note: 'Same rule as the receipt: one priced box, its contents named beneath it.',
    clip: { x: 0, y: 0, width: 760, height: 1100 },
  });
  await ctx.close();
}

/* ---------------------------------------------------------------- 6. pack */
{
  const ctx = await browser.newContext({ viewport: { width: 460, height: 1200 } });
  await ctx.addCookies([{ name: 'mb_admin', value: adminCookie, domain: 'localhost', path: '/' }]);
  const p = await ctx.newPage();
  await p.goto('http://localhost:3000/admin?stage=open', { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const card = await p.locator('.pack__card').first().boundingBox();
  await shot(p, 'pack-1-checklist', {
    flow: 'pack',
    title: 'A packing checklist, not a run-on',
    note: 'Carton first, then every item with its chosen flavour and SKU — readable while holding a box.',
    clip: { x: 0, y: card.y - 10, width: 460, height: Math.min(card.height + 20, 700) },
    callouts: [
      { selector: '.pack__checklist-box', text: 'The carton she reaches for' },
      { selector: '.pack__checklist li:nth-child(2)', text: 'Flavour + SKU: the right jar, not just the right shelf' },
    ],
  });

  await p.goto('http://localhost:3000/admin?stage=sealed', { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  if (await p.locator('.pack__go').first().count()) {
    const sealed = await p.locator('.pack__card').first().boundingBox();
    await shot(p, 'pack-2-label', {
      flow: 'pack',
      title: 'Buying the shipping label',
      note: 'One tap quotes a real carrier price; a second tap spends it. Nothing is bought without seeing the number.',
      clip: { x: 0, y: sealed.y - 10, width: 460, height: Math.min(sealed.height + 20, 700) },
      callouts: [{ selector: '.pack__go', text: 'Quote first, buy second' }],
    });
  }
  await ctx.close();
}

/* ----------------------------------------------------------- 7. dashboard */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  await p.goto('http://localhost:9000/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  if (await p.locator('input[name="email"]').count()) {
    await p.fill('input[name="email"]', 'r.kamun@gmail.com');
    await p.fill('input[name="password"]', '123');
    await p.click('button[type="submit"]');
    await p.waitForTimeout(6000);
  }

  /**
   * Saleor overlays a "Pulse" marketing panel on the dashboard. It is not part
   * of the product being documented, and it sits over the page rather than in
   * it, so it is removed by content — the close button has no stable selector.
   */
  async function dismissChrome() {
    await p.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll('div, aside, section'))) {
        const text = el.textContent ?? '';
        if (text.includes('Saleor Pulse') && text.length < 400) {
          const style = getComputedStyle(el);
          if (style.position === 'fixed' || style.position === 'absolute') {
            el.remove();
            return;
          }
        }
      }
    });
    await p.waitForTimeout(300);
  }

  const variantId = (
    await gql('{ products(first:1, filter:{slugs:["soy-candle-4oz"]}){ edges{ node{ id } } } }')
  ).data.products.edges[0].node.id;
  await p.goto(`http://localhost:9000/products/${encodeURIComponent(variantId)}`, {
    waitUntil: 'networkidle',
  });
  await p.waitForTimeout(4000);
  await dismissChrome();
  // The variants table is the point of this shot, so put it on screen.
  const variantsHeading = p.locator('text=Variants').first();
  if (await variantsHeading.count()) {
    await variantsHeading.scrollIntoViewIfNeeded().catch(() => {});
    await p.waitForTimeout(800);
  }
  await shot(p, 'dashboard-1-variants', {
    flow: 'dashboard',
    title: 'A flavour is a variant, not a product',
    note: 'Saleor’s own model — SKU and stock live on the variant. Adding a scent is adding a variant, which is why the product is the swap group.',
    clip: { x: 0, y: 0, width: 1440, height: 950 },
    callouts: [{ selector: '[data-test-id="product-image"], form img', text: 'One photo per flavour, assigned to its variant' }],
  });

  const boxId = (
    await gql('{ products(first:1, filter:{slugs:["the-afternoon-box"]}){ edges{ node{ id } } } }')
  ).data.products.edges[0].node.id;
  await p.goto(`http://localhost:9000/products/${encodeURIComponent(boxId)}`, {
    waitUntil: 'networkidle',
  });
  await p.waitForTimeout(4000);
  await dismissChrome();
  const attributes = p.locator('text=Attributes').first();
  if (await attributes.count()) {
    await attributes.scrollIntoViewIfNeeded().catch(() => {});
    await p.waitForTimeout(800);
  }
  await shot(p, 'dashboard-2-contents', {
    flow: 'dashboard',
    title: 'Composing a box from items',
    note: 'The Contents picker is how Daniya builds a box. What she picks becomes the order lines, the stock that moves, and the site copy.',
    clip: { x: 0, y: 0, width: 1440, height: 950 },
    callouts: [
      { selector: 'text=Contents', text: 'Pick items here — no code, no JSON, no re-seed' },
    ],
  });
  await ctx.close();
}

fs.writeFileSync(path.join(RAW, 'manifest.json'), JSON.stringify(manifest, null, 2));
await browser.close();
console.log(`\n${manifest.length} raw shots -> ${path.relative(ROOT, RAW)}`);
