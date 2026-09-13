/**
 * What the box builders need, shaped for the browser.
 *
 * `loadBoxCatalogue` returns the whole catalogue — variant ids, costs, stock,
 * metadata — and most of that has no business crossing to a client component.
 * These types are the narrow view two different pages both render: the curated
 * box on `/order`, and the two-step builder on `/build`. Having one mapper
 * rather than one per route is what keeps them showing the same prices.
 */

import type { BoxCatalogue } from '@/lib/catalogue';
import { contentsOf } from '@/lib/catalogue';

export type BuilderFlavour = {
  sku: string;
  flavour: string;
  available: number;
  imageUrl: string | null;
  /** What this flavour adds to the box. Two flavours of one bar can cost
   *  different money to buy in, so they can sell for different money too. */
  price: number;
};

export type BuilderProduct = {
  slug: string;
  name: string;
  kind: string;
  maker: string;
  maxPerBox: number;
  weightKg: number | null;
  flavours: BuilderFlavour[];
};

export type BuilderTier = {
  slug: string;
  name: string;
  slots: number;
  recipe: Array<{ sku: string; quantity: number }>;
  tareKg: number | null;
  contents: string[];
  /** The carton alone: box, tissue, band and card, packed by hand. What goes
   *  inside is priced on its own lines, so this is a base, not a box price. */
  price: number;
  currency: string;
  imageUrl: string | null;
  available: number;
};

/** One slot: which product and which of its flavours, or empty while building. */
export type Filled = { productSlug: string; sku: string };
export type Slot = Filled | null;
export type Chosen = { sku: string; quantity: number };

export function toBuilderTiers(catalogue: BoxCatalogue): BuilderTier[] {
  return [...catalogue.tiers.values()].map((tier) => ({
    slug: tier.slug,
    name: tier.name,
    slots: tier.slots,
    recipe: tier.recipe,
    tareKg: tier.tareKg,
    contents: contentsOf(tier, catalogue.items),
    price: tier.price,
    currency: catalogue.currency,
    imageUrl: tier.imageUrl,
    available: tier.available,
  }));
}

export function toBuilderProducts(catalogue: BoxCatalogue): BuilderProduct[] {
  return catalogue.products.map((product) => ({
    slug: product.slug,
    name: product.name,
    kind: product.kind,
    maker: product.maker,
    maxPerBox: product.maxPerBox,
    weightKg: product.weightKg,
    flavours: product.flavours.map((f) => ({
      sku: f.sku,
      flavour: f.flavour,
      available: f.available,
      imageUrl: f.imageUrl,
      price: f.price,
    })),
  }));
}

export function indexFlavours(products: BuilderProduct[]) {
  const bySku = new Map<string, { product: BuilderProduct; flavour: BuilderFlavour }>();
  for (const product of products) {
    for (const flavour of product.flavours) bySku.set(flavour.sku, { product, flavour });
  }
  return bySku;
}

/** Slots collapse into the `{sku, quantity}` list the checkout accepts. */
export function chosenFrom(slots: Slot[]): Chosen[] {
  const counts = new Map<string, number>();
  // Empty slots contribute nothing; the caller is responsible for refusing to
  // check out a box that still has any.
  for (const slot of slots) {
    if (!slot) continue;
    counts.set(slot.sku, (counts.get(slot.sku) ?? 0) + 1);
  }
  return [...counts].map(([sku, quantity]) => ({ sku, quantity }));
}

export function slotsFromRecipe(
  tier: BuilderTier,
  bySku: Map<string, { product: BuilderProduct; flavour: BuilderFlavour }>,
): Slot[] {
  const slots: Slot[] = [];
  for (const entry of tier.recipe) {
    const found = bySku.get(entry.sku);
    if (!found) continue;
    for (let i = 0; i < entry.quantity; i++) {
      slots.push({ productSlug: found.product.slug, sku: entry.sku });
    }
  }
  // Always exactly `tier.slots` entries, padded with empties. The array's
  // length is the box's capacity and never changes; only what fills it does.
  return Array.from({ length: tier.slots }, (_, i) => slots[i] ?? null);
}

const KG_PER_LB = 0.45359237;

/** "2 lb 13 oz" — the unit a US customer weighs a parcel in. */
export function poundsAndOunces(kg: number): string {
  const totalOunces = Math.round((kg / KG_PER_LB) * 16);
  const lb = Math.floor(totalOunces / 16);
  const oz = totalOunces % 16;
  if (lb === 0) return `${oz} oz`;
  return oz === 0 ? `${lb} lb` : `${lb} lb ${oz} oz`;
}

/** How many illustrated stand-ins `tools/box-shots.mjs` writes. */
const FALLBACK_SHOTS = 3;

/**
 * Illustrated art for a box with no photograph, chosen by slug so it is stable
 * across renders and two unphotographed boxes rarely show the same picture.
 *
 * A box Daniya composed in the dashboard has no photograph, and a card with no
 * image beside cards that have one reads as broken rather than as new.
 */
export function fallbackShot(slug: string): string {
  let hash = 0;
  for (const ch of slug) hash = (hash * 31 + ch.charCodeAt(0)) % 9973;
  return `/box-shot-${(hash % FALLBACK_SHOTS) + 1}.png`;
}
