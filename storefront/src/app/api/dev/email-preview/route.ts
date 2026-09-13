import type { EmailSlug } from '@/lib/content';
import { buildEmailOpts } from '@/lib/email/send';
import { orderConfirmation } from '@/lib/email/orderConfirmation';
import { deliveredEmail, shippedEmail } from '@/lib/email/shipping';
import { getOrderAuthed } from '@/lib/orders';
import { OPEN_ORDERS_QUERY } from '@/lib/queries';
import { saleorFetchAuthed } from '@/lib/saleor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Renders an email in the browser, against a real order.
 *
 * Development only. It exists so a copy change made in the Saleor dashboard can
 * be seen before a customer gets it — the alternative is placing a test order
 * and waiting for the inbox, which nobody will do, so copy would go out
 * unreviewed.
 *
 *   /api/dev/email-preview?type=shipped[&order=<id>]
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not found', { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  const type = params.get('type') ?? 'confirmed';
  const slug = `email-order-${type}` as EmailSlug;

  let orderId = params.get('order');
  if (!orderId) {
    // Whatever the newest order is, so the preview always has real content.
    const data = await saleorFetchAuthed<{
      orders: { edges: Array<{ node: { id: string } }> };
    }>(OPEN_ORDERS_QUERY);
    orderId = data.orders.edges[0]?.node.id ?? null;
  }
  if (!orderId) return new Response('No orders to preview against.', { status: 404 });

  const order = await getOrderAuthed(orderId);
  if (!order) return new Response('Order not found.', { status: 404 });

  // Bypass the cache: the whole point of the preview is to see the edit you
  // just made in the dashboard.
  const opts = await buildEmailOpts(slug, false);
  const url = `${opts.siteUrl}/order/${order.id}`;

  let html: string;
  if (type === 'shipped') {
    html = shippedEmail(
      order,
      {
        trackingNumber: '9405511899223197428492',
        carrier: 'usps',
        eta: new Date(Date.now() + 6 * 864e5).toISOString(),
        orderUrl: url,
      },
      opts,
    );
  } else if (type === 'delivered') {
    html = deliveredEmail(order, url, opts);
  } else {
    html = orderConfirmation(order, opts);
  }

  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
