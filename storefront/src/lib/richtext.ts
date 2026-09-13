/**
 * Shared handling for Saleor's EditorJS rich text.
 *
 * Saleor stores rich text as HTML fragments inside EditorJS JSON, which means
 * two things the storefront has to respect:
 *
 *   1. Entities are already encoded. "Ballard & Bell" is stored as
 *      "Ballard &amp; Bell". Stripping tags and rendering the result as a
 *      React string prints the entity literally — so text from these fields
 *      must be rendered as HTML, not as a string.
 *   2. It is written by signed-in staff, but staff accounts get compromised,
 *      so it goes through an allow-list rather than being trusted whole.
 */

export type Block = {
  type?: string;
  data?: {
    text?: string;
    level?: number;
    style?: string;
    items?: unknown[];
    caption?: string;
  };
};

/** Tags the copy is allowed to use inline. Everything else is stripped. */
const ALLOWED = /^(b|strong|i|em|u|br|a)$/i;

export function sanitizeInline(html: string): string {
  return html.replace(/<\/?([a-z0-9-]+)([^>]*)>/gi, (tag, name: string, attrs: string) => {
    if (!ALLOWED.test(name)) return '';
    if (name.toLowerCase() !== 'a') return tag.replace(attrs, '');

    // Keep href, but only for schemes that cannot execute script.
    const href = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    const url = (href?.[2] ?? href?.[3] ?? '').trim();
    if (!/^(https?:\/\/|mailto:|\/)/i.test(url)) return tag.startsWith('</') ? '</a>' : '';
    return tag.startsWith('</') ? '</a>' : `<a href="${url}" rel="noopener noreferrer">`;
  });
}

export function parseBlocks(content: string | null): Block[] {
  if (!content) return [];
  try {
    return (JSON.parse(content) as { blocks?: Block[] }).blocks ?? [];
  } catch {
    return [];
  }
}

export function itemText(item: unknown): string {
  if (typeof item === 'string') return item;
  return String((item as { content?: string })?.content ?? '');
}

/**
 * A product description split into its two useful halves: the opening pitch,
 * and the contents list. Both come back as sanitized HTML, ready for
 * dangerouslySetInnerHTML — see the note above about entities.
 */
export type Described = { intro: string; items: string[] };

export function describe(raw: string | null): Described {
  const blocks = parseBlocks(raw);
  if (blocks.length === 0) {
    return { intro: raw ? sanitizeInline(raw) : '', items: [] };
  }

  const intro = blocks
    .filter((b) => b.type === 'paragraph')
    .map((b) => sanitizeInline(b.data?.text ?? '').trim())
    .filter(Boolean)
    .join(' ');

  const items = blocks
    .filter((b) => b.type === 'list')
    .flatMap((b) => b.data?.items ?? [])
    .map((item) => sanitizeInline(itemText(item)).trim())
    .filter(Boolean);

  return { intro, items };
}
