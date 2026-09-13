/**
 * Copy that Daniya can change from the Saleor dashboard without a deploy.
 *
 * Stored as ordinary pages under Content → Models, the same place the About
 * page lives, so there is one editing experience to learn and no page-type
 * attributes to configure. A page's **title** is the heading — a stage label,
 * or an email subject — and its rich text is everything else.
 *
 * Two rules make this safe to depend on:
 *
 *   1. **Defaults in code are complete.** Content only ever overrides. Nothing
 *      is blank because a page has not been created yet, which is also why this
 *      can ship before the pages exist.
 *
 *   2. **A content failure is never a send failure.** These reads happen on the
 *      path that emails a customer who has already paid. If Saleor is slow,
 *      down, or missing the page, we give up quickly and use the built-in copy.
 *      An unreachable CMS must never become an unsent confirmation.
 */

import { CONTENT_PAGES_QUERY } from '@/lib/queries';
import { saleorFetch } from '@/lib/saleor';
import { parseBlocks, sanitizeInline } from '@/lib/richtext';
import { STAGES, STAGE_DEFAULTS, type Stage, type StageCopy } from '@/lib/orderStatus';

/** Slow Saleor is treated as absent Saleor. A customer waiting on an email
 *  cares far more about receiving it than about the wording being current. */
const TIMEOUT_MS = 1500;

/**
 * Uncached by default: a refresh should show a dashboard edit immediately,
 * with nothing to explain about a delay. Content edits are rare enough that
 * the extra Saleor read costs nothing worth optimising for; callers that do
 * want caching (none currently do) can still pass a revalidate window through
 * `getStageCopy`/`getEmailCopy`.
 */
const REVALIDATE_SECONDS = false;

const stageSlug = (stage: Stage) => `stage-${stage.replace(/_/g, '-')}`;

export type EmailSlug =
  | 'email-order-confirmed'
  | 'email-order-shipped'
  | 'email-order-delivered';

export type EmailCopy = {
  /** The subject line, and the headline shown at the top of the email. */
  subject: string;
  headline: string;
  /** Body paragraphs, already sanitised to the inline tags email clients like. */
  body: string[];
  /**
   * The line the Mist Bird signs off with. The body is written in the brand's
   * voice; this one line is the bird's, which is what makes it a correspondent
   * rather than a picture. Ends with a comma — the name follows it.
   */
  signoff: string;
};

export const EMAIL_DEFAULTS: Record<EmailSlug, EmailCopy> = {
  'email-order-confirmed': {
    subject: 'Your Mistbox is confirmed',
    headline: 'Your box is confirmed.',
    body: ['Thank you — this is the receipt. We will write to you once more on the day it ships.'],
    signoff: 'Packed with care,',
  },
  'email-order-shipped': {
    subject: 'Your Mistbox is on its way',
    headline: 'It is on its way.',
    body: [
      'Packed, sealed and handed to the carrier this morning. You can follow it below, and we will write once more when it arrives.',
    ],
    signoff: 'On my way,',
  },
  'email-order-delivered': {
    subject: 'Your Mistbox has arrived',
    headline: 'It arrived.',
    body: [
      'Your box was delivered today. We hope it was opened slowly.',
      'If you hear how it landed, we would love to know — just reply to this email.',
    ],
    signoff: 'Left at your door,',
  },
};

type PageNode = { slug: string; title: string; content: string | null };
type PagesData = { pages: { edges: Array<{ node: PageNode }> } };

/**
 * Fetch the named pages, or give up. Never throws: every caller here has a
 * complete default to fall back on, and none of them can afford to fail.
 */
async function fetchPages(
  slugs: string[],
  revalidate: number | false = REVALIDATE_SECONDS,
): Promise<Map<string, PageNode>> {
  const found = new Map<string, PageNode>();
  try {
    const data = await Promise.race([
      saleorFetch<PagesData>(CONTENT_PAGES_QUERY, { slugs }, revalidate),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('content fetch timed out')), TIMEOUT_MS),
      ),
    ]);
    for (const { node } of data.pages.edges) found.set(node.slug, node);
  } catch (error) {
    // Deliberately quiet at warn level: this is an expected degradation, not a
    // fault, and it must not read as an error in the logs during local work.
    console.warn(
      '[mistbox] using built-in copy —',
      error instanceof Error ? error.message : error,
    );
  }
  return found;
}

/** Paragraph and header text out of an EditorJS document, in order. */
function paragraphs(content: string | null): string[] {
  return parseBlocks(content)
    .filter((b) => b.type === 'paragraph' || b.type === 'header')
    .map((b) => sanitizeInline(String((b.data as { text?: string })?.text ?? '')).trim())
    .filter(Boolean);
}

/**
 * Stage labels and notes. A page titled "Being packed" at slug `stage-packing`
 * replaces that stage's label; its first paragraph replaces the note.
 */
export async function getStageCopy(
  revalidate?: number | false,
): Promise<Record<Stage, StageCopy>> {
  const pages = await fetchPages(STAGES.map(stageSlug), revalidate);
  const copy = {} as Record<Stage, StageCopy>;
  for (const stage of STAGES) {
    const page = pages.get(stageSlug(stage));
    const note = page ? paragraphs(page.content)[0] : '';
    copy[stage] = {
      ...STAGE_DEFAULTS[stage],
      ...(page?.title ? { label: page.title } : {}),
      ...(note ? { note } : {}),
    };
  }
  return copy;
}

/**
 * Copy for one email. The page title becomes the subject; the first paragraph
 * becomes the headline and the rest become the body. Any part left out of the
 * page keeps its built-in wording, so a half-finished page still sends.
 */
export async function getEmailCopy(
  slug: EmailSlug,
  revalidate?: number | false,
): Promise<EmailCopy> {
  const page = (await fetchPages([slug], revalidate)).get(slug);
  if (!page) return EMAIL_DEFAULTS[slug];

  const [headline, ...body] = paragraphs(page.content);
  return {
    subject: page.title || EMAIL_DEFAULTS[slug].subject,
    headline: headline || EMAIL_DEFAULTS[slug].headline,
    body: body.length ? body : EMAIL_DEFAULTS[slug].body,
    // The sign-off stays in code on purpose. Deriving it from the page would
    // mean claiming a paragraph position by convention, and a writer who did
    // not know the rule would silently lose their last line into the
    // signature. It is one short line per email; it can move to the dashboard
    // when there is a field for it rather than a guess.
    signoff: EMAIL_DEFAULTS[slug].signoff,
  };
}
