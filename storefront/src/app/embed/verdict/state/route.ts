import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ADMIN_COOKIE, readSession } from '@/lib/adminAuth';
import { loadBoxCatalogue } from '@/lib/catalogue';
import { summariseBox } from '@/lib/boxSheet';
import { formatMoney } from '@/lib/saleor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The verdict, as JSON, so the panel can keep itself current.
 *
 * The panel is an iframe the dashboard renders once. It is a WIDGET, and the
 * dashboard only sends form events to POPUP extensions — `o === "POPUP"` in
 * its own bundle — so nothing tells us when a box was saved. Without this the
 * panel keeps showing whatever was true when the page loaded, which is how it
 * came to say "ready to send" about a box that had just been refused.
 */
export async function GET(request: Request) {
  const jar = await cookies();
  if (!readSession(jar.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const productId = new URL(request.url).searchParams.get('productId');
  if (!productId) return NextResponse.json({ error: 'No product.' }, { status: 400 });

  const catalogue = await loadBoxCatalogue();
  const tier = [...catalogue.tiers.values()].find((t) => t.productId === productId);
  if (!tier) return NextResponse.json({ error: 'Not a gift box.' }, { status: 404 });

  const box = summariseBox(tier, catalogue);
  return NextResponse.json({
    blocked: box.blocked,
    price: formatMoney(box.total, box.currency),
    pieces: box.filled,
    slots: box.slots,
  });
}
