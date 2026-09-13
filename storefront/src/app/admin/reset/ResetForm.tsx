'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export function ResetForm({ email, token }: { email: string; token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('Those two do not match.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/admin/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, token, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'That did not work.');
        return;
      }
      router.push('/admin');
      router.refresh();
    } catch {
      setError('No connection. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!email || !token) {
    return (
      <div className="authcard">
        <p className="authcard__error" role="alert">
          This link is missing its email or token — it may have been copied
          incorrectly. Request a new one.
        </p>
        <p className="authcard__links">
          <Link href="/admin/forgot">Send a new reset link</Link>
        </p>
      </div>
    );
  }

  return (
    <form className="authcard" onSubmit={submit}>
      <p className="authcard__intro">
        Choose a new password for <strong>{email}</strong>.
      </p>

      <div className="field">
        <label htmlFor="reset-password">New password</label>
        <input
          id="reset-password"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="reset-confirm">Type it again</label>
        <input
          id="reset-confirm"
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>

      <button className="button" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Set password and sign in'}
      </button>

      {error && (
        <p className="authcard__error" role="alert">
          {error}
        </p>
      )}

      <p className="authcard__links">
        <Link href="/admin/forgot">Request a new link</Link>
      </p>
    </form>
  );
}
