import Link from 'next/link';
import { Emblem } from '@/components/Emblem';

export const dynamic = 'force-dynamic';

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id: sessionId } = await searchParams;

  return (
    <section className="shell centred">
      <div className="lockup">
        <Emblem size={88} />
        <h1 className="wordmark" style={{ fontSize: 'clamp(1.75rem, 5vw, 2.5rem)' }}>
          Thank you
        </h1>
        <p className="tagline">
          Thoughtfully gathered
          <br />
          Beautifully given
        </p>
      </div>

      <p style={{ marginTop: '3rem' }}>
        Your box is confirmed. A receipt is on its way to your inbox, and we will write
        to you again the day it ships.
      </p>
      <p>
        Every box is packed by hand in Seattle, and your card is written in ink before
        it goes in — so give us a couple of days.
      </p>

      {sessionId && (
        <p className="support" style={{ color: 'var(--sage)' }}>
          Reference {sessionId.slice(-12)}
        </p>
      )}

      <p style={{ marginTop: '2.5rem' }}>
        <Link className="button button--ghost" href="/">
          Back to Mistbox
        </Link>
      </p>
    </section>
  );
}
