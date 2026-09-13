'use client';

import { useState } from 'react';

/**
 * "Leave your email" — a standalone signup, not tied to a purchase. Success
 * replaces the field in place rather than navigating anywhere: someone who
 * just typed their email is done the moment they see that, not before.
 */
export function NewsletterForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState('busy');
    setError(null);
    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? 'That did not work.');
        setState('error');
        return;
      }
      setState('done');
    } catch {
      setError('No connection. Try again.');
      setState('error');
    }
  }

  if (state === 'done') {
    return <p className="newsletter__done">You&rsquo;re on the list.</p>;
  }

  return (
    <form className="newsletter" onSubmit={submit}>
      <label className="visually-hidden" htmlFor="newsletter-email">
        Email
      </label>
      <input
        id="newsletter-email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button className="button" type="submit" disabled={state === 'busy'}>
        {state === 'busy' ? 'Signing up…' : 'Keep me posted'}
      </button>
      {error && (
        <p className="newsletter__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
