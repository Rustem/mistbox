import { NextResponse } from 'next/server';
import { SET_PASSWORD } from '@/lib/queries';
import { saleorFetch } from '@/lib/saleor';
import { isAllowedEmail, setAdminSessionCookie } from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SetPasswordData = {
  setPassword: {
    user: { email: string; isStaff: boolean } | null;
    errors: Array<{ message: string | null; code: string | null }>;
  };
};

/**
 * The other half of "forgot password": the link from that email lands here
 * with a token, and a new password completes the reset.
 *
 * Unlike the login route's deliberately generic failure message, Saleor's own
 * errors are shown as-is here — an expired link or a too-weak password are
 * useful for the person to know, and there is no equivalent enumeration risk:
 * whoever is calling this already holds a token that could only have reached
 * them by having the mailbox.
 */
export async function POST(request: Request) {
  let body: { email?: string; token?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const email = String(body.email ?? '').trim();
  const token = String(body.token ?? '').trim();
  const password = String(body.password ?? '');

  if (!email || !token || !password) {
    return NextResponse.json({ error: 'Fill in every field.' }, { status: 400 });
  }
  if (!isAllowedEmail(email)) {
    return NextResponse.json({ error: 'That is not a mist.box address.' }, { status: 400 });
  }

  let data: SetPasswordData;
  try {
    data = await saleorFetch<SetPasswordData>(SET_PASSWORD, { email, password, token }, false);
  } catch (error) {
    console.error('[mistbox] admin reset: Saleor unreachable —', error);
    return NextResponse.json({ error: 'Could not reach Saleor. Try again.' }, { status: 502 });
  }

  const { user, errors } = data.setPassword;
  if (errors.length) {
    // "INVALID" covers both an expired link and a link already used once —
    // Saleor does not distinguish, and neither needs to for the person to know
    // what to do next: ask for a new one.
    return NextResponse.json({ error: errors[0].message ?? 'That link no longer works.' }, { status: 400 });
  }
  if (!user || !isAllowedEmail(user.email) || !user.isStaff) {
    return NextResponse.json({ error: 'That account cannot sign in here.' }, { status: 403 });
  }

  // The token just proved mailbox ownership as convincingly as a password
  // would — sign them straight in rather than making them log in again with
  // the password they only just chose.
  const response = NextResponse.json({ ok: true, email: user.email });
  setAdminSessionCookie(response, user.email);
  return response;
}
