/**
 * The box catalogue: what tiers exist, what may go in them, and what each of
 * those weighs.
 *
 * Read authenticated on purpose. Items are published with
 * `visibleInListings: false` so the public products query cannot see them —
 * that flag is the entire "orderable but not shoppable" mechanism, and there
 * is no storefront-side filtering anywhere. An app token with Manage orders
 * reads past it.
 *
 * Server-only: never import this into a Client Component.
 */

import { BOX_CATALOGUE_QUERY } from '@/lib/queries';
import { CHANNEL, saleorFetchAuthed } from '@/lib/saleor';
import type { BoxTier, CatalogueItem } from '@/lib/box';

const TIER_TYPE = 'gift-box';
const ITEM_TYPE = 'box-item';

type Meta = Array<{ key: string; value: string }>;

type Node = {
  id: string;
  name: string;
  slug: string;
  metadata: Meta;
  productType: { slug: string } | null;
  thumbnail: { url: string; alt: string | null } | null;
  attributes: Array<{
    attribute: { slug: string | null } | null;
    values: Array<{ name: string | null; reference: string | null }>;
  }> | null;
  variants: Array<{
    id: string;
    sku: string | null;
    name: string;
    quantityAvailable: number | null;
    weight: { unit: string; value: number } | null;
    metadata: Meta;
    pricing: { price: { gross: { amount: number; currency: string } } | null } | null;
    media: Array<{ url: string; alt: string | null }> | null;
  }> | null;
};

type CatalogueData = { products: { edges: Array<{ node: Node }> } | null };

/** One flavour of an item — the thing a customer actually picks. */
export type ItemFlavour = {
  sku: string;
  variantId: string;
  /** "Cedar smoke". The variant's own name. */
  flavour: string;
  available: number;
  imageUrl: string | null;
  /** What this flavour adds to a box. Two flavours of one bar can cost
   *  different money to buy in, so they can sell for different money too. */
  price: number;
};

/**
 * An item as it is merchandised: one product, its flavours beneath it.
 *
 * The product is also the swap group — swapping a scent is choosing a sibling
 * variant — so the builder needs no grouping of its own.
 */
export type ItemProduct = {
  slug: string;
  name: string;
  maker: string;
  kind: string;
  weightKg: number | null;
  maxPerBox: number;
  flavours: ItemFlavour[];
};

export type BoxCatalogue = {
  /** Tiers by slug — the slug is what the order form posts. */
  tiers: Map<string, BoxTier>;
  /** Every flavour, flattened by SKU. SKUs travel in requests and onto the
   *  packing card, because a variant id is unreadable in a log and means
   *  nothing to a person. This is what validation works against. */
  items: Map<string, CatalogueItem>;
  /** The same things grouped for display: a product with its flavours. */
  products: ItemProduct[];
  currency: string;
};

const meta = (m: Meta, key: string): string => m.find((x) => x.key === key)?.value ?? '';

/**
 * Saleor returns a weight in whatever unit the shop is configured for, not the
 * unit it was written in, so the unit has to be honoured rather than assumed.
 */
const PER_KG: Record<string, number> = { KG: 1, G: 0.001, LB: 0.45359237, OZ: 0.028349523, TONN: 1000 };

export function toKg(weight: { unit: string; value: number } | null | undefined): number | null {
  if (!weight || typeof weight.value !== 'number') return null;
  const factor = PER_KG[weight.unit?.toUpperCase()];
  if (!factor) return null;
  const kg = weight.value * factor;
  // A zero weight is Saleor's "unset", not a real measurement of nothing.
  return kg > 0 ? kg : null;
}

function parseRecipe(raw: string): Array<{ sku: string; quantity: number }> {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const e = entry as { sku?: unknown; quantity?: unknown };
      const quantity = Number(e.quantity);
      return typeof e.sku === 'string' && Number.isInteger(quantity) && quantity > 0
        ? [{ sku: e.sku, quantity }]
        : [];
    });
  } catch {
    // A malformed recipe must not take the order form down — the tier simply
    // has no curated filling until it is fixed, and custom boxes still work.
    console.warn('[mistbox] could not parse a tier recipe');
    return [];
  }
}

