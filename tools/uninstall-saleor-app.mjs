// Remove the "Mistbox rules" dashboard app (the PRODUCT_DETAILS_WIDGETS verdict
// panel). Superseded by dashboard/mistbox-inline-errors.js, which shows a
// refused save's real reason in sync with the form — see
// tools/install-saleor-app.mjs for the install side and the security notes.
//
//   node tools/uninstall-saleor-app.mjs --email you@example.com --password '…'
import fs from 'node:fs';
const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : undefined; };
const env = fs.readFileSync('storefront/.env.local', 'utf8');
const SALEOR = (env.match(/^SALEOR_API_URL=(.*)$/m) || [, 'http://localhost:8000/graphql/'])[1].trim();
const APP_NAME = 'Mistbox rules';
const email = arg('email'), password = arg('password');
if (!email || !password) { console.error('Pass --email and --password for a Saleor staff account.'); process.exit(1); }

let token;
const gql = async (query, variables) => {
  const res = await fetch(SALEOR, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data;
};

const login = await gql(
  `mutation($email:String!,$password:String!){tokenCreate(email:$email,password:$password){token errors{message}}}`,
  { email, password });
if (login.tokenCreate.errors?.length) throw new Error(login.tokenCreate.errors.map((e) => e.message).join('; '));
token = login.tokenCreate.token;

const existing = await gql(
  `query($search:String!){apps(first:20,filter:{search:$search}){edges{node{id name}}}}`, { search: APP_NAME });
const found = existing.apps.edges.map((e) => e.node).filter((n) => n.name === APP_NAME);
if (!found.length) { console.log(`No "${APP_NAME}" app installed. Nothing to do.`); process.exit(0); }
for (const app of found) {
  const r = await gql(`mutation($id:ID!){appDelete(id:$id){errors{message}}}`, { id: app.id });
  if (r.appDelete.errors?.length) throw new Error(r.appDelete.errors.map((e) => e.message).join('; '));
  console.log(`Removed ${APP_NAME} (${app.id})`);
}
