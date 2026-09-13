/**
 * The one ordered list of what happens to a box, shared by the order page, the
 * packing screen and the emails.
 *
 * Three of the stages are ours and three are the carrier's. That mix is the
 * point: carrier tracking is the same data every shop shows, and the stages
 * before it — packed by hand, card written in ink — are the part only Mistbox
 * can show, and the part the catalogue already promises.
 *
 * The wording here is a **default**. Once the matching pages exist in Saleor,
 * `src/lib/content.ts` overrides every label and note from the dashboard
 * without a deploy. Ordering and the carrier mapping stay in code, because they
 * are behaviour rather than copy.
 */

export const STAGES = [
  'confirmed',
  'packing',
  'card_written',
  'sealed',
  'shipped',
  'in_transit',
  'delivered',
] as const;

export type Stage = (typeof STAGES)[number];

/** Stages Daniya advances by hand, in the order she does them. */
export const MANUAL_STAGES: readonly Stage[] = ['packing', 'card_written', 'sealed'];

export type StageCopy = {
  /** Shown on the timeline. */
  label: string;
  /** One line under the label, explaining what is happening. */
  note: string;
  /** Imperative, for the button that advances *to* this stage. */
  action: string;
};

export const STAGE_DEFAULTS: Record<Stage, StageCopy> = {
  confirmed: {
    label: 'Order confirmed',
    note: 'We have your order and your card details are settled.',
    action: 'Confirm',
  },
  packing: {
    label: 'Being packed',
    note: 'Your box is being filled by hand in Seattle, on pale sage tissue.',
    action: 'Start packing',
  },
  card_written: {
    label: 'Card written',
    note: 'Your message has been written out in ink and laid on top.',
    action: 'Card written',
  },
  sealed: {
    label: 'Sealed',
    note: 'Banded, sealed and waiting for the post.',
    action: 'Sealed',
  },
  shipped: {
    label: 'On its way',
    note: 'Handed to the carrier. Tracking is live below.',
    action: 'Mark shipped',
  },
  in_transit: {
    label: 'In transit',
    note: 'Travelling towards the delivery address.',
    action: 'In transit',
  },
  delivered: {
    label: 'Delivered',
    note: 'It arrived. We hope it was opened slowly.',
    action: 'Delivered',
  },
};

/**
 * Shippo's six statuses, mapped onto our stages.
 *
 * `PRE_TRANSIT` deliberately maps to `shipped` rather than a stage of its own:
 * from the buyer's side "a label exists" and "it is on its way" are the same
 * news, and an extra row would be honest but useless.
 *
 * `RETURNED`, `FAILURE` and `UNKNOWN` map to nothing. They are not progress, so
 * they never move the timeline — they surface as an exception instead.
 */
const CARRIER_TO_STAGE: Record<string, Stage | null> = {
  PRE_TRANSIT: 'shipped',
  TRANSIT: 'in_transit',
  DELIVERED: 'delivered',
  RETURNED: null,
  FAILURE: null,
  UNKNOWN: null,
};

export function stageForCarrierStatus(status: string): Stage | null {
  return CARRIER_TO_STAGE[status?.toUpperCase()] ?? null;
}

/** Carrier statuses that need a person rather than a timeline row. */
export function isException(status: string): boolean {
  return ['RETURNED', 'FAILURE'].includes(status?.toUpperCase());
}

export function stageIndex(stage: Stage | null): number {
  return stage ? STAGES.indexOf(stage) : -1;
}

/**
 * Stages only ever move forward. A carrier can report TRANSIT after an
 * out-for-delivery scan, and a duplicate webhook can arrive at any time; both
 * would otherwise walk the timeline backwards in front of the customer.
 */
export function isAdvance(from: Stage | null, to: Stage): boolean {
  return stageIndex(to) > stageIndex(from);
}

export function nextManualStage(current: Stage | null): Stage | null {
  const at = stageIndex(current);
  return MANUAL_STAGES.find((s) => stageIndex(s) > at) ?? null;
}

/* ---------------------------------------------------------------- metadata */

/** Keys written to Saleor order metadata. Namespaced so they are obviously ours. */
export const META = {
  stage: 'mistbox_stage',
  stageAt: 'mistbox_stage_at',
  trackingNumber: 'tracking_number',
  trackingCarrier: 'tracking_carrier',
  trackingStatus: 'tracking_status',
  trackingDetail: 'tracking_detail',
  trackingEta: 'tracking_eta',
  shippoRegistered: 'shippo_track_registered',
  history: 'mistbox_history',
  labelTransactionId: 'shippo_label_transaction_id',
  labelCost: 'shippo_label_cost',
  giftMessage: 'gift_message',
  newsletterOptIn: 'newsletter_opt_in',
  recipientName: 'recipient_name',
} as const;

export type MetadataItem = { key: string; value: string };

export function readMeta(metadata: MetadataItem[] | undefined, key: string): string {
  return metadata?.find((m) => m.key === key)?.value ?? '';
}

/**
 * When each stage was reached.
 *
 * Stored as one JSON metadata value rather than a key per stage: Saleor
 * metadata is a flat list, and seven keys per order would bury the handful that
 * a person actually reads in the dashboard.
 */
export type StageEvent = { s: Stage; at: string };

export function readHistory(metadata: MetadataItem[] | undefined): StageEvent[] {
  try {
    const raw = readMeta(metadata, META.history);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is StageEvent =>
        typeof e === 'object' && e !== null && 's' in e && 'at' in e,
    );
  } catch {
    // Malformed history is a display problem, never a reason to fail a webhook.
    return [];
  }
}

/** Append a stage, keeping the first time each was reached. */
export function appendHistory(existing: StageEvent[], stage: Stage, at: string): StageEvent[] {
  if (existing.some((e) => e.s === stage)) return existing;
  return [...existing, { s: stage, at }];
}

export function historyMap(metadata: MetadataItem[] | undefined): Partial<Record<Stage, string>> {
  const out: Partial<Record<Stage, string>> = {};
  for (const e of readHistory(metadata)) out[e.s] = e.at;
  return out;
}

export function currentStage(metadata: MetadataItem[] | undefined): Stage {
  const raw = readMeta(metadata, META.stage);
  return (STAGES as readonly string[]).includes(raw) ? (raw as Stage) : 'confirmed';
}

/* ---------------------------------------------------------------- carriers */

/**
 * Shippo needs a carrier alongside the tracking number. Rather than ask Daniya
 * for it a second time, infer it from the number's shape and let a
 * `tracking_carrier` metadata key override when she ships something by UPS.
 *
 * USPS is the default because every other pattern is more distinctive: guessing
 * wrong towards USPS fails safely, since Shippo simply reports UNKNOWN.
 */
export function inferCarrier(trackingNumber: string): string {
  const n = trackingNumber.replace(/\s+/g, '').toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return 'ups';
  if (/^(96\d{20}|\d{12}|\d{15})$/.test(n)) return 'fedex';
  return 'usps';
}

/** Where a customer goes to see the carrier's own page. */
export function carrierTrackingUrl(carrier: string, trackingNumber: string): string {
  const n = encodeURIComponent(trackingNumber.replace(/\s+/g, ''));
  switch (carrier) {
    case 'ups':
      return `https://www.ups.com/track?tracknum=${n}`;
    case 'fedex':
      return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
    default:
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
  }
}

export function carrierName(carrier: string): string {
  return { usps: 'USPS', ups: 'UPS', fedex: 'FedEx' }[carrier] ?? carrier.toUpperCase();
}
