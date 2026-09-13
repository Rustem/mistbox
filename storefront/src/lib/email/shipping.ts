/**
 * The two emails that come after the receipt: it shipped, and it arrived.
 *
 * Both go to the **buyer**, never the recipient. Mistbox sells gifts, and an
 * email to the person receiving one would spoil it.
 *
 * The delivered email is deliberately the plainest thing here — no tracking
 * table, no totals. By then the only thing worth saying is that it landed, and
 * an invitation to tell us how it went.
 */

import type { EmailCopy } from '@/lib/content';
import { EMAIL_DEFAULTS } from '@/lib/content';
import { carrierName, carrierTrackingUrl } from '@/lib/orderStatus';
import {
  FIR,
  FOREST,
  PALE,
  SANS,
  SERIF,
  button,
  esc,
  section,
  shell,
  textShell,
} from '@/lib/email/layout';
import { type EmailOrder, type TemplateOptions } from '@/lib/email/orderConfirmation';

export type ShipmentInfo = {
  trackingNumber: string;
  carrier: string;
  /** ISO date. Carrier-dependent and often absent — treat as informational. */
  eta?: string | null;
  /** Absolute URL of the order page. */
  orderUrl: string;
};

const etaLine = (eta?: string | null): string =>
  eta
    ? new Date(eta).toLocaleDateString('en-US', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      })
    : '';

function trackingBlock(ship: ShipmentInfo): string {
  const url = carrierTrackingUrl(ship.carrier, ship.trackingNumber);
  const eta = etaLine(ship.eta);
  return section(
    'Tracking',
    `<div style="font-family:${SANS};font-size:15px;line-height:1.8;color:${FOREST};">
                    ${carrierName(ship.carrier)}
                    <a href="${esc(url)}" style="font-family:${SERIF};font-size:19px;color:${FOREST};text-decoration:none;border-bottom:1px solid ${PALE};">${esc(ship.trackingNumber)}</a>
                  </div>
                  ${
                    eta
                      ? `<div style="padding-top:10px;font-family:${SANS};font-size:14px;line-height:1.7;color:${FIR};">Expected ${esc(eta)}. Carriers revise this, so treat it as a guide rather than a promise.</div>`
                      : ''
                  }`,
    28,
  );
}

export function shippedEmail(
  order: EmailOrder,
  ship: ShipmentInfo,
  opts: TemplateOptions = {},
): string {
  const copy = opts.copy ?? EMAIL_DEFAULTS['email-order-shipped'];
  return shell({
    title: copy.subject,
    preheader: `Order ${order.number} · ${carrierName(ship.carrier)} ${ship.trackingNumber}`,
    headline: copy.headline,
    intro: copy.body,
    orderRef: { number: order.number, created: order.created },
    rows: trackingBlock(ship) + button(ship.orderUrl, 'Follow your box'),
    closing:
      'The order page above updates as it travels, and we will write once more the day it arrives.',
    recipientEmail: order.userEmail,
    emblemSrc: opts.emblemSrc,
    birdSrc: opts.birdSrc,
    birdSignSrc: opts.birdSignSrc,
    signoff: copy.signoff,
    siteUrl: opts.siteUrl,
  });
}

export function shippedEmailText(
  order: EmailOrder,
  ship: ShipmentInfo,
  opts: TemplateOptions = {},
): string {
  const copy = opts.copy ?? EMAIL_DEFAULTS['email-order-shipped'];
  const eta = etaLine(ship.eta);
  return textShell(
    [
      copy.headline,
      '',
      ...copy.body,
      '',
      `Order ${order.number}`,
      '',
      'TRACKING',
      `  ${carrierName(ship.carrier)} ${ship.trackingNumber}`,
      `  ${carrierTrackingUrl(ship.carrier, ship.trackingNumber)}`,
      ...(eta ? [`  Expected ${eta} — carriers revise this, so treat it as a guide.`] : []),
      '',
      'FOLLOW YOUR BOX',
      `  ${ship.orderUrl}`,
    ],
    order.userEmail,
    copy.signoff,
  );
}

export function deliveredEmail(
  order: EmailOrder,
  orderUrl: string,
  opts: TemplateOptions = {},
): string {
  const copy = opts.copy ?? EMAIL_DEFAULTS['email-order-delivered'];
  return shell({
    title: copy.subject,
    preheader: `Order ${order.number} was delivered.`,
    headline: copy.headline,
    intro: copy.body,
    rows: button(orderUrl, 'See your order'),
    recipientEmail: order.userEmail,
    emblemSrc: opts.emblemSrc,
    birdSrc: opts.birdSrc,
    birdSignSrc: opts.birdSignSrc,
    signoff: copy.signoff,
    siteUrl: opts.siteUrl,
  });
}

export function deliveredEmailText(
  order: EmailOrder,
  orderUrl: string,
  opts: TemplateOptions = {},
): string {
  const copy = opts.copy ?? EMAIL_DEFAULTS['email-order-delivered'];
  return textShell(
    [copy.headline, '', ...copy.body, '', `Order ${order.number}`, `  ${orderUrl}`],
    order.userEmail,
    copy.signoff,
  );
}
