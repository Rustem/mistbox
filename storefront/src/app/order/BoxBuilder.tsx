'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatMoney } from '@/lib/saleor';
import {
  indexFlavours,
  poundsAndOunces,
  slotsFromRecipe,
  type BuilderFlavour,
  type BuilderProduct,
  type BuilderTier,
  type Slot,
} from '@/lib/builder';

/**
 * A curated box, as composed — and the one thing a customer may change about
 * it.
 *
 * The *pieces* are fixed. Sending "The Afternoon Box" means sending that box,
 * and if a customer could swap the tea for a candle the name on the card would
 * be a lie. What they can change is the flavour of a piece, wherever there is
 * a choice: a different tea is still tea, and the box is still itself.
 *
 * Building a box from nothing is a different proposition with a different
 * shape — two steps, a grid of items, a running total — and it lives on its
 * own page at `/build`. It used to be a mode toggle here, which meant no
 * curated box could be shown without also inviting the customer to dismantle
 * it.
 *
 * Prices are per piece and they add up in view. A box is worth its carton plus
 * its contents now, so the total is arithmetic the customer can check rather
 * than a number they have to take on trust.
 *
 * Every rule here is enforced again on the server (`src/lib/box.ts`). This
 * exists so the answer is instant and the reason visible, never as the thing
 * standing between a request and the catalogue.
 */

