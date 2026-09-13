// Registers the webhooks Mistbox depends on, so the setup is reproducible
// rather than clicked into a dashboard once and forgotten.
//
//   node tools/register-webhooks.mjs [--force]
//
// Reads storefront/.env.local. Safe to re-run: existing webhooks with the same
// target are left alone unless --force replaces them.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');

const env = Object.fromEntries(
  readFileSync(path.join(root, 'storefront/.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const need = (k) => {
  if (!env[k]) throw new Error(`${k} is missing from storefront/.env.local`);
  return env[k];
};

const SALEOR = env.SALEOR_API_URL ?? 'http://localhost:8000/graphql/';
const SITE = (env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

// Saleor runs in Docker, so "localhost" from inside its container is the
// container, not this machine. Every local setup needs this rewrite, and
// forgetting it produces a webhook that silently never arrives.
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(SITE);
const saleorTarget = isLocal
  ? SITE.replace(/localhost|127\.0\.0\.1/, 'host.docker.internal')
  : SITE;

async function gql(query, variables = {}) {
  const res = await fetch(SALEOR, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${need('SALEOR_APP_TOKEN')}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e) => e.message).join('; '));
  return json.data;
}

// FULFILLMENT_TRACKING_NUMBER_UPDATED only, deliberately.
//
// Saleor fires FULFILLMENT_CREATED *as well* when an order is fulfilled with a
// tracking number in one step, and the two arrive simultaneously. Both would
// pass the "already registered" guard before either had written it, sending two
// shipped emails and — far worse — registering the track with Shippo twice,
// which is not idempotent and cannot be undone.
//
// Subscribing to one event removes the race at its source. Nothing is lost:
// this event fires both when a fulfillment is created with a number and when
// one is added afterwards, which are the only two ways a box ever ships.
const SUBSCRIPTION = `subscription MistboxFulfillmentEvents {
  event {
    __typename
    ... on FulfillmentTrackingNumberUpdated { fulfillment { id trackingNumber } order { id number } }
  }
}`;

async function registerSaleor() {
  const url = `${saleorTarget}/api/saleor/webhook`;

  // Read through `app`, not the top-level `webhooks` query: that one needs
  // MANAGE_APPS and, with an app token, returns an empty list rather than an
  // error. Trusting it meant every run of this script created *another*
  // webhook, and each one delivered — three shipped emails for one order.
  const existing = (await gql(`{ app { webhooks { id name targetUrl isActive } } }`)).app.webhooks;

  // Match on the path, not the full URL. A registration made before the host
  // was rewritten for Docker is still a duplicate and still delivers.
  const path = new URL(url).pathname;
  const mine = existing.filter((w) => {
    try {
      return new URL(w.targetUrl).pathname === path;
    } catch {
      return false;
    }
  });

  if (mine.length && !force) {
    console.log(`  saleor  already registered (${mine.length}) → ${url}`);
    if (mine.length > 1) console.log('          more than one — re-run with --force to collapse them');
    return;
  }

  for (const w of mine) {
    const res = await gql(
      `mutation ($id: ID!) { webhookDelete(id: $id) { errors { field message } } }`,
      { id: w.id },
    );
    const errs = res.webhookDelete.errors;
    if (errs?.length) throw new Error(errs.map((e) => e.message).join('; '));
    console.log(`  saleor  removed previous registration ${w.id}`);
  }

  const data = await gql(
    `mutation ($input: WebhookCreateInput!) {
       webhookCreate(input: $input) {
         webhook { id name targetUrl isActive }
         errors { field message code }
       }
     }`,
    {
      input: {
        name: 'Mistbox — fulfillment',
        targetUrl: url,
        isActive: true,
        asyncEvents: ['FULFILLMENT_TRACKING_NUMBER_UPDATED'],
        query: SUBSCRIPTION,
        // Saleor signs payloads with a JWS, but a shared header is simpler to
        // verify and enough for a secret both ends already hold.
        // Saleor only permits custom header names matching X-*, Authorization*
        // or BrokerProperties, hence the X- prefix.
        customHeaders: JSON.stringify({
          'X-Mistbox-Webhook-Secret': need('SALEOR_WEBHOOK_SECRET'),
        }),
      },
    },
  );

  const errors = data.webhookCreate.errors;
  if (errors?.length) throw new Error(errors.map((e) => `${e.field}: ${e.message}`).join('; '));
  console.log(`  saleor  registered → ${url}`);
}

async function registerShippo() {
  const url = `${SITE}/api/shippo/webhook?token=${need('SHIPPO_WEBHOOK_TOKEN')}`;

  if (isLocal) {
    console.log('  shippo  skipped — Shippo cannot reach a localhost URL.');
    console.log('          Test it by posting a track_updated payload to:');
    console.log(`          ${url}`);
    return;
  }

  const headers = {
    Authorization: `ShippoToken ${need('SHIPPO_API_TOKEN')}`,
    'Shippo-API-Version': '2018-02-08',
    'Content-Type': 'application/json',
  };

  const list = await fetch('https://api.goshippo.com/webhooks', { headers }).then((r) => r.json());
  const hooks = list.results ?? (Array.isArray(list) ? list : []);
  if (hooks.some((w) => w.url === url) && !force) {
    console.log(`  shippo  already registered → ${url}`);
    return;
  }

  const created = await fetch('https://api.goshippo.com/webhooks', {
    method: 'POST',
    headers,
    body: JSON.stringify({ url, event: 'track_updated', is_active: true }),
  }).then((r) => r.json());

  if (created.detail) throw new Error(`Shippo: ${created.detail}`);
  console.log(`  shippo  registered → ${url}`);
}

console.log('registering webhooks');
await registerSaleor();
await registerShippo();
console.log('done');
