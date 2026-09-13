// Validates every GraphQL document in the project against Saleor's schema.
// Run: node tools/check-graphql.mjs
import { readFileSync } from 'node:fs';
import { buildSchema, parse, validate, specifiedRules } from 'graphql';

const schema = buildSchema(
  readFileSync(new URL('./saleor-3.23.graphql', import.meta.url), 'utf8'),
  { assumeValidSDL: true },
);

const sources = [
  ['storefront/src/lib/queries.ts', /\/\* GraphQL \*\/\s*`([\s\S]*?)`/g],
  ['seed/seed.py', /"""\s*(\s*(?:query|mutation)[\s\S]*?)"""/g],
  ['seed/media.py', /(?:"""|= """)\s*((?:query|mutation)[\s\S]*?)"""/g],
  ['seed/inventory.py', /(?:"""|= """)\s*((?:query|mutation)[\s\S]*?)"""/g],
  ['seed/content.py', /(?:"""|= """)\s*((?:query|mutation)[\s\S]*?)"""/g],
];

let total = 0;
let failed = 0;

for (const [file, pattern] of sources) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const docs = [...text.matchAll(pattern)].map((m) => m[1]);
  console.log(`\n${file} — ${docs.length} documents`);

  for (const doc of docs) {
    total++;
    const name = (doc.match(/(?:query|mutation)\s+(\w+)/) ?? [, '<anonymous>'])[1];
    try {
      const errs = validate(schema, parse(doc), specifiedRules);
      if (errs.length) {
        failed++;
        console.log(`  FAIL  ${name}`);
        for (const e of errs) console.log(`          ${e.message}`);
      } else {
        console.log(`  ok    ${name}`);
      }
    } catch (e) {
      failed++;
      console.log(`  PARSE FAIL  ${name}: ${e.message}`);
    }
  }
}

console.log(`\n${total - failed}/${total} documents valid against Saleor 3.23`);
process.exit(failed ? 1 : 0);
