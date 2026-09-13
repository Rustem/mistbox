/**
 * What goes in a box, and how a box becomes order lines.
 *
 * A Mistbox order is one priced line — the carton, tissue, band and card — plus
 * one line per item inside it, each at $0.00. That shape is not a stylistic
 * choice: Saleor has no concept of a product composed of other products, so the
 * only way for selling a box to draw down real chocolate and tea stock is for
 * each item to be its own order line and let Saleor's own stock engine do the
 * work.
 *
 * Everything here is pure. The rules a box must satisfy are the same whether
 * the filling came from a customer picking items or from a tier's saved
 * recipe — one code path, so a preset can never quietly diverge from a custom
 * box — and none of them may be enforced in the browser alone.
 */

export type CatalogueItem = {
  sku: string;
  variantId: string;
  name: string;
  /** The product this flavour belongs to. Caps apply per product, not per
   *  flavour: "up to two chocolate bars" has to mean two bars, not two of
   *  each bar, or a five-slot box can be filled with five chocolate bars. */
  productSlug: string;
  productName: string;
  maker: string;
  kind: string;
  /** Kilograms. `null` when this item has never actually been weighed. */
  weightKg: number | null;
  /** How many of this one item may go in a single box: 1 for heavy or bulky,
   *  2 for small and light. Set per item, not as one blanket rule. */
  maxPerBox: number;
  available: number;
  /** What this item adds to the box, in the channel's currency. A box is worth
   *  its carton plus its contents, so this is the number the builder totals
   *  and the customer is charged. */
  price: number;
};

export type BoxTier = {
  slug: string;
  /** The product's own id, for linking straight to it in the Saleor dashboard. */
  productId: string;
  sku: string;
  variantId: string;
  name: string;
  /** How many items the box holds, curated or custom. */
  slots: number;
  /** The curated filling, expanded into real item lines at checkout. */
  recipe: Array<{ sku: string; quantity: number }>;
  /** Kilograms of empty carton, tissue, band and card. */
  tareKg: number | null;
  available: number;
  /** The carton alone — box, tissue, band and card, packed by hand. What goes
   *  inside is priced on its own lines, so this is a base, not a box price. */
  price: number;
  /** Product thumbnail, for the box cards in step one. */
  imageUrl: string | null;
  imageAlt: string | null;
};

export type Choice = { sku: string; quantity: number };

export type CheckoutLine = { variantId: string; quantity: number };

export type Filling = {
  choices: Array<Choice & { name: string; variantId: string }>;
  lines: CheckoutLine[];
};

export type Invalid = { error: string; sku?: string };

/**
 * The flavour worth printing beside a product name.
 *
 * Suppressed only when it literally repeats what the product name already
 * says — "Cedar trivet, hand-planed — Hand-planed". The test is deliberately
 * narrow and one-directional: showing a redundant flavour is untidy, while
 * hiding a real one would have Daniya pack the wrong scent, so anything not
 * provably redundant is shown.
 */
export function flavourOf(productName: string, variantName?: string | null): string {
  if (!variantName) return '';
  return productName.toLowerCase().includes(variantName.toLowerCase()) ? '' : variantName;
}

