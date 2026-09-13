'use client';

import { useState } from 'react';
import Link from 'next/link';

export function ForgotForm({ initialEmail = '' }: { initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const res = await fetch('/api/admin/forgot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? 'That did not work.');
        return;
      }
      setSent(data.message ?? 'Check your inbox.');
    } catch {
      setError('No connection. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="authcard" onSubmit={submit}>
      <p className="authcard__intro">Enter your mist.box address and a reset link will be sent.</p>

      <div className="field">
        <label htmlFor="forgot-email">Email</label>
        <input
          id="forgot-email"
          type="email"
          required
          autoComplete="username"
          placeholder="you@mist.box"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <button className="button" type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Send reset link'}
      </button>

      {sent && (
        <p className="authcard__note" role="status">
          {sent}
        </p>
      )}
      {error && (
        <p className="authcard__error" role="alert">
          {error}
        </p>
      )}

      <p className="authcard__links">
        <Link href="/admin">Back to sign in</Link>
      </p>
    </form>
  );
}
