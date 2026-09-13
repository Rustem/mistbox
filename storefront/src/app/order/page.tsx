import Link from 'next/link';
import { Emblem } from '@/components/Emblem';
import { CHANNEL, saleorFetch } from '@/lib/saleor';
import { PRODUCTS_QUERY } from '@/lib/queries';
import { loadBoxCatalogue } from '@/lib/catalogue';
import { toBuilderProducts, toBuilderTiers } from '@/lib/builder';
import { OrderForm, type BoxOption } from './OrderForm';
import type { BuilderTier, BuilderProduct } from '@/lib/builder';

export const revalidate = 0;

type ProductsData = {
  products: {
    edges: Array<{
      node: {
        id: string;
        name: string;
        slug: string;
        variants: Array<{
          id: string;
          name: string;
          quantityAvailable: number | null;
          pricing: { price: { gross: { amount: number; currency: string } } | null } | null;
        }> | null;
        pricing: {
          priceRange: { start: { gross: { amount: number; currency: string } } | null } | null;
        } | null;
      };
    }>;
  } | null;
};

export default async function OrderPage({
  searchParams,
}: {
  searchParams: Promise<{ box?: string; cancelled?: string }>;
}) {
  const { box, cancelled } = await searchParams;

  let boxes: BoxOption[] = [];
  let apiDown = false;
  let tiers: BuilderTier[] = [];
  let products: BuilderProduct[] = [];

  try {
    const data = await saleorFetch<ProductsData>(PRODUCTS_QUERY, { channel: CHANNEL }, false);
    boxes = (data.products?.edges ?? []).flatMap(({ node }) => {
      const variant = node.variants?.[0];
      if (!variant) return [];
      const price =
        variant.pricing?.price?.gross ?? node.pricing?.priceRange?.start?.gross ?? null;
      return [
        {
          variantId: variant.id,
          slug: node.slug,
          name: node.name,
          amount: price?.amount ?? 0,
          currency: price?.currency ?? 'USD',
          available: variant.quantityAvailable ?? 0,
        },
      ];
    });
  } catch {
    apiDown = true;
  }

  try {
    // Items are invisible to the anonymous query above, so the builder's own
    // data comes from the authenticated catalogue read.
    const catalogue = await loadBoxCatalogue();
    tiers = toBuilderTiers(catalogue);
    products = toBuilderProducts(catalogue);
  } catch {
    // Without the catalogue the builder cannot open, but a curated box can
    // still be bought — the form falls back to the tier's own recipe.
  }

  return (
    <>
      <section className="shell centred" style={{ paddingBottom: '2rem' }}>
        <Link href="/" className="lockup" style={{ textDecoration: 'none' }}>
          <Emblem size={64} />
          <span className="wordmark" style={{ fontSize: '1.5rem' }}>
            Mistbox
          </span>
        </Link>
      </section>

      <section className="shell" style={{ paddingTop: 0 }}>
        <div style={{ maxWidth: '38rem', marginInline: 'auto' }}>
          <h2>Send a box</h2>
          <p className="support gold" style={{ marginBottom: '2.5rem' }}>
            A little mist. A lot of meaning.
          </p>

          {cancelled && (
            <p className="error">
              Payment was cancelled — nothing was charged. Your details are still below.
            </p>
          )}

          {apiDown ? (
            <p className="error">
              The store is not reachable right now. Please try again in a moment.
            </p>
          ) : boxes.length === 0 ? (
            <p className="error">
              No boxes are published yet. Run the seed script or publish a product in the
              Saleor dashboard.
            </p>
          ) : (
            <OrderForm boxes={boxes} preselect={box} tiers={tiers} products={products} />
          )}
        </div>
      </section>

      <footer>
        <p className="support">Mistbox · Seattle, Washington</p>
      </footer>
    </>
  );
}