/** A plain attribute's first value, as text. */
function attr(node: Node, slug: string): string {
  const found = (node.attributes ?? []).find((a) => a.attribute?.slug === slug);
  return found?.values?.[0]?.name ?? '';
}

/** Variant ids picked in the dashboard's "Contents" attribute, in order. */
function contentsReferences(node: Node): string[] {
  const attr = (node.attributes ?? []).find((a) => a.attribute?.slug === 'contents');
  return (attr?.values ?? []).flatMap((v) => (v.reference ? [v.reference] : []));
}

export async function loadBoxCatalogue(): Promise<BoxCatalogue> {
  const data = await saleorFetchAuthed<CatalogueData>(BOX_CATALOGUE_QUERY, { channel: CHANNEL });

  const tiers = new Map<string, BoxTier>();
  const items = new Map<string, CatalogueItem>();
  const products: ItemProduct[] = [];
  let currency = 'USD';

  // Items first: a tier's contents are variant ids, and turning those into
  // SKUs needs the item side of the catalogue already in hand.
  const skuByVariantId = new Map<string, string>();
  const tierNodes: Node[] = [];

  for (const { node } of data.products?.edges ?? []) {
    const variant = node.variants?.[0];
    if (!variant?.sku) continue;
    const kind = node.productType?.slug;

    if (kind === TIER_TYPE) {
      const price = variant.pricing?.price?.gross;
      if (price?.currency) currency = price.currency;
      tierNodes.push(node);
    } else if (kind === ITEM_TYPE) {
      // Product-wide facts: how much room it takes and how many may go in one
      // box are true of every flavour of it.
      // The attribute first, because it is the only one of the two a person can
      // actually change: Saleor 3.23's dashboard has no metadata editor, so a
      // cap kept only in metadata can never be adjusted without a re-seed.
      // Metadata stays as the fallback for an item seeded before the attribute
      // existed.
      const maxPerBox =
        Number(attr(node, 'max-per-box')) || Number(meta(node.metadata, 'max_per_box')) || 1;
      const maker = meta(node.metadata, 'maker');
      const itemKind = meta(node.metadata, 'kind');
      const flavours: ItemFlavour[] = [];

      for (const v of node.variants ?? []) {
        if (!v.sku) continue;
        skuByVariantId.set(v.id, v.sku);
        const weightKg = toKg(v.weight);
        const only = (node.variants ?? []).length === 1;

        const price = v.pricing?.price?.gross;
        if (price?.currency) currency = price.currency;

        flavours.push({
          sku: v.sku,
          variantId: v.id,
          flavour: v.name,
          available: v.quantityAvailable ?? 0,
          imageUrl: v.media?.[0]?.url ?? node.thumbnail?.url ?? null,
          price: price?.amount ?? 0,
        });

        items.set(v.sku, {
          sku: v.sku,
          variantId: v.id,
          productSlug: node.slug,
          productName: node.name,
          // A flavour is only worth naming when there is a choice to make.
          name: only || !v.name ? node.name : `${node.name}, ${v.name}`,
          maker,
          kind: itemKind,
          weightKg,
          maxPerBox,
          available: v.quantityAvailable ?? 0,
          price: price?.amount ?? 0,
        });
      }

      if (flavours.length) {
        products.push({
          slug: node.slug,
          name: node.name,
          maker,
          kind: itemKind,
          weightKg: toKg(node.variants?.[0]?.weight),
          maxPerBox,
          flavours,
        });
      }
    }
  }

  for (const node of tierNodes) {
    const variant = node.variants?.[0];
    if (!variant?.sku) continue;

    // What Daniya picked in the dashboard beats what the seed wrote.
    //
    // The seeded recipe is a default, not a decree: if she has composed this
    // box's contents on its product page, that is a deliberate human act and
    // it must survive the next `seed.py` run — otherwise "she can build boxes"
    // would be true only until someone re-seeded.
    const picked = contentsReferences(node)
      .flatMap((ref) => {
        const sku = skuByVariantId.get(ref);
        if (!sku) return [];
        return [{ sku, quantity: 1 }];
      })
      // The same item picked twice is two of it, which the per-item cap still
      // polices at checkout.
      .reduce<Array<{ sku: string; quantity: number }>>((acc, entry) => {
        const found = acc.find((e) => e.sku === entry.sku);
        if (found) found.quantity += 1;
        else acc.push(entry);
        return acc;
      }, []);

    const recipe = picked.length ? picked : parseRecipe(meta(node.metadata, 'mistbox.recipe'));

    // How many pieces the box *holds* — a fact about the carton, not about
    // what happens to be in it today.
    //
    // This used to prefer the contents whenever any were picked, which made
    // capacity move as the box was edited: put seven chips in a five-piece box
    // and it quietly became a seven-piece box. "Six of seven pieces" was then
    // a sentence about nothing, and the checkout still refused the box for a
    // reason the dashboard had never mentioned. The declared size wins, and
    // the contents are only a fallback for a box whose size was never
    // recorded — which is how an over-filled box now reads as over-filled.
    // The attribute first, because it is the only one of the two a person can
    // change: 3.23's dashboard has no metadata editor. Metadata stays as the
    // fallback for a box seeded before the attribute existed.
    const declaredSlots =
      Number(attr(node, 'slots')) || Number(meta(node.metadata, 'mistbox.slots')) || 0;
    const recipeTotal = recipe.reduce((n, e) => n + e.quantity, 0);

    tiers.set(node.slug, {
      slug: node.slug,
      productId: node.id,
      sku: variant.sku,
      variantId: variant.id,
      name: node.name,
      slots: declaredSlots || recipeTotal,
      recipe,
      tareKg: toKg(variant.weight),
      available: variant.quantityAvailable ?? 0,
      price: variant.pricing?.price?.gross?.amount ?? 0,
      imageUrl: node.thumbnail?.url ?? variant.media?.[0]?.url ?? null,
      imageAlt: node.thumbnail?.alt ?? null,
    });
  }

  products.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

  return { tiers, items, products, currency };
}

