// Places a real test order end to end: creates a checkout through the
// storefront, pays it on Stripe with a test card, and reports what Saleor
// ended up with. Requires `stripe listen --forward-to
// localhost:3000/api/stripe/webhook` to be running, or no order appears.
//
// Run:
//   node tools/testpay.mjs                              curated Mistbox
//   node tools/testpay.mjs --tier the-mistbox-grand --qty 2
//   node tools/testpay.mjs --pick FWT-050,BBC-SALT,OBC-004,CDC-TOWEL,LPC-004
//
// A box is a carton line plus one line per item inside it, so this also checks
// the thing that whole design exists for: that selling a box draws down the
// real stock of the chocolate and tea in it.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SALEOR = process.env.SALEOR_API_URL ?? 'http://localhost:8000/graphql/';
const TOKEN = process.env.SALEOR_APP_TOKEN;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const tier = arg('tier', 'the-mistbox');
const qty = Number(arg('qty', 1));
const pick = arg('pick', '');
const items = pick ? pick.split(',').map((sku) => ({ sku: sku.trim(), quantity: 1 })) : null;

const gql = (q, headers = {}) =>
  fetch(SALEOR, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ query: q }),
  }).then((r) => r.json());

const auth = TOKEN ? { authorization: `Bearer ${TOKEN}` } : {};

/**
 * Per-item ALLOCATION by SKU — not `quantityAvailable`.
 *
 * Two traps make the obvious check meaningless. Saleor caps
 * `quantityAvailable` at 50, so a drop from 90 to 89 is invisible; and a paid
 * order *allocates* stock rather than removing it, since the chocolate is
 * still physically on the shelf until the box is fulfilled. Allocation is
 * uncapped and moves the moment the order is created, which is exactly the
 * thing worth asserting.
 *
 * Items are hidden from anonymous reads, so this needs the app token.
 */
async function itemAllocation() {
  if (!TOKEN) return null;
  const data = await gql(
    `{ productVariants(first:100){ edges{ node{ sku
         product{ productType{ slug } }
         stocks{ quantity quantityAllocated } } } } }`,
    auth,
  );
  const rows = data.data?.productVariants?.edges ?? [];
  return new Map(
    rows
      .filter((e) => e.node.product.productType.slug === 'box-item')
      .map((e) => [
        e.node.sku,
        (e.node.stocks ?? []).reduce((n, s) => n + s.quantityAllocated, 0),
      ]),
  );
}

const before = await itemAllocation();
console.log(items ? `ordering a custom ${tier}: ${pick}` : `ordering ${qty} x ${tier} (curated)`);

const res = await fetch(`${BASE}/api/checkout`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    tier,
    ...(items ? { items } : { preset: true, quantity: qty }),
    // Override with TEST_BUYER_EMAIL. Not billing@ — that mailbox is for
    // vendor invoices, and test orders should not silt it up.
    email: process.env.TEST_BUYER_EMAIL ?? 'rustem@mist.box',
    giftMessage: 'Automated test order.',
    // Deliberately not a landmark. "1 Pike Place" (Pike Place Market, also
    // Mistbox's own warehouse address) is real-carrier-ambiguous — USPS
    // refuses to quote it ("Multiple addresses were found... no default
    // exists"), which only surfaced once label-buying started validating
    // against real carriers. An ordinary residential-shaped address avoids it.
    shippingAddress: {
      firstName: 'Test', lastName: 'Buyer', streetAddress1: '4200 Meridian Ave N',
      city: 'Seattle', countryArea: 'WA', postalCode: '98103', country: 'US',
    },
  }),
}).then((r) => r.json());
if (res.error) throw new Error('checkout failed: ' + res.error);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
await page.goto(res.url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);

// Card sits in an accordion whenever other payment methods are offered; its
// radio is covered by the accordion's own button, hence the forced click.
await page.locator('#payment-method-accordion-item-title-card').click({ force: true });
await page.waitForTimeout(5000);

let frame = null;
for (let i = 0; i < 6 && !frame; i++) {
  for (const f of page.frames()) if (await f.locator('#cardNumber').count()) { frame = f; break; }
  if (!frame) await page.waitForTimeout(2000);
}
if (!frame) throw new Error('card form never appeared');

for (const [sel, val] of [
  ['#cardNumber', '4242424242424242'], ['#cardExpiry', '1234'], ['#cardCvc', '123'],
  ['#billingName', 'Test Buyer'], ['#billingPostalCode', '98101'],
]) {
  if (await frame.locator(sel).count()) await frame.locator(sel).first().fill(val);
}

