import { createHmac } from 'node:crypto';
import { safeEqual } from '@/lib/safeEqual';

/**
 * The order page shows status and tracking to anyone holding the link, and
 * hides the address, gift message and prices until the buyer proves their
 * email.
 *
 * The threat this addresses is a **forwarded link**, not a guessed one — the
 * order id is a v4 UUID and cannot be enumerated. For a gift shop the forward
 * is the real risk: a recipient who opened the link would learn both the price
 * of their present and what was written on the card.
 *
 * The proof is a cookie holding an HMAC of the order id. It is not a session
 * and grants nothing beyond one order.
 */

const COOKIE_PREFIX = 'mb_reveal_';

/** Long enough to finish reading, short enough that a shared laptop forgets. */
export const REVEAL_MAX_AGE = 60 * 60 * 12;

function secret(): string {
  const s = process.env.ORDER_REVEAL_SECRET ?? process.env.SALEOR_APP_TOKEN;
  if (!s) throw new Error('ORDER_REVEAL_SECRET is not set.');
  return s;
}

export function cookieName(orderId: string): string {
  return COOKIE_PREFIX + createHmac('sha256', 'mistbox-cookie-name').update(orderId).digest('hex').slice(0, 16);
}

export function revealToken(orderId: string): string {
  return createHmac('sha256', secret()).update(`reveal:${orderId}`).digest('hex');
}

export function tokenValid(orderId: string, given: string | undefined): boolean {
  return safeEqual(given, revealToken(orderId));
}

/**
 * Emails are compared case- and whitespace-insensitively. Someone typing their
 * own address back in should not be defeated by a capital letter.
 */
export function emailMatches(entered: string, onOrder: string | null): boolean {
  const norm = (s: string) => s.trim().toLowerCase();
  return Boolean(onOrder) && norm(entered) === norm(onOrder as string);
}
