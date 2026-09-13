import Link from 'next/link';
import { Emblem } from '@/components/Emblem';
import { CHANNEL, saleorFetch } from '@/lib/saleor';
import { PRODUCTS_QUERY } from '@/lib/queries';
import { loadBoxCatalogue } from '@/lib/catalogue';
import { toBuilderProducts, toBuilderTiers } from '@/lib/builder';
import type { BuilderProduct, BuilderTier } from '@/lib/builder';
import type { BoxOption } from '../order/OrderForm';
import { BuildYourOwn } from './BuildYourOwn';

export const revalidate = 0;

export const metadata = {
  title: 'Build your own box · Mistbox',
  description:
    'Choose a box, fill it with what you like from makers across Washington and Oregon, and we pack it by hand.',
};

type ProductsData = {
  products: {
    edges: Array<{
      node: {
        slug: string;
        name: string;
        variants: Array<{
          id: string;
          quantityAvailable: number | null;
          pricing: { price: { gross: { amount: number; currency: string } } | null } | null;
        }> | null;
      };
    }>;
  } | null;
};

export default async function BuildPage() {
  let boxes: BoxOption[] = [];
  let tiers: BuilderTier[] = [];
  let products: BuilderProduct[] = [];
  let apiDown = false;

  try {
    // The anonymous query is what gives the checkout its variant ids; items are
    // invisible to it, which is exactly the point — they are orderable, never
    // shoppable on their own.
    const data = await saleorFetch<ProductsData>(PRODUCTS_QUERY, { channel: CHANNEL }, false);
    boxes = (data.products?.edges ?? []).flatMap(({ node }) => {
      const variant = node.variants?.[0];
      if (!variant) return [];
      const price = variant.pricing?.price?.gross ?? null;
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

    const catalogue = await loadBoxCatalogue();
    tiers = toBuilderTiers(catalogue);
    products = toBuilderProducts(catalogue);
  } catch {
    apiDown = true;
  }

  return (
    <>
      <section className="shell centred" style={{ paddingBottom: '1.5rem' }}>
        <Link href="/" className="lockup" style={{ textDecoration: 'none' }}>
          <Emblem size={64} />
          <span className="wordmark" style={{ fontSize: '1.5rem' }}>
            Mistbox
          </span>
        </Link>
      </section>

      <section className="shell centred" style={{ paddingTop: 0, paddingBottom: '1rem' }}>
        <h1 className="wordmark" style={{ fontSize: 'clamp(1.75rem, 5vw, 2.75rem)' }}>
          Build your own box
        </h1>
        <p className="support gold rule-under">Choose the vessel. Choose what fills it.</p>
      </section>

      {apiDown || tiers.length === 0 || products.length === 0 ? (
        <section className="shell">
          <p className="error" style={{ maxWidth: '38rem', marginInline: 'auto' }}>
            {apiDown
              ? 'The catalogue is not reachable right now. Please try again in a moment.'
              : 'Nothing is available to build with yet. Run the seed script, or publish some items in the Saleor dashboard.'}
          </p>
        </section>
      ) : (
        <BuildYourOwn boxes={boxes} tiers={tiers} products={products} />
      )}

      <footer>
        <p className="support">Mistbox · Seattle, Washington</p>
      </footer>
    </>
  );
}