// Link's "save my information" is pre-checked and makes phone number required,
// which silently blocks the submit.
const link = page.locator('#enableStripePass');
if ((await link.count()) && (await link.isChecked())) await link.uncheck({ force: true });

const shown = await page.locator('body').innerText();
const totalShown = shown.match(/\$[\d,]+\.\d\d/)?.[0];
await page.locator('[data-testid="hosted-payment-submit-button"]').click();
await page.waitForURL(/\/order\/success/, { timeout: 90000 });
console.log('paid', totalShown, '->', page.url().slice(0, 60) + '…');
await browser.close();

await new Promise((r) => setTimeout(r, 3000));

if (!TOKEN) {
  console.log('\nSet SALEOR_APP_TOKEN to have this script verify the order in Saleor.');
  process.exit(0);
}
const orders = await gql(
  `{ orders(first:1, sortBy:{field:CREATION_DATE, direction:DESC}){ totalCount edges{ node{
      number status paymentStatus total{gross{amount currency}} subtotal{gross{amount}}
      shippingPrice{gross{amount}} lines{quantity productName productSku unitPrice{gross{amount}}}
      metadata{key value}
      transactions{pspReference chargedAmount{amount}} } } } }`,
  auth,
);
const o = orders.data?.orders?.edges?.[0]?.node;
if (!o) { console.log('no order found'); process.exit(1); }

const meta = Object.fromEntries(o.metadata.map((m) => [m.key, m.value]));
const priced = o.lines.filter((l) => l.unitPrice.gross.amount > 0);
const included = o.lines.filter((l) => l.unitPrice.gross.amount === 0);

console.log(`\norder #${o.number}  ${o.status} / ${o.paymentStatus}`);
console.log(`  box       ${priced.map((l) => `${l.quantity}x ${l.productName}`).join(', ')}`);
console.log(`  inside    ${included.map((l) => `${l.quantity}x ${l.productSku}`).join(', ') || '(none)'}`);
console.log(`  subtotal  ${o.subtotal.gross.amount}`);
console.log(`  delivery  ${o.shippingPrice.gross.amount}`);
console.log(`  total     ${o.total.gross.amount} ${o.total.gross.currency}`);
console.log(`  charged   ${o.transactions.map((t) => t.chargedAmount.amount).join(', ')}`);
console.log(`  parcel    ${meta.parcel_weight_kg} kg (${meta.parcel_weight_source})`);

const charged = o.transactions.reduce((a, t) => a + t.chargedAmount.amount, 0);
const ok = (pass, good, bad) => console.log(pass ? `  ✓ ${good}` : `  ✗ ${bad}`);

ok(charged === o.total.gross.amount,
  'Saleor total and Stripe charge agree',
  `MISMATCH: Saleor says ${o.total.gross.amount}, Stripe charged ${charged}`);

// The whole point of itemising: the box's own price is the only price. If an
// item ever became non-zero the customer would be charged twice for it.
ok(priced.length === 1 && o.subtotal.gross.amount === priced[0].unitPrice.gross.amount * priced[0].quantity,
  'the carton is the only priced line — items ride at zero',
  `expected one priced line matching the subtotal, got ${priced.length}`);

const expectedLines = Number(meta.box_slots) + 1;
ok(o.lines.length === expectedLines,
  `${o.lines.length} lines = 1 carton + ${meta.box_slots} slots`,
  `expected ${expectedLines} lines for a ${meta.box_slots}-slot box, got ${o.lines.length}`);

// And the reason all of this exists: selling a box has to move the chocolate.
if (before) {
  const after = await itemAllocation();

  const expected = new Map();
  for (const l of included) {
    expected.set(l.productSku, (expected.get(l.productSku) ?? 0) + l.quantity);
  }

  const moved = [...after]
    .filter(([sku, now]) => now !== (before.get(sku) ?? 0))
    .map(([sku, now]) => `${sku} +${now - (before.get(sku) ?? 0)}`);

  const wrong = [];
  for (const [sku, quantity] of expected) {
    if ((after.get(sku) ?? 0) - (before.get(sku) ?? 0) !== quantity) wrong.push(sku);
  }
  // Nothing outside the box may move either — a box that quietly allocated an
  // item it does not contain would be worse than one that allocated nothing.
  for (const [sku, now] of after) {
    if (!expected.has(sku) && now !== (before.get(sku) ?? 0)) wrong.push(`${sku} (not in box)`);
  }

  console.log(`  allocated ${moved.join(', ') || '(nothing)'}`);
  ok(wrong.length === 0 && expected.size > 0,
    `every item in the box was allocated from its own stock, and nothing else was`,
    `allocation wrong for: ${wrong.join(', ') || '(no items in the box at all)'}`);
}
