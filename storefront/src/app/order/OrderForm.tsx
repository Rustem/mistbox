'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatMoney } from '@/lib/saleor';
import { BoxBuilder } from './BoxBuilder';
import {
  chosenFrom,
  indexFlavours,
  slotsFromRecipe,
  type BuilderProduct,
  type BuilderTier,
  type Slot,
} from '@/lib/builder';

export type BoxOption = {
  variantId: string;
  slug: string;
  name: string;
  amount: number;
  currency: string;
  available: number;
};

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR',
  'PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
];

const GIFT_MESSAGE_LIMIT = 300;

/**
 * A box that has already been chosen and filled somewhere else — the two-step
 * builder on `/build`. The form then drops its own box picker and collects
 * only the details, so there is exactly one set of address fields on the site
 * rather than a second copy that drifts.
 */
export type PrebuiltBox = {
  tierSlug: string;
  slots: Slot[];
  /** Carton plus contents, already totalled by whoever built it. */
  total: number;
  currency: string;
};

export function OrderForm({
  boxes,
  preselect,
  tiers = [],
  products = [],
  prebuilt,
}: {
  boxes: BoxOption[];
  preselect?: string;
  tiers?: BuilderTier[];
  products?: BuilderProduct[];
  prebuilt?: PrebuiltBox;
}) {
  const inStock = boxes.filter((b) => b.available > 0);
  const initial =
    inStock.find((b) => b.slug === preselect)?.variantId ?? inStock[0]?.variantId ?? '';

  const [variantId, setVariantId] = useState(
    prebuilt ? (inStock.find((b) => b.slug === prebuilt.tierSlug)?.variantId ?? initial) : initial,
  );
  const [quantity, setQuantity] = useState(1);
  const [giftMessage, setGiftMessage] = useState('');
  const [separateBilling, setSeparateBilling] = useState(false);
  const [newsletterOptIn, setNewsletterOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => boxes.find((b) => b.variantId === variantId),
    [boxes, variantId],
  );

  const maxQuantity = Math.max(1, Math.min(20, selected?.available ?? 1));

  // What is in the box. Starts as the curated selection and is edited in
  // place; an untouched box posts exactly what the recipe would have.
  const bySku = useMemo(() => indexFlavours(products), [products]);
  const tier = useMemo(
    () => tiers.find((t) => t.slug === selected?.slug) ?? null,
    [tiers, selected],
  );
  const [slots, setSlots] = useState<Slot[]>([]);

  // Changing the box changes what is in it, so the slots reset to that box's
  // own selection rather than carrying the previous box's choices across.
  useEffect(() => {
    if (prebuilt) return setSlots(prebuilt.slots);
    setSlots(tier ? slotsFromRecipe(tier, bySku) : []);
  }, [tier, bySku, prebuilt]);

  // The builder loaded AND the box is completely filled. Both halves matter:
  // an incomplete box must never fall through to `preset: true`, which would
  // quietly send our selection instead of the one being built.
  const canBuild = Boolean(tier && slots.length === tier.slots && slots.every(Boolean));
  const boxIncomplete = Boolean(tier && slots.length > 0 && !canBuild);

  // The carton is what `selected.amount` is now; a box is worth that plus what
  // is in it. Falling back to the carton alone would quote a box at $15.
  const boxTotal = useMemo(() => {
    if (prebuilt) return prebuilt.total;
    if (!tier || !selected) return selected?.amount ?? 0;
    return slots.reduce(
      (sum, slot) => sum + (slot ? (bySku.get(slot.sku)?.flavour.price ?? 0) : 0),
      tier.price,
    );
  }, [prebuilt, tier, selected, slots, bySku]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? '').trim();

    const shippingAddress = {
      firstName: field('ship_firstName'),
      lastName: field('ship_lastName'),
      streetAddress1: field('ship_street1'),
      streetAddress2: field('ship_street2'),
      city: field('ship_city'),
      countryArea: field('ship_state'),
      postalCode: field('ship_postal'),
      country: 'US',
    };

    const billingAddress = separateBilling
      ? {
          firstName: field('bill_firstName'),
          lastName: field('bill_lastName'),
          streetAddress1: field('bill_street1'),
          streetAddress2: field('bill_street2'),
          city: field('bill_city'),
          countryArea: field('bill_state'),
          postalCode: field('bill_postal'),
          country: 'US',
        }
      : undefined;

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // A box is a carton plus its contents. The chosen filling is sent
          // explicitly when the builder could load; `preset` is the fallback
          // that asks the server to use the tier's own recipe, so an order can
          // still be placed if the item catalogue was unreachable.
          tier: selected?.slug,
          ...(canBuild ? { items: chosenFrom(slots) } : { preset: true }),
          quantity,
          email: field('email'),
          giftMessage,
          newsletterOptIn,
          shippingAddress,
          billingAddress,
        }),
      });

      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? 'We could not start the payment. Please try again.');
        setSubmitting(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError('We could not reach the store. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  if (inStock.length === 0) {
    return (
      <p className="error">
        Every box is spoken for this season. Write to us and we will hold one from the
        next run.
      </p>
    );
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate={false}>
      {error && <p className="error">{error}</p>}

      {/* The box, unless one arrived already chosen and filled. */}
      {!prebuilt && (
        <>
        {/* ---------------------------------------------------- the box */}
        <div className="field">
          <label htmlFor="box">Which box</label>
          <select
            id="box"
            name="box"
            value={variantId}
            onChange={(e) => {
              setVariantId(e.target.value);
              setQuantity(1);
            }}
          >
            {boxes.map((b) => {
              // The listed price is the box as curated — carton plus the pieces
              // in it — because that is what picking it here would cost.
              const curated = tiers.find((t) => t.slug === b.slug);
              const amount = curated
                ? curated.recipe.reduce(
                    (sum, e) => sum + (bySku.get(e.sku)?.flavour.price ?? 0) * e.quantity,
                    curated.price,
                  )
                : b.amount;
              return (
                <option key={b.variantId} value={b.variantId} disabled={b.available <= 0}>
                  {b.name} — {formatMoney(amount, b.currency)}
                  {b.available <= 0
                    ? ' (sold out)'
                    : b.available <= 10
                      ? ` (${b.available} left)`
                      : ''}
                </option>
              );
            })}
          </select>
        </div>

        <div className="field">
          <label htmlFor="quantity">How many</label>
          <select
            id="quantity"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          >
            {Array.from({ length: maxQuantity }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {selected && (
            <span className="hint">
              {formatMoney(boxTotal * quantity, selected.currency)} plus delivery and tax,
              calculated at the next step.
            </span>
          )}
        </div>

        {tier && slots.length > 0 && (
          <BoxBuilder tier={tier} products={products} slots={slots} onChange={setSlots} />
        )}
        </>
      )}

      {/* ------------------------------------------------------- you */}
      <div className="field">
        <label htmlFor="email">Your email</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
        />
        <span className="hint">Receipts and tracking go here — not to the recipient.</span>
      </div>

      {/* ------------------------------------------------- recipient */}
      <fieldset>
        <legend>Deliver to</legend>
        <div className="row">
          <div className="field">
            <label htmlFor="ship_firstName">First name</label>
            <input id="ship_firstName" name="ship_firstName" required autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="ship_lastName">Last name</label>
            <input id="ship_lastName" name="ship_lastName" required autoComplete="off" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="ship_street1">Street address</label>
          <input id="ship_street1" name="ship_street1" required autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="ship_street2">Apartment, suite (optional)</label>
          <input id="ship_street2" name="ship_street2" autoComplete="off" />
        </div>
        <div className="row row--address">
          <div className="field">
            <label htmlFor="ship_city">City</label>
            <input id="ship_city" name="ship_city" required autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="ship_state">State</label>
            <select id="ship_state" name="ship_state" required defaultValue="WA">
              {US_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ship_postal">ZIP</label>
            <input
              id="ship_postal"
              name="ship_postal"
              required
              inputMode="numeric"
              pattern="[0-9]{5}(-[0-9]{4})?"
            />
          </div>
        </div>
      </fieldset>

      {/* ---------------------------------------------- gift message */}
      <div className="field">
        <label htmlFor="giftMessage">Message for the insert card (optional)</label>
        <textarea
          id="giftMessage"
          name="giftMessage"
          value={giftMessage}
          maxLength={GIFT_MESSAGE_LIMIT}
          onChange={(e) => setGiftMessage(e.target.value)}
          placeholder="Something short. It will be written by hand."
        />
        <span className="hint">
          We write this onto the card in ink, so keep it to a few lines.{' '}
          {GIFT_MESSAGE_LIMIT - giftMessage.length} characters left.
        </span>
      </div>

      {/* --------------------------------------------- newsletter */}
      <div className="checkline">
        <input
          id="newsletterOptIn"
          type="checkbox"
          checked={newsletterOptIn}
          onChange={(e) => setNewsletterOptIn(e.target.checked)}
        />
        <label htmlFor="newsletterOptIn">
          Keep me posted about new boxes and Pacific Northwest makers
        </label>
      </div>

      {/* ------------------------------------------------ billing */}
      <div className="checkline">
        <input
          id="separateBilling"
          type="checkbox"
          checked={separateBilling}
          onChange={(e) => setSeparateBilling(e.target.checked)}
        />
        <label htmlFor="separateBilling">
          My billing address is different from the delivery address
        </label>
      </div>

      {separateBilling && (
        <fieldset>
          <legend>Bill to</legend>
          <div className="row">
            <div className="field">
              <label htmlFor="bill_firstName">First name</label>
              <input id="bill_firstName" name="bill_firstName" required autoComplete="given-name" />
            </div>
            <div className="field">
              <label htmlFor="bill_lastName">Last name</label>
              <input id="bill_lastName" name="bill_lastName" required autoComplete="family-name" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="bill_street1">Street address</label>
            <input id="bill_street1" name="bill_street1" required autoComplete="address-line1" />
          </div>
          <div className="field">
            <label htmlFor="bill_street2">Apartment, suite (optional)</label>
            <input id="bill_street2" name="bill_street2" autoComplete="address-line2" />
          </div>
          <div className="row row--address">
            <div className="field">
              <label htmlFor="bill_city">City</label>
              <input id="bill_city" name="bill_city" required autoComplete="address-level2" />
            </div>
            <div className="field">
              <label htmlFor="bill_state">State</label>
              <select id="bill_state" name="bill_state" required defaultValue="WA">
                {US_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="bill_postal">ZIP</label>
              <input
                id="bill_postal"
                name="bill_postal"
                required
                inputMode="numeric"
                pattern="[0-9]{5}(-[0-9]{4})?"
              />
            </div>
          </div>
        </fieldset>
      )}

      <button
        className="button"
        type="submit"
        disabled={submitting || !variantId || boxIncomplete}
      >
        {submitting ? 'Taking you to payment…' : 'Continue to payment'}
      </button>

      {boxIncomplete && (
        <p className="hint" style={{ margin: 0 }}>
          Fill every slot in the box above to continue.
        </p>
      )}

      <p className="hint" style={{ margin: 0 }}>
        Payment is handled by Stripe. Card details never touch our servers.
      </p>
    </form>
  );
}
