import { describe, expect, it } from 'vitest';
import {
  fillBox,
  fillFromRecipe,
  isInvalid,
  weighLines,
  UNWEIGHED_ITEM_KG,
  type BoxTier,
  type CatalogueItem,
} from './box';

const item = (over: Partial<CatalogueItem> & { sku: string }): CatalogueItem => ({
  variantId: `variant:${over.sku}`,
  name: over.sku,
  // One flavour of one product. Distinct products unless a test says otherwise.
  productSlug: `product-${over.sku}`,
  productName: `Product ${over.sku}`,
  maker: 'A maker',
  kind: 'Chocolate',
  weightKg: 0.1,
  maxPerBox: 2,
  available: 50,
  price: 12,
  ...over,
});

const catalogue = (...items: CatalogueItem[]) => new Map(items.map((i) => [i.sku, i]));

const TIER: BoxTier = {
  slug: 'the-mistbox',
  productId: 'product:MB-SIG-01',
  sku: 'MB-SIG-01',
  variantId: 'variant:MB-SIG-01',
  name: 'The Mistbox',
  slots: 3,
  recipe: [
    { sku: 'A', quantity: 1 },
    { sku: 'B', quantity: 2 },
  ],
  tareKg: 0.45,
  price: 15,
  imageUrl: null,
  imageAlt: null,
  available: 10,
};

const THREE = catalogue(item({ sku: 'A' }), item({ sku: 'B' }), item({ sku: 'C' }));

describe('fillBox', () => {
  it('produces the carton line first, then one line per item', () => {
    const result = fillBox(TIER, [{ sku: 'A', quantity: 1 }, { sku: 'B', quantity: 2 }], THREE);
    if (isInvalid(result)) throw new Error(result.error);

    expect(result.lines[0]).toEqual({ variantId: 'variant:MB-SIG-01', quantity: 1 });
    expect(result.lines).toHaveLength(3);
    expect(result.lines.slice(1)).toEqual([
      { variantId: 'variant:A', quantity: 1 },
      { variantId: 'variant:B', quantity: 2 },
    ]);
  });

  it('requires the slots to be exactly full, not merely not-overfull', () => {
    const short = fillBox(TIER, [{ sku: 'A', quantity: 1 }], THREE);
    expect(isInvalid(short) && short.error).toMatch(/2 slots are still empty/);

    const over = fillBox(
      TIER,
      [{ sku: 'A', quantity: 2 }, { sku: 'B', quantity: 2 }],
      THREE,
    );
    expect(isInvalid(over) && over.error).toMatch(/1 too many/);
  });

  it('enforces each item’s own maxPerBox rather than one blanket rule', () => {
    // Same selection, same tier — only the item's own cap differs.
    const capped = catalogue(
      item({ sku: 'A', maxPerBox: 1, productName: 'candle' }),
      item({ sku: 'B' }),
    );
    const selection = [{ sku: 'A', quantity: 2 }, { sku: 'B', quantity: 1 }];

    const refused = fillBox(TIER, selection, capped);
    expect(isInvalid(refused) && refused.error).toBe('Only one candle fits in a box.');
    expect(isInvalid(refused) && refused.sku).toBe('A');

    const allowed = fillBox(TIER, selection, THREE);
    expect(isInvalid(allowed)).toBe(false);
  });

  it('applies the cap per product, so swapping flavour cannot dodge it', () => {
    // Three flavours of ONE chocolate bar, each under its own cap of 2 —
    // but five bars in a five-slot box is exactly what the cap forbids.
    const bars = catalogue(
      item({ sku: 'SALT', productSlug: 'chocolate-bar', productName: 'chocolate bar', maxPerBox: 2 }),
      item({ sku: 'MILK', productSlug: 'chocolate-bar', productName: 'chocolate bar', maxPerBox: 2 }),
      item({ sku: 'TRUF', productSlug: 'chocolate-bar', productName: 'chocolate bar', maxPerBox: 2 }),
    );
    const result = fillBox(
      TIER,
      [{ sku: 'SALT', quantity: 2 }, { sku: 'MILK', quantity: 2 }, { sku: 'TRUF', quantity: 1 }],
      bars,
    );
    expect(isInvalid(result) && result.error).toMatch(/Up to 2 of the chocolate bar/);
  });

  it('still allows two of one product spread across flavours', () => {
    const bars = catalogue(
      item({ sku: 'SALT', productSlug: 'chocolate-bar', productName: 'chocolate bar', maxPerBox: 2 }),
      item({ sku: 'MILK', productSlug: 'chocolate-bar', productName: 'chocolate bar', maxPerBox: 2 }),
      item({ sku: 'C' }),
    );
    const result = fillBox(
      TIER,
      [{ sku: 'SALT', quantity: 1 }, { sku: 'MILK', quantity: 1 }, { sku: 'C', quantity: 1 }],
      bars,
    );
    expect(isInvalid(result)).toBe(false);
  });

  it('merges repeated picks of the same item before checking its cap', () => {
    const result = fillBox(
      TIER,
      [
        { sku: 'A', quantity: 1 },
        { sku: 'A', quantity: 1 },
        { sku: 'A', quantity: 1 },
      ],
      THREE,
    );
    // Three separate picks of a max-2 item is still three of it.
    expect(isInvalid(result) && result.error).toMatch(/Up to 2 of the Product A fit/);
  });

  it('refuses an item that is not in the catalogue', () => {
    const result = fillBox(TIER, [{ sku: 'GHOST', quantity: 3 }], THREE);
    expect(isInvalid(result) && result.error).toMatch(/no longer available/);
    expect(isInvalid(result) && result.sku).toBe('GHOST');
  });

  it('names the item that ran out rather than failing generically', () => {
    const out = catalogue(item({ sku: 'A', available: 0, name: 'Smith Mao Feng' }), item({ sku: 'B' }));
    const result = fillBox(TIER, [{ sku: 'A', quantity: 1 }, { sku: 'B', quantity: 2 }], out);
    expect(isInvalid(result) && result.error).toMatch(/Smith Mao Feng has just run out/);
    expect(isInvalid(result) && result.sku).toBe('A');
  });

  it('rejects fractional and zero quantities', () => {
    for (const quantity of [0, -1, 1.5, Number.NaN]) {
      const result = fillBox(TIER, [{ sku: 'A', quantity }], THREE);
      expect(isInvalid(result) && result.error).toMatch(/whole quantity/);
    }
  });

  it('scales every line for multiple identical boxes', () => {
    const result = fillBox(TIER, [{ sku: 'A', quantity: 1 }, { sku: 'B', quantity: 2 }], THREE, 3);
    if (isInvalid(result)) throw new Error(result.error);

    expect(result.lines).toEqual([
      { variantId: 'variant:MB-SIG-01', quantity: 3 },
      { variantId: 'variant:A', quantity: 3 },
      { variantId: 'variant:B', quantity: 6 },
    ]);
    // The per-box choices stay per-box: they describe one gift, and the label
    // weighs one parcel.
    expect(result.choices.map((c) => c.quantity)).toEqual([1, 2]);
  });

  it('keeps the per-item cap per box while checking stock across the order', () => {
    const scarce = catalogue(item({ sku: 'A', available: 4 }), item({ sku: 'B' }));

    // 2 per box is within the cap of 2, but 3 boxes needs 6 and only 4 exist.
    const tooFew = fillBox(TIER, [{ sku: 'A', quantity: 2 }, { sku: 'B', quantity: 1 }], scarce, 3);
    expect(isInvalid(tooFew) && tooFew.error).toMatch(/not enough for 3 boxes/);

    const fits = fillBox(TIER, [{ sku: 'A', quantity: 2 }, { sku: 'B', quantity: 1 }], scarce, 2);
    expect(isInvalid(fits)).toBe(false);
  });

  it('asks for a filling rather than accepting an empty box', () => {
    const result = fillBox(TIER, [], THREE);
    expect(isInvalid(result) && result.error).toBe('Choose 3 items to fill this box.');
  });
});

