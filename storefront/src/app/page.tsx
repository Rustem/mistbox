import Image from 'next/image';
import Link from 'next/link';
import { Emblem } from '@/components/Emblem';
import { NewsletterForm } from '@/components/NewsletterForm';
import { CHANNEL, formatMoney, saleorFetch } from '@/lib/saleor';
import { PRODUCTS_QUERY } from '@/lib/queries';
import { describe } from '@/lib/richtext';
import { contentsOf, loadBoxCatalogue } from '@/lib/catalogue';
import { fallbackShot } from '@/lib/builder';

export const revalidate = 60;

type Media = { url: string; alt: string | null };

type Variant = {
  id: string;
  name: string;
  sku: string | null;
  quantityAvailable: number | null;
  pricing: { price: { gross: { amount: number; currency: string } } | null } | null;
};

type Product = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  thumbnail: Media | null;
  media: Media[] | null;
  variants: Variant[] | null;
  pricing: {
    priceRange: { start: { gross: { amount: number; currency: string } } | null } | null;
  } | null;
};

type ProductsData = { products: { edges: Array<{ node: Product }> } | null };

/**
 * Stock is merchandising, not inventory reporting. A number is only worth
 * showing when it is a reason to act — Saleor also caps `quantityAvailable`
 * at 50, so printing it verbatim is misleading as well as noisy.
 */
function stockLabel(qty: number | null): { text: string; low: boolean; out: boolean } {
  if (qty === null) return { text: '', low: false, out: false };
  if (qty <= 0) return { text: 'Sold out for this season', low: false, out: true };
  if (qty <= 10) return { text: `Only ${qty} left`, low: true, out: false };
  return { text: 'Ready to send', low: false, out: false };
}

