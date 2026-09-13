/**
 * The order-confirmation email — the receipt.
 *
 * Design lives in `layout.ts`; the wording comes from `content.ts` so it can be
 * changed from the Saleor dashboard. What is left here is the part that is
 * neither: the shape of a receipt.
 */

import type { EmailCopy } from '@/lib/content';
import { EMAIL_DEFAULTS } from '@/lib/content';
import { fullName } from '@/lib/saleor';
import { flavourOf } from '@/lib/box';
import {
  FIR,
  FOREST,
  GOLD,
  PALE,
  SANS,
  SAGE,
  SERIF,
  esc,
  longDate,
  money,
  section,
  shell,
  support,
  textShell,
} from '@/lib/email/layout';

export type EmailOrder = {
  id?: string;
  number: string;
  created: string;
  userEmail: string;
  total: { gross: { amount: number; currency: string } };
  subtotal: { gross: { amount: number } };
  shippingPrice: { gross: { amount: number } };
  shippingMethodName: string | null;
  lines: Array<{
    id: string;
    quantity: number;
    productName: string;
    /** The flavour the customer chose — "Cedar smoke". Saleor snapshots it
     *  separately from the product name, and it is the whole point of the
     *  choice, so it must not be dropped from the receipt. */
    variantName?: string | null;
    variant: { id: string };
    totalPrice: { gross: { amount: number } };
  }>;
  shippingAddress: {
    firstName: string;
    lastName: string;
    streetAddress1: string;
    streetAddress2?: string | null;
    city: string;
    countryArea: string;
    postalCode: string;
  } | null;
  metadata: Array<{ key: string; value: string }>;
};

export type TemplateOptions = {
  emblemSrc?: string;
  /** The Mist Bird in this email's pose, and the small mark that signs it. */
  birdSrc?: string;
  birdSignSrc?: string;
  siteUrl?: string;
  copy?: EmailCopy;
};

/** "Chocolate bar, 3 oz — Truffle mix". The flavour is the chosen part. */
export const itemLabel = (line: { productName: string; variantName?: string | null }): string => {
  const flavour = flavourOf(line.productName, line.variantName);
  return flavour ? `${line.productName} — ${flavour}` : line.productName;
};

export const giftMessageOf = (order: EmailOrder): string =>
  (order.metadata ?? []).find((m) => m.key === 'gift_message')?.value ?? '';

/**
 * The gift message, set the way it will actually be written on the card —
 * serif, italic, indented behind a gold rule — rather than as another data row.
 * It is the emotional centre of the purchase and earns the one piece of real
 * typographic treatment in the email.
 */
export function giftBlock(gift: string): string {
  if (!gift) return '';
  return section(
    'Written on your card',
    `<div style="border-left:2px solid ${GOLD};padding:2px 0 2px 20px;font-family:${SERIF};font-style:italic;font-size:19px;line-height:1.65;color:${FIR};">${esc(
      gift,
    ).replace(/\n/g, '<br>')}</div>`,
  );
}

export function addressBlock(order: EmailOrder): string {
  const a = order.shippingAddress;
  if (!a) return '';
  return section(
    'Delivering to',
    `<div style="font-family:${SANS};font-size:15px;line-height:1.7;color:${FOREST};">
                    ${esc(fullName(a))}<br>
                    ${esc(a.streetAddress1)}${a.streetAddress2 ? `<br>${esc(a.streetAddress2)}` : ''}<br>
                    ${esc(a.city)}, ${esc(a.countryArea)} ${esc(a.postalCode)}
                  </div>`,
    40,
  );
}

