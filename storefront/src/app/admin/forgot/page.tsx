import type { Metadata } from 'next';
import { Emblem } from '@/components/Emblem';
import { ForgotForm } from './ForgotForm';

export const metadata: Metadata = {
  title: 'Reset password · Mistbox',
  robots: { index: false, follow: false },
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email = '' } = await searchParams;

  return (
    <section className="shell">
      <div className="lockup centred">
        <Emblem size={64} />
        <h1 className="wordmark" style={{ fontSize: 'clamp(1.5rem, 4vw, 2rem)' }}>
          Reset password
        </h1>
      </div>
      <ForgotForm initialEmail={email} />
    </section>
  );
}
