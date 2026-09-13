import { describe, expect, it } from 'vitest';
import { describe as describeBlocks, itemText, parseBlocks, sanitizeInline } from './richtext';

describe('sanitizeInline', () => {
  it('keeps allowed formatting tags', () => {
    expect(sanitizeInline('<b>bold</b> and <em>emphasis</em>')).toBe(
      '<b>bold</b> and <em>emphasis</em>',
    );
  });

  it('strips disallowed tags but keeps their text', () => {
    expect(sanitizeInline('<script>alert(1)</script>hello')).toBe('alert(1)hello');
    expect(sanitizeInline('<div class="x">boxed</div>')).toBe('boxed');
  });

  it('keeps entities untouched — they are not tags', () => {
    // The bug this guards: Saleor stores "Ballard & Bell" as
    // "Ballard &amp; Bell" already-encoded. Sanitizing must never touch it,
    // or a double-escape turns it into "&amp;amp;" on render.
    expect(sanitizeInline('Ballard &amp; Bell')).toBe('Ballard &amp; Bell');
  });

  it('keeps a safe link and adds rel="noopener noreferrer"', () => {
    expect(sanitizeInline('<a href="https://mist.box">shop</a>')).toBe(
      '<a href="https://mist.box" rel="noopener noreferrer">shop</a>',
    );
  });

  it('allows mailto: and relative links', () => {
    expect(sanitizeInline('<a href="mailto:hi@mist.box">mail</a>')).toContain(
      'href="mailto:hi@mist.box"',
    );
    expect(sanitizeInline('<a href="/about">about</a>')).toContain('href="/about"');
  });

  it('strips a javascript: link, never emitting an href for it', () => {
    // Each tag is sanitized independently, with no open/close pairing, so the
    // now-orphaned </a> is left behind — harmless (a browser treats a stray
    // closing tag as a no-op) but worth pinning exactly, not assuming away.
    // What actually matters for safety is asserted directly: no bad-scheme
    // href ever reaches the output.
    const out = sanitizeInline('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('<a ');
    expect(out).toBe('click</a>');
  });

  it('strips a link with no href at all, same orphan-tag caveat', () => {
    expect(sanitizeInline('<a>click</a>')).toBe('click</a>');
  });
});

describe('parseBlocks', () => {
  it('returns nothing for null or empty content', () => {
    expect(parseBlocks(null)).toEqual([]);
    expect(parseBlocks('')).toEqual([]);
  });

  it('never throws on malformed JSON — a bad page must not crash the site', () => {
    expect(parseBlocks('{not valid json')).toEqual([]);
    expect(parseBlocks('null')).toEqual([]);
  });

  it('parses real EditorJS output', () => {
    const content = JSON.stringify({
      blocks: [{ type: 'paragraph', data: { text: 'hello' } }],
    });
    expect(parseBlocks(content)).toEqual([{ type: 'paragraph', data: { text: 'hello' } }]);
  });
});

describe('itemText', () => {
  it('passes through a plain string', () => {
    expect(itemText('a list item')).toBe('a list item');
  });

  it('reads .content off an EditorJS nested-list item', () => {
    expect(itemText({ content: 'nested item' })).toBe('nested item');
  });

  it('never throws on something unexpected', () => {
    expect(itemText(null)).toBe('');
    expect(itemText(42)).toBe('');
  });
});

describe('describe', () => {
  it('joins paragraphs into the intro and lists into items', () => {
    const content = JSON.stringify({
      blocks: [
        { type: 'paragraph', data: { text: 'First.' } },
        { type: 'paragraph', data: { text: 'Second.' } },
        { type: 'list', data: { items: ['One', 'Two'] } },
      ],
    });
    expect(describeBlocks(content)).toEqual({
      intro: 'First. Second.',
      items: ['One', 'Two'],
    });
  });

  it('falls back to the raw text as the intro when there are no blocks', () => {
    expect(describeBlocks('Plain text, no EditorJS.')).toEqual({
      intro: 'Plain text, no EditorJS.',
      items: [],
    });
  });

  it('returns an empty description for null', () => {
    expect(describeBlocks(null)).toEqual({ intro: '', items: [] });
  });

  it('sanitizes both the intro and the list items', () => {
    const content = JSON.stringify({
      blocks: [
        { type: 'paragraph', data: { text: '<script>bad</script>Safe intro' } },
        { type: 'list', data: { items: ['<div>Tea</div>', { content: 'Honey' }] } },
      ],
    });
    expect(describeBlocks(content)).toEqual({
      intro: 'badSafe intro',
      items: ['Tea', 'Honey'],
    });
  });
});
