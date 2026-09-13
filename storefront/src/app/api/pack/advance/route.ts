import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/adminAuth';
import { advanceStage, getOrderAuthed } from '@/lib/orders';
import { STAGES, type Stage } from '@/lib/orderStatus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Move one order to the stage Daniya just tapped.
 *
 * The target stage is sent explicitly rather than inferred as "the next one",
 * so a double tap on a slow connection cannot skip a stage — `advanceStage`
 * simply reports no change the second time.
 */
export async function POST(request: Request) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;

  let body: { orderId?: string; stage?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const stage = String(body.stage ?? '') as Stage;
  if (!(STAGES as readonly string[]).includes(stage)) {
    return NextResponse.json({ error: 'Unknown stage.' }, { status: 400 });
  }

  const order = await getOrderAuthed(String(body.orderId ?? '')).catch(() => null);
  if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });

  const changed = await advanceStage(order, stage, [], session.email);
  return NextResponse.json({ ok: true, stage, changed });
}
