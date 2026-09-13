import { NextResponse } from 'next/server';
import { siteUrl } from '@/lib/saleor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The Saleor app manifest — how Mistbox gets a panel onto a box's product page.
 *
 * The app does almost nothing. It holds no token we use and makes no API calls
 * of its own; it exists because a dashboard extension can *only* be registered
 * through a manifest, via `appInstall`. There is no `appExtensionCreate`.
 *
 * The keys are `mount` and `target`, not the `mountName` / `targetName` the
 * GraphQL type reads back — Saleor's `_clean_extensions` reads `mount` and
 * `target` and lowercases them for storage. It validates neither against a
 * list, so a wrong value installs happily and then never renders.
 */

/**
 * The origin Saleor's *server* can reach us on, which is not always the one a
 * browser uses.
 *
 * `tokenTargetUrl` is fetched server-to-server during installation, so in local
 * development it cannot say `localhost` — inside Saleor's container that is the
 * container itself, and the install fails with "Failed to connect to app".
 * Docker Desktop publishes the host as `host.docker.internal`; in production
 * both origins are the same public address and this rewrite does nothing.
 */
function callbackOrigin(): string {
  const explicit = process.env.SALEOR_APP_CALLBACK_ORIGIN;
  if (explicit) return explicit.replace(/\/$/, '');
  return siteUrl().replace(/^(https?:\/\/)(localhost|127\.0\.0\.1)/, '$1host.docker.internal');
}

export function GET() {
  // Two origins on purpose: `appUrl` and the extension's `url` are opened by
  // the operator's browser and must stay public; `tokenTargetUrl` is fetched
  // by Saleor itself and must be reachable from inside its container.
  const site = siteUrl();

  return NextResponse.json({
    id: 'box.mist.composer',
    version: '1.0.0',
    name: 'Mistbox rules',
    about:
      'Says whether a gift box can actually be sold, in a sentence the dashboard cannot show on its own.',
    permissions: ['MANAGE_PRODUCTS'],
    appUrl: `${site}/embed/about`,
    tokenTargetUrl: `${callbackOrigin()}/api/saleor-app/register`,
    extensions: [
      {
        label: 'Mistbox',
        mount: 'PRODUCT_DETAILS_WIDGETS',
        target: 'WIDGET',
        permissions: ['MANAGE_PRODUCTS'],
        url: `${site}/embed/verdict`,
      },
    ],
  });
}
