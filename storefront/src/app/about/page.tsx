import type { Metadata } from 'next';
import Link from 'next/link';
import { Emblem } from '@/components/Emblem';
import { RichText } from '@/components/RichText';
import { saleorFetch } from '@/lib/saleor';
import { PAGE_QUERY } from '@/lib/queries';

export const revalidate = 60;

const SLUG = 'about';

type PageData = {
  page: {
    id: string;
    title: string;
    slug: string;
    content: string | null;
    seoTitle: string | null;
    seoDescription: string | null;
  } | null;
};

/**
 * Placeholder artwork. These are line drawings in the brand palette standing in
 * for real photographs — drop a JPG into `public/about/` with the same name to
 * replace one, no code change needed.
 */
const GALLERY = [
  { src: '/about/artwork-1.svg', alt: 'Placeholder artwork — layered hills under a low sun' },
  { src: '/about/artwork-2.svg', alt: 'Placeholder artwork — a stand of firs' },
  { src: '/about/artwork-3.svg', alt: 'Placeholder artwork — shoreline and still water' },
];

async function getPage() {
  try {
    const data = await saleorFetch<PageData>(PAGE_QUERY, { slug: SLUG });
    return { page: data.page, apiDown: false };
  } catch {
    return { page: null, apiDown: true };
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const { page } = await getPage();
  return {
    title: page?.seoTitle || `${page?.title ?? 'About'} — Mistbox`,
    description:
      page?.seoDescription ||
      'Why Mistbox exists, and the Pacific Northwest makers behind it.',
  };
}

export default async function AboutPage() {
  const { page, apiDown } = await getPage();

  return (
    <>
      {/* ------------------------------------------------------ header */}
      <section className="shell centred" style={{ paddingBottom: '2rem' }}>
        <Link href="/" className="lockup" style={{ textDecoration: 'none' }}>
          <Emblem size={64} />
          <span className="wordmark" style={{ fontSize: '1.5rem' }}>
            Mistbox
          </span>
        </Link>
      </section>

      {/* -------------------------------------------------------- story */}
      <section className="shell" style={{ paddingTop: 0 }}>
        <div className="prose">
          <h2>{page?.title ?? 'About'}</h2>

          {apiDown ? (
            <p className="error">
              This page is not reachable right now. Check that Saleor is running at{' '}
              <code>{process.env.NEXT_PUBLIC_SALEOR_API_URL}</code>.
            </p>
          ) : !page ? (
            <p>
              Nothing written yet. Create a page with the slug <code>{SLUG}</code> in
              the Saleor dashboard under Content &rarr; Models, or run{' '}
              <code>python content.py</code> in <code>seed/</code>.
            </p>
          ) : (
            <RichText content={page.content} />
          )}
        </div>
      </section>

      {/* ------------------------------------------------------ gallery */}
      {!apiDown && page && (
        <section className="shell">
          <div className="gallery">
            {GALLERY.map((art) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={art.src} src={art.src} alt={art.alt} loading="lazy" />
            ))}
          </div>
          <p className="support gallery-note">Placeholder images</p>
        </section>
      )}

      {/* ------------------------------------------------------- origin */}
      <section className="band">
        <div className="shell centred">
          <div className="band__mark">
            <Emblem variant="fir" size={54} />
          </div>
          <p className="support" style={{ marginTop: '1.5rem' }}>
            Made in the Pacific Northwest
            <br />
            with care and intention
          </p>
          <Link className="button" href="/#boxes" style={{ marginTop: '2rem' }}>
            See the boxes
          </Link>
        </div>
      </section>

      <footer>
        <p className="support">Mistbox · Seattle, Washington</p>
      </footer>
    </>
  );
}
