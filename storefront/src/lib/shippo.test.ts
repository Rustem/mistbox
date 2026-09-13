import { describe, expect, it } from 'vitest';
import { buyableRates, unbuyableCarriers, type ShippoRate } from './shippo';

const rate = (provider: string, amount: string): ShippoRate => ({
  object_id: `${provider}-${amount}`,
  provider,
  servicelevel: { name: 'Ground' },
  amount,
  currency: 'USD',
  estimated_days: 3,
});

describe('buyableRates', () => {
  it('drops a carrier we cannot buy from, even when it is the cheapest', () => {
    // Exactly the order-36 case: UPS quoted $6.43, USPS $8.44, and the UPS
    // purchase failed with "The UPS account is not yet registered".
    const kept = buyableRates([rate('UPS', '6.43'), rate('USPS', '8.44')]);
    expect(kept.map((r) => r.provider)).toEqual(['USPS']);
  });

  it('returns the buyable ones cheapest first', () => {
    const kept = buyableRates([
      rate('USPS', '32.57'),
      rate('USPS', '5.68'),
      rate('USPS', '8.44'),
    ]);
    expect(kept.map((r) => r.amount)).toEqual(['5.68', '8.44', '32.57']);
  });

  it('matches the provider whatever case Shippo sends it in', () => {
    expect(buyableRates([rate('usps', '5.68')])).toHaveLength(1);
  });

  it('is empty when nothing quoted is buyable', () => {
    expect(buyableRates([rate('UPS', '6.43'), rate('FedEx', '9.10')])).toEqual([]);
  });
});

describe('unbuyableCarriers', () => {
  it('names what was quoted but cannot be bought, once each', () => {
    expect(
      unbuyableCarriers([rate('UPS', '6.43'), rate('UPS', '7.10'), rate('USPS', '8.44')]),
    ).toEqual(['UPS']);
  });

  it('names nothing when every rate is buyable', () => {
    expect(unbuyableCarriers([rate('USPS', '5.68')])).toEqual([]);
  });
});
