// End-to-end check of the packing screen: signs in with the passphrase from
// .env.local and advances the newest order through every manual stage,
// screenshotting each step. Requires the storefront and Saleor to be running.
//
//   node tools/test-packing.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const SP = '/private/tmp/claude-501/-Users-rustem-code-mistbox/ae6e8ac3-af1e-480f-ab92-ae067f36b047/scratchpad';
const env = Object.fromEntries(readFileSync('/Users/rustem/code/mistbox/storefront/.env.local','utf8')
  .split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^"|"$/g,'')]}));

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = [];
p.on('console', m => m.type()==='error' && errs.push(m.text().slice(0,120)));
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message.slice(0,120)));

await p.goto('http://localhost:3000/pack', { waitUntil: 'networkidle' });
await p.screenshot({ path: SP + '/pack-gate.png', fullPage: true });
console.log('gate:', (await p.locator('body').innerText()).replace(/\n+/g,' | ').slice(0,120));

await p.fill('#pack-pass', env.PACKING_PASSPHRASE);
await p.click('button[type=submit]');
await p.waitForTimeout(2500);
console.log('after auth:', (await p.locator('body').innerText()).replace(/\n+/g,' | ').slice(0,200));
await p.screenshot({ path: SP + '/pack-list.png', fullPage: true });

// Advance the newest order through every manual stage.
for (let i = 0; i < 3; i++) {
  const btn = p.locator('.pack__card').first().locator('button.pack__go');
  if (!(await btn.count())) { console.log('no more stages'); break; }
  const label = (await btn.innerText()).trim();
  await btn.click();
  await p.waitForTimeout(2500);
  const stage = await p.locator('.pack__card').first().locator('.pack__stage').innerText();
  console.log(`  tapped "${label}" -> now "${stage}"`);
}
await p.screenshot({ path: SP + '/pack-advanced.png', fullPage: true });
console.log('console errors:', errs.length ? errs : 'none');
await b.close();
