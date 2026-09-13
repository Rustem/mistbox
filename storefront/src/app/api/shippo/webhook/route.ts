import { NextResponse } from 'next/server';
import { buildEmailOpts, sendEmail } from '@/lib/email/send';
import { deliveredEmail, deliveredEmailText } from '@/lib/email/shipping';
import { META, isException, stageForCarrierStatus } from '@/lib/orderStatus';
import { advanceStage, getOrderAuthed, orderUrl, type Order } from '@/lib/orders';
import type { TrackUpdatedEvent } from '@/lib/shippo';
import { safeEqual } from '@/lib/safeEqual';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Shippo tells us where a box has got to.
 *
 * **Authentication is a secret in the URL**, compared in constant time. Shippo
 * does support HMAC — header `Shippo-Auth-Signature`, formatted
 * `t=<timestamp>,v1=<sha256 hmac of "<timestamp>.<body>">`, the same shape as
 * Stripe's — but it has to be provisioned by their team and takes up to ten
 * business days. When the secret arrives, verify that header here and the URL
 * token becomes a belt-and-braces second check.
 *
 * The risk this accepts is small and worth naming: someone who learned the URL
 * could post a false status. They could not read anything, spend anything, or
 * reach any other order, and the stage guard means the worst case is a
 * premature "it arrived" email.
 */

export async function POST(request: Request) {
  const expected = process.env.SHIPPO_WEBHOOK_TOKEN;
  if (!expected) {
    console.error('[mistbox] SHIPPO_WEBHOOK_TOKEN is not set');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const token = new URL(request.url).searchParams.get('token');
  if (!safeEqual(token, expected)) {
    console.warn('[mistbox] shippo webhook rejected: bad or missing token');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let event: TrackUpdatedEvent;
  try {
    event = (await request.json()) as TrackUpdatedEvent;
  } catch {
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 });
  }

  if (event.event !== 'track_updated') {
    return NextResponse.json({ received: true, ignored: event.event });
  }

  // `metadata` is set when we register the track and echoed back on every
  // event. It is the only link from a tracking number to an order.
  const orderId = (event.data?.metadata ?? '').replace(/^order:/, '').trim();
  const status = event.data?.tracking_status?.status;

  if (!orderId || !status) {
    console.warn('[mistbox] shippo webhook without order metadata or status', event.data?.tracking_number);
    return NextResponse.json({ received: true });
  }

  try {
    const order = await getOrderAuthed(orderId);
    if (!order) {
      console.error('[mistbox] shippo webhook: order not found', orderId);
      return NextResponse.json({ received: true });
    }

    const detail = event.data.tracking_status?.status_details ?? '';
    const location = event.data.tracking_status?.location;
    const where = [location?.city, location?.state].filter(Boolean).join(', ');

    const meta = [
      { key: META.trackingStatus, value: status },
      { key: META.trackingDetail, value: [detail, where && `(${where})`].filter(Boolean).join(' ') },
      ...(event.data.eta ? [{ key: META.trackingEta, value: event.data.eta }] : []),
    ];

    // Returns, failed deliveries and anything flagged action_required are not
    // progress. They never move the timeline — they need a person, so they are
    // recorded loudly and surfaced on the order page instead.
    const substatus = event.data.tracking_status?.substatus;
    if (isException(status) || substatus?.action_required) {
      console.error(
        `[mistbox] DELIVERY PROBLEM on order ${order.number}: ${status}` +
          `${substatus ? ` / ${substatus.code} — ${substatus.text}` : ''}`,
      );
      await advanceStage(order, 'shipped', meta); // records meta without regressing
      return NextResponse.json({ received: true, exception: status });
    }

    const stage = stageForCarrierStatus(status);
    if (!stage) return NextResponse.json({ received: true, ignored: status });

    // `advanceStage` returns false for a repeat or an out-of-order event, which
    // is exactly what stops a redelivered DELIVERED sending a second email.
    const moved = await advanceStage(order, stage, meta);
    if (moved && stage === 'delivered') await sendDelivered(order);

    return NextResponse.json({ received: true, stage, changed: moved });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[mistbox] shippo webhook failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Failure-isolated, like every other send in this codebase. */
async function sendDelivered(order: Order): Promise<void> {
  try {
    const opts = await buildEmailOpts('email-order-delivered');
    const url = orderUrl(order.id);
    const sent = await sendEmail({
      to: order.userEmail,
      subject: opts.copy.subject,
      html: deliveredEmail(order, url, opts),
      text: deliveredEmailText(order, url, opts),
    });
    console.log(`[mistbox] delivered email for order ${order.number} sent (${sent.id})`);
  } catch (error) {
    console.error(
      `[mistbox] DELIVERED EMAIL NOT SENT for order ${order.number}:`,
      error instanceof Error ? error.message : error,
    );
  }
}
