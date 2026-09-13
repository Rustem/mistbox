import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { Emblem } from '@/components/Emblem';
import { getStageCopy } from '@/lib/content';
import { ADMIN_ORDERS_QUERY } from '@/lib/queries';
import { formatMoney, fullName, saleorFetchAuthed } from '@/lib/saleor';
import { ADMIN_COOKIE, readSession } from '@/lib/adminAuth';
import { trackingOf } from '@/lib/orders';
import { flavourOf } from '@/lib/box';
import {
  META,
  STAGES,
  currentStage,
  isException,
  nextManualStage,
  readMeta,
  type MetadataItem,
  type Stage,
} from '@/lib/orderStatus';
import { AdminLogin } from './AdminLogin';
import { SignOut } from './SignOut';
import { AdminList, type AdminOrder } from './AdminList';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Orders · Mistbox',
  robots: { index: false, follow: false },
};

type OrdersData = {
  orders: {
    totalCount: number;
    edges: Array<{
      node: {
        id: string;
        number: string;
        created: string;
        status: string;
        userEmail: string;
        total: { gross: { amount: number; currency: string } };
        lines: Array<{
          quantity: number;
          productName: string;
          variantName: string | null;
          productSku: string | null;
          unitPrice: { gross: { amount: number } };
        }>;
        shippingAddress: {
          firstName: string;
          lastName: string;
          city: string;
          countryArea: string;
        } | null;
        fulfillments: Array<{ trackingNumber: string }>;
        metadata: MetadataItem[];
      };
    }>;
  };
};

