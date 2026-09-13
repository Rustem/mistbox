// Proves the injected dashboard script (dashboard/mistbox-inline-errors.js)
// shows a refused save's REAL reason in every browser — the thing the stock
// dashboard cannot do, because it renders an error's code ("Invalid value")
// and hides the server's sentence in a toast that the next toast dismisses.
//
//   node tools/test-inline-error.mjs
//
// Needs the patched dashboard up (docker compose up -d dashboard) and the dev
// storefront running (the dashboard login and mb_admin cookie ride on it).
//
// The refusal itself is proven elsewhere at the API. What is unproven, and what
// broke "no matter the browser", is the DISPLAY. So this drives the real
// dashboard page and fulfils the productUpdate with the plugin's exact
// real-shaped error body (no real mutation, nothing persists), then asserts our
// panel and inline rewrite render the same sentence in all three engines.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { chromium, webkit, firefox } from 'playwright';

const ROOT = '/Users/rustem/code/mistbox';
const env = fs.readFileSync(`${ROOT}/storefront/.env.local`, 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [, ''])[1].trim();

const BOX = 'UHJvZHVjdDox'; // Product:1, a gift box
// The plugin's real output for three chocolate bars against a cap of two —
// f"Only {cap} {name} fit in a box, in any mix of flavours — {box} has {used}."
const REAL = 'Only 2 Chocolate bar, 3 oz fit in a box, in any mix of flavours — The Mistbox has 3.';

// The refused-save body, exactly the shape Saleor returns for our
// ValidationError(code="invalid", params={"attributes":[...]}).
const REFUSED = {
  data: { productUpdate: { errors: [{ field: 'attributes', message: REAL, code: 'INVALID', attributes: ['QXR0cmlidXRlOjE='] }], product: null } },
};
const OK = { data: { productUpdate: { errors: [], product: { id: BOX } } } };

const secret = g('ADMIN_SESSION_SECRET');
const payload = `rustem@mist.box|${Math.floor(Date.now() / 1000) + 3600}`;
const cookie = `${payload}|${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;

async function run(engine, name) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await ctx.addCookies([{ name: 'mb_admin', value: cookie, domain: 'localhost', path: '/' }]);
  const page = await ctx.newPage();

  // Fulfil any productUpdate with our refused body; leave every other call real.
  let mode = REFUSED;
  await page.route('**/graphql/**', async (route) => {
    const post = route.request().postData() || '';
    if (post.includes('productUpdate')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mode) });
    } else {
      await route.continue();
    }
  });

  await page.goto('http://localhost:9000/', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', 'r.kamun@gmail.com');
  await page.fill('input[name="password"]', '123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(6000);
  await page.goto(`http://localhost:9000/products/${BOX}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  // Plant the dashboard's own inline "Invalid value" so we can prove the swap.
  await page.evaluate(() => {
    const s = document.createElement('span');
    s.textContent = 'Invalid value';
    s.id = 'mb-fake-inline';
    document.body.appendChild(s);
  });

  // Fire a save exactly as the form would: a productUpdate to the real API.
  await page.evaluate((api) => {
    fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'mutation{productUpdate(id:"x",input:{}){errors{message}}}' }),
    });
  }, g('SALEOR_API_URL'));
  await page.waitForTimeout(1500);

  const panel = await page.locator('#mistbox-panel').innerText().catch(() => '(no panel)');
  const inline = await page.locator('#mb-fake-inline').innerText().catch(() => '(gone)');

  const shot = `${ROOT}/docs/pricing-review/inline-error-${name}.png`;
  await page.screenshot({ path: shot });

  // And that a successful save clears the panel.
  mode = OK;
  await page.evaluate((api) => {
    fetch(api, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'mutation{productUpdate(id:"x",input:{}){errors{message}}}' }),
    });
  }, g('SALEOR_API_URL'));
  await page.waitForTimeout(1200);
  const cleared = (await page.locator('#mistbox-panel').count()) === 0;

  await browser.close();
  return { panel, inline, cleared, shot };
}

const engines = [['chromium', chromium], ['webkit', webkit], ['firefox', firefox]];
let failures = 0;
for (const [name, engine] of engines) {
  let r;
  try { r = await run(engine, name); } catch (e) { r = { panel: '(engine failed: ' + String(e).split('\n')[0] + ')' }; }
  const panelOk = (r.panel || '').includes(REAL);
  const inlineOk = r.inline === REAL;
  const clearOk = r.cleared === true;
  if (!panelOk || !inlineOk || !clearOk) failures++;
  console.log(`\n${name}`);
  console.log(`  ${panelOk ? 'ok  ' : 'FAIL'} panel shows the reason`);
  console.log(`  ${inlineOk ? 'ok  ' : 'FAIL'} inline "Invalid value" rewritten  (got: ${JSON.stringify(r.inline)})`);
  console.log(`  ${clearOk ? 'ok  ' : 'FAIL'} panel clears on a successful save`);
  if (r.shot) console.log(`  shot ${r.shot}`);
}
console.log(failures ? `\n${failures} browser(s) failed.` : '\nEvery browser showed the same reason.');
process.exit(failures ? 1 : 0);
