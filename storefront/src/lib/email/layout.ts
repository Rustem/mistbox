/**
 * The shell every Mistbox email is built in: masthead, headline, order line,
 * the forest band that closes it, and the palette and type stacks.
 *
 * Email HTML is not web HTML: no flexbox, no grid, no external stylesheet, and
 * no web fonts in most clients. Layout is tables, every style is inline, and
 * the typography is carried by the fallbacks — Georgia standing in for
 * Cormorant Garamond, Futura/Century Gothic for Jost. The brand survives that
 * substitution because it lives in the spacing and the palette, not the faces.
 *
 * Design lives here; wording comes from `src/lib/content.ts`. That split is
 * what lets Daniya reword an email from the dashboard without being able to
 * break a table layout or emit markup an email client will choke on.
 */

/* ------------------------------------------------------- brand ---------- */

export const FOREST = '#2b3a31';
export const FIR = '#4a5d4e';
export const SAGE = '#8fa394';
export const PALE = '#b9c7bc';
export const GOLD = '#c6a462';
export const GOLD_INK = '#7a5f22';
export const BONE = '#efe9de';
/** A half-step lighter than bone, so the card lifts off the ground. */
export const PAPER = '#f7f4ed';

export const SERIF = "Georgia, 'Cormorant Garamond', 'Times New Roman', serif";
export const SANS = "'Futura', 'Century Gothic', 'Avenir Next', Helvetica, Arial, sans-serif";

/* ------------------------------------------------------- helpers -------- */

export const esc = (s: unknown): string =>
  String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );

export const money = (n: number, currency = 'USD'): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);

export const longDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

/** A block of small uppercase type with the brand's wide tracking. */
export const support = (
  text: string,
  color: string,
  size = 11,
  tracking = '0.3em',
): string =>
  `<span style="font-family:${SANS};font-size:${size}px;line-height:1.9;letter-spacing:${tracking};text-transform:uppercase;color:${color};">${text}</span>`;

/** A full-width labelled section, the unit most email bodies are built from. */
export const section = (label: string, inner: string, padBottom = 36): string => `
          <tr>
            <td class="pad" style="padding:0 40px ${padBottom}px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr><td style="padding-bottom:10px;">${support(label, SAGE)}</td></tr>
                <tr><td>${inner}</td></tr>
              </table>
            </td>
          </tr>`;

/** Big centred call to action. Outlook ignores border-radius; that is fine. */
export const button = (href: string, label: string): string => `
          <tr>
            <td align="center" class="pad" style="padding:4px 40px 40px;">
              <a href="${esc(href)}" style="display:inline-block;background:${FOREST};color:${BONE};font-family:${SANS};font-size:13px;letter-spacing:0.22em;text-transform:uppercase;text-decoration:none;padding:15px 34px;">${esc(label)}</a>
            </td>
          </tr>`;

/* ------------------------------------------------------- the shell ------ */

export type ShellOptions = {
  title: string;
  preheader: string;
  headline: string;
  /** Intro paragraphs under the headline, centred. Already-escaped HTML. */
  intro: string[];
  /** Order number and date, shown under the intro. */
  orderRef?: { number: string; created: string };
  /** Pre-rendered `<tr>` rows forming the body. */
  rows: string;
  /** Closing paragraph above the band, in the rule-topped block. */
  closing?: string;
  recipientEmail: string;
  emblemSrc?: string;
  /**
   * The Mist Bird, in the pose this email calls for. When present the headline
   * moves off the paper and into a forest band beside the bird — see `hero`
   * below for why the band is dark.
   */
  birdSrc?: string;
  /** Small foil mark beside the sign-off. */
  birdSignSrc?: string;
  /** The bird's closing line, e.g. "Packed with care,". */
  signoff?: string;
  siteUrl?: string;
};

