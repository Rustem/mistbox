// Installs the "Mistbox rules" app, which puts Mistbox's verdict on a gift
// box's product page in the Saleor dashboard.
//
//   node tools/install-saleor-app.mjs --email you@example.com --password '…'
//   node tools/install-saleor-app.mjs --email … --password … --force
//
// Staff credentials rather than SALEOR_APP_TOKEN: installing an app needs
// MANAGE_APPS, and the storefront's token does not hold it.
//
// Safe to re-run: an existing install is left alone unless --force replaces it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};
const force = argv.includes('--force');

const env = Object.fromEntries(
  readFileSync(path.join(root, 'storefront/.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const SALEOR = env.SALEOR_API_URL ?? 'http://localhost:8000/graphql/';
const APP_NAME = 'Mistbox rules';

// Saleor fetches the manifest from inside its own container, where `localhost`
// is the container itself — verified: host.docker.internal answers, localhost
// does not. Only this fetch is container-internal; the URLs inside the
// manifest are loaded by a browser and stay public.
const MANIFEST_ORIGIN =
  env.SALEOR_APP_MANIFEST_ORIGIN ??
  (env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(
    /^(https?:\/\/)(localhost|127\.0\.0\.1)/,
    '$1host.docker.internal',
  );
const manifestUrl = `${MANIFEST_ORIGIN.replace(/\/$/, '')}/api/saleor-app/manifest`;

const email = arg('email');
const password = arg('password');
if (!email || !password) {
  console.error('Pass --email and --password for a Saleor staff account.');
  process.exit(2);
}

let token = null;
const gql = async (query, variables = {}) => {
  const res = await fetch(SALEOR, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data;
};
const check = (errors, what) => {
  if (errors?.length) {
    throw new Error(`${what}: ${errors.map((e) => `${e.field ?? ''} ${e.message}`).join('; ')}`);
  }
};

console.log(`Saleor:   ${SALEOR}`);
console.log(`Manifest: ${manifestUrl}`);

const login = await gql(
  `mutation Login($email: String!, $password: String!) {
     tokenCreate(email: $email, password: $password) { token errors { field message code } }
   }`,
  { email, password },
);
check(login.tokenCreate.errors, 'Signing in');
token = login.tokenCreate.token;
console.log(`Signed in as ${email}`);

// ------------------------------------------------------------- existing?
// Before the dry run, not after: Saleor refuses to even parse a manifest whose
// identifier is already installed, so checking second makes every re-run a
// crash instead of a clean no-op.
const existing = await gql(
  `query FindApp($search: String!) {
     apps(first: 20, filter: { search: $search }) { edges { node { id name } } }
   }`,
  { search: APP_NAME },
);
const found = existing.apps.edges.map((e) => e.node).filter((n) => n.name === APP_NAME);

if (found.length && !force) {
  console.log(`\n${APP_NAME} is already installed. Nothing to do.`);
  console.log('Re-run with --force to remove and reinstall it.');
  process.exit(0);
}
for (const app of found) {
  const removed = await gql(
    `mutation RemoveApp($id: ID!) { appDelete(id: $id) { errors { field message code } } }`,
    { id: app.id },
  );
  check(removed.appDelete.errors, 'Removing the old app');
  console.log(`Removed previous ${APP_NAME} (${app.id})`);
}

// ------------------------------------------------------------- dry run
// `appFetchManifest` is a MUTATION, not a query. It asks Saleor to fetch and
// parse without creating anything, and names the offending field when it fails.
const fetched = await gql(
  `mutation DryRun($url: String!) {
     appFetchManifest(manifestUrl: $url) {
       manifest { name extensions { label mountName targetName url } }
       errors { field message code }
     }
   }`,
  { url: manifestUrl },
);
check(fetched.appFetchManifest.errors, 'Fetching the manifest');
const parsed = fetched.appFetchManifest.manifest;
console.log(`\nSaleor parsed the manifest as:`);
console.log(`  name: ${parsed.name}`);
for (const e of parsed.extensions ?? []) {
  console.log(`  extension: ${e.label} — ${e.mountName} / ${e.targetName}`);
  console.log(`             ${e.url}`);
}
if (!parsed.extensions?.length) {
  throw new Error('Saleor parsed no extensions — the panel would never render.');
}

const installed = await gql(
  `mutation InstallApp($input: AppInstallInput!) {
     appInstall(input: $input) {
       appInstallation { id status appName }
       errors { field message code }
     }
   }`,
  {
    input: {
      appName: APP_NAME,
      manifestUrl,
      permissions: ['MANAGE_PRODUCTS'],
      activateAfterInstallation: true,
    },
  },
);
check(installed.appInstall.errors, 'Installing the app');
const job = installed.appInstall.appInstallation;
console.log(`\nInstall queued: ${job.appName} (${job.status})`);

for (let i = 0; i < 15; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const poll = await gql(`query InstallStatus { appsInstallations { id status message } }`);
  const state = poll.appsInstallations.find((j) => j.id === job.id);
  if (!state) {
    console.log('Installed. The panel appears on a gift box product page in the dashboard.');
    process.exit(0);
  }
  if (state.status === 'FAILED') {
    console.error(`Install failed: ${state.message ?? 'no reason given'}`);
    process.exit(1);
  }
}
console.log('Still installing — check Configuration → Extensions in the dashboard.');
