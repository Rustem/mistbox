import Link from 'next/link';

export const dynamic = 'force-dynamic';

/**
 * The app's own page — Extensions → Installed → Mistbox rules.
 *
 * Under `/embed` because the dashboard frames `appUrl` too, and everything
 * outside `/embed` is `frame-ancestors 'none'`. Pointing it at `/admin/boxes`
 * renders a blank pane with a broken-document icon.
 */
export default function AboutPage() {
  return (
    <main className="embed embed--page">
      <h1>Mistbox rules</h1>
      <p>
        Saleor refuses to save a gift box that Mistbox could not actually ship — more
        pieces than the box holds, or more of one item than its per-box limit allows.
        It checks with the same code the checkout runs, so a box that saves here is one
        a customer can really buy.
      </p>
      <p>
        The dashboard can only show an error <em>code</em>, which is why a refused save
        says &ldquo;Invalid value&rdquo;. The reason is on the box&rsquo;s own product
        page, in the <strong>Mistbox</strong> panel in the right-hand column.
      </p>
      <p>
        <Link href="/admin/boxes" target="_blank" rel="noreferrer">
          Every box and what it is worth
        </Link>{' '}
        — opens Mistbox admin in a new tab.
      </p>
    </main>
  );
}