/** "Open" means still Daniya's problem: paid, not yet handed to a carrier. */
const OPEN_STAGES: readonly Stage[] = ['confirmed', 'packing', 'card_written', 'sealed'];

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; stage?: string }>;
}) {
  const jar = await cookies();
  const session = readSession(jar.get(ADMIN_COOKIE)?.value);
  if (!session) {
    return (
      <section className="shell">
        <div className="lockup centred">
          <Emblem size={64} />
          <h1 className="wordmark" style={{ fontSize: 'clamp(1.5rem, 4vw, 2rem)' }}>
            Orders
          </h1>
        </div>
        <AdminLogin />
      </section>
    );
  }

  const { q = '', stage: stageParam = 'open' } = await searchParams;
  // Searching for one specific order should find it whatever stage it is in.
  const effectiveStage = q.trim() ? 'all' : stageParam;

  // Search runs in Saleor rather than here, so it covers every order rather
  // than only the page we happen to have loaded.
  //
  // Saleor's `search` matches customer name and email but *not* the order
  // number, which is the first thing anyone types. A bare number is therefore
  // routed to the `numbers` filter instead. The two cannot be combined in one
  // filter, and a number is unambiguous enough that guessing is safe.
  const term = q.trim();
  const filter = !term
    ? {}
    : /^#?\d+$/.test(term)
      ? { numbers: [term.replace(/^#/, '')] }
      : { search: term };

  // Independent of each other — the stage copy and the orders themselves —
  // so there is no reason to wait for one before asking for the other.
  const [stageCopy, data] = await Promise.all([
    getStageCopy(),
    saleorFetchAuthed<OrdersData>(ADMIN_ORDERS_QUERY, { first: 100, filter }),
  ]);

  const all: AdminOrder[] = data.orders.edges
    .filter(({ node }) => node.status !== 'CANCELED')
    .map(({ node }) => {
      const stage = currentStage(node.metadata);
      const status = readMeta(node.metadata, META.trackingStatus);
      return {
        id: node.id,
        number: node.number,
        created: node.created,
        recipient: node.shippingAddress ? fullName(node.shippingAddress) : node.userEmail,
        where: node.shippingAddress
          ? `${node.shippingAddress.city}, ${node.shippingAddress.countryArea}`
          : '',
        email: node.userEmail,
        total: formatMoney(node.total.gross.amount, node.total.gross.currency),
        // The carton first — it names the box she reaches for — then what
        // goes in it. Kept as structure rather than one joined string: eight
        // items read as a run-on, and she is holding a box while reading it.
        lines: node.lines.map((l) => ({
          name: l.productName,
          // The flavour is what she has to pick off the shelf, so it belongs
          // on the packing card, not just in the SKU.
          flavour: l.unitPrice.gross.amount > 0 ? '' : flavourOf(l.productName, l.variantName),
          sku: l.productSku ?? '',
          quantity: l.quantity,
          isBox: l.unitPrice.gross.amount > 0,
        })),
        stage,
        next: nextManualStage(stage),
        tracking: trackingOf(node).number,
        labelBought: Boolean(readMeta(node.metadata, META.labelTransactionId)),
        labelCost: readMeta(node.metadata, META.labelCost),
        problem: Boolean(status && isException(status)),
      };
    });

  // Stage filtering happens here rather than in the query: Saleor's metadata
  // filter cannot express "any of these four stages", and at this volume the
  // difference is unmeasurable.
  const shown =
    effectiveStage === 'all'
      ? all
      : effectiveStage === 'open'
        ? all.filter((o) => OPEN_STAGES.includes(o.stage))
        : effectiveStage === 'attention'
          ? all.filter((o) => o.problem)
          : all.filter((o) => o.stage === effectiveStage);

  // Newest first, everywhere — `all` already comes back that way from
  // Saleor (sortBy CREATION_DATE DESC) and filtering by stage above never
  // reorders. What just came in is what she sees first.
  const ordered = shown;

  // One pass over `all` for every count the tabs need, rather than three.
  const counts = new Map<string, number>();
  let openCount = 0;
  let problems = 0;
  for (const o of all) {
    counts.set(o.stage, (counts.get(o.stage) ?? 0) + 1);
    if (OPEN_STAGES.includes(o.stage)) openCount++;
    if (o.problem) problems++;
  }

  const tab = (key: string, label: string, count: number) => {
    const active = stageParam === key;
    const href = `/admin?${new URLSearchParams({ ...(q ? { q } : {}), stage: key })}`;
    return (
      <Link key={key} className={`tab${active ? ' tab--on' : ''}`} href={href}>
        {label}
        <span className="tab__count">{count}</span>
      </Link>
    );
  };

  return (
    <section className="shell shell--wide admin-shell">
      {/* A compact bar, not the storefront's centred lockup — once signed in,
          this is a tool used many times a day, and every line the big
          masthead used to take is a line stolen from the one thing this
          screen exists to show: the card itself. */}
      <header className="admin-bar">
        <div className="admin-bar__brand">
          <Emblem size={28} />
          <h1 className="admin-bar__title">Orders</h1>
          {/* The other half of the admin. Saleor's own dashboard cannot show
              what a box is worth, so the box sheet has to be reachable from
              here or it is not reachable at all. */}
          <Link className="admin-bar__nav" href="/admin/boxes">
            Boxes
          </Link>
        </div>
        <p className="admin-bar__counts">
          {openCount} to pack
          {problems > 0 && ` · ${problems} need${problems === 1 ? 's' : ''} attention`}
        </p>
        <SignOut email={session.email} />
      </header>

      <form className="admin-search" action="/admin" method="get">
        <input type="hidden" name="stage" value={stageParam} />
        <label className="visually-hidden" htmlFor="admin-q">
          Search orders
        </label>
        <input
          id="admin-q"
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Order number, name or email"
        />
        <button className="button" type="submit">
          Search
        </button>
        {q && (
          <span className="quiet-link">
            <Link href={`/admin?stage=${stageParam}`}>Clear</Link>
          </span>
        )}
      </form>

      <nav className="tabs" aria-label="Filter by stage">
        {tab('open', 'To pack', openCount)}
        {/* Only shown when there is something wrong: a permanent empty tab
            trains you to ignore it, which is the opposite of the point. */}
        {problems > 0 && tab('attention', 'Needs attention', problems)}
        {STAGES.filter((s) => !OPEN_STAGES.includes(s)).map((s) =>
          tab(s, stageCopy[s].label, counts.get(s) ?? 0),
        )}
        {tab('all', 'All', all.length)}
      </nav>

      <AdminList orders={ordered} copy={stageCopy} />
    </section>
  );
}
