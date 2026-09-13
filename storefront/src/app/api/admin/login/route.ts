import { NextResponse } from 'next/server';
import { TOKEN_CREATE } from '@/lib/queries';
import { saleorFetch } from '@/lib/saleor';
import { isAllowedEmail, setAdminSessionCookie } from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TokenCreateData = {
  tokenCreate: {
    token: string | null;
    user: { email: string; isStaff: boolean } | null;
    errors: Array<{ message: string | null }>;
  };
};

/**
 * One generic failure message covers a wrong password, an unknown address,
 * a non-staff account, and a real login from outside @mist.box. Telling those
 * apart would tell an attacker which check to work on next.
 *
 * Built fresh on every call, not shared as a module-level constant: a
 * NextResponse's body is a one-shot stream, so a single reused instance would
 * serve its real body to only the first caller and an empty one to everyone
 * after — exactly the bug this function replaced.
 */
function denied() {
  return NextResponse.json({ error: 'That email or password is not right.' }, { status: 401 });
}

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const email = String(body.email ?? '').trim();
  const password = String(body.password ?? '');
  if (!email || !password) return denied();

  // Cheap check first: an address that can never qualify shouldn't cost a
  // round trip to Saleor.
  if (!isAllowedEmail(email)) return denied();

  let data: TokenCreateData;
  try {
    // Not cached, and not the app's authenticated client — this is a
    // password grant made on the caller's behalf, once, then discarded.
    data = await saleorFetch<TokenCreateData>(TOKEN_CREATE, { email, password }, false);
  } catch (error) {
    console.error('[mistbox] admin login: Saleor unreachable —', error);
    return NextResponse.json({ error: 'Could not reach Saleor. Try again.' }, { status: 502 });
  }

  const { token, user, errors } = data.tokenCreate;
  if (errors.length || !token || !user) return denied();

  // Re-check the domain against what Saleor actually returned, not just what
  // was typed — the two could differ, and the returned one is the one that
  // matters. isStaff keeps an @mist.box customer account, if one ever exists,
  // from getting in just for sharing the domain.
  if (!isAllowedEmail(user.email) || !user.isStaff) return denied();

  const response = NextResponse.json({ ok: true, email: user.email });
  setAdminSessionCookie(response, user.email);
  return response;
}
