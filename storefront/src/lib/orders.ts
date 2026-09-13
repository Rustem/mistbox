/**
 * Reading and advancing an order, shared by the webhooks, the order page and
 * the packing screen.
 *
 * Saleor is the system of record. Stage and tracking live in order metadata
 * rather than a database of our own, so there is one place an order exists and
 * nothing to keep in sync.
 */

import { ORDER_NOTE_ADD, ORDER_QUERY, SET_METADATA } from '@/lib/queries';
import { assertNoUserErrors, saleorFetch, saleorFetchAuthed, siteUrl } from '@/lib/saleor';
import {
  META,
  STAGE_DEFAULTS,
  type MetadataItem,
  type Stage,
  appendHistory,
  currentStage,
  isAdvance,
  readHistory,
  readMeta,
} from '@/lib/orderStatus';
import type { EmailOrder } from '@/lib/email/orderConfirmation';

export type Order = EmailOrder & {
  id: string;
  status: string;
  paymentStatus: string;
  fulfillments: Array<{ status: string; trackingNumber: string }>;
  metadata: MetadataItem[];
};

type OrderData = { order: Order | null };

/**
 * Anonymous read — the order UUID is the credential.
 *
 * Saleor serves an order by id to an unauthenticated caller, which is what
 * makes a link-only order page possible. The id is a v4 UUID, so it cannot be
 * guessed; the realistic risk is the link being **forwarded**, which is why the
 * page hides the address, gift message and prices until the buyer proves their
 * email.
 *
 * Note this also means Saleor's own API must not be publicly reachable in
 * production. The storefront reads it server-side, so it does not need to be.
 */
export function getOrder(id: string, revalidate: number | false = 30): Promise<Order | null> {
  return saleorFetch<OrderData>(ORDER_QUERY, { id }, revalidate).then((d) => d.order);
}

/** Authenticated read, for the webhooks and packing screen. Never cached. */
export function getOrderAuthed(id: string): Promise<Order | null> {
  return saleorFetchAuthed<OrderData>(ORDER_QUERY, { id }).then((d) => d.order);
}

export async function setMetadata(orderId: string, input: MetadataItem[]): Promise<void> {
  if (input.length === 0) return;
  const data = await saleorFetchAuthed<{ updateMetadata: { errors: Array<{ message?: string | null }> } }>(
    SET_METADATA,
    { id: orderId, input },
  );
  assertNoUserErrors(data.updateMetadata.errors, 'Updating order metadata');
}

/**
 * Move an order to a later stage, and refuse to move it backwards.
 *
 * Carriers report out of order — a TRANSIT scan can arrive after an
 * out-for-delivery one — and every webhook can be delivered more than once.
 * Without this guard the customer would watch the timeline walk backwards.
 *
 * Returns whether the stage actually changed, which callers use to decide
 * whether to send an email. That is what stops a repeated DELIVERED event from
 * sending a second "it arrived".
 */
export async function advanceStage(
  order: Order,
  to: Stage,
  extra: MetadataItem[] = [],
  /** Who did it, when a person (rather than a webhook) is the cause — shown on
   *  the Saleor note so the timeline says who packed and sealed a box, not
   *  just that it happened. Omitted for automatic transitions. */
  actorEmail?: string,
): Promise<boolean> {
  const from = currentStage(order.metadata);
  if (!isAdvance(from, to)) {
    if (extra.length) await setMetadata(order.id, extra);
    return false;
  }

  const at = new Date().toISOString();
  const history = appendHistory(readHistory(order.metadata), to, at);

  await setMetadata(order.id, [
    { key: META.stage, value: to },
    { key: META.stageAt, value: at },
    { key: META.history, value: JSON.stringify(history) },
    ...extra,
  ]);

  const who = actorEmail ? ` (${actorEmail})` : '';
  await noteOnOrder(order.id, `Mistbox — ${STAGE_DEFAULTS[to].label}${who}`);
  return true;
}

/**
 * Put a line on the order's timeline in the Saleor dashboard.
 *
 * Metadata is where the stage *lives*, but nobody reads a metadata table to
 * find out how an order is going. The note makes progress visible where Daniya
 * already works, alongside Saleor's own payment and fulfilment events.
 *
 * Never throws: a missing note is cosmetic, and this runs on paths where the
 * customer has already paid.
 */
export async function noteOnOrder(orderId: string, message: string): Promise<void> {
  try {
    await saleorFetchAuthed(ORDER_NOTE_ADD, { order: orderId, input: { message } });
  } catch (error) {
    console.warn(
      '[mistbox] could not add order note:',
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Only the two fields this actually reads — narrower than `Order` on
 * purpose, so a caller with a smaller GraphQL selection (the admin order
 * list queries far fewer fields per order than the full order page) can
 * still call this instead of re-deriving the same fallback by hand.
 */
type Trackable = { metadata: MetadataItem[]; fulfillments: Array<{ trackingNumber: string }> };

export const trackingOf = (order: Trackable): { number: string; carrier: string } => ({
  number:
    readMeta(order.metadata, META.trackingNumber) ||
    order.fulfillments.find((f) => f.trackingNumber)?.trackingNumber ||
    '',
  carrier: readMeta(order.metadata, META.trackingCarrier),
});

/** Absolute URL of an order's page, used in emails. */
export function orderUrl(orderId: string): string {
  return `${siteUrl()}/order/${encodeURIComponent(orderId)}`;
}
