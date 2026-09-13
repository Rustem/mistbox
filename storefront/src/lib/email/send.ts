import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getEmailCopy, type EmailCopy, type EmailSlug } from '@/lib/content';
import { siteUrl } from '@/lib/saleor';

/**
 * Sending goes through Resend's REST API directly rather than its SDK: one
 * POST, no dependency, and nothing to keep upgraded.
 */

const ENDPOINT = 'https://api.resend.com/emails';

export type SendResult = { id: string };

/**
 * The emblem, as something an email client will actually render.
 *
 * Once the storefront is deployed somewhere public the image is fetched from
 * it, which every client handles. Until then there is nowhere to fetch from, so
 * it travels inside the message as a data URI — which Apple Mail, iCloud and
 * Outlook.com render and **Gmail deliberately blocks**. The layout is built to
 * survive its absence; the wordmark carries the masthead alone.
 *
 * The switch happens on its own as soon as NEXT_PUBLIC_SITE_URL stops being a
 * local address, so deploying fixes Gmail with no code change.
 */
const cachedAssets = new Map<string, string>();

async function assetSrc(siteUrl: string, name: string): Promise<string> {
  const isLocal = /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(siteUrl);
  if (!isLocal) return `${siteUrl.replace(/\/$/, '')}/${name}`;

  const cached = cachedAssets.get(name);
  if (cached !== undefined) return cached;
  try {
    const file = await readFile(path.join(process.cwd(), 'public', name));
    const uri = `data:image/png;base64,${file.toString('base64')}`;
    cachedAssets.set(name, uri);
    return uri;
  } catch {
    // No image is better than a broken one: every layout reads without it.
    cachedAssets.set(name, '');
    return '';
  }
}

export const emblemSrc = (siteUrl: string) => assetSrc(siteUrl, 'emblem.png');

/**
 * The bird for one email, in the pose that suits it. Same local/deployed rule
 * as the emblem, so nothing extra breaks when the site goes public.
 */
export type BirdPose = 'climb' | 'carry' | 'perch' | 'tag' | 'hover';

export const birdSrc = (siteUrl: string, pose: BirdPose) =>
  assetSrc(siteUrl, `bird-${pose}.png`);

/** The small foil mark that stands beside the sign-off. */
export const birdSignSrc = (siteUrl: string) => assetSrc(siteUrl, 'bird-sign.png');

/**
 * Which bird each email gets. The pose is part of what the email *says* —
 * climbing for a beginning, carrying for a parcel in transit, perched for one
 * that has landed — so it is decided here beside the copy, not at the call
 * site where it would drift.
 */
const POSE_FOR: Record<EmailSlug, BirdPose> = {
  'email-order-confirmed': 'climb',
  'email-order-shipped': 'carry',
  'email-order-delivered': 'perch',
};

export type EmailOpts = {
  siteUrl: string;
  emblemSrc: string;
  birdSrc: string;
  birdSignSrc: string;
  copy: EmailCopy;
};

/**
 * The three pieces every transactional email's layout is built from: the
 * dashboard-editable copy (falling back to a built-in default), the site's
 * own URL, and the emblem image. Fetched together — neither depends on the
 * other's result — rather than sequentially at each of the four call sites
 * that used to assemble this by hand.
 */
export async function buildEmailOpts(slug: EmailSlug, revalidate?: number | false): Promise<EmailOpts> {
  const url = siteUrl();
  const [copy, emblem, hero, sign] = await Promise.all([
    getEmailCopy(slug, revalidate),
    emblemSrc(url),
    birdSrc(url, POSE_FOR[slug]),
    birdSignSrc(url),
  ]);
  return { siteUrl: url, emblemSrc: emblem, birdSrc: hero, birdSignSrc: sign, copy };
}

export async function sendEmail(message: {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** e.g. a label PDF. `content` is base64 — Resend decodes it, never us. */
  attachments?: Array<{ filename: string; content: string; contentType?: string }>;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key) throw new Error('RESEND_API_KEY is not set.');
  if (!from) throw new Error('RESEND_FROM is not set.');

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      // Sent from the automated address, answered by a person.
      reply_to: message.replyTo ?? process.env.RESEND_REPLY_TO ?? undefined,
      attachments: message.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        content_type: a.contentType,
      })),
    }),
  });

  if (!response.ok) {
    // Resend puts the useful part in the body; the status alone says little.
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend returned ${response.status}: ${detail.slice(0, 300)}`);
  }

  return (await response.json()) as SendResult;
}