export function shell(o: ShellOptions): string {
  const siteUrl = o.siteUrl ?? 'https://mist.box';

  // Smaller above a hero band, so the two marks do not compete for the top.
  const [emblemW, emblemH, emblemGap] = o.birdSrc ? [52, 66, 20] : [66, 84, 24];
  const emblem = o.emblemSrc
    ? `<img src="${o.emblemSrc}" width="${emblemW}" height="${emblemH}" alt="" style="display:block;margin:0 auto ${emblemGap}px;border:0;outline:none;">`
    : '';

  const intro = o.intro
    .map(
      (p) =>
        `<div style="padding-top:16px;font-family:${SANS};font-size:16px;line-height:1.75;color:${FIR};max-width:400px;margin:0 auto;">${p}</div>`,
    )
    .join('');

  const orderRef = o.orderRef
    ? `
        <tr>
          <td align="center" class="pad" style="padding:30px 40px 0;">
            ${support(`Order ${esc(o.orderRef.number)}`, GOLD_INK, 12, '0.28em')}
            <div style="padding-top:4px;">${support(longDate(o.orderRef.created), SAGE, 11)}</div>
          </td>
        </tr>`
    : '';

  /**
   * The hero band, when this email has a bird.
   *
   * Forest, and not by taste: the bird is a gold contour, and gold measures
   * 5.07:1 on forest against 1.96:1 on bone. The dark band is the only ground
   * the artwork has any presence on.
   *
   * The headline is live text on a background colour rather than set into the
   * image. That matters more than it looks — before the site is public the
   * artwork travels as a data URI, which Gmail blocks, and an email whose
   * headline lived in the image would arrive blank.
   */
  const heroEyebrow = o.orderRef
    ? `Order ${esc(o.orderRef.number)} &nbsp;&middot;&nbsp; ${esc(longDate(o.orderRef.created))}`
    : '';

  const hero = o.birdSrc
    ? `
        <tr>
          <td bgcolor="${FOREST}" style="background:${FOREST};padding:0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td valign="middle" class="pad" style="padding:36px 8px 36px 40px;">
                  ${heroEyebrow ? `<div style="padding-bottom:12px;">${support(heroEyebrow, GOLD, 11, '0.24em')}</div>` : ''}
                  <div style="font-family:${SERIF};font-size:31px;line-height:1.22;color:${BONE};">${o.headline}</div>
                </td>
                <td valign="middle" width="200" style="padding:24px 28px 24px 0;">
                  <img src="${o.birdSrc}" width="200" alt="" style="display:block;width:200px;max-width:200px;height:auto;border:0;outline:none;">
                </td>
              </tr>
            </table>
          </td>
        </tr>`
    : '';

  /**
   * The sign-off. The body above is written in the brand's voice; this line is
   * the bird's, and the signature under it is what makes the bird a
   * correspondent rather than an illustration. Both degrade to plain text if
   * the mark is blocked.
   */
  const signoff = o.signoff
    ? `
        <tr>
          <td align="center" class="pad" style="padding:10px 40px 42px;">
            <div style="font-family:${SANS};font-size:15px;line-height:1.7;color:${FIR};padding-bottom:14px;">${o.signoff}</div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
              <tr>
                ${
                  o.birdSignSrc
                    ? `<td valign="middle" width="46" style="padding-right:14px;"><img src="${o.birdSignSrc}" width="46" alt="" style="display:block;border:0;outline:none;"></td>`
                    : ''
                }
                <td valign="middle" style="font-family:${SERIF};font-style:italic;font-size:23px;color:${FOREST};">the Mist Bird</td>
              </tr>
            </table>
          </td>
        </tr>`
    : '';

  const closing = o.closing
    ? `
        <tr>
          <td class="pad" style="padding:0 40px 48px;">
            <div style="border-top:1px solid ${PALE};padding-top:28px;font-family:${SANS};font-size:15px;line-height:1.8;color:${FIR};">
              ${o.closing}
            </div>
          </td>
        </tr>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(o.title)}</title>
<style>
  /* Only clients that support <style> get these; nothing here is load-bearing. */
  @media (max-width:620px) {
    .shell { width:100% !important; }
    .pad { padding-left:24px !important; padding-right:24px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${BONE};">

<!-- Preheader: the line shown beside the subject in the inbox list.
     Deliberately *not* padded with the usual run of zero-width characters —
     invisible filler text is a spam signature, and on a domain with no sending
     reputation that is a cost the preview line is not worth. -->
<div style="display:none;max-height:0;overflow:hidden;">${esc(o.preheader)}</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BONE};">
  <tr>
    <td align="center" style="padding:40px 12px;">

      <table role="presentation" class="shell" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;background:${PAPER};">

        <!-- masthead. With a hero band under it the wordmark steps back and the
             hairline goes: the band's own top edge is the rule. -->
        <tr>
          <td align="center" class="pad" style="padding:${o.birdSrc ? '44px 40px 32px' : '48px 40px 0'};">
            ${emblem}
            <div style="font-family:${SERIF};font-weight:400;font-size:${o.birdSrc ? 24 : 30}px;line-height:1.1;letter-spacing:0.38em;text-indent:0.38em;text-transform:uppercase;color:${FOREST};">Mistbox</div>
            ${o.birdSrc ? '' : `<div style="height:1px;width:52px;background:${GOLD};margin:22px auto 0;line-height:1px;font-size:0;">&nbsp;</div>`}
          </td>
        </tr>
${hero}
        <!-- the news. The headline lives in the band when there is one, so this
             row carries only the intro. -->
        <tr>
          <td align="center" class="pad" style="padding:34px 40px 0;">
            ${o.birdSrc ? '' : `<div style="font-family:${SERIF};font-size:34px;line-height:1.2;color:${FOREST};">${o.headline}</div>`}
            ${intro}
          </td>
        </tr>
${o.birdSrc ? '' : orderRef}
${signoff}
${signoff ? '' : '        <tr><td style="height:36px;line-height:36px;font-size:0;">&nbsp;</td></tr>'}
${o.rows}
${closing}
        <!-- band -->
        <tr>
          <td align="center" bgcolor="${FOREST}" style="background:${FOREST};padding:36px 40px;">
            <div style="font-family:${SANS};font-size:11px;line-height:2;letter-spacing:0.3em;text-transform:uppercase;color:${PALE};">
              Thoughtfully gathered<br>Beautifully given
            </div>
            <div style="height:1px;width:36px;background:${GOLD};margin:20px auto;line-height:1px;font-size:0;">&nbsp;</div>
            <div style="font-family:${SANS};font-size:12px;line-height:1.8;color:${PALE};">
              <a href="${siteUrl}" style="color:${GOLD};text-decoration:none;">mist.box</a>
              &nbsp;&middot;&nbsp; Seattle, Washington
            </div>
          </td>
        </tr>

      </table>

      <!-- outside the card -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;">
        <tr>
          <td align="center" style="padding:22px 24px 0;font-family:${SANS};font-size:12px;line-height:1.8;color:${SAGE};">
            Sent to ${esc(o.recipientEmail)} because you placed an order with Mistbox.<br>
            Questions? Reply to this email and a person will answer.
          </td>
        </tr>
      </table>

    </td>
  </tr>
</table>
</body>
</html>`;
}

/**
 * The plain-text masthead and sign-off, shared by every text alternative.
 *
 * The bird signs the text part too. A reader on a plain-text client should get
 * the same correspondent as everyone else — the mark is what cannot travel,
 * not the voice.
 */
export function textShell(lines: string[], recipientEmail: string, signoff?: string): string {
  return [
    'MISTBOX',
    'Thoughtfully gathered, beautifully given',
    '',
    ...lines,
    ...(signoff ? ['', signoff, 'the Mist Bird'] : []),
    '',
    'mist.box · Seattle, Washington',
    `Sent to ${recipientEmail} because you placed an order with Mistbox.`,
  ].join('\n');
}
