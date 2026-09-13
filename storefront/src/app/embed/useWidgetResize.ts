'use client';

import { useEffect } from 'react';

/**
 * Tell the Saleor dashboard how tall this widget is.
 *
 * A widget extension's iframe is fixed at 200px and the dashboard will not
 * grow it on its own, so anything taller is silently cut off.
 *
 * The protocol is the App Bridge's `widgetResize`, read off the 3.23 dashboard
 * bundle rather than guessed: it wants `type`, a **string** `actionId` and a
 * finite positive `height`, and clamps the result to 5000px.
 *
 * Posted to the dashboard's exact origin, never `*` — a wildcard would
 * broadcast our layout to whatever page happened to frame us.
 */
export function useWidgetResize(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    // Not framed: the page is open directly, where parent is itself.
    if (!el || typeof window === 'undefined' || window.parent === window) return;

    const origin = (
      process.env.NEXT_PUBLIC_SALEOR_DASHBOARD_URL ?? 'http://localhost:9000'
    ).replace(/\/$/, '');

    let last = 0;
    const report = () => {
      const height = Math.ceil(el.getBoundingClientRect().height) + 8;
      if (!Number.isFinite(height) || height <= 0 || height === last) return;
      last = height;
      window.parent.postMessage(
        { type: 'widgetResize', payload: { actionId: crypto.randomUUID(), height } },
        origin,
      );
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}
