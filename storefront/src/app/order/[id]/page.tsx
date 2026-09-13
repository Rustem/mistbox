import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { Emblem } from '@/components/Emblem';
import { getStageCopy } from '@/lib/content';
import { getOrder, trackingOf } from '@/lib/orders';
import {
  META,
  STAGES,
  carrierName,
  carrierTrackingUrl,
  currentStage,
  historyMap,
  isException,
  readMeta,
  stageIndex,
} from '@/lib/orderStatus';
import { formatMoney, fullName } from '@/lib/saleor';
import { cookieName, tokenValid } from '@/lib/reveal';
import { longDate } from '@/lib/email/layout';
import { flavourOf } from '@/lib/box';
import { RevealForm } from './RevealForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your order · Mistbox',
  // A link that leaks into a search index would be a link anyone could open.
  robots: { index: false, follow: false },
};

/** "5 September, 2:14 pm" — enough to be useful, short enough to sit inline. */
const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orderId = decodeURIComponent(id);

  // None of the three depends on either of the others.
  const [order, stageCopy, jar] = await Promise.all([
    getOrder(orderId).catch(() => null),
    getStageCopy(),
    cookies(),
  ]);
  if (!order) notFound();

  const revealed = tokenValid(orderId, jar.get(cookieName(orderId))?.value);

  const stage = currentStage(order.metadata);
  const at = stageIndex(stage);
  const tracking = trackingOf(order);
  const status = readMeta(order.metadata, META.trackingStatus);
  const detail = readMeta(order.metadata, META.trackingDetail);
  const eta = readMeta(order.metadata, META.trackingEta);
  const gift = readMeta(order.metadata, META.giftMessage);
  // `confirmed` is the starting state, so it is never recorded by an advance —
  // the order's own creation time is exactly when it happened.
  const reached = { confirmed: order.created, ...historyMap(order.metadata) };
  const problem = status && isException(status);
  const currency = order.total.gross.currency;

  return (
    <section className="shell">
      <div className="lockup centred">
        <Emblem size={72} />
        <p className="support" style={{ color: 'var(--sage)' }}>
          Order {order.number}
        </p>
        <h1 className="wordmark" style={{ fontSize: 'clamp(1.6rem, 4.5vw, 2.25rem)' }}>
          {stageCopy[stage].label}
        </h1>
        <p className="centred" style={{ maxWidth: '30rem' }}>
          {stageCopy[stage].note}
        </p>
      </div>

      {problem && (
        <p className="notice notice--problem" role="status">
          <strong>This one needs a hand.</strong> The carrier reported a problem
          {detail ? ` — ${detail}` : ''}. We have been told too, and we will be in touch.
        </p>
      )}

      <ol className="timeline" aria-label="Order progress">
        {STAGES.map((s, i) => {
          const state = i < at ? 'done' : i === at ? 'now' : 'todo';
          return (
            <li key={s} className={`timeline__step timeline__step--${state}`}>
              <span className="timeline__mark" aria-hidden="true" />
              <span className="timeline__label">{stageCopy[s].label}</span>
              {reached[s] && (
                <time className="timeline__when" dateTime={reached[s]}>
                  {stamp(reached[s] as string)}
                </time>
              )}
            </li>
          );
        })}
      </ol>

      {tracking.number && (
        <div className="panel">
          <p className="support contents-label">Tracking</p>
          <p className="tracking">
            <span className="tracking__carrier">{carrierName(tracking.carrier || 'usps')}</span>
            <a
              className="tracking__number"
              href={carrierTrackingUrl(tracking.carrier || 'usps', tracking.number)}
              target="_blank"
              rel="noreferrer noopener"
            >
              {tracking.number}
            </a>
          </p>
          {detail && !problem && <p className="tracking__detail">{detail}</p>}
          {/* An estimate is only news before it arrives. */}
          {eta && stage !== 'delivered' && (
            <p className="tracking__detail">
              Expected {longDate(eta)}. Carriers revise this, so treat it as a guide rather than a
              promise.
            </p>
          )}
        </div>
      )}

      {revealed ? (
        <>
          <div className="panel">
            <p className="support contents-label">In your box</p>
            <ul className="receipt">
              {/* Every line carries its own price: the carton first, then what
                  went in it. The box is worth the sum of its parts, and a
                  receipt that says so is the one the customer can check. */}
              {order.lines.map((line, i) => (
                <li key={i}>
                  <span>
                    {line.quantity > 1 && <span className="quiet">{line.quantity} × </span>}
                    {line.productName}
                    {flavourOf(line.productName, line.variantName) && (
                      <span className="quiet"> — {flavourOf(line.productName, line.variantName)}</span>
                    )}
                  </span>
                  <span className="tabular">
                    {formatMoney(line.totalPrice.gross.amount, currency)}
                  </span>
                </li>
              ))}

              <li className="receipt__rule">
                <span>{order.shippingMethodName ?? 'Delivery'}</span>
                <span className="tabular">
                  {order.shippingPrice.gross.amount === 0
                    ? 'Included'
                    : formatMoney(order.shippingPrice.gross.amount, currency)}
                </span>
              </li>
              <li className="receipt__total">
                <span className="support">Total</span>
                <span className="tabular price">
                  {formatMoney(order.total.gross.amount, currency)}
                </span>
              </li>
            </ul>
          </div>

          {gift && (
            <div className="panel">
              <p className="support contents-label">Written on your card</p>
              <blockquote className="gift">{gift}</blockquote>
            </div>
          )}

          {order.shippingAddress && (
            <div className="panel">
              <p className="support contents-label">Delivering to</p>
              <p className="address">
                {fullName(order.shippingAddress)}
                <br />
                {order.shippingAddress.streetAddress1}
                {order.shippingAddress.streetAddress2 && (
                  <>
                    <br />
                    {order.shippingAddress.streetAddress2}
                  </>
                )}
                <br />
                {order.shippingAddress.city}, {order.shippingAddress.countryArea}{' '}
                {order.shippingAddress.postalCode}
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="panel panel--locked">
          <p className="support contents-label">Order details</p>
          <RevealForm orderId={orderId} />
        </div>
      )}

      <p className="centred quiet-link" style={{ marginTop: '2.5rem' }}>
        <Link href="/">Back to Mistbox</Link>
      </p>
      <footer>
        <p className="support">Thoughtfully gathered · Beautifully given</p>
        <p>Ordered {longDate(order.created)}. Questions? Reply to any of our emails.</p>
      </footer>
    </section>
  );
}