/** Narrow a validation result without a thrown exception at the call site. */
export function isInvalid(result: Filling | Invalid): result is Invalid {
  return 'error' in result;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * Turn a chosen (or recipe) filling into the checkout lines for one box, or
 * explain in a sentence a customer can act on why it isn't a box yet.
 *
 * The slot count is checked as an equality, not a maximum: a box with an empty
 * slot is not a cheaper box, it is an unfinished one, and Mistbox charges the
 * tier price either way.
 */
export function fillBox(
  tier: BoxTier,
  choices: Choice[],
  catalogue: Map<string, CatalogueItem>,
  /** How many identical boxes. Caps are per box; stock is checked against the
   *  whole order, because that is what actually has to come off the shelf. */
  boxes = 1,
): Filling | Invalid {
  const merged = new Map<string, number>();
  for (const choice of choices) {
    const quantity = Number(choice.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      return { error: 'Every item needs a whole quantity of at least one.', sku: choice.sku };
    }
    merged.set(choice.sku, (merged.get(choice.sku) ?? 0) + quantity);
  }

  if (merged.size === 0) {
    return { error: `Choose ${tier.slots} items to fill this box.` };
  }

  const chosen: Filling['choices'] = [];
  let filled = 0;
  /** Running total per product, so caps survive a flavour swap. */
  const perProduct = new Map<string, number>();

  for (const [sku, quantity] of merged) {
    const item = catalogue.get(sku);
    if (!item) {
      // Either a stale page, or someone hand-crafting a request. Both get the
      // same honest answer rather than a stack trace.
      return { error: 'One of those items is no longer available.', sku };
    }

    const ofThisProduct = (perProduct.get(item.productSlug) ?? 0) + quantity;
    perProduct.set(item.productSlug, ofThisProduct);
    if (ofThisProduct > item.maxPerBox) {
      return {
        error:
          item.maxPerBox === 1
            ? `Only one ${item.productName} fits in a box.`
            : `Up to ${item.maxPerBox} of the ${item.productName} fit in a box, in any mix of flavours.`,
        sku,
      };
    }
    const needed = quantity * boxes;
    if (item.available < needed) {
      return {
        error:
          item.available === 0
            ? `The ${item.name} has just run out. Swap it for something else and we'll hold the rest.`
            : boxes > 1
              ? `Only ${item.available} of the ${item.name} left — not enough for ${boxes} boxes.`
              : `Only ${item.available} of the ${item.name} left.`,
        sku,
      };
    }
    filled += quantity;
    chosen.push({ sku, quantity, name: item.name, variantId: item.variantId });
  }

  if (filled !== tier.slots) {
    const short = tier.slots - filled;
    return {
      error:
        short > 0
          ? `${short} ${plural(short, 'slot is', 'slots are')} still empty.`
          : `That is ${-short} too many for this box — it holds ${tier.slots}.`,
    };
  }

  return {
    choices: chosen,
    lines: [
      { variantId: tier.variantId, quantity: boxes },
      ...chosen.map((c) => ({ variantId: c.variantId, quantity: c.quantity * boxes })),
    ],
  };
}

/**
 * A tier's curated filling, validated through exactly the same path a custom
 * box takes — so "our selection" can never be a box the builder would refuse.
 */
export function fillFromRecipe(
  tier: BoxTier,
  catalogue: Map<string, CatalogueItem>,
  boxes = 1,
): Filling | Invalid {
  if (tier.recipe.length === 0) {
    return { error: `${tier.name} has no recipe recorded.` };
  }
  return fillBox(tier, tier.recipe, catalogue, boxes);
}

export type WeighedLine = { quantity: number; weightKg: number | null; productName: string };

/**
 * What the parcel weighs, and what we are still guessing about.
 *
 * The carton line carries the tare, so summing every line on the order gives
 * carton plus contents with no separate packaging allowance to keep in sync.
 * An item that has never been weighed contributes a deliberately generous
 * default and is named in `estimated` — carriers re-weigh parcels and
 * back-charge the difference quietly, weeks later, so the number errs high and
 * the admin is told which items it is unsure about.
 */
export const UNWEIGHED_ITEM_KG = 0.25;

export function weighLines(lines: WeighedLine[]): {
  kg: number;
  estimated: string[];
} {
  let kg = 0;
  const estimated: string[] = [];
  for (const line of lines) {
    if (line.weightKg === null) {
      kg += UNWEIGHED_ITEM_KG * line.quantity;
      estimated.push(line.productName);
    } else {
      kg += line.weightKg * line.quantity;
    }
  }
  return { kg: Math.round(kg * 1000) / 1000, estimated };
}
