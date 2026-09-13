import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/adminAuth';
import { getOrderAuthed } from '@/lib/orders';
import { META, readMeta } from '@/lib/orderStatus';
import { getTransaction } from '@/lib/shippo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "View label" from the admin. Re-fetches from Shippo by the stored
 * transaction id every time, rather than trusting a URL saved at purchase
 * time — this is the fallback for whenever the label email did not arrive,
 * so it must not depend on anything that email-flow-specific.
 */
export async function GET(request: Request) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;

  const orderId = new URL(request.url).searchParams.get('order');
  if (!orderId) return NextResponse.json({ error: 'Missing order id.' }, { status: 400 });

  const order = await getOrderAuthed(orderId).catch(() => null);
  if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });

  const transactionId = readMeta(order.metadata, META.labelTransactionId);
  if (!transactionId) {
    return NextResponse.json({ error: 'No label has been bought for this order.' }, { status: 404 });
  }

  try {
    const transaction = await getTransaction(transactionId);
    if (!transaction.label_url) {
      return NextResponse.json({ error: 'Shippo has no label file for this transaction.' }, { status: 502 });
    }
    return NextResponse.redirect(transaction.label_url);
  } catch (error) {
    console.error('[mistbox] label view failed:', error);
    return NextResponse.json({ error: 'Could not reach Shippo.' }, { status: 502 });
  }
}
