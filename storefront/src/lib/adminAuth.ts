import { createHmac } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { safeEqual } from '@/lib/safeEqual';

/**
 * The admin session — who is allowed to touch `/admin`, once they have signed
 * in. Signing in itself is `src/app/api/admin/login/route.ts`; this file only
 * covers proving, on every later request, that the sign-in still holds.
 *
 * Identity is a Saleor staff login: both people already need a Saleor password
 * to edit content in the dashboard, so this adds no new secret to remember and
 * no password storage of our own. The email a session names is real Saleor
 * identity, checked twice at login time — see the login route — never
 * something this file has to verify again.
 *
 * The session itself is stateless: a signed value the browser holds, verified
 * against this secret, with no server-side store to fall out of sync. That
 * matches the order-page reveal cookie (`src/lib/reveal.ts`), but this one
 * embeds its own expiry inside the signed payload rather than trusting the
 * browser to delete an expired cookie — worth the extra step here, since this
 * credential can act on every order rather than just one.
 */

export const ADMIN_COOKIE = 'mb_admin';
export const ADMIN_ALLOWED_DOMAIN = 'mist.box';

/** A tool opened once a day, not a banking session — long enough to not be
 *  annoying, short enough that a departed staff member's cookie goes stale. */
export const ADMIN_SESSION_MAX_AGE = 60 * 60 * 24 * 14;

export type AdminSession = { email: string };

function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s) throw new Error('ADMIN_SESSION_SECRET is not set.');
  return s;
}

export function isAllowedEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${ADMIN_ALLOWED_DOMAIN}`);
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('hex');
}

/**
 * `email|expiryEpoch|signature`. Piped, not dotted — an email address
 * legitimately contains dots (this domain is literally "mist.box"), so
 * joining fields with "." made every real session un-splittable back into its
 * three parts and rejected on read. "|" cannot appear in an email address.
 */
export function signSession(email: string): string {
  const expires = Math.floor(Date.now() / 1000) + ADMIN_SESSION_MAX_AGE;
  const payload = `${email.toLowerCase()}|${expires}`;
  return `${payload}|${sign(payload)}`;
}

export function readSession(cookieValue: string | undefined): AdminSession | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split('|');
  if (parts.length !== 3) return null;
  const [email, expiresRaw, signature] = parts;
  const payload = `${email}|${expiresRaw}`;

  if (!safeEqual(signature, sign(payload))) return null;

  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return null;

  // Belt and braces: a session should never exist for the wrong domain, but a
  // future secret rotation or bug should not silently grant one either.
  if (!isAllowedEmail(email)) return null;

  return { email };
}

/**
 * The check every admin route handler starts with: read the session cookie,
 * and hand back the 401 to return if there isn't one. Route handlers use it
 * as `const session = await requireAdminSession(); if (session instanceof
 * NextResponse) return session;` — five copies of the same four lines,
 * collapsed to one.
 *
 * Not used by `/admin`'s own page component: an RSC fails differently (with
 * a login screen, not a JSON response), so that check stays where it is.
 */
export async function requireAdminSession(): Promise<AdminSession | NextResponse> {
  const jar = await cookies();
  const session = readSession(jar.get(ADMIN_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  return session;
}

/** The cookie every sign-in — a fresh login or a password reset — ends
 *  with. Identical in both places, so it lives once. */
export function setAdminSessionCookie(response: NextResponse, email: string): void {
  response.cookies.set(ADMIN_COOKIE, signSession(email), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_SESSION_MAX_AGE,
  });
}
