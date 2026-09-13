/**
 * Shippo: tracking, and — as of the one-click admin flow — buying the label
 * itself.
 *
 * Label purchases are real money the moment `purchaseLabel` is called; there
 * is no test-mode simulation of a charge the way there is for tracking
 * statuses. Every caller of it must have already shown the buyer-facing admin
 * a real quoted price and gotten an explicit tap on it — see
 * `src/app/api/admin/label/buy/route.ts`. Nothing in this file purchases
 * anything on its own.
 */

const API = 'https://api.goshippo.com';
const API_VERSION = '2018-02-08';

/** Shippo's six tracking statuses. */
export type ShippoStatus =
  | 'PRE_TRANSIT'
  | 'TRANSIT'
  | 'DELIVERED'
  | 'RETURNED'
  | 'FAILURE'
  | 'UNKNOWN';

export type ShippoSubstatus = {
  code: string;
  text: string;
  action_required: boolean;
};

export type ShippoTrackingStatus = {
  status: ShippoStatus;
  status_details?: string;
  status_date?: string;
  location?: { city?: string; state?: string; zip?: string; country?: string } | null;
  substatus?: ShippoSubstatus | null;
};

/** The `track_updated` webhook body. */
export type TrackUpdatedEvent = {
  event: string;
  test?: boolean;
  data: {
    carrier: string;
    tracking_number: string;
    /** Free-form, echoed back on every event — how we find the order again. */
    metadata?: string;
    tracking_status: ShippoTrackingStatus | null;
    tracking_history?: ShippoTrackingStatus[];
    eta?: string | null;
    messages?: string[];
  };
};

/** Test tokens are prefixed `shippo_test_`; live ones `shippo_live_`. */
export function isTestMode(): boolean {
  return (process.env.SHIPPO_API_TOKEN ?? '').startsWith('shippo_test_');
}

/**
 * In test mode Shippo accepts exactly one carrier, `shippo`, and rejects real
 * ones outright: "usps is not a valid test tracking carrier."
 *
 * Substituting it here rather than at the call site keeps every caller writing
 * the real carrier — which is what gets stored on the order and shown to the
 * customer — while the sandbox still accepts the registration. Pair it with one
 * of Shippo's magic numbers (SHIPPO_TRANSIT, SHIPPO_DELIVERED, and so on) to
 * drive statuses on demand.
 */
function carrierFor(carrier: string): string {
  return isTestMode() ? 'shippo' : carrier;
}

function headers(): Record<string, string> {
  const token = process.env.SHIPPO_API_TOKEN;
  if (!token) throw new Error('SHIPPO_API_TOKEN is not set.');
  return {
    Authorization: `ShippoToken ${token}`,
    'Shippo-API-Version': API_VERSION,
    'Content-Type': 'application/json',
  };
}

