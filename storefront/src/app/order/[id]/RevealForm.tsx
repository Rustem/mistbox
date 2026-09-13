'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Asks for the buyer's email before showing the address, gift message and
 * prices. Everything above it on the page — status and tracking — is already
 * visible, so this never stands between someone and the thing they came for.
 */
export function RevealForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/order/reveal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId, email }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'That did not work. Try again.');
        return;
      }
      router.refresh();
    } catch {
      setError('We could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="reveal" onSubmit={submit}>
      <p className="reveal__why">
        The delivery address, your gift message and the prices are kept behind
        your email, so a forwarded link cannot spoil the surprise.
      </p>
      <div className="reveal__row">
        <label className="visually-hidden" htmlFor="reveal-email">
          The email you ordered with
        </label>
        <input
          id="reveal-email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-describedby={error ? 'reveal-error' : undefined}
        />
        <button className="button" type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Show details'}
        </button>
      </div>
      {error && (
        <p className="reveal__error" id="reveal-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
