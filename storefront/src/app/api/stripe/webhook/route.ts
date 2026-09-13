import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { assertNoUserErrors, saleorFetchAuthed } from '@/lib/saleor';
import {
  CHECKOUT_COMPLETE,
  CHECKOUT_FOR_COMPLETION,
  TRANSACTION_CREATE,
} from '@/lib/queries';
import {
  orderConfirmation,
  orderConfirmationText,
  type EmailOrder,
} from '@/lib/email/orderConfirmation';
import { buildEmailOpts, sendEmail } from '@/lib/email/send';
import { ensureCustomerRecord } from '@/lib/customers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type UserError = { field: string | null; message: string | null; code: string };

type TransactionData = {
  transactionCreate: {
    transaction: { id: string; pspReference: string | null } | null;
    errors: UserError[];
  };
};

type CheckoutForCompletionData = {
  checkout: {
    id: string;
    email: string | null;
    transactions: Array<{ id: string; pspReference: string }>;
    shippingAddress: {
      firstName: string;
      lastName: string;
      streetAddress1: string;
      streetAddress2?: string | null;
      city: string;
      countryArea: string;
      postalCode: string;
    } | null;
    metadata: Array<{ key: string; value: string }>;
  } | null;
};

type CompleteData = {
  checkoutComplete: {
    order: (EmailOrder & { id: string; status: string; paymentStatus: string }) | null;
    confirmationNeeded: boolean;
    errors: UserError[];
  };
};

/**
 * Send the confirmation, and never let it break the order.
 *
 * By the time this runs the customer has paid and the order exists. If Resend
 * is down, or the address bounces, that is a missing email — annoying, and
 * fixable by hand from the dashboard. Throwing here would return a non-2xx,
 * Stripe would redeliver the event, and the retry would try to complete a
 * checkout that no longer exists. A mail outage would look exactly like a
 * payment failure. So this swallows everything and only logs.
 */