async function shippo<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: headers() });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Shippo ${path} returned ${res.status}: ${body.slice(0, 300)}`);
  }
  return JSON.parse(body) as T;
}

/**
 * Ask Shippo to watch a tracking number and push updates to our webhook.
 *
 * **Registering the same number twice is not idempotent** — Shippo's own
 * documentation warns that duplicate registrations produce duplicate
 * notifications for every subsequent event, forever. The caller must guard on
 * the `shippo_track_registered` order metadata flag before calling this; there
 * is no way to undo a double registration from here.
 *
 * `metadata` is echoed back on every webhook and is the only link from a
 * tracking event to a Saleor order, so it must always be set.
 */
export function registerTrack(
  carrier: string,
  trackingNumber: string,
  metadata: string,
): Promise<{ carrier: string; tracking_number: string; tracking_status: ShippoTrackingStatus | null }> {
  return shippo('/tracks/', {
    method: 'POST',
    body: JSON.stringify({
      carrier: carrierFor(carrier),
      tracking_number: trackingNumber.replace(/\s+/g, ''),
      metadata,
    }),
  });
}

/** Current status, for reconciling an order whose webhook was missed. */
export function getTrack(
  carrier: string,
  trackingNumber: string,
): Promise<{ tracking_status: ShippoTrackingStatus | null; eta?: string | null }> {
  return shippo(`/tracks/${encodeURIComponent(carrierFor(carrier))}/${encodeURIComponent(trackingNumber)}`);
}

/* --------------------------------------------------------- buying a label */

export type ShippoAddress = {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  email?: string;
  phone?: string;
};

/**
 * Where every box ships from. USPS specifically refuses to quote a rate
 * without an email and phone on the sender — found by testing a real
 * shipment, not documented anywhere obvious — so both are required here even
 * though nothing about a return address usually needs them.
 */
export const MISTBOX_ORIGIN: ShippoAddress = {
  name: 'Mistbox',
  street1: '1 Pike Place',
  city: 'Seattle',
  state: 'WA',
  zip: '98101',
  country: 'US',
  email: 'info@mist.box',
  // A placeholder in the same spirit as catalog.json's invented maker names:
  // real, callable number needed before this ships a label for real money.
  phone: '2065551234',
};

/**
 * Per-box parcel size for rating and the label itself.
 *
 * **Not yet verified against a real packed box.** The weights match
 * catalog.json's pre-launch estimates; the dimensions are a placeholder outer
 * carton size. A wrong declared weight or size is not merely cosmetic here —
 * carriers re-weigh and back-charge the difference after the fact, quietly,
 * well after the label was printed and the box gone. Confirm both against an
 * actual packed box before buying a label for a real order.
 */
export const PARCEL_DEFAULTS: Record<string, { weightLb: number; in: [number, number, number] }> = {
  'The Mistbox': { weightLb: 3.1, in: [10, 8, 4] },
  'The Mistbox, Grand': { weightLb: 4.6, in: [12, 10, 5] },
};

const DEFAULT_PARCEL = PARCEL_DEFAULTS['The Mistbox'];

/**
 * One parcel for the whole order. Multiple boxes are approximated as one
 * combined parcel — weights sum, but the box dimensions stay the largest
 * single item's, which is optimistic for more than a couple of boxes. This is
 * exactly the kind of approximation that needs real numbers before it is
 * trusted at volume; see `PARCEL_DEFAULTS`.
 */
export function parcelForLines(
  lines: Array<{ productName: string; quantity: number }>,
): { length: string; width: string; height: string; distance_unit: 'in'; weight: string; mass_unit: 'lb' } {
  let weight = 0;
  let dims: [number, number, number] = DEFAULT_PARCEL.in;
  for (const line of lines) {
    const parcel = PARCEL_DEFAULTS[line.productName] ?? DEFAULT_PARCEL;
    weight += parcel.weightLb * line.quantity;
    if (parcel.in[0] * parcel.in[1] * parcel.in[2] > dims[0] * dims[1] * dims[2]) dims = parcel.in;
  }
  return {
    length: String(dims[0]),
    width: String(dims[1]),
    height: String(dims[2]),
    distance_unit: 'in',
    weight: weight.toFixed(1),
    mass_unit: 'lb',
  };
}

export type ShippoRate = {
  object_id: string;
  provider: string;
  servicelevel: { name: string };
  amount: string;
  currency: string;
  estimated_days: number | null;
};

/**
 * Which carriers we are actually able to buy a label from.
 *
 * A quoted rate is not a purchasable rate. Shippo will happily quote UPS on an
 * account where UPS has never been registered, and only say so at purchase
 * time — "The UPS account is not yet registered" — which lands after the
 * label button has already been pressed on a real order.
 *
 * Shippo's own data cannot be used to tell the two apart: every carrier
 * account on this token reports `active: true`, the unregistered UPS ones
 * included. So the list is ours to keep, and it is deliberately a list of what
 * has been *proven* to buy rather than what has been offered.
 *
 * USPS is the default because it is what Shippo quotes for a 2-3 lb parcel
 * inside Washington, and what the tracking side of this file was built
 * against. Add a carrier here only once a label has actually been bought from
 * it.
 */
const PURCHASABLE = (process.env.SHIPPO_CARRIERS ?? 'usps')
  .split(',')
  .map((c) => c.trim().toLowerCase())
  .filter(Boolean);

/** Rates we could actually buy, cheapest first. */
export function buyableRates(rates: ShippoRate[]): ShippoRate[] {
  return rates
    .filter((r) => PURCHASABLE.includes(r.provider.toLowerCase()))
    .sort((a, b) => Number(a.amount) - Number(b.amount));
}

/** What was quoted but cannot be bought, for an error worth reading. */
export function unbuyableCarriers(rates: ShippoRate[]): string[] {
  return [
    ...new Set(
      rates
        .filter((r) => !PURCHASABLE.includes(r.provider.toLowerCase()))
        .map((r) => r.provider),
    ),
  ];
}

export type ShippoShipment = {
  object_id: string;
  status: string;
  rates: ShippoRate[];
  messages?: Array<{ source: string; text: string }>;
};

/** Quotes rates for a shipment. Costs nothing and buys nothing — a shipment
 *  is just Shippo's record of "these two addresses, this parcel." */
export function createShipment(
  addressTo: ShippoAddress,
  parcel: ReturnType<typeof parcelForLines>,
): Promise<ShippoShipment> {
  return shippo('/shipments/', {
    method: 'POST',
    body: JSON.stringify({
      address_from: MISTBOX_ORIGIN,
      address_to: addressTo,
      parcels: [parcel],
      async: false,
    }),
  });
}

export type ShippoTransaction = {
  object_id: string;
  status: 'SUCCESS' | 'ERROR' | 'QUEUED' | 'WAITING';
  tracking_number: string | null;
  label_url: string | null;
  tracking_url_provider: string | null;
  messages?: Array<{ source: string; text: string }>;
};

/**
 * The actual purchase. Real money in live mode, the moment this resolves —
 * see the file header. `rateId` must come from a shipment's own quoted rates,
 * shown to and picked by a person first.
 */
export function purchaseLabel(rateId: string): Promise<ShippoTransaction> {
  return shippo('/transactions/', {
    method: 'POST',
    body: JSON.stringify({ rate: rateId, label_file_type: 'PDF_4x6', async: false }),
  });
}

/**
 * Re-fetches a transaction already bought — the label's own S3 URL again,
 * fresh, rather than trusting one saved earlier. Used by the admin's "View
 * label" link so it never depends on a link that might have aged out.
 */
export function getTransaction(transactionId: string): Promise<ShippoTransaction> {
  return shippo(`/transactions/${encodeURIComponent(transactionId)}`);
}
