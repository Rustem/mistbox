import { NextResponse } from 'next/server';
import { buildEmailOpts, sendEmail } from '@/lib/email/send';
import { shippedEmail, shippedEmailText } from '@/lib/email/shipping';
import { META, inferCarrier, readMeta } from '@/lib/orderStatus';
import { advanceStage, getOrderAuthed, orderUrl, type Order } from '@/lib/orders';
import { registerTrack } from '@/lib/shippo';
import { safeEqual } from '@/lib/safeEqual';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Saleor tells us a box has shipped.
 *
 * The trigger is Daniya pasting a tracking number into the dashboard when she
 * fulfils the order — the same action she would take anyway. Nothing here asks
 * her to learn a new tool.
 *
 * Registered by `node tools/register-webhooks.mjs`, which sets the shared
 * secret this route checks. Saleor only allows custom header names matching
 * `X-*`, `Authorization*` or `BrokerProperties`, hence the prefix.
 */

/**
 * Saleor posts the subscription's `event` object **flat** — no GraphQL `data`
 * envelope around it, despite the payload being a subscription result. Both
 * shapes are accepted here: the flat one is what 3.23 actually sends, and
 * tolerating the wrapped form costs one line should that ever change.
 */
type EventBody = {
  __typename?: string;
  fulfillment?: { id: string; trackingNumber: string } | null;
  order?: { id: string; number: string } | null;
};

type FulfillmentEvent = EventBody & { data?: { event?: EventBody | null } | null };

export async function POST(request: Request) {
  const expected = process.env.SALEOR_WEBHOOK_SECRET;
  if (!expected) {
    console.error('[mistbox] SALEOR_WEBHOOK_SECRET is not set');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  if (!safeEqual(request.headers.get('x-mistbox-webhook-secret'), expected)) {
    console.warn('[mistbox] saleor webhook rejected: bad or missing secret');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: FulfillmentEvent;
  try {
    payload = (await request.json()) as FulfillmentEvent;
  } catch {
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 });
  }

  const event: EventBody = payload.data?.event ?? payload;
  const trackingNumber = (event?.fulfillment?.trackingNumber ?? '').trim();
  const orderId = event?.order?.id;

  // A fulfillment can be created before a tracking number exists; the tracking
  // update event follows when Daniya adds one. Nothing to do until then.
  if (!orderId || !trackingNumber) {
    return NextResponse.json({ received: true, waiting: 'tracking number' });
  }

  try {
    const order = await getOrderAuthed(orderId);
    if (!order) {
      console.error('[mistbox] saleor webhook: order not found', orderId);
      return NextResponse.json({ received: true });
    }

    // Shippo's track registration is NOT idempotent — registering the same
    // number twice produces duplicate notifications for every later event,
    // permanently, with no way to undo it. This flag is the only thing standing
    // between a redelivered webhook and a customer getting two of every email.
    if (readMeta(order.metadata, META.shippoRegistered) === trackingNumber) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    const carrier = readMeta(order.metadata, META.trackingCarrier) || inferCarrier(trackingNumber);

    // Register first, then flag. Registering and failing to flag costs one
    // duplicate registration; flagging and failing to register would leave the
    // order permanently untracked, which is worse.
    let registered = false;
    try {
      await registerTrack(carrier, trackingNumber, `order:${order.id}`);
      registered = true;
    } catch (error) {
      // A Shippo outage must not stop the customer being told it shipped.
      console.error(
        `[mistbox] SHIPPO REGISTRATION FAILED for order ${order.number} (${trackingNumber}):`,
        error instanceof Error ? error.message : error,
      );
    }

    const moved = await advanceStage(order, 'shipped', [
      { key: META.trackingNumber, value: trackingNumber },
      { key: META.trackingCarrier, value: carrier },
      ...(registered ? [{ key: META.shippoRegistered, value: trackingNumber }] : []),
    ]);

    if (moved) await sendShipped(order, trackingNumber, carrier);

    return NextResponse.json({ received: true, orderNumber: order.number, registered });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[mistbox] saleor webhook failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Failure-isolated: an email problem must never make Saleor retry this. */
async function sendShipped(order: Order, trackingNumber: string, carrier: string): Promise<void> {
  try {
    const ship = {
      trackingNumber,
      carrier,
      eta: readMeta(order.metadata, META.trackingEta) || null,
      orderUrl: orderUrl(order.id),
    };
    const opts = await buildEmailOpts('email-order-shipped');
    const sent = await sendEmail({
      to: order.userEmail,
      subject: opts.copy.subject,
      html: shippedEmail(order, ship, opts),
      text: shippedEmailText(order, ship, opts),
    });
    console.log(`[mistbox] shipped email for order ${order.number} sent (${sent.id})`);
  } catch (error) {
    console.error(
      `[mistbox] SHIPPED EMAIL NOT SENT for order ${order.number}:`,
      error instanceof Error ? error.message : error,
    );
  }
}
