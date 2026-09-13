// Screenshots every storefront page at three widths, for design review.
// Run: node tools/shoot.mjs [outDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? './shots';
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

const PAGES = [
  ['home', '/'],
  ['about', '/about'],
  ['order', '/order'],
];

const SIZES = [
  ['desktop', 1440, 900],
  ['tablet', 834, 1112],
  ['mobile', 390, 844],
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const problems = [];

for (const [sizeName, width, height] of SIZES) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`[console] ${sizeName} ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${sizeName} ${e.message}`));

  for (const [name, path] of PAGES) {
    const res = await page.goto(BASE + path, { waitUntil: 'networkidle' });
    if (!res || res.status() >= 400) {
      problems.push(`[http] ${path} returned ${res?.status()}`);
      continue;
    }
    // Let webfonts settle so type is measured, not swapped mid-shot.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);

    await page.screenshot({
      path: `${OUT}/${name}-${sizeName}.png`,
      fullPage: true,
    });

    // Horizontal overflow is the single most common responsive defect.
    const overflow = await page.evaluate(() => {
      const d = document.documentElement;
      return d.scrollWidth > d.clientWidth ? d.scrollWidth - d.clientWidth : 0;
    });
    if (overflow) problems.push(`[overflow] ${path} @${sizeName} +${overflow}px`);
  }

  await ctx.close();
}

await browser.close();

console.log(`shots written to ${OUT}`);
if (problems.length) {
  console.log('\nproblems:');
  for (const p of [...new Set(problems)]) console.log('  ' + p);
} else {
  console.log('no console errors, no horizontal overflow');
}