export function orderConfirmation(order: EmailOrder, opts: TemplateOptions = {}): string {
  const copy = opts.copy ?? EMAIL_DEFAULTS['email-order-confirmed'];
  const currency = order.total.gross.currency ?? 'USD';

  // Every line is priced: the carton first, then what went in it. The rule
  // sits under the last row only, so the block reads as one receipt rather
  // than a stack of separate rows.
  const last = order.lines.length - 1;

  const lines = order.lines
    .map(
      (l, i) => `
              <tr>
                <td style="padding:14px 0;${i === last ? `border-bottom:1px solid ${PALE};` : ''}font-family:${SERIF};font-size:17px;line-height:1.4;color:${FOREST};">
                  ${esc(itemLabel(l))}${l.quantity > 1 ? `<span style="font-family:${SANS};font-size:13px;color:${FIR};"> &times;&nbsp;${l.quantity}</span>` : ''}
                </td>
                <td align="right" style="padding:14px 0;${i === last ? `border-bottom:1px solid ${PALE};` : ''}font-family:${SANS};font-size:15px;color:${FOREST};white-space:nowrap;">
                  ${money(l.totalPrice.gross.amount, currency)}
                </td>
              </tr>`,
    )
    .join('');

  // The total gets a hairline above it: this is a receipt, and the eye should
  // be able to find the figure that matters without reading the rows above.
  const totalRow = (label: string, value: string, strong = false): string => {
    const pad = strong ? '13px 0 0' : '7px 0 0';
    const rule = strong ? `border-top:1px solid ${PALE};padding-top:13px;` : '';
    return `
              <tr>
                <td style="padding:${pad};${rule}font-family:${SANS};font-size:${strong ? 14 : 13}px;${strong ? `letter-spacing:0.2em;text-transform:uppercase;color:${FOREST};` : `color:${FIR};`}">${label}</td>
                <td align="right" style="padding:${pad};${rule}font-family:${strong ? SERIF : SANS};font-size:${strong ? 22 : 13}px;color:${FOREST};white-space:nowrap;">${value}</td>
              </tr>`;
  };

  const receipt = `
        <tr>
          <td class="pad" style="padding:0 40px 36px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td colspan="2" style="padding-bottom:6px;border-bottom:1px solid ${GOLD};">${support('In your box', SAGE)}</td>
              </tr>
              ${lines}
              ${totalRow('Subtotal', money(order.subtotal.gross.amount, currency))}
              ${totalRow(
                esc(order.shippingMethodName ?? 'Delivery'),
                order.shippingPrice.gross.amount === 0
                  ? 'Included'
                  : money(order.shippingPrice.gross.amount, currency),
              )}
              ${totalRow('Total', money(order.total.gross.amount, currency), true)}
            </table>
          </td>
        </tr>`;

  return shell({
    title: copy.subject,
    preheader: `Order ${order.number} · packed by hand in Seattle and on its way to you soon.`,
    headline: copy.headline,
    intro: copy.body,
    orderRef: { number: order.number, created: order.created },
    rows: receipt + giftBlock(giftMessageOf(order)) + addressBlock(order),
    closing:
      'Every box is packed by hand in Seattle, laid on pale sage tissue and sealed with a band. Your card is written in ink before it goes in — so give us a couple of days before it travels.',
    recipientEmail: order.userEmail,
    emblemSrc: opts.emblemSrc,
    birdSrc: opts.birdSrc,
    birdSignSrc: opts.birdSignSrc,
    signoff: copy.signoff,
    siteUrl: opts.siteUrl,
  });
}

/** The plain-text alternative. Every email needs one; some people only see this. */
export function orderConfirmationText(order: EmailOrder, opts: TemplateOptions = {}): string {
  const copy = opts.copy ?? EMAIL_DEFAULTS['email-order-confirmed'];
  const currency = order.total.gross.currency ?? 'USD';
  const gift = giftMessageOf(order);
  const a = order.shippingAddress;

  return textShell(
    [
      copy.headline,
      '',
      ...copy.body,
      '',
      `Order ${order.number} · ${longDate(order.created)}`,
      '',
      'IN YOUR BOX',
      ...order.lines.map(
        (l) =>
          `  ${itemLabel(l)}${l.quantity > 1 ? ` x ${l.quantity}` : ''}  ${money(l.totalPrice.gross.amount, currency)}`,
      ),
      `  Subtotal  ${money(order.subtotal.gross.amount, currency)}`,
      `  ${order.shippingMethodName ?? 'Delivery'}  ${
        order.shippingPrice.gross.amount === 0
          ? 'Included'
          : money(order.shippingPrice.gross.amount, currency)
      }`,
      `  TOTAL  ${money(order.total.gross.amount, currency)}`,
      '',
      ...(gift ? ['WRITTEN ON YOUR CARD', `  "${gift}"`, ''] : []),
      ...(a
        ? [
            'DELIVERING TO',
            `  ${fullName(a)}`,
            `  ${a.streetAddress1}`,
            ...(a.streetAddress2 ? [`  ${a.streetAddress2}`] : []),
            `  ${a.city}, ${a.countryArea} ${a.postalCode}`,
            '',
          ]
        : []),
      'Every box is packed by hand in Seattle. Your card is written in ink',
      'before it goes in, so give us a couple of days before it travels.',
    ],
    order.userEmail,
    copy.signoff,
  );
}
