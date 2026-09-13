import { NextResponse } from 'next/server';
import { getOrder } from '@/lib/orders';
import { REVEAL_MAX_AGE, cookieName, emailMatches, revealToken } from '@/lib/reveal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Unlocks the private half of an order page.
 *
 * The comparison happens here, on the server: the buyer's email is never sent
 * to the browser, so a wrong guess reveals nothing at all — not even how close
 * it was.
 */
export async function POST(request: Request) {
  let body: { orderId?: string; email?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const orderId = String(body.orderId ?? '');
  const email = String(body.email ?? '');
  if (!orderId || !email) {
    return NextResponse.json({ error: 'Enter the email you ordered with.' }, { status: 400 });
  }

  const order = await getOrder(orderId, false).catch(() => null);
  if (!order || !emailMatches(email, order.userEmail)) {
    // Same message either way. Distinguishing "no such order" from "wrong
    // email" would turn this into a way to test whether an order exists.
    return NextResponse.json(
      { error: 'That does not match the email on this order.' },
      { status: 403 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(cookieName(orderId), revealToken(orderId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: `/order/${orderId}`,
    maxAge: REVEAL_MAX_AGE,
  });
  return response;
}