async function sendConfirmation(order: EmailOrder): Promise<void> {
  try {
    if (!order.shippingAddress) {
      console.warn(`[mistbox] order ${order.number} has no address, skipping confirmation`);
      return;
    }
    // Wording comes from the dashboard when it has been set there, and from
    // the built-in defaults otherwise — `buildEmailOpts` never throws.
    const opts = await buildEmailOpts('email-order-confirmed');
    const sent = await sendEmail({
      to: order.userEmail,
      subject: opts.copy.subject,
      html: orderConfirmation(order, opts),
      text: orderConfirmationText(order, opts),
    });
    console.log(`[mistbox] confirmation for order ${order.number} sent to ${order.userEmail} (${sent.id})`);
  } catch (error) {
    console.error(
      `[mistbox] CONFIRMATION NOT SENT for order ${order.number} to ${order.userEmail}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Stripe tells us the money moved; we then tell Saleor, and only then does
 * Saleor turn the checkout into an order and decrement stock.
 *
 * Three events matter, not one. Card payments settle immediately and arrive as
 * `checkout.session.completed` already paid. Delayed-notification methods —
 * ACH, Klarna and friends, which dynamic payment methods can offer without any
 * code change here — complete the session while still `unpaid` and only settle
 * hours or days later as `async_payment_succeeded`. Listening for `completed`
 * alone means those customers are charged and never get an order.
 *
 * Local testing:
 *   stripe listen --forward-to localhost:3000/api/stripe/webhook
 */
const FULFIL: ReadonlySet<string> = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
]);

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[mistbox] STRIPE_WEBHOOK_SECRET is not set');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });

  const raw = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature, secret);
  } catch (error) {
    console.error('[mistbox] webhook signature check failed:', error);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // A delayed payment that failed. Nothing to undo — no order was ever made —
  // but it is the one case where a customer thinks they have bought something
  // and has not, so it must not pass silently.
  if (event.type === 'checkout.session.async_payment_failed') {
    const s = event.data.object as Stripe.Checkout.Session;
    console.error('[mistbox] DELAYED PAYMENT FAILED — session', s.id, 'email', s.customer_email);
    return NextResponse.json({ received: true });
  }

  if (!FULFIL.has(event.type)) {
    return NextResponse.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const checkoutId = session.metadata?.saleorCheckoutId ?? session.client_reference_id;

  if (!checkoutId) {
    console.error('[mistbox] no Saleor checkout id on session', session.id);
    return NextResponse.json({ received: true });
  }

  // `unpaid` is the delayed-payment case: the session is done but the money is
  // not here yet. Wait for async_payment_succeeded rather than fulfilling now.
  // Anything else — `paid`, or `no_payment_required` for a fully discounted
  // order — is safe to act on.
  if (session.payment_status === 'unpaid') {
    console.log('[mistbox] session completed but payment pending, awaiting settlement', session.id);
    return NextResponse.json({ received: true, pending: true });
  }

  const amount = (session.amount_total ?? 0) / 100;
  const currency = (session.currency ?? 'usd').toUpperCase();
  const pspReference =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent?.id ?? session.id);

  try {
    /* 1a — record the money against the checkout, unless a previous delivery of
           this event already did. Stripe guarantees at-least-once delivery, and
           the two writes below are not atomic: if `checkoutComplete` failed last
           time, the retry would otherwise book the payment a second time. */
    const checkoutData = await saleorFetchAuthed<CheckoutForCompletionData>(
      CHECKOUT_FOR_COMPLETION,
      { id: checkoutId },
    );
    const alreadyRecorded = (checkoutData.checkout?.transactions ?? []).some(
      (t) => t.pspReference === pspReference,
    );

    if (alreadyRecorded) {
      console.log('[mistbox] payment already recorded for', pspReference, '— skipping to complete');
    } else {
      const tx = await saleorFetchAuthed<TransactionData>(TRANSACTION_CREATE, {
        id: checkoutId,
        transaction: {
          name: 'Stripe Checkout',
          pspReference,
          availableActions: ['REFUND'],
          amountCharged: { amount, currency },
          externalUrl: `https://dashboard.stripe.com/payments/${pspReference}`,
          metadata: [{ key: 'stripe_session_id', value: session.id }],
        },
      });
      assertNoUserErrors(tx.transactionCreate.errors, 'Recording the Stripe payment');
    }

    /* 2 — create a matching customer record now, *before* completion. Saleor
           only links an order to an account that already exists at the moment
           checkoutComplete runs — created a moment later, it never links.
           Uses the checkout's own email/address; harmless to repeat on a
           retried webhook, since it no-ops once the account exists. */
    if (checkoutData.checkout) {
      await ensureCustomerRecord({
        email: checkoutData.checkout.email,
        shippingAddress: checkoutData.checkout.shippingAddress,
        metadata: checkoutData.checkout.metadata,
        reference: checkoutId,
      });
    }

    /* 3 — turn it into an order. This is where stock is deducted. */
    const done = await saleorFetchAuthed<CompleteData>(CHECKOUT_COMPLETE, { id: checkoutId });
    assertNoUserErrors(done.checkoutComplete.errors, 'Completing the checkout');

    const order = done.checkoutComplete.order;
    console.log(
      `[mistbox] order ${order?.number ?? '?'} created from Stripe session ${session.id}`,
    );

    if (order) {
      await sendConfirmation(order);
    }

    return NextResponse.json({ received: true, orderNumber: order?.number ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Stripe retries on non-2xx. If the checkout is already gone the order
    // was created by an earlier delivery of this same event — that is success,
    // not a failure, so acknowledge it and stop the retries.
    if (/not found|does not exist|NOT_FOUND/i.test(message)) {
      console.log('[mistbox] checkout already completed, acknowledging duplicate event');
      return NextResponse.json({ received: true, duplicate: true });
    }

    // Anything else is worth a retry — and worth a shout, because the customer
    // has been charged and has no order.
    console.error('[mistbox] PAID BUT NOT ORDERED — session', session.id, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
