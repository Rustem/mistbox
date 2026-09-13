import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison that also tolerates a length mismatch
 * without throwing — `timingSafeEqual` itself requires equal-length buffers,
 * so every caller needs the length check first regardless.
 *
 * Shared by every secret comparison in this codebase: admin sessions, the
 * order-reveal cookie, and the Saleor and Shippo webhook secrets. One place
 * to get this right rather than four independent copies.
 */
export function safeEqual(given: string | null | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
