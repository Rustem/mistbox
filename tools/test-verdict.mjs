// Proves the Mistbox verdict panel says the same thing in every browser.
//
//   node tools/test-verdict.mjs
//
// The reason this test exists: Saleor's dashboard renders a failed save
// through its own translation table, keyed on the error *code*, so the actual
// reason ("three chocolate bars against a limit of two") cannot survive there.
// It reaches a toast, and in Chrome a second generic toast dismisses that one
// before it can be read. The panel is our own HTML for exactly that reason —
// so this checks the claim rather than trusting it.
//
// Needs the dev server, Saleor, and the app installed
// (tools/install-saleor-app.mjs).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { chromium, webkit, firefox } from 'playwright';

const ROOT = '/Users/rustem/code/mistbox';
const env = fs.readFileSync(`${ROOT}/storefront/.env.local`, 'utf8');
const g = (k) => env.match(new RegExp('^' + k + '=(.*)$', 'm'))[1].trim();

const gql = (query, variables = {}) =>
  fetch(g('SALEOR_API_URL'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + g('SALEOR_APP_TOKEN') },
    body: JSON.stringify({ query, variables }),
  }).then((r) => r.json());

const MUTATION =
  'mutation($id:ID!,$input:ProductInput!){productUpdate(id:$id,input:$input){errors{message}}}';
const BOX = 'UHJvZHVjdDox';

const slotsAttr = async () =>
  (await gql('{attributes(first:1,filter:{slugs:["slots"]}){edges{node{id}}}}')).data.attributes
    .edges[0].node.id;

const setSlots = async (n) =>
  gql(MUTATION, { id: BOX, input: { attributes: [{ id: await slotsAttr(), numeric: String(n) }] } });

// A signed admin session, the same one a browser would carry.
const secret = g('ADMIN_SESSION_SECRET');
const payload = `rustem@mist.box|${Math.floor(Date.now() / 1000) + 3600}`;
const cookie = `${payload}|${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;

async function readPanel(engine, name) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await ctx.addCookies([{ name: 'mb_admin', value: cookie, domain: 'localhost', path: '/' }]);
  const page = await ctx.newPage();
  await page.goto('http://localhost:9000/', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', 'r.kamun@gmail.com');
  await page.fill('input[name="password"]', '123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(6000);
  await page.goto(`http://localhost:9000/products/${BOX}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  const frame = page.frameLocator('iframe[src*="/embed/verdict"]');
  const state = await frame.locator('.verdict__state').innerText().catch(() => '(no panel)');
  const why = await frame.locator('.verdict__why').innerText().catch(() => '');
  await browser.close();
  return `${state} — ${why}`;
}

const engines = [
  ['chromium', chromium],
  ['webkit', webkit],
  ['firefox', firefox],
];

let failures = 0;
for (const [label, expected, slots] of [
  ['a box that cannot be sold', 'CANNOT BE ORDERED', 3],
  ['a box that is ready', 'READY TO SEND', 5],
]) {
  await setSlots(slots);
  console.log(`\n${label} (capacity ${slots}):`);
  for (const [name, engine] of engines) {
    let said;
    try {
      said = await readPanel(engine, name);
    } catch (e) {
      said = `(engine failed: ${String(e).split('\n')[0]})`;
    }
    const ok = said.startsWith(expected);
    if (!ok) failures++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(9)} ${said}`);
  }
}

// Leave the box sellable.
await setSlots(5);
console.log(failures ? `\n${failures} browser(s) disagreed.` : '\nEvery browser said the same thing.');
process.exit(failures ? 1 : 0);
