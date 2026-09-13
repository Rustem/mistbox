'use client';

import { useRouter } from 'next/navigation';

export function SignOut({ email }: { email: string }) {
  const router = useRouter();

  async function signOut() {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.refresh();
  }

  return (
    <p className="admin-who">
      Signed in as {email}
      {' · '}
      <button type="button" className="admin-who__signout" onClick={signOut}>
        Sign out
      </button>
    </p>
  );
}