export default async function HomePage() {
  let products: Product[] = [];
  let apiDown = false;
  /** Real contents per box slug, from the recipe rather than the copy. */
  let contents = new Map<string, string[]>();
  /** What each box costs as curated: its carton plus everything in it. */
  let boxPrice = new Map<string, { amount: number; currency: string }>();

  try {
    const data = await saleorFetch<ProductsData>(PRODUCTS_QUERY, { channel: CHANNEL });
    products = (data.products?.edges ?? []).map((e) => e.node);
  } catch {
    apiDown = true;
  }

  try {
    const catalogue = await loadBoxCatalogue();
    contents = new Map(
      [...catalogue.tiers.values()].map((tier) => [tier.slug, contentsOf(tier, catalogue.items)]),
    );
    // The tier's own variant price is the carton alone now, so quoting it here
    // would advertise The Mistbox at $15. A box is worth its carton plus its
    // contents, and that is the number on the card.
    boxPrice = new Map(
      [...catalogue.tiers.values()].map((tier) => [
        tier.slug,
        {
          amount: tier.recipe.reduce(
            (sum, e) => sum + (catalogue.items.get(e.sku)?.price ?? 0) * e.quantity,
            tier.price,
          ),
          currency: catalogue.currency,
        },
      ]),
    );
  } catch {
    // A box still sells without its contents list; falling back to whatever
    // the description says is better than an empty shop.
  }

  return (
    <>
      {/* ------------------------------------------------------ hero */}
      <section className="shell centred hero">
        <div className="lockup">
          <Emblem size={104} />
          <h1 className="wordmark">Mistbox</h1>
          <p className="tagline">
            Thoughtfully gathered
            <br />
            Beautifully given
          </p>
        </div>
      </section>

      {/* ----------------------------------------------------- story */}
      <section className="shell centred story">
        <h2>Inspired by nature. Made to connect.</h2>
        <p>
          A Mistbox is a small, deliberate collection — gathered from makers across
          Washington and Oregon, arranged by hand, and sent to someone who will know
          you meant it. No filler, no surplus, nothing chosen at random.
        </p>
        <p className="support gold rule-under">A little mist. A lot of meaning.</p>
        <p className="quiet-link">
          <Link href="/about">Read our story</Link>
        </p>
      </section>

      {/* ----------------------------------------------------- tiers */}
      <section className="shell" id="boxes">
        <div className="centred">
          <h2>The boxes</h2>
        </div>

        {apiDown ? (
          <p className="error" style={{ maxWidth: '38rem', margin: '2rem auto' }}>
            The catalogue is not reachable right now. Check that Saleor is running at{' '}
            <code>{process.env.NEXT_PUBLIC_SALEOR_API_URL}</code>.
          </p>
        ) : products.length === 0 ? (
          <p className="centred" style={{ marginTop: '2rem' }}>
            Nothing published yet. Run the seed script, or publish a product in the
            Saleor dashboard.
          </p>
        ) : (
          <div className="tiers">
            {products.map((product) => {
              const variant = product.variants?.[0];
              // Falls back to the raw variant price only when the catalogue is
              // unreachable — a price that is too low is worse than none, but
              // a card with no price at all is worse still.
              const price =
                boxPrice.get(product.slug) ??
                variant?.pricing?.price?.gross ??
                product.pricing?.priceRange?.start?.gross;
              const stock = stockLabel(variant?.quantityAvailable ?? null);
              const { intro, items: described } = describe(product.description);
              // The recipe is the truth; the description's own list is only a
              // fallback for a box that has no recipe yet.
              const items = contents.get(product.slug)?.length
                ? (contents.get(product.slug) as string[])
                : described;
              const photo = product.thumbnail ?? product.media?.[0] ?? null;
              // A box Daniya composed in the dashboard has no photograph, and a
              // card with no image beside cards that have one reads as broken
              // rather than as new. Fall back to illustrated art, picked by
              // slug so a box keeps the same picture on every render.
              const shot = photo ?? { url: fallbackShot(product.slug), alt: '' };

              return (
                <article className="tier" key={product.id}>
                  <Link
                    href={stock.out ? '#boxes' : `/order?box=${product.slug}`}
                    className="tier__shot"
                    tabIndex={-1}
                    aria-hidden="true"
                  >
                    <Image
                      src={shot.url}
                      alt={shot.alt || product.name}
                      width={800}
                      height={800}
                      sizes="(max-width: 48rem) 100vw, 32rem"
                      priority
                    />
                  </Link>

                  <div className="tier__body">
                    <h3>{product.name}</h3>
                    {price && (
                      <div className="price">{formatMoney(price.amount, price.currency)}</div>
                    )}
                    <p dangerouslySetInnerHTML={{ __html: intro }} />

                    {items.length > 0 && (
                      <>
                        <div className="contents-label">What&rsquo;s inside</div>
                        <ul className="contents">
                          {items.map((item, i) => (
                            <li key={i} dangerouslySetInnerHTML={{ __html: item }} />
                          ))}
                        </ul>
                      </>
                    )}

                    <div className="stock" data-low={stock.low} data-out={stock.out}>
                      {stock.text}
                    </div>

                    <Link
                      className={`button${stock.out ? ' button--ghost' : ''}`}
                      href={stock.out ? '#boxes' : `/order?box=${product.slug}`}
                      aria-disabled={stock.out}
                      style={stock.out ? { pointerEvents: 'none', opacity: 0.4 } : undefined}
                    >
                      {stock.out ? 'Sold out' : 'Send this box'}
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* The way into the two-step builder. A fourth card would read as a
            fourth product, and this is not a box you can be sent — it is a
            different way of arriving at one. */}
        {!apiDown && products.length > 0 && (
          <div className="centred byo">
            <p className="byo__lede">
              Or choose the vessel yourself and fill it piece by piece, from the same
              makers.
            </p>
            <Link className="button button--ghost" href="/build">
              Build your own box
            </Link>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------- origin */}
      <section className="band">
        <div className="shell centred">
          <div className="band__mark">
            <Emblem variant="fir" size={54} />
          </div>
          <p className="support" style={{ marginTop: '1.5rem' }}>
            Made in the Pacific Northwest
            <br />
            with care and intention
          </p>
          <p className="band__newsletter-intro">
            Stay in touch — new boxes, no more than a few times a year.
          </p>
          <NewsletterForm />
        </div>
      </section>

      <footer>
        <p className="support">Mistbox · Seattle, Washington</p>
      </footer>
    </>
  );
}
