/**
 * What a composed box amounts to: its pieces, what it is worth, and whether it
 * can actually be sold.
 *
 * Extracted because two screens need exactly this and must never disagree —
 * the box sheet at `/admin/boxes`, and the panel Saleor's dashboard embeds at
 * `/embed/compose`. A second implementation would drift, and the whole point
 * of both screens is to be trusted about money and about whether an order will
 * go through.
 *
 * The "can it be sold" answer is not computed here. It comes from
 * `fillFromRecipe` in `./box` — the same call the checkout route makes — so
 * the worst this file can do is report the truth in a different font.
 */

import type { BoxCatalogue } from '@/lib/catalogue';
import { fillFromRecipe, isInvalid, type BoxTier } from '@/lib/box';

export type BoxPiece = {
  sku: string;
  name: string;
  quantity: number;
  price: number;
};

export type BoxSummary = {
  slug: string;
  name: string;
  productId: string;
  /** How many pieces the box holds. */
  slots: number;
  /** How many are actually composed. */
  filled: number;
  pieces: BoxPiece[];
  /** SKUs in the recipe that are no longer in the catalogue at all. */
  missing: string[];
  /** The carton alone — box, tissue, band and card. */
  carton: number;
  /** Carton plus contents: what the box is worth. */
  total: number;
  currency: string;
  /** Why this box cannot be ordered, in the customer's own words, or null. */
  blocked: string | null;
};

export function summariseBox(tier: BoxTier, catalogue: BoxCatalogue): BoxSummary {
  const pieces: BoxPiece[] = [];
  const missing: string[] = [];

  for (const entry of tier.recipe) {
    const item = catalogue.items.get(entry.sku);
    // A recipe can outlive the item it names — unpublished, or renamed.
    // Saying so is exactly the job of a screen that adds up.
    if (!item) {
      missing.push(entry.sku);
      continue;
    }
    pieces.push({
      sku: entry.sku,
      name: item.name,
      quantity: entry.quantity,
      price: item.price,
    });
  }

  const contents = pieces.reduce((sum, p) => sum + p.price * p.quantity, 0);
  const filling = fillFromRecipe(tier, catalogue.items);

  return {
    slug: tier.slug,
    name: tier.name,
    productId: tier.productId,
    slots: tier.slots,
    filled: pieces.reduce((n, p) => n + p.quantity, 0),
    pieces,
    missing,
    carton: tier.price,
    total: tier.price + contents,
    currency: catalogue.currency,
    blocked: isInvalid(filling) ? filling.error : null,
  };
}

export function summariseBoxes(catalogue: BoxCatalogue): BoxSummary[] {
  return [...catalogue.tiers.values()].map((tier) => summariseBox(tier, catalogue));
}
