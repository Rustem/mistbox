'use client';

import { useMemo, useState } from 'react';
import { formatMoney } from '@/lib/saleor';
import {
  fallbackShot,
  indexFlavours,
  poundsAndOunces,
  type BuilderProduct,
  type BuilderTier,
  type Slot,
} from '@/lib/builder';
import { OrderForm, type BoxOption } from '../order/OrderForm';

/**
 * Building a box from nothing, in two steps.
 *
 * Step one is the vessel, step two is what goes in it — that order is not
 * decoration. A box has a fixed capacity and a tare weight, so choosing it
 * first is what makes "four of eight filled" and the parcel weight mean
 * anything at all. Reversing the steps would mean either an unbounded pile or
 * a capacity that changes under the customer.
 *
 * The running total is the point of the page. Every item carries its own
 * price, so the figure is arithmetic anyone can check: the carton, plus what
 * they put in it. Nothing here quotes tax or delivery — those are Stripe's to
 * compute at the next step, and a number invented for them would be a guess
 * presented as fact.
 *
 * Both steps stay on screen once passed. Someone who has filled six slots and
 * then wants a bigger carton should not have to start again, and the choice
 * already made is the clearest label step one can carry.
 */
export function BuildYourOwn({
  boxes,
  tiers,
  products,
}: {
  boxes: BoxOption[];
  tiers: BuilderTier[];
  products: BuilderProduct[];
}) {
  const [tierSlug, setTierSlug] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const bySku = useMemo(() => indexFlavours(products), [products]);
  const bySlug = useMemo(() => new Map(products.map((p) => [p.slug, p])), [products]);
  const tier = useMemo(() => tiers.find((t) => t.slug === tierSlug) ?? null, [tiers, tierSlug]);
  const currency = tiers[0]?.currency ?? 'USD';

  const filled = slots.filter(Boolean).length;
  const room = tier ? tier.slots - filled : 0;

  /** How many of each product are in the box — caps are per product, so two
   *  flavours of one bar still count as two bars. */
  const perProduct = useMemo(() => {
    const counts = new Map<string, number>();
    for (const slot of slots) {
      if (!slot) continue;
      counts.set(slot.productSlug, (counts.get(slot.productSlug) ?? 0) + 1);
    }
    return counts;
  }, [slots]);

  const total = useMemo(
    () =>
      slots.reduce(
        (sum, slot) => sum + (slot ? (bySku.get(slot.sku)?.flavour.price ?? 0) : 0),
        tier?.price ?? 0,
      ),
    [slots, bySku, tier],
  );

  /** Only quoted when every piece has actually been weighed — a guessed weight
   *  shown as fact is how a parcel gets back-charged weeks later. */
  const weightKg = useMemo(() => {
    if (!tier?.tareKg || !filled) return null;
    let kg = tier.tareKg;
    for (const slot of slots) {
      if (!slot) continue;
      const weight = bySlug.get(slot.productSlug)?.weightKg;
      if (!weight) return null;
      kg += weight;
    }
    return kg;
  }, [slots, bySlug, tier, filled]);

  /** Changing the carton keeps what has been chosen, trimmed to the new
   *  capacity — a smaller box should not silently discard the whole box. */
  function chooseTier(next: BuilderTier) {
    setTierSlug(next.slug);
    setSlots((current) => {
      const kept = current.filter(Boolean).slice(0, next.slots);
      return Array.from({ length: next.slots }, (_, i) => kept[i] ?? null);
    });
    setDetailsOpen(false);
  }

  function add(product: BuilderProduct) {
    const flavour = product.flavours.find((f) => f.available > 0) ?? product.flavours[0];
    if (!flavour) return;
    setSlots((current) => {
      const i = current.findIndex((s) => !s);
      if (i === -1) return current;
      return current.map((s, n) =>
        n === i ? { productSlug: product.slug, sku: flavour.sku } : s,
      );
    });
  }

  /** Removing closes the gap, so filled pieces stay at the top of the box and
   *  "add" always lands in the next empty slot rather than in a hole. */
  function removeAt(index: number) {
    setSlots((current) => {
      const kept = current.filter((s, i) => s && i !== index);
      return Array.from({ length: current.length }, (_, i) => kept[i] ?? null);
    });
  }

  function setFlavour(index: number, sku: string) {
    setSlots((current) => current.map((s, i) => (i === index && s ? { ...s, sku } : s)));
  }

  const byKind = useMemo(() => {
    const groups = new Map<string, BuilderProduct[]>();
    for (const product of products) {
      const list = groups.get(product.kind) ?? [];
      list.push(product);
      groups.set(product.kind, list);
    }
    return [...groups];
  }, [products]);

  return (
    <>
      {/* ------------------------------------------------ step one */}
      <section className="shell build__step">
        <div className="build__lede">
          <p className="support gold">Step one</p>
          <h2>Pick your box</h2>
          <p>
            Choose the vessel first — it sets how many pieces will fit, and how the
            whole thing arrives. Everything you add in step two is wrapped in tissue
            and packed into it by hand.
          </p>
        </div>

        <div className="boxpick">
          {tiers.map((t) => {
            const chosen = t.slug === tierSlug;
            const soldOut = t.available <= 0;
            return (
              <article className="boxpick__card" key={t.slug} aria-current={chosen || undefined}>
                <div className="boxpick__shot">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={t.imageUrl ?? fallbackShot(t.slug)} alt={t.name} />
                </div>
                <h3>{t.name}</h3>
                <p className="boxpick__holds quiet">Holds {t.slots} pieces</p>
                <p className="price">{formatMoney(t.price, t.currency)}</p>
                <p className="boxpick__note quiet">
                  The carton alone — what you choose goes on top.
                </p>
                <button
                  type="button"
                  className={`button${chosen ? '' : ' button--ghost'}`}
                  onClick={() => chooseTier(t)}
                  disabled={soldOut}
                >
                  {soldOut ? 'Sold out' : chosen ? 'Chosen' : 'Choose this box'}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------ step two */}
      <section className="shell shell--wide build__step" id="fill">
        <div className="build__lede">
          <p className="support gold">Step two</p>
          <h2>Fill your box</h2>
          <p>
            {tier
              ? `Add up to ${tier.slots} pieces from makers across Washington and Oregon. A few are limited to one or two per box, so no single order runs away with the season's stock.`
              : 'Choose a box above and this fills in — the capacity comes from the vessel you pick.'}
          </p>
        </div>

        {tier && (
          <div className="build__layout">
            <div className="build__items">
              {byKind.map(([kind, group]) => (
                <div className="build__group" key={kind}>
                  <p className="contents-label">{kind}</p>
                  <div className="picker">
                    {group.map((product) => {
                      const used = perProduct.get(product.slug) ?? 0;
                      const soldOut = product.flavours.every((f) => f.available <= 0);
                      const atCap = used >= product.maxPerBox;
                      const noRoom = room <= 0;
                      const cheapest = Math.min(...product.flavours.map((f) => f.price));
                      const shot = product.flavours.find((f) => f.imageUrl)?.imageUrl ?? null;

                      return (
                        <article className="picker__item" key={product.slug}>
                          <div className="picker__shot">
                            {shot ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={shot} alt={product.name} />
                            ) : (
                              <span aria-hidden="true" />
                            )}
                            {used > 0 && <span className="picker__badge">{used}</span>}
                          </div>
                          <h3>{product.name}</h3>
                          <p className="picker__maker quiet">{product.maker}</p>
                          <p className="picker__price">{formatMoney(cheapest, currency)}</p>

                          {/* The cap, said before it is hit rather than only
                              as a dead button afterwards. It appears once the
                              limit is in play — either because one is already
                              in the box, or because the limit is one and the
                              first tap would be the last. */}
                          <p className="picker__cap" data-at-cap={atCap || undefined}>
                            {used > 0
                              ? `${used} of ${product.maxPerBox} in your box`
                              : product.maxPerBox === 1
                                ? 'One per box'
                                : `Up to ${product.maxPerBox} per box`}
                          </p>

                          <button
                            type="button"
                            className="button button--ghost picker__add"
                            onClick={() => add(product)}
                            disabled={soldOut || atCap || noRoom}
                          >
                            {soldOut
                              ? 'Sold out'
                              : atCap
                                ? "That's the limit"
                                : noRoom
                                  ? 'Box is full'
                                  : used > 0
                                    ? 'Add another'
                                    : 'Add to box'}
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* ------------------------------------------ the box so far */}
            <aside className="build__summary">
              <div className="builder">
                <div className="builder__head">
                  <p className="support builder__count">
                    {filled} of {tier.slots} filled
                    {weightKg !== null && (
                      <span className="quiet">about {poundsAndOunces(weightKg)}</span>
                    )}
                  </p>
                </div>

                <ol className="slots">
                  {slots.map((slot, i) => {
                    const product = slot ? bySlug.get(slot.productSlug) : null;
                    const found = slot ? bySku.get(slot.sku) : undefined;

                    if (!slot || !product) {
                      return (
                        <li className="slot slot--empty" key={i}>
                          <span className="slot__shot slot__shot--blank" aria-hidden="true" />
                          <span className="slot__choices quiet">Empty</span>
                        </li>
                      );
                    }

                    return (
                      <li className="slot" key={`${slot.sku}-${i}`}>
                        {found?.flavour.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            className="slot__shot"
                            src={found.flavour.imageUrl}
                            alt=""
                            width={72}
                            height={72}
                          />
                        ) : (
                          <span className="slot__shot slot__shot--blank" aria-hidden="true" />
                        )}

                        <div className="slot__choices">
                          <span className="slot__fixed">{product.name}</span>
                          {product.flavours.length > 1 ? (
                            <>
                              <label className="visually-hidden" htmlFor={`fill-${i}-flavour`}>
                                Flavour for piece {i + 1}
                              </label>
                              <select
                                id={`fill-${i}-flavour`}
                                value={slot.sku}
                                onChange={(e) => setFlavour(i, e.target.value)}
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
                            <span className="slot__single quiet">{product.maker}</span>
                          )}
                        </div>

                        <span className="slot__price tabular">
                          {formatMoney(found?.flavour.price ?? 0, currency)}
                        </span>

                        <button
                          type="button"
                          className="slot__remove"
                          onClick={() => removeAt(i)}
                          aria-label={`Remove ${product.name}`}
                          title="Remove"
                        >
                          &times;
                        </button>
                      </li>
                    );
                  })}
                </ol>

                <p className="slot slot__total">
                  <span className="slot__choices">
                    <span className="slot__fixed">{tier.name}</span>
                    <span className="slot__note quiet">Carton, tissue, band and card</span>
                  </span>
                  <span className="slot__price tabular">{formatMoney(tier.price, currency)}</span>
                </p>

                <p className="builder__total">
                  <span className="support">Box total</span>
                  <span className="tabular price">{formatMoney(total, currency)}</span>
                </p>

                <p className="builder__hint quiet">
                  Delivery and tax are added at the next step.
                </p>

                {!detailsOpen && (
                  <button
                    type="button"
                    className="button"
                    onClick={() => setDetailsOpen(true)}
                    disabled={filled === 0}
                  >
                    {filled === 0 ? 'Add something first' : 'Continue'}
                  </button>
                )}
              </div>
            </aside>
          </div>
        )}
      </section>

      {/* ------------------------------------------------ the details */}
      {tier && detailsOpen && (
        <section className="shell build__step" id="details">
          <div style={{ maxWidth: '38rem', marginInline: 'auto' }}>
            <div className="build__lede">
              <p className="support gold">Step three</p>
              <h2>Where it goes</h2>
            </div>
            <OrderForm
              boxes={boxes}
              tiers={tiers}
              products={products}
              prebuilt={{ tierSlug: tier.slug, slots, total, currency }}
            />
          </div>
        </section>
      )}
    </>
  );
}
