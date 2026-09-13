import { NextResponse } from 'next/server';
import { REQUEST_PASSWORD_RESET } from '@/lib/queries';
import { saleorFetch, siteUrl } from '@/lib/saleor';
import { isAllowedEmail } from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "I forgot my password." Always answers the same way, whether or not the
 * address is real — the alternative would let anyone learn which @mist.box
 * addresses exist as staff accounts just by trying them here.
 */
const GENERIC_OK = { ok: true, message: 'If that is a mist.box staff account, a reset link is on its way.' };

export async function POST(request: Request) {
  let body: { email?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const email = String(body.email ?? '').trim();
  if (!email) return NextResponse.json({ error: 'Enter an email address.' }, { status: 400 });

  // Not a real gate — just skips a wasted Saleor call for an address that can
  // never be a valid admin account. The generic response is the real gate.
  if (isAllowedEmail(email)) {
    try {
      await saleorFetch(
        REQUEST_PASSWORD_RESET,
        { email, redirectUrl: `${siteUrl()}/admin/reset` },
        false,
      );
    } catch (error) {
      // Saleor unreachable is an operational problem, not the caller's to know
      // about — still answer generically, and let the log carry the detail.
      console.error('[mistbox] admin forgot-password: Saleor unreachable —', error);
    }
  }

  return NextResponse.json(GENERIC_OK);
}
