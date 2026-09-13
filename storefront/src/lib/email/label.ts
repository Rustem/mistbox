/**
 * The label-ready email — sent to Daniya, not the customer, the moment a
 * label is bought. Same shell as every customer-facing email so it reads as
 * part of the same system, not a separate tool bolted on.
 */

import { FIR, esc, section, shell, textShell } from '@/lib/email/layout';

export function labelReadyEmail(opts: {
  orderNumber: string;
  recipientName: string;
  carrier: string;
  service: string;
  cost: string;
  trackingNumber: string;
  emblemSrc?: string;
  siteUrl?: string;
}): string {
  const rows = section(
    'Label details',
    `<div style="font-family:'Jost','Avenir Next','Segoe UI',system-ui,sans-serif;font-size:15px;line-height:1.8;color:${FIR};">
                    ${esc(opts.carrier)} ${esc(opts.service)} — ${esc(opts.cost)}<br>
                    Tracking ${esc(opts.trackingNumber)}
                  </div>`,
    40,
  );

  return shell({
    title: 'Label ready to print',
    preheader: `Order ${opts.orderNumber} — label attached, ready to print.`,
    headline: 'A label is ready.',
    intro: [
      `For ${esc(opts.recipientName)}, order ${esc(opts.orderNumber)}. It's attached to this email as a PDF — print it, tape it to the box, and it's ready to hand to the carrier.`,
    ],
    rows,
    recipientEmail: 'mrsdaniya@mist.box',
    emblemSrc: opts.emblemSrc,
    siteUrl: opts.siteUrl,
  });
}

export function labelReadyEmailText(opts: {
  orderNumber: string;
  recipientName: string;
  carrier: string;
  service: string;
  cost: string;
  trackingNumber: string;
}): string {
  return textShell(
    [
      'A label is ready.',
      '',
      `For ${opts.recipientName}, order ${opts.orderNumber}.`,
      "It's attached to this email as a PDF — print it and tape it to the box.",
      '',
      `${opts.carrier} ${opts.service} — ${opts.cost}`,
      `Tracking ${opts.trackingNumber}`,
    ],
    'mrsdaniya@mist.box',
  );
}
