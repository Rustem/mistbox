import Link from 'next/link';
import { cookies } from 'next/headers';
import { ADMIN_COOKIE, readSession } from '@/lib/adminAuth';
import { loadBoxCatalogue } from '@/lib/catalogue';
import { summariseBox } from '@/lib/boxSheet';
import { formatMoney } from '@/lib/saleor';
import { Verdict } from './Verdict';

export const dynamic = 'force-dynamic';

/**
 * Whether this box can actually be sold, on the box's own product page.
 *
 * It trusts nothing from its embedder. The dashboard hands the iframe an
 * `appToken`, which is ignored — a value handed to us by the frame proves
 * nothing about who is driving it. Authentication is Mistbox's own admin
 * cookie, which only a verified Saleor staff login can mint and which is
 * `httpOnly`, so the surrounding page cannot read it. The one thing taken from
 * the URL is a product id, and that is resolved against the catalogue rather
 * than believed.
 */
export default async function VerdictPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string }>;
}) {
  const { productId } = await searchParams;
  const jar = await cookies();

  if (!readSession(jar.get(ADMIN_COOKIE)?.value)) {
    return (
      <main className="embed">
        <p className="embed__note">
          {/* A new tab, never a login form inside someone else's frame — that
              is the shape a phishing panel takes. */}
          <Link href="/admin" target="_blank" rel="noreferrer">
            Sign in to Mistbox
          </Link>{' '}
          to see whether this box can be sold.
        </p>
      </main>
    );
  }

  if (!productId) return <main className="embed" />;

  let catalogue;
  try {
    catalogue = await loadBoxCatalogue();
  } catch {
    return (
      <main className="embed">
        <p className="embed__note">Mistbox is not reachable right now.</p>
      </main>
    );
  }

  // The mount fires on every product page, items included, so most of the time
  // there is simply nothing to say.
  const tier = [...catalogue.tiers.values()].find((t) => t.productId === productId);
  if (!tier) return <main className="embed" />;

  const box = summariseBox(tier, catalogue);

  return (
    <main className="embed">
      <Verdict
        productId={productId}
        initial={{
          blocked: box.blocked,
          price: formatMoney(box.total, box.currency),
          pieces: box.filled,
          slots: box.slots,
        }}
      />
      <p className="embed__note embed__foot">
        <Link href="/admin/boxes" target="_blank" rel="noreferrer">
          All boxes and what they are worth
        </Link>
      </p>
    </main>
  );
}
