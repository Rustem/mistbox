// Screenshot storefront routes, for looking at a change rather than trusting it.
//
//   node tools/ui-shots.mjs <out-dir> '[{"name":"build","url":"http://localhost:3000/build"}]'
//
// Each entry takes an optional `w`/`h` viewport, a `do` list of {click} steps,
// and `full` for a whole-page capture. Note that `full: true` displaces
// `position: sticky` elements in Chromium — to judge a sticky panel, leave it
// off and scroll to the section instead.
import fs from 'node:fs';
import { chromium } from 'playwright';

const OUT = process.argv[2];
const SHOTS = JSON.parse(process.argv[3]);
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
for (const s of SHOTS) {
  const ctx = await browser.newContext({
    viewport: { width: s.w ?? 1280, height: s.h ?? 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  // A page that logged an error is not a page worth judging by eye.
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(s.url, { waitUntil: 'networkidle' });
  for (const step of s.do ?? []) {
    if (step.click) await page.click(step.click);
    if (step.scrollTo) await page.locator(step.scrollTo).scrollIntoViewIfNeeded();
    await page.waitForTimeout(180);
  }
  await page.screenshot({ path: `${OUT}/${s.name}.png`, fullPage: s.full ?? false });
  console.log(`  ${s.name}  ${errors.length ? 'ERRORS: ' + errors.slice(0, 3).join(' | ') : 'clean'}`);
  await ctx.close();
}
await browser.close();
