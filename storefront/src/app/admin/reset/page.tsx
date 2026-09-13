import type { Metadata } from 'next';
import { Emblem } from '@/components/Emblem';
import { ResetForm } from './ResetForm';

export const metadata: Metadata = {
  title: 'Set a new password · Mistbox',
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; token?: string }>;
}) {
  const { email = '', token = '' } = await searchParams;

  return (
    <section className="shell">
      <div className="lockup centred">
        <Emblem size={64} />
        <h1 className="wordmark" style={{ fontSize: 'clamp(1.5rem, 4vw, 2rem)' }}>
          New password
        </h1>
      </div>
      <ResetForm email={decodeURIComponent(email)} token={token} />
    </section>
  );
}
