// End-to-end check of the customer order page: proves the email gate hides the
// address, gift message and prices from a forwarded link, that a wrong email
// reveals nothing, and that the right one unlocks. Also screenshots the
// delivered and delivery-problem states at desktop and mobile widths.
//
// Reads order ids written by the fulfillment tests into the scratchpad.
//
//   node tools/test-orderpage.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const SP = '/private/tmp/claude-501/-Users-rustem-code-mistbox/ae6e8ac3-af1e-480f-ab92-ae067f36b047/scratchpad';
const delivered = readFileSync(SP + '/orderid.txt', 'utf8').trim();
const problem = readFileSync(SP + '/orderid11.txt', 'utf8').trim();

const b = await chromium.launch();
const errs = [];

async function shoot(id, name, width) {
  const p = await b.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  p.on('console', m => m.type()==='error' && errs.push(`${name}: ${m.text().slice(0,110)}`));
  p.on('pageerror', e => errs.push(`${name} PAGEERROR: ${e.message.slice(0,110)}`));
  await p.goto(`http://localhost:3000/order/${encodeURIComponent(id)}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  // Horizontal overflow is a bug on a page people open on phones.
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) errs.push(`${name}: horizontal overflow at ${width}px`);
  await p.screenshot({ path: `${SP}/order-${name}.png`, fullPage: true });
  return p;
}

// 1. Locked state — what a forwarded link shows.
const p1 = await shoot(delivered, 'locked', 900);
const lockedText = await p1.locator('body').innerText();
console.log('LOCKED shows address?  ', /1 Pike Place/i.test(lockedText));
console.log('LOCKED shows total?    ', /\$100|\$160/.test(lockedText));
console.log('LOCKED shows tracking? ', /SHIPPO_TRANSIT/.test(lockedText));

// 2. Wrong email reveals nothing.
await p1.fill('#reveal-email', 'nobody@example.com');
await p1.click('.reveal button[type=submit]');
await p1.waitForTimeout(1500);
console.log('WRONG email error:     ', (await p1.locator('.reveal__error').innerText().catch(() => 'NONE')).slice(0, 60));
console.log('WRONG email leaked?    ', /1 Pike Place/i.test(await p1.locator('body').innerText()));

// 3. Right email unlocks.
await p1.fill('#reveal-email', 'rustem@mist.box');
await p1.click('.reveal button[type=submit]');
await p1.waitForTimeout(2500);
const openText = await p1.locator('body').innerText();
console.log('UNLOCKED address?      ', /Pike Place/i.test(openText));
console.log('UNLOCKED gift message? ', /Automated test order/i.test(openText));
await p1.screenshot({ path: SP + '/order-unlocked.png', fullPage: true });

// 4. Mobile, and the exception state.
await shoot(delivered, 'mobile', 390);
await shoot(problem, 'problem', 900);

console.log('issues:', errs.length ? errs : 'none');
await b.close();
