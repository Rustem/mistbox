// End-to-end check of the admin: sign-in, search, stage filters, and advancing
// an order. Screenshots desktop and phone widths.
//
//   node tools/test-admin.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const SP = '/private/tmp/claude-501/-Users-rustem-code-mistbox/ae6e8ac3-af1e-480f-ab92-ae067f36b047/scratchpad';
const env = Object.fromEntries(readFileSync('/Users/rustem/code/mistbox/storefront/.env.local','utf8')
  .split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^"|"$/g,'')]}));

const b = await chromium.launch();
const errs = [];
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
p.on('console', m => m.type()==='error' && errs.push(m.text().slice(0,110)));
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message.slice(0,110)));

// ADMIN_TEST_EMAIL / ADMIN_TEST_PASSWORD name a real Saleor staff account
// ending in @mist.box. Set them in the shell before running this — there is
// no default, since the account and its password are created once by hand.
const email = process.env.ADMIN_TEST_EMAIL;
const password = process.env.ADMIN_TEST_PASSWORD;
if (!email || !password) {
  console.log('Set ADMIN_TEST_EMAIL and ADMIN_TEST_PASSWORD to a real @mist.box staff login.');
  process.exit(1);
}

await p.goto('http://localhost:3000/pack', { waitUntil: 'networkidle' });
console.log('redirected /pack ->', new URL(p.url()).pathname);
await p.fill('#admin-email', email);
await p.fill('#admin-password', password);
await p.click('button[type=submit]');
await p.waitForTimeout(2500);

const count = async () => (await p.locator('.pack__card').count());
console.log('to-pack tab:', await count(), 'cards |', (await p.locator('.support').nth(1).innerText()).trim());
await p.screenshot({ path: SP + '/admin-list.png', fullPage: true });

// Search by order number.
await p.fill('#admin-q', '13');
await p.click('.admin-search button[type=submit]');
await p.waitForTimeout(2000);
console.log('search "13":', await count(), 'card(s) —', (await p.locator('.pack__num').first().innerText().catch(()=> 'none')));
await p.screenshot({ path: SP + '/admin-search.png', fullPage: true });

// Search by email.
await p.goto('http://localhost:3000/admin?q=rustem%40mist.box&stage=all', { waitUntil: 'networkidle' });
console.log('search by email:', await count(), 'cards');

// Delivered filter.
await p.goto('http://localhost:3000/admin?stage=delivered', { waitUntil: 'networkidle' });
console.log('delivered tab:', await count(), 'cards');
await p.screenshot({ path: SP + '/admin-delivered.png', fullPage: true });

// Advance the first to-pack order.
await p.goto('http://localhost:3000/admin?stage=open', { waitUntil: 'networkidle' });
const btn = p.locator('.pack__card').first().locator('button.pack__go');
if (await btn.count()) {
  const label = (await btn.innerText()).trim();
  await btn.click();
  await p.waitForTimeout(2500);
  console.log(`advance: tapped "${label}" -> "${(await p.locator('.pack__card').first().locator('.pack__stage').innerText()).trim()}"`);
}

// Phone.
const m = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await m.goto('http://localhost:3000/admin', { waitUntil: 'networkidle' });
await m.fill('#admin-email', email).catch(()=>{});
await m.fill('#admin-password', password).catch(()=>{});
await m.click('button[type=submit]').catch(()=>{});
await m.waitForTimeout(2500);
const over = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
if (over) errs.push('horizontal overflow at 390px');
await m.screenshot({ path: SP + '/admin-mobile.png', fullPage: true });

console.log('issues:', errs.length ? errs : 'none');
await b.close();