/**
 * What is actually in a box, ready to print under "What's inside".
 *
 * Read from the recipe — the same list that becomes order lines and draws
 * down stock — rather than from prose in the product description. That is the
 * difference between a contents list that is true and one that merely was
 * true when somebody last edited the copy, and it is the only reason a box
 * Daniya composes in the dashboard describes itself correctly on the site
 * without her writing anything.
 */
export function contentsOf(tier: BoxTier, items: Map<string, CatalogueItem>): string[] {
  // These lines sit beside description-derived HTML in the same list, so they
  // are escaped to match. "Ballard & Bell" is the everyday case; a product
  // name is admin-entered, which is a small blast radius but not zero.
  const esc = (s: string) =>
    s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);

  return tier.recipe.flatMap((entry) => {
    const item = items.get(entry.sku);
    if (!item) return [];
    const prefix = entry.quantity > 1 ? `${entry.quantity} × ` : '';
    const line = item.maker ? `${prefix}${item.name} — ${item.maker}` : `${prefix}${item.name}`;
    return [esc(line)];
  });
}

/** Items grouped for the builder, in a stable order. */
export function groupItemsByKind(items: Iterable<CatalogueItem>): Array<[string, CatalogueItem[]]> {
  const groups = new Map<string, CatalogueItem[]>();
  for (const item of items) {
    const key = item.kind || 'Other';
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  for (const group of groups.values()) group.sort((a, b) => a.name.localeCompare(b.name));
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}
