import { NextResponse } from 'next/server';
import { CUSTOMER_UPDATE } from '@/lib/queries';
import { saleorFetchAuthed, isValidEmail } from '@/lib/saleor';
import { META } from '@/lib/orderStatus';
import { findOrCreateCustomer } from '@/lib/customers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Leave your email" on the homepage — signup with no order attached.
 *
 * Shares `findOrCreateCustomer` with an order's own customer sync
 * (`src/lib/customers.ts`): no password, no `redirectUrl`, so nobody is ever
 * emailed or able to log in because of this, and the same handling for
 * Saleor's hidden-superuser lookup gap applies here too rather than being
 * reimplemented. It is genuinely simpler than the order-side call, though,
 * because there is no order to link — no address, and none of the "must
 * exist before checkoutComplete" timing that matters there.
 *
 * A past buyer signing up here a second time gets their *existing* record
 * updated, not a duplicate created.
 */
export async function POST(request: Request) {
  let body: { email?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const email = String(body.email ?? '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }

  try {
    const result = await findOrCreateCustomer(email, {
      metadata: [{ key: META.newsletterOptIn, value: 'true' }],
    });

    if (result.kind === 'existing' && !result.user.isStaff) {
      // A staff account sharing this email is left alone, same rule as the
      // order-side sync — never touched by anything a website visitor typed.
      const updated = await saleorFetchAuthed<{
        customerUpdate: { errors: Array<{ message: string | null }> };
      }>(CUSTOMER_UPDATE, {
        id: result.user.id,
        input: { metadata: [{ key: META.newsletterOptIn, value: 'true' }] },
      });
      if (updated.customerUpdate.errors.length) {
        throw new Error(updated.customerUpdate.errors.map((e) => e.message).join('; '));
      }
    } else if (result.kind === 'failed') {
      throw new Error(result.message);
    }
    // 'existing' (staff) and 'hidden' (a real, Saleor-hidden account) both
    // mean the same thing here: leave it alone, tell the visitor it worked.

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[mistbox] newsletter signup failed:', error);
    return NextResponse.json({ error: 'That did not work. Try again.' }, { status: 502 });
  }
}
