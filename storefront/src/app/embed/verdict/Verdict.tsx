'use client';

import { useEffect, useRef, useState } from 'react';
import { useWidgetResize } from '../useWidgetResize';

/**
 * The one sentence the Saleor dashboard cannot say.
 *
 * Saleor refuses a bad box — the plugin in `saleor-plugin/` sees to that — but
 * it cannot reliably *explain* the refusal. The reason travels in the
 * mutation's `message`, and the dashboard shows that only in a toast which a
 * second, generic toast dismisses; in Chrome it is gone before it can be read.
 * Every other surface renders the error *code* through the dashboard's own
 * translation table, so it can only ever say "Invalid value". This is our own
 * HTML, so it says the same thing in every browser and stays put.
 *
 * **It describes the box as saved, and says so.** The panel is a WIDGET
 * extension, and the dashboard sends form events only to POPUP ones — so
 * nothing here can see unsaved chips. Left unqualified this read "Ready to
 * send" at the exact moment a save was being refused, which is worse than
 * saying nothing. The qualifier is not decoration; it is the difference
 * between a true statement and a false one.
 *
 * It re-checks on a timer because a successful save changes the answer and,
 * for the same reason, nothing tells us it happened.
 */

type State = { blocked: string | null; price: string; pieces: number; slots: number };

/** Often enough to feel live, rare enough to be invisible on a dev box. */
const RECHECK_MS = 4000;

export function Verdict({ productId, initial }: { productId: string; initial: State }) {
  const root = useRef<HTMLDivElement>(null);
  useWidgetResize(root);

  const [state, setState] = useState(initial);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const res = await fetch(
          `/embed/verdict/state?productId=${encodeURIComponent(productId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok || !live) return;
        setState((await res.json()) as State);
      } catch {
        // A failed poll is not worth saying anything about: the panel simply
        // keeps showing the last answer it trusted.
      }
    };
    const id = setInterval(tick, RECHECK_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [productId]);

  const refresh = async () => {
    setChecking(true);
    try {
      const res = await fetch(`/embed/verdict/state?productId=${encodeURIComponent(productId)}`, {
        cache: 'no-store',
      });
      if (res.ok) setState((await res.json()) as State);
    } catch {
      /* leave the last answer standing */
    }
    setChecking(false);
  };

  return (
    <div ref={root} className={`verdict${state.blocked ? ' verdict--blocked' : ''}`}>
      <p className="verdict__state">
        {state.blocked ? 'Cannot be ordered' : 'Ready to send'}
        <span className="verdict__scope"> as saved</span>
      </p>
      <p className="verdict__why">
        {state.blocked ?? `${state.pieces} of ${state.slots} pieces · ${state.price} including the carton`}
      </p>
      <button type="button" className="verdict__recheck" onClick={refresh} disabled={checking}>
        {checking ? 'Checking…' : 'Re-check'}
      </button>
    </div>
  );
}
