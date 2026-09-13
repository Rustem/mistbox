import { NextResponse } from 'next/server';
import {
  CHANNEL,
  assertNoUserErrors,
  fullName,
  isValidEmail,
  saleorFetchAuthed,
  SaleorError,
  siteUrl,
} from '@/lib/saleor';
import {
  CHECKOUT_CREATE,
  CHECKOUT_SET_DELIVERY,
  CHECKOUT_SET_METADATA,
} from '@/lib/queries';
import { INTEGRATION_ID, stripe } from '@/lib/stripe';
import { fillBox, fillFromRecipe, flavourOf, isInvalid, weighLines } from '@/lib/box';
import { loadBoxCatalogue } from '@/lib/catalogue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Address = {
  firstName: string;
  lastName: string;
  streetAddress1: string;
  streetAddress2?: string;
  city: string;
  countryArea: string;
  postalCode: string;
  country: string;
  phone?: string;
};

type Body = {
  /** Product slug of the box tier — 'the-mistbox' | 'the-mistbox-grand'. */
  tier: string;
  /** The chosen filling. Ignored when `preset` is set. */
  items?: Array<{ sku: string; quantity: number }>;
  /** Fill from the tier's own saved recipe instead of a chosen list. */
  preset?: boolean;
  /** How many identical boxes. Each is its own parcel at fulfilment time. */
  quantity?: number;
  email: string;
  shippingAddress: Address;
  billingAddress?: Address;
  giftMessage?: string;
  newsletterOptIn?: boolean;
};

type UserError = { field: string | null; message: string | null; code: string };

type Money = { amount: number; currency: string };

type Line = {
  id: string;
  quantity: number;
  variant: { id: string; name: string; product: { name: string } };
  unitPrice: { gross: Money };
};

type CheckoutCreateData = {
  checkoutCreate: {
    checkout: {
      id: string;
      totalPrice: { gross: Money };
      subtotalPrice: { gross: Money };
      lines: Line[];
      shippingMethods: Array<{ id: string; name: string; price: Money }>;
    } | null;
    errors: UserError[];
  };
};

type DeliveryData = {
  checkoutDeliveryMethodUpdate: {
    checkout: { id: string; totalPrice: { gross: Money } } | null;
    errors: UserError[];
  };
};

type MetadataData = { updateMetadata: { errors: UserError[] } };

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Trim, cap length, and reject anything obviously not an address. */
function cleanAddress(a: Address | undefined, label: string): Address {
  if (!a) throw new Error(`${label} is missing.`);
  const req: Array<keyof Address> = [
    'firstName',
    'lastName',
    'streetAddress1',
    'city',
    'countryArea',
    'postalCode',
    'country',
  ];
  for (const k of req) {
    if (!String(a[k] ?? '').trim()) throw new Error(`${label}: ${k} is required.`);
  }
  return {
    firstName: a.firstName.trim().slice(0, 100),
    lastName: a.lastName.trim().slice(0, 100),
    streetAddress1: a.streetAddress1.trim().slice(0, 200),
    streetAddress2: (a.streetAddress2 ?? '').trim().slice(0, 200),
    city: a.city.trim().slice(0, 100),
    countryArea: a.countryArea.trim().toUpperCase().slice(0, 40),
    postalCode: a.postalCode.trim().slice(0, 20),
    country: (a.country || 'US').trim().toUpperCase().slice(0, 2),
    phone: (a.phone ?? '').trim().slice(0, 40) || undefined,
  };
}

/** The shape Stripe's `address`/`shipping.address` fields want — built once,
 *  used for both the billing and the shipping address below. */
