import type { EmailSlug } from '@/lib/content';
import { buildEmailOpts, sendEmail } from '@/lib/email/send';
import { orderConfirmation, orderConfirmationText } from '@/lib/email/orderConfirmation';
import {
  deliveredEmail,
  deliveredEmailText,
  shippedEmail,
  shippedEmailText,
} from '@/lib/email/shipping';
import { getOrderAuthed } from '@/lib/orders';
import { OPEN_ORDERS_QUERY } from '@/lib/queries';
import { saleorFetchAuthed } from '@/lib/saleor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Actually sends one of the emails, to an address you name.
 *
 * The sibling `email-preview` route renders in a browser, which proves the
 * markup but not the delivery: an inbox applies its own rules about images,
 * fonts and dark mode that no screenshot will show you. This route goes
 * through the same `buildEmailOpts` → template → `sendEmail` path production
 * uses, so what lands is what a customer would get.
 *
 *   /api/dev/email-test?to=you@example.com[&type=shipped][&order=<id>]
 *
 * Development only, and `to` is required — there is no default recipient and
 * no way to reach a real customer by leaving a parameter off.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not found', { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  const to = params.get('to');
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return new Response('Pass ?to=<address>. This route never picks a recipient for you.', {
      status: 400,
    });
  }

  const type = params.get('type') ?? 'confirmed';
  const slug = `email-order-${type}` as EmailSlug;

  let orderId = params.get('order');
  if (!orderId) {
    const data = await saleorFetchAuthed<{
      orders: { edges: Array<{ node: { id: string } }> };
    }>(OPEN_ORDERS_QUERY);
    orderId = data.orders.edges[0]?.node.id ?? null;
  }
  if (!orderId) return new Response('No orders to send against.', { status: 404 });

  const order = await getOrderAuthed(orderId);
  if (!order) return new Response('Order not found.', { status: 404 });

  const opts = await buildEmailOpts(slug, false);
  const url = `${opts.siteUrl}/order/${order.id}`;
  const ship = {
    trackingNumber: '9405511899223197428492',
    carrier: 'usps',
    eta: new Date(Date.now() + 6 * 864e5).toISOString(),
    orderUrl: url,
  };

  let html: string;
  let text: string;
  if (type === 'shipped') {
    html = shippedEmail(order, ship, opts);
    text = shippedEmailText(order, ship, opts);
  } else if (type === 'delivered') {
    html = deliveredEmail(order, url, opts);
    text = deliveredEmailText(order, url, opts);
  } else {
    html = orderConfirmation(order, opts);
    text = orderConfirmationText(order, opts);
  }

  // Marked in the subject so a test can never be mistaken for a real order
  // notice sitting in someone's inbox.
  const subject = `[test] ${opts.copy.subject}`;

  try {
    const { id } = await sendEmail({ to, subject, html, text });
    return Response.json({ sent: id, to, type, order: order.number, subject });
  } catch (error) {
    return new Response(String(error), { status: 502 });
  }
}
