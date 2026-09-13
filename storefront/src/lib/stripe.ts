import Stripe from 'stripe';

let cached: Stripe | null = null;

export function stripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set. Copy .env.example to .env.local.');
  }
  // Pinned rather than left to the SDK default so that upgrading the package
  // is a deliberate, reviewable change instead of a silent behaviour shift.
  // Must be a version this SDK major knows about — see node_modules/stripe/cjs/apiVersion.js.
  cached = new Stripe(key, { apiVersion: '2026-08-26.dahlia' });
  return cached;
}

/**
 * Tag for `integration_identifier` on Checkout Sessions, so this flow can be
 * told apart from any other in the Stripe dashboard. Stripe asks for a random
 * eight-letter suffix; it is fixed here because it identifies the integration,
 * not the session.
 */
export const INTEGRATION_ID = 'mistbox-checkout-qkfhwlzt';
