import { describe, expect, it } from 'vitest';
import { summariseBox } from './boxSheet';
import type { BoxCatalogue } from './catalogue';
import type { BoxTier, CatalogueItem } from './box';

const item = (over: Partial<CatalogueItem> & { sku: string }): CatalogueItem => ({
  variantId: `variant:${over.sku}`,
  name: over.sku,
  productSlug: `product-${over.sku}`,
  productName: `Product ${over.sku}`,
  maker: 'A maker',
  kind: 'Chocolate',
  weightKg: 0.1,
  maxPerBox: 2,
  available: 50,
  price: 10,
  ...over,
});

const TIER: BoxTier = {
  slug: 'the-mistbox',
  productId: 'product:box',
  sku: 'MB-SIG-01',
  variantId: 'variant:MB-SIG-01',
  name: 'The Mistbox',
  slots: 2,
  recipe: [{ sku: 'A', quantity: 1 }, { sku: 'B', quantity: 1 }],
  tareKg: 0.45,
  price: 15,
  imageUrl: null,
  imageAlt: null,
  available: 10,
};

const catalogue = (tier: BoxTier, ...items: CatalogueItem[]): BoxCatalogue => ({
  tiers: new Map([[tier.slug, tier]]),
  items: new Map(items.map((i) => [i.sku, i])),
  products: [],
  currency: 'USD',
});

describe('summariseBox', () => {
  it('adds the carton to its contents to price the box', () => {
    const box = summariseBox(TIER, catalogue(TIER, item({ sku: 'A', price: 9 }), item({ sku: 'B', price: 21 })));
    expect(box.total).toBe(15 + 9 + 21);
    expect(box.carton).toBe(15);
  });

  it('counts quantity, not rows, as filled', () => {
    const tier = { ...TIER, slots: 3, recipe: [{ sku: 'A', quantity: 3 }] };
    const box = summariseBox(tier, catalogue(tier, item({ sku: 'A', price: 8, maxPerBox: 3 })));
    expect(box.filled).toBe(3);
    expect(box.total).toBe(15 + 24);
  });

  it('names a recipe entry whose item has left the catalogue', () => {
    // The item is gone, so it contributes no price — and saying nothing would
    // quietly under-price the box.
    const box = summariseBox(TIER, catalogue(TIER, item({ sku: 'A', price: 9 })));
    expect(box.missing).toEqual(['B']);
    expect(box.total).toBe(15 + 9);
  });

  it('reports an over-cap box as unsellable, in the checkout own words', () => {
    const tier = { ...TIER, slots: 3, recipe: [{ sku: 'A', quantity: 3 }] };
    // Three of a product capped at two: exactly the fault that reached a real
    // box and was only caught when a customer could not buy it.
    const box = summariseBox(
      tier,
      catalogue(tier, item({ sku: 'A', maxPerBox: 2, productName: 'Chocolate bar, 3 oz' })),
    );
    expect(box.blocked).toContain('Up to 2 of the Chocolate bar, 3 oz');
  });

  it('leaves a good box unblocked', () => {
    const box = summariseBox(
      TIER,
      catalogue(TIER, item({ sku: 'A' }), item({ sku: 'B', productSlug: 'other' })),
    );
    expect(box.blocked).toBeNull();
  });

  it('blocks a box with nothing in it rather than pricing an empty carton', () => {
    const tier = { ...TIER, recipe: [] };
    const box = summariseBox(tier, catalogue(tier));
    expect(box.blocked).toBe('The Mistbox has no recipe recorded.');
    expect(box.total).toBe(15);
  });
});
