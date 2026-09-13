import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/adminAuth';
import { getOrderAuthed, noteOnOrder, setMetadata } from '@/lib/orders';
import { META, readMeta } from '@/lib/orderStatus';
import { purchaseLabel } from '@/lib/shippo';
import { emblemSrc, sendEmail } from '@/lib/email/send';
import { labelReadyEmail, labelReadyEmailText } from '@/lib/email/label';
import { ORDER_FULFILL, FIRST_WAREHOUSE } from '@/lib/queries';
import { formatMoney, fullName, saleorFetchAuthed, siteUrl } from '@/lib/saleor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type FulfillData = {
  orderFulfill: {
    fulfillments: Array<{ id: string; trackingNumber: string }> | null;
    errors: Array<{ field: string | null; message: string | null }>;
  };
};

type WarehouseData = { warehouses: { edges: Array<{ node: { id: string } }> } };

/** There is exactly one warehouse and it does not change between requests —
 *  worth caching for the process's life rather than asking Saleor again on
 *  every single label purchase. */
let cachedWarehouseId: string | null = null;

async function getFirstWarehouseId(): Promise<string> {
  if (cachedWarehouseId) return cachedWarehouseId;
  const data = await saleorFetchAuthed<WarehouseData>(FIRST_WAREHOUSE);
  const id = data.warehouses.edges[0]?.node.id;
  if (!id) throw new Error('No warehouse configured in Saleor.');
  cachedWarehouseId = id;
  return id;
}

/**
 * The one real spend in this whole feature. Everything before this route —
 * quoting a rate, showing it, requiring a second tap — exists so this call
 * only ever happens with a real number already seen and accepted by a person.
 */
export async function POST(request: Request) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;

  let body: {
    orderId?: string;
    rateId?: string;
    provider?: string;
    service?: string;
    amount?: string;
    currency?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const orderId = String(body.orderId ?? '');
  const rateId = String(body.rateId ?? '');
  if (!orderId || !rateId) {
    return NextResponse.json({ error: 'Missing order or rate.' }, { status: 400 });
  }

  const order = await getOrderAuthed(orderId).catch(() => null);
  if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });

  // The idempotency check that matters — the client button is one thing, but
  // a second real purchase for the same order must be impossible even from a
  // replayed or hand-crafted request.
  if (readMeta(order.metadata, META.labelTransactionId)) {
    return NextResponse.json({ error: 'A label has already been bought for this order.' }, { status: 409 });
  }

  let purchase;
  try {
    purchase = await purchaseLabel(rateId);
  } catch (error) {
    console.error('[mistbox] label purchase request failed:', error);
    return NextResponse.json({ error: 'Could not reach Shippo. Try again.' }, { status: 502 });
  }

  if (purchase.status !== 'SUCCESS' || !purchase.tracking_number || !purchase.label_url) {
    const detail = purchase.messages?.map((m) => m.text).join('; ');
    console.error('[mistbox] PURCHASE FAILED for order', order.number, detail);
    return NextResponse.json({ error: detail || 'The label could not be purchased.' }, { status: 502 });
  }

  const provider = body.provider ?? 'Carrier';
  const service = body.service ?? '';
  const cost = body.amount ? formatMoney(Number(body.amount), body.currency ?? 'USD') : 'unknown cost';

  // Written immediately, before anything else — this is what a retried or
  // duplicate request checks against, and Shippo has already been charged.
  await setMetadata(order.id, [
    { key: META.labelTransactionId, value: purchase.object_id },
    { key: META.labelCost, value: cost },
    { key: META.trackingCarrier, value: provider.toLowerCase() },
  ]);

  try {
    const warehouseId = await getFirstWarehouseId();

    // The same mutation Daniya's manual paste-into-Saleor step has always
    // used. Everything downstream — Shippo track registration, the "on its
    // way" email, the customer's own order-page timeline — is the existing
    // fulfillment webhook, entirely unchanged and untouched by this route.
    const fulfilled = await saleorFetchAuthed<FulfillData>(ORDER_FULFILL, {
      order: order.id,
      input: {
        trackingNumber: purchase.tracking_number,
        notifyCustomer: false,
        lines: order.lines.map((line) => ({
          orderLineId: line.id,
          stocks: [{ quantity: line.quantity, warehouse: warehouseId }],
        })),
      },
    });
    if (fulfilled.orderFulfill.errors.length) {
      throw new Error(fulfilled.orderFulfill.errors.map((e) => e.message).join('; '));
    }
  } catch (error) {
    // The label is bought and the money is spent — that cannot be undone from
    // here. What can still go right is telling a person loudly, since the
    // fallback is the same one a hand-pasted tracking number already has:
    // paste `purchase.tracking_number` into Saleor's own Fulfil screen.
    console.error(
      `[mistbox] LABEL BOUGHT BUT ORDER ${order.number} NOT FULFILLED — tracking ${purchase.tracking_number}:`,
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error: `Label bought (tracking ${purchase.tracking_number}) but Saleor was not updated. File this tracking number in Saleor by hand.`,
        trackingNumber: purchase.tracking_number,
        labelUrl: purchase.label_url,
      },
      { status: 500 },
    );
  }

  // Neither depends on the other's result, and both are slow (a Saleor
  // round-trip; a PDF fetch plus a Resend call) — no reason to serialize them.
  await Promise.all([
    noteOnOrder(order.id, `Mistbox — Label bought: ${provider} ${service} ${cost} (${session.email})`),
    sendLabelEmail(order, {
      carrier: provider,
      service,
      cost,
      trackingNumber: purchase.tracking_number,
      labelUrl: purchase.label_url,
    }),
  ]);

  return NextResponse.json({
    ok: true,
    trackingNumber: purchase.tracking_number,
    labelUrl: purchase.label_url,
  });
}


/**
 * Failure-isolated like every other send in this codebase: the label is
 * bought and Saleor is updated regardless of whether this email ever arrives.
 * The admin's own "View label" link is the fallback if it does not.
 */
async function sendLabelEmail(
  order: { number: string; shippingAddress: { firstName: string; lastName: string } | null },
  info: { carrier: string; service: string; cost: string; trackingNumber: string; labelUrl: string },
): Promise<void> {
  try {
    const pdf = await fetch(info.labelUrl).then((r) => r.arrayBuffer());
    const content = Buffer.from(pdf).toString('base64');
    const url = siteUrl();
    const recipientName = order.shippingAddress ? fullName(order.shippingAddress) : 'the recipient';

    const opts = {
      orderNumber: order.number,
      recipientName,
      carrier: info.carrier,
      service: info.service,
      cost: info.cost,
      trackingNumber: info.trackingNumber,
      emblemSrc: await emblemSrc(url),
      siteUrl: url,
    };

    const sent = await sendEmail({
      to: 'mrsdaniya@mist.box',
      subject: `Label ready to print — order ${order.number}`,
      html: labelReadyEmail(opts),
      text: labelReadyEmailText(opts),
      attachments: [
        { filename: `mistbox-order-${order.number}-label.pdf`, content, contentType: 'application/pdf' },
      ],
    });
    console.log(`[mistbox] label email for order ${order.number} sent (${sent.id})`);
  } catch (error) {
    console.error(
      `[mistbox] LABEL EMAIL NOT SENT for order ${order.number}:`,
      error instanceof Error ? error.message : error,
    );
  }
}
