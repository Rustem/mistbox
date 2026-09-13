import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/adminAuth';
import { getOrderAuthed } from '@/lib/orders';
import { META, readMeta } from '@/lib/orderStatus';
import {
  buyableRates,
  createShipment,
  parcelForLines,
  unbuyableCarriers,
  type ShippoAddress,
} from '@/lib/shippo';
import { fullName } from '@/lib/saleor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Quotes a real shipping rate for an order. Costs nothing and buys nothing —
 * this is Shippo's own definition of a shipment: two addresses and a parcel,
 * priced. The actual spend only happens in `../buy`, and only once a person
 * has seen the number this returns.
 */
export async function POST(request: Request) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;

  let body: { orderId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const order = await getOrderAuthed(String(body.orderId ?? '')).catch(() => null);
  if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });

  if (readMeta(order.metadata, META.labelTransactionId)) {
    return NextResponse.json({ error: 'A label has already been bought for this order.' }, { status: 409 });
  }

  const a = order.shippingAddress;
  if (!a) return NextResponse.json({ error: 'This order has no shipping address.' }, { status: 400 });

  const addressTo: ShippoAddress = {
    name: fullName(a),
    street1: a.streetAddress1,
    street2: a.streetAddress2 || undefined,
    city: a.city,
    state: a.countryArea,
    zip: a.postalCode,
    country: 'US',
  };

  const parcel = parcelForLines(order.lines);

  try {
    const shipment = await createShipment(addressTo, parcel);
    if (shipment.status !== 'SUCCESS' || shipment.rates.length === 0) {
      const detail = shipment.messages?.map((m) => m.text).join('; ');
      return NextResponse.json(
        { error: detail || 'Shippo could not quote a rate for this address.' },
        { status: 502 },
      );
    }

    // Cheapest *of the ones we can actually buy*. Quoting across every carrier
    // on the account offered a UPS rate that failed at purchase time, after
    // the button had been pressed on a real order.
    const buyable = buyableRates(shipment.rates);
    if (buyable.length === 0) {
      const offered = unbuyableCarriers(shipment.rates);
      return NextResponse.json(
        {
          error: offered.length
            ? `No label can be bought for this address. Shippo quoted ${offered.join(', ')}, none of which is set up on the Mistbox account.`
            : 'Shippo quoted no rates we can buy for this address.',
        },
        { status: 502 },
      );
    }

    const cheapest = buyable[0];
    return NextResponse.json({
      rate: {
        id: cheapest.object_id,
        provider: cheapest.provider,
        service: cheapest.servicelevel.name,
        amount: cheapest.amount,
        currency: cheapest.currency,
      },
    });
  } catch (error) {
    console.error('[mistbox] label rate quote failed:', error);
    return NextResponse.json({ error: 'Could not reach Shippo. Try again.' }, { status: 502 });
  }
}
