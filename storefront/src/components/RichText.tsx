/**
 * Renders Saleor's EditorJS content as HTML.
 *
 * Whatever someone types into Content -> Models in the dashboard arrives here,
 * so this copes with the block types that editor can produce: paragraphs,
 * headers, lists and quotes. Sanitising lives in `lib/richtext`.
 */
import { itemText, parseBlocks, sanitizeInline } from '@/lib/richtext';

export function RichText({ content }: { content: string | null }) {
  if (!content) return null;

  const blocks = parseBlocks(content);

  // Not EditorJS — show it as plain text rather than showing nothing.
  if (blocks.length === 0) return <p>{content}</p>;

  return (
    <>
      {blocks.map((block, i) => {
        const key = `${block.type}-${i}`;
        const html = sanitizeInline(block.data?.text ?? '');

        switch (block.type) {
          case 'header': {
            // The wordmark owns h1; content headings start at h2.
            const level = Math.min(Math.max(block.data?.level ?? 2, 2), 4);
            const Tag = `h${level}` as 'h2' | 'h3' | 'h4';
            return <Tag key={key} dangerouslySetInnerHTML={{ __html: html }} />;
          }

          case 'list': {
            const items = (block.data?.items ?? [])
              .map(itemText)
              .map(sanitizeInline)
              .filter(Boolean);
            if (items.length === 0) return null;
            const Tag = block.data?.style === 'ordered' ? 'ol' : 'ul';
            return (
              <Tag key={key} className="contents prose-list">
                {items.map((item, j) => (
                  <li key={j} dangerouslySetInnerHTML={{ __html: item }} />
                ))}
              </Tag>
            );
          }

          case 'quote':
            return (
              <blockquote key={key}>
                <p dangerouslySetInnerHTML={{ __html: html }} />
                {block.data?.caption && (
                  <cite className="support">
                    {block.data.caption.replace(/<[^>]+>/g, '')}
                  </cite>
                )}
              </blockquote>
            );

          case 'paragraph':
          default:
            if (!html.trim()) return null;
            return <p key={key} dangerouslySetInnerHTML={{ __html: html }} />;
        }
      })}
    </>
  );
}
