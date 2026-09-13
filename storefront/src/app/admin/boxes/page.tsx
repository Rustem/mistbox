import Link from 'next/link';
import { cookies } from 'next/headers';
import { Emblem } from '@/components/Emblem';
import { ADMIN_COOKIE, readSession } from '@/lib/adminAuth';
import { loadBoxCatalogue } from '@/lib/catalogue';
import { summariseBoxes, type BoxSummary } from '@/lib/boxSheet';
import { dashboardLink, formatMoney } from '@/lib/saleor';
import { SignOut } from '../SignOut';

export const dynamic = 'force-dynamic';

/**
 * What each box is worth, and what it is made of.
 *
 * Daniya composes boxes in the Saleor dashboard, through the `Contents`
 * reference attribute on the box's product page. That is the right place to do
 * it and this page does not try to replace it — there is a link straight to it
 * on every box.
 *
 * What the dashboard cannot do is add up. Its reference picker lists product
 * names and nothing else: no price per piece, no total for the box being
 * assembled. So a box could be composed there in perfectly good faith and only
 * reveal what it is worth once somebody bought one. This page is that
 * arithmetic, and only that.
 */

export default async function AdminBoxesPage() {
  const jar = await cookies();
  const session = readSession(jar.get(ADMIN_COOKIE)?.value);
  if (!session) {
    return (
      <section className="shell">
        <p className="error" style={{ maxWidth: '32rem', marginInline: 'auto' }}>
          <Link href="/admin">Sign in</Link> to see the boxes.
        </p>
      </section>
    );
  }

  let boxes: BoxSummary[] = [];
  let failed = false;

  try {
    boxes = summariseBoxes(await loadBoxCatalogue());
  } catch {
    failed = true;
  }

  return (
    <section className="shell admin">
      <header className="admin-bar">
        <div className="admin-bar__brand">
          <Emblem size={28} />
          <h1 className="admin-bar__title">Boxes</h1>
          <Link className="admin-bar__nav" href="/admin">
            Orders
          </Link>
        </div>
        <p className="admin-bar__counts">
          What each box is worth
        </p>
        <SignOut email={session.email} />
      </header>

      {failed ? (
        <p className="error">The catalogue is not reachable right now.</p>
      ) : boxes.length === 0 ? (
        <p className="centred">No boxes published yet.</p>
      ) : (
        <div className="boxsheet">
          {boxes.map((row) => {
            const url = dashboardLink('products', row.productId);

            return (
              <article className="boxsheet__box" key={row.slug}>
                <div className="boxsheet__head">
                  <h2>{row.name}</h2>
                  <p className="quiet">
                    {row.filled} of {row.slots} slots composed
                    {' · '}
                    <a href={url} target="_blank" rel="noreferrer">
                      Edit contents in Saleor
                    </a>
                  </p>
                </div>

                <ul className="receipt">
                  {row.pieces.map((piece) => (
                    <li key={piece.sku}>
                      <span>
                        {piece.quantity > 1 && <span className="quiet">{piece.quantity} × </span>}
                        {piece.name}
                        <span className="quiet boxsheet__sku"> {piece.sku}</span>
                      </span>
                      <span className="tabular">
                        {formatMoney(piece.price * piece.quantity, row.currency)}
                      </span>
                    </li>
                  ))}

                  {row.filled < row.slots && (
                    <li className="boxsheet__gap">
                      <span>
                        {row.slots - row.filled} slot{row.slots - row.filled === 1 ? '' : 's'} still
                        empty — this box cannot be sent as our selection until they are filled.
                      </span>
                      <span />
                    </li>
                  )}

                  {row.missing.length > 0 && (
                    <li className="boxsheet__gap">
                      <span>No longer in the catalogue: {row.missing.join(', ')}</span>
                      <span />
                    </li>
                  )}

                  {row.blocked && (
                    <li className="boxsheet__gap boxsheet__blocked">
                      <span>
                        <strong>This box cannot be ordered.</strong> {row.blocked} Fix it in
                        Saleor and this clears.
                      </span>
                      <span />
                    </li>
                  )}

                  <li className="receipt__rule">
                    <span>
                      The carton
                      <span className="quiet"> — box, tissue, band and card</span>
                    </span>
                    <span className="tabular">{formatMoney(row.carton, row.currency)}</span>
                  </li>

                  <li className="receipt__total">
                    <span className="support">Box price</span>
                    <span className="tabular price">{formatMoney(row.total, row.currency)}</span>
                  </li>
                </ul>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