export function BoxBuilder({
  tier,
  products,
  slots,
  onChange,
}: {
  tier: BuilderTier;
  products: BuilderProduct[];
  slots: Slot[];
  onChange: (slots: Slot[]) => void;
}) {
  const [open, setOpen] = useState(false);
  /** Which slot's item is being looked at up close, if any. */
  const [peek, setPeek] = useState<number | null>(null);
  const bySku = useMemo(() => indexFlavours(products), [products]);
  const bySlug = useMemo(() => new Map(products.map((p) => [p.slug, p])), [products]);

  const weightKg = useMemo(() => {
    if (tier.tareKg === null) return null;
    let kg = tier.tareKg;
    for (const slot of slots) {
      // A half-filled box has no meaningful weight to quote yet.
      if (!slot) return null;
      const product = bySlug.get(slot.productSlug);
      // One unweighed item makes the whole number a guess, and a guessed
      // weight shown as fact is how a parcel gets back-charged later.
      if (!product?.weightKg) return null;
      kg += product.weightKg;
    }
    return kg;
  }, [slots, bySlug, tier.tareKg]);

  /** Carton plus contents. The box is worth the sum of its parts, so the
   *  figure on screen is one the customer can add up themselves. */
  const total = useMemo(
    () =>
      slots.reduce(
        (sum, slot) => sum + (slot ? (bySku.get(slot.sku)?.flavour.price ?? 0) : 0),
        tier.price,
      ),
    [slots, bySku, tier.price],
  );

  const isDefault = useMemo(() => {
    const original = slotsFromRecipe(tier, bySku);
    return (
      original.length === slots.length && original.every((s, i) => s?.sku === slots[i]?.sku)
    );
  }, [slots, tier, bySku]);

  /** True when a slot holds a flavour with no stock and no in-stock sibling. */
  const soldOutInBox = useMemo(
    () =>
      slots.some((slot) => {
        const found = slot ? bySku.get(slot.sku) : undefined;
        if (!found) return false;
        return found.product.flavours.every((f) => f.available <= 0);
      }),
    [slots, bySku],
  );

  function setSlot(index: number, next: Slot) {
    onChange(slots.map((slot, i) => (i === index ? next : slot)));
  }

  // A curated box arrives full. An empty slot means the recipe and the
  // catalogue disagree — an item was unpublished out from under it — and the
  // wrong array length means the same thing.
  const structureBroken = slots.length !== tier.slots || slots.some((s) => !s);

  return (
    <div className="builder">
      <div className="builder__head">
        <p className="support builder__count">
          {isDefault ? 'Our selection' : 'Your flavours'}
          <span className="quiet"> · {tier.slots} pieces</span>
          {weightKg !== null && <span className="quiet"> · about {poundsAndOunces(weightKg)}</span>}
        </p>
        <button
          type="button"
          className="builder__toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? 'Done choosing' : 'Change what’s inside'}
        </button>
      </div>

      {!open && (
        <ul className="builder__summary">
          {slots.map((slot, i) => {
            const found = slot ? bySku.get(slot.sku) : undefined;
            if (!found) return null;
            return (
              <li key={`${slot?.sku ?? 'empty'}-${i}`}>
                <span>
                  {found.product.name}
                  {found.product.flavours.length > 1 && (
                    <span className="quiet"> — {found.flavour.flavour}</span>
                  )}
                </span>
                <span className="tabular quiet">
                  {formatMoney(found.flavour.price, tier.currency)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <>
          <p className="builder__hint quiet">
            The pieces are ours. Swap a flavour wherever there is a choice, or{' '}
            <Link href="/build">build a box from scratch</Link>.
          </p>

          <ol className="slots">
            {slots.map((slot, i) => {
              const product = slot ? bySlug.get(slot.productSlug) : null;
              const flavour = slot ? bySku.get(slot.sku)?.flavour : null;

              return (
                <li className="slot" key={i}>
                  {product ? (
                    <button
                      type="button"
                      className="slot__zoom"
                      onClick={() => setPeek(i)}
                      aria-label={`Look closer at ${product.name}`}
                    >
                      {flavour?.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="slot__shot" src={flavour.imageUrl} alt="" width={72} height={72} />
                      ) : (
                        <span className="slot__shot slot__shot--blank" aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    <span className="slot__shot slot__shot--blank" aria-hidden="true" />
                  )}

                  <div className="slot__choices">
                    {/* The piece is part of what this box *is*, so it is
                        stated, not offered. */}
                    <span className="slot__fixed">{product?.name}</span>

                    {product && product.flavours.length > 1 ? (
                      <>
                        <label className="visually-hidden" htmlFor={`slot-${i}-flavour`}>
                          Flavour for item {i + 1}
                        </label>
                        <select
                          id={`slot-${i}-flavour`}
                          value={flavour?.sku ?? ''}
                          onChange={(e) =>
                            setSlot(i, { productSlug: product.slug, sku: e.target.value })
                          }
                        >
                          {product.flavours.map((f) => (
                            <option key={f.sku} value={f.sku} disabled={f.available <= 0}>
                              {f.flavour}
                              {f.available <= 0
                                ? ' (sold out)'
                                : f.available <= 10
                                  ? ` (${f.available} left)`
                                  : ''}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <span className="slot__single quiet">{product?.maker}</span>
                    )}
                  </div>

                  <span className="slot__price tabular">
                    {flavour ? formatMoney(flavour.price, tier.currency) : null}
                  </span>

                </li>
              );
            })}
          </ol>

          <p className="slot slot__total">
            <span className="slot__choices">
              <span className="slot__fixed">{tier.name}</span>
              <span className="slot__note quiet">
                Carton, tissue, band and card — packed by hand
              </span>
            </span>
            <span className="slot__price tabular">
              {formatMoney(tier.price, tier.currency)}
            </span>
          </p>

          <p className="builder__total">
            <span className="support">Box total</span>
            <span className="tabular price">{formatMoney(total, tier.currency)}</span>
          </p>

          {/* A curated piece cannot be swapped for a different one, so a
              sold-out piece is a dead end here. Name the way through. */}
          {soldOutInBox && (
            <p className="builder__hint">
              Something in this box has sold out.{' '}
              <Link href="/build">Build your own</Link> to put something else in its place.
            </p>
          )}
        </>
      )}

      <ItemPeek
        entry={peek === null ? null : slots[peek]}
        products={bySlug}
        flavours={bySku}
        onClose={() => setPeek(null)}
      />

      {structureBroken && (
        <p className="error">
          This box holds {tier.slots}. Something has gone out of stock — reload and try again.
        </p>
      )}
    </div>
  );
}

/**
 * One item, up close: the flavour's own photograph at full size, and the facts
 * that do not fit on a slot row. Native <dialog>, so Escape and the backdrop
 * behave the way people already expect and focus is trapped for free.
 */
function ItemPeek({
  entry,
  products,
  flavours,
  onClose,
}: {
  entry: Slot | null | undefined;
  products: Map<string, BuilderProduct>;
  flavours: Map<string, { product: BuilderProduct; flavour: BuilderFlavour }>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const found = entry ? flavours.get(entry.sku) : undefined;
  const product = entry ? products.get(entry.productSlug) : undefined;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (found && !dialog.open) dialog.showModal();
    if (!found && dialog.open) dialog.close();
  }, [found]);

  return (
    <dialog className="peek" ref={ref} onClose={onClose}>
      {found && product && (
        <>
          {found.flavour.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="peek__shot" src={found.flavour.imageUrl} alt={product.name} />
          ) : (
            <span className="peek__shot" aria-hidden="true" />
          )}
          <div className="peek__body">
            <h3 className="peek__name">{product.name}</h3>
            <dl className="peek__facts">
              {product.flavours.length > 1 && (
                <>
                  <dt>Flavour</dt>
                  <dd>{found.flavour.flavour}</dd>
                </>
              )}
              <dt>Maker</dt>
              <dd>{product.maker}</dd>
              {product.weightKg ? (
                <>
                  <dt>Weight</dt>
                  <dd>{poundsAndOunces(product.weightKg)}</dd>
                </>
              ) : null}
              <dt>Per box</dt>
              <dd>
                {product.maxPerBox === 1 ? 'One only' : `Up to ${product.maxPerBox}`}
              </dd>
              <dt>Stock</dt>
              <dd>
                {found.flavour.available <= 0
                  ? 'Sold out'
                  : found.flavour.available <= 10
                    ? `Only ${found.flavour.available} left`
                    : 'Ready to send'}
              </dd>
            </dl>
            <button type="button" className="peek__close" onClick={() => ref.current?.close()}>
              Close
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}