function toStripeAddress(a: Address) {
  return {
    line1: a.streetAddress1,
    line2: a.streetAddress2 || undefined,
    city: a.city,
    state: a.countryArea,
    postal_code: a.postalCode,
    country: a.country,
  };
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return badRequest('Malformed request.');
  }

  const email = String(body.email ?? '').trim().toLowerCase();

  if (!body.tier) return badRequest('Choose a box before continuing.');
  if (!isValidEmail(email)) return badRequest('Enter a valid email address.');

  let shippingAddress: Address;
  let billingAddress: Address;
  try {
    shippingAddress = cleanAddress(body.shippingAddress, 'Delivery address');
    billingAddress = body.billingAddress
      ? cleanAddress(body.billingAddress, 'Billing address')
      : shippingAddress;
  } catch (e) {
    return badRequest((e as Error).message);
  }

  const giftMessage = String(body.giftMessage ?? '').trim().slice(0, 400);
  const newsletterOptIn = Boolean(body.newsletterOptIn);

  try {
    /* 0 — resolve what was asked for against the real catalogue.

           Nothing the client sent is trusted: not the slot count, not the
           per-item cap, not even that a named SKU is an item rather than a
           box. A preset is expanded from the tier's own recipe and then run
           through exactly the same validation a custom box gets, so "our
           selection" can never become a box the builder itself would refuse. */
    const catalogue = await loadBoxCatalogue();
    const tier = catalogue.tiers.get(String(body.tier));
    if (!tier) return badRequest('That box is no longer available.');
    if (tier.slots < 1) return badRequest('That box is not ready to order yet.');
    if (tier.available < 1) {
      return badRequest(`${tier.name} is out of stock. The other size may still be available.`);
    }

    // Multiples apply to any box, curated or chosen: several identical gifts
    // is an ordinary thing to want. It does mean several parcels — the label
    // flow buys one at a time — which is called out in the plan rather than
    // silently approximated as one heavy parcel.
    const boxes = Math.max(1, Math.min(20, tier.available, Number(body.quantity) || 1));

    const filling = body.preset
      ? fillFromRecipe(tier, catalogue.items, boxes)
      : fillBox(tier, body.items ?? [], catalogue.items, boxes);

    if (isInvalid(filling)) return badRequest(filling.error);

    // The carton's own weight is its tare, so summing every line gives carton
    // plus contents with no separate packaging allowance to drift out of sync.
    // Recorded now so the shipping label reads the same number later even if
    // the catalogue is re-seeded in between.
    const parcel = weighLines([
      { quantity: 1, weightKg: tier.tareKg, productName: tier.name },
      ...filling.choices.map((c) => ({
        quantity: c.quantity,
        weightKg: catalogue.items.get(c.sku)?.weightKg ?? null,
        productName: c.name,
      })),
    ]);

    /* 1 — create the checkout in Saleor: the carton, then one line per item
           inside it. Saleor decrements each item's own stock, which is the
           whole reason a box is spelled out as separate lines. */
    const created = await saleorFetchAuthed<CheckoutCreateData>(CHECKOUT_CREATE, {
      input: {
        channel: CHANNEL,
        email,
        lines: filling.lines,
        shippingAddress,
        billingAddress,
      },
    });
    assertNoUserErrors(created.checkoutCreate.errors, 'Creating the checkout');
    const checkout = created.checkoutCreate.checkout;
    if (!checkout) throw new SaleorError('Saleor did not return a checkout.');

    /* 2 — the gift message and recipient ride along as metadata so they
           land on the order and show up on the packing slip. */
    const metadata = [
      { key: 'gift_message', value: giftMessage },
      {
        key: 'recipient_name',
        value: fullName(shippingAddress),
      },
      { key: 'source', value: 'mistbox-storefront' },
      // Consent for future mail beyond this order's own confirmation emails.
      // Recorded on every order, opted in or not, so "no" is on file just as
      // clearly as "yes" — silence is never read as consent later.
      { key: 'newsletter_opt_in', value: String(newsletterOptIn) },
      // A snapshot of what this box actually is, taken now. The catalogue can
      // be re-seeded or re-priced tomorrow; the packing card and the shipping
      // label for this order must not change when it is.
      { key: 'box_tier', value: tier.slug },
      { key: 'box_slots', value: String(tier.slots) },
      { key: 'box_filled_from', value: body.preset ? 'recipe' : 'chosen' },
      {
        key: 'box_recipe',
        value: JSON.stringify(
          filling.choices.map((c) => ({ sku: c.sku, name: c.name, qty: c.quantity })),
        ),
      },
      { key: 'box_count', value: String(boxes) },
      // Per box, not per order: a label is bought for one parcel, and an order
      // of three boxes is three parcels rather than one heavy one.
      { key: 'parcel_weight_kg', value: parcel.kg.toFixed(3) },
      {
        key: 'parcel_weight_source',
        value: parcel.estimated.length ? 'estimated' : 'measured',
      },
      ...(parcel.estimated.length
        ? [{ key: 'parcel_weight_estimated_for', value: parcel.estimated.join(' · ') }]
        : []),
    ].filter((m) => m.value);

    const meta = await saleorFetchAuthed<MetadataData>(CHECKOUT_SET_METADATA, {
      id: checkout.id,
      input: metadata,
    });
    assertNoUserErrors(meta.updateMetadata.errors, 'Saving the gift message');

    /* 3 — pick a delivery method. One flat rate for now; if several are
           configured we take the cheapest so nobody is quietly upsold. */
    const methods = [...checkout.shippingMethods].sort((a, b) => a.price.amount - b.price.amount);
    if (methods.length === 0) {
      return badRequest(
        'No delivery method covers that address yet. We currently ship within the United States.',
      );
    }

    const delivered = await saleorFetchAuthed<DeliveryData>(CHECKOUT_SET_DELIVERY, {
      id: checkout.id,
      deliveryMethodId: methods[0].id,
    });
    assertNoUserErrors(delivered.checkoutDeliveryMethodUpdate.errors, 'Setting delivery');

    const total =
      delivered.checkoutDeliveryMethodUpdate.checkout?.totalPrice.gross ??
      checkout.totalPrice.gross;

    /* 4 — hand off to Stripe Checkout. Stripe owns the card form, so no
           card data ever reaches this server.

           The order is sent as real line items with delivery as a shipping
           option, rather than as one lump sum. That costs nothing today and is
           what makes Stripe Tax possible later: tax is worked out per line from
           each product's tax code, and delivery is taxed under its own rules —
           neither of which can be done to a single opaque "order" amount. It
           also means the buyer's receipt and your dashboard show what was
           actually bought. */
    const origin = siteUrl();

    // Give Stripe the address we already collected, as a Customer, rather than
    // asking the buyer to type it a second time. Stripe resolves tax location
    // from the customer address; without one it falls back to IP, which is the
    // weakest source it has.
    const customer = await stripe().customers.create({
      email,
      name: fullName(billingAddress),
      address: toStripeAddress(billingAddress),
      shipping: {
        name: fullName(shippingAddress),
        address: toStripeAddress(shippingAddress),
      },
      metadata: { saleorCheckoutId: checkout.id },
    });

    const currency = total.currency.toLowerCase();
    const method = methods[0];

    // Every line carries its own price now, so each one goes to Stripe as
    // itself: the carton, then what went in it. Stripe's receipt then reads
    // like ours, and the invariant the webhook depends on — Stripe's total is
    // Saleor's total — holds because nothing is filtered out or folded away.
    const lineItems = checkout.lines.map((line) => ({
      quantity: line.quantity,
      price_data: {
        currency,
        unit_amount: Math.round(line.unitPrice.gross.amount * 100),
        // Prices are entered in Saleor without tax, so tax is added on top
        // rather than being carved out of the amount shown.
        tax_behavior: 'exclusive' as const,
        product_data: {
          name: line.variant.product.name,
          // The flavour, where there is one. `variant.name` repeats the
          // product name on a single-variant item, which would read as a
          // stutter under it.
          description: flavourOf(line.variant.product.name, line.variant.name) || undefined,
          // No `tax_code` yet. Stripe falls back to the account preset, and a
          // tax code must come from Stripe's canonical list rather than be
          // guessed here — picking the wrong one misfiles real tax.
        },
      },
    }));

    // A box whose lines all came back at zero would have Stripe collect
    // nothing — better to fail loudly here than to ship a free box and find
    // out from the accounts.
    if (lineItems.every((l) => l.price_data.unit_amount === 0)) {
      throw new SaleorError('The box priced out at zero — refusing to charge nothing.');
    }

    // Turning tax on is deliberately a flag, not a code change. It stays off
    // until the Stripe account has a head office address and an active
    // registration: enabled without those, Stripe collects zero tax and reports
    // no error, which looks identical to working correctly.
    const automaticTax = process.env.STRIPE_AUTOMATIC_TAX === 'true';

    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      integration_identifier: INTEGRATION_ID,
      customer: customer.id,
      client_reference_id: checkout.id,
      line_items: lineItems,
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            display_name: method.name,
            fixed_amount: {
              currency,
              amount: Math.round(method.price.amount * 100),
            },
            tax_behavior: 'exclusive',
          },
        },
      ],
      automatic_tax: { enabled: automaticTax },
      metadata: {
        saleorCheckoutId: checkout.id,
        giftMessage: giftMessage.slice(0, 190),
      },
      success_url: `${origin}/order/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/order?cancelled=1`,
    });

    if (!session.url) throw new Error('Stripe did not return a redirect URL.');
    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Something went wrong.';
    console.error('[mistbox] checkout failed:', error);
    // Saleor's insufficient-stock error is the one customers will actually hit.
    if (/INSUFFICIENT_STOCK|quantity/i.test(message)) {
      return badRequest('That box just sold out. Try a smaller quantity or the other tier.');
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
