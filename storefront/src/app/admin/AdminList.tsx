'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { nextManualStage, stageIndex, type Stage, type StageCopy } from '@/lib/orderStatus';
import { dashboardLink } from '@/lib/saleor';

/** One row of the packing checklist: the carton, or a thing that goes in it. */
export type PackLine = {
  name: string;
  flavour: string;
  sku: string;
  quantity: number;
  isBox: boolean;
};

export type AdminOrder = {
  id: string;
  number: string;
  created: string;
  recipient: string;
  where: string;
  email: string;
  total: string;
  lines: PackLine[];
  stage: Stage;
  next: Stage | null;
  tracking: string;
  labelBought: boolean;
  labelCost: string;
  problem: boolean;
};

type Rate = { id: string; provider: string; service: string; amount: string; currency: string };

/**
 * The label control for one order — three states in sequence, matching the
 * two-tap rule this feature was built around: a real price has to be seen
 * before it can be spent. "Get shipping label" costs nothing and can be
 * backed out of; "Buy for $X.XX" is the one action in this entire screen that
 * spends real money, and it always shows the number it is about to spend
 * before it can be pressed.
 */
function LabelControl({ order, onBought }: { order: AdminOrder; onBought: () => void }) {
  const [rate, setRate] = useState<Rate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bought, setBought] = useState<{ tracking: string } | null>(null);

  if (order.tracking || order.labelBought || bought) {
    const tracking = bought?.tracking || order.tracking;
    return (
      <div className="pack__waiting pack__waiting--label">
        <span>
          {tracking ? `Tracking ${tracking}` : 'Label bought'}
          {order.labelCost && <span className="quiet"> — {order.labelCost}</span>}
        </span>
        {(order.labelBought || bought) && (
          <a href={`/api/admin/label/view?order=${order.id}`} target="_blank" rel="noreferrer">
            View label
          </a>
        )}
      </div>
    );
  }

  async function getRate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/label/rate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId: order.id }),
      });
      const data = (await res.json()) as { rate?: Rate; error?: string };
      if (!res.ok || !data.rate) {
        setError(data.error ?? 'Could not get a rate.');
        return;
      }
      setRate(data.rate);
    } catch {
      setError('No connection. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function buy() {
    if (!rate) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/label/buy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          rateId: rate.id,
          provider: rate.provider,
          service: rate.service,
          amount: rate.amount,
          currency: rate.currency,
        }),
      });
      const data = (await res.json()) as { trackingNumber?: string; labelUrl?: string; error?: string };
      if (!res.ok || !data.trackingNumber || !data.labelUrl) {
        setError(data.error ?? 'The label could not be bought.');
        return;
      }
      setBought({ tracking: data.trackingNumber });
      onBought();
    } catch {
      setError('No connection — check whether the label was actually bought before trying again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {rate ? (
        <button className="button pack__go" type="button" disabled={busy} onClick={buy}>
          {busy ? 'Buying…' : `Buy for $${rate.amount} — ${rate.provider} ${rate.service}`}
        </button>
      ) : (
        <button className="button pack__go" type="button" disabled={busy} onClick={getRate}>
          {busy ? 'Getting rate…' : 'Get shipping label'}
        </button>
      )}
      {error && <p className="reveal__error">{error}</p>}
    </div>
  );
}

/**
 * The order list Daniya works from.
 *
 * One column, newest order first, sized so several cards are on screen at
 * once and the list scrolls exactly the way every other scrollable thing on
 * her phone scrolls — no forced full-screen card, no snap fighting her
 * thumb. "One at a time" lives in the card itself: one obvious action, one
 * glance to see what it is, nothing competing for attention next to it.
 * Detail that is only occasionally needed — the email address, the full
 * address — is present but quiet.
 */
export function AdminList({
  orders,
  copy,
}: {
  orders: AdminOrder[];
  copy: Record<Stage, StageCopy>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, Stage>>({});

  // Drop optimistic stages once the server has caught up, or a card stops
  // offering the stage after the one just tapped.
  useEffect(() => {
    setDone((d) => {
      let changed = false;
      const next = { ...d };
      for (const o of orders) {
        if (next[o.id] && stageIndex(o.stage) >= stageIndex(next[o.id])) {
          delete next[o.id];
          changed = true;
        }
      }
      return changed ? next : d;
    });
  }, [orders]);

  async function advance(order: AdminOrder, stage: Stage) {
    setBusyId(order.id);
    setError(null);
    setDone((d) => ({ ...d, [order.id]: stage }));
    try {
      const res = await fetch('/api/pack/advance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, stage }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? 'That did not save.');
        setDone((d) => {
          const n = { ...d };
          delete n[order.id];
          return n;
        });
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError('No connection. The change was not saved.');
      setDone((d) => {
        const n = { ...d };
        delete n[order.id];
        return n;
      });
    } finally {
      setBusyId(null);
    }
  }

  if (orders.length === 0) {
    return <p className="pack__empty">No orders match.</p>;
  }

  return (
    <>
      {error && (
        <p className="reveal__error" role="alert">
          {error}
        </p>
      )}

      <ul className="pack">
        {orders.map((order) => {
          const stage = done[order.id] ?? order.stage;
          const next = done[order.id] ? nextManualStage(stage) : order.next;
          return (
            <li key={order.id} className={`pack__card${order.problem ? ' pack__card--problem' : ''}`}>
              <div className="pack__head">
                <span className="support pack__num">Order {order.number}</span>
                <span className="pack__stage">{copy[stage].label}</span>
              </div>

              <ul className="pack__checklist">
                {order.lines.map((line, i) => (
                  <li
                    key={`${line.sku}-${i}`}
                    className={line.isBox ? 'pack__checklist-box' : undefined}
                  >
                    <span>
                      {line.quantity > 1 && <span className="pack__qty">{line.quantity} × </span>}
                      {line.name}
                      {line.flavour && <span className="pack__flavour"> — {line.flavour}</span>}
                    </span>
                    {line.sku && <span className="quiet tabular">{line.sku}</span>}
                  </li>
                ))}
              </ul>
              <p className="pack__to">
                {order.recipient}
                {order.where && <span className="quiet"> — {order.where}</span>}
              </p>
              <p className="pack__meta">
                <span>{order.total}</span>
                <span className="quiet">{order.email}</span>
              </p>

              {order.problem && (
                <p className="pack__problem">Carrier reported a problem — needs a person.</p>
              )}

              {next ? (
                <button
                  className="button pack__go"
                  type="button"
                  disabled={busyId === order.id || pending}
                  onClick={() => advance(order, next)}
                >
                  {busyId === order.id ? 'Saving…' : copy[next].action}
                </button>
              ) : (
                <LabelControl order={order} onBought={() => startTransition(() => router.refresh())} />
              )}

              <p className="pack__links">
                <a href={`/order/${order.id}`} target="_blank" rel="noreferrer">
                  Customer view
                </a>
                <a
                  href={dashboardLink('orders', order.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Saleor
                </a>
              </p>
            </li>
          );
        })}
      </ul>
    </>
  );
}
