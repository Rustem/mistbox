export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where Saleor delivers the app's auth token once the app is installed.
 *
 * **The token is deliberately discarded.** That is not an oversight, so please
 * do not "finish" this later by storing it.
 *
 * The panel authenticates with Mistbox's own admin session cookie
 * (`src/lib/adminAuth.ts`) and reads through `SALEOR_APP_TOKEN`, which is
 * already audited and already scoped. A second live credential would widen the
 * blast radius and buy nothing: anything arriving from an embedded frame is
 * attacker-controllable and would have to be verified against Saleor's JWKS
 * before it meant anything.
 *
 * Saleor requires the endpoint to exist and answer 200, so it does.
 */
export function POST() {
  return new Response(null, { status: 200 });
}