describe('fillFromRecipe', () => {
  it('produces exactly what an equivalent hand-picked selection would', () => {
    const preset = fillFromRecipe(TIER, THREE);
    const custom = fillBox(TIER, [{ sku: 'A', quantity: 1 }, { sku: 'B', quantity: 2 }], THREE);
    if (isInvalid(preset) || isInvalid(custom)) throw new Error('both should be valid');

    expect(preset.lines).toEqual(custom.lines);
  });

  it('is held to the same rules — a recipe that no longer fits is refused', () => {
    const soldOut = catalogue(item({ sku: 'A', available: 0 }), item({ sku: 'B' }));
    expect(isInvalid(fillFromRecipe(TIER, soldOut))).toBe(true);
  });

  it('says so when a tier has no recipe recorded', () => {
    const result = fillFromRecipe({ ...TIER, recipe: [] }, THREE);
    expect(isInvalid(result) && result.error).toBe('The Mistbox has no recipe recorded.');
  });
});

describe('weighLines', () => {
  it('sums the carton tare and the contents into one parcel weight', () => {
    const { kg, estimated } = weighLines([
      { quantity: 1, weightKg: 0.45, productName: 'The Mistbox' },
      { quantity: 2, weightKg: 0.1, productName: 'Dark chocolate' },
      { quantity: 1, weightKg: 0.25, productName: 'Wildflower honey' },
    ]);
    expect(kg).toBeCloseTo(0.9, 5);
    expect(estimated).toEqual([]);
  });

  it('errs high and names anything never weighed', () => {
    const { kg, estimated } = weighLines([
      { quantity: 1, weightKg: 0.45, productName: 'The Mistbox' },
      { quantity: 2, weightKg: null, productName: 'Franz cinnamon twist' },
    ]);
    expect(kg).toBeCloseTo(0.45 + 2 * UNWEIGHED_ITEM_KG, 5);
    expect(estimated).toEqual(['Franz cinnamon twist']);
  });
});
