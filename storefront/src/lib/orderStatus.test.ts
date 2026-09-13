import { describe, expect, it } from 'vitest';
import {
  META,
  STAGES,
  appendHistory,
  carrierName,
  carrierTrackingUrl,
  currentStage,
  historyMap,
  inferCarrier,
  isAdvance,
  isException,
  nextManualStage,
  readHistory,
  readMeta,
  stageForCarrierStatus,
  stageIndex,
} from './orderStatus';

describe('isAdvance', () => {
  it('allows moving to a later stage', () => {
    expect(isAdvance('packing', 'sealed')).toBe(true);
  });

  it('refuses to move to an earlier stage', () => {
    // The real case: a TRANSIT scan arriving after an out-for-delivery one,
    // or the same webhook delivered twice. The timeline must never walk
    // backwards in front of the customer.
    expect(isAdvance('delivered', 'in_transit')).toBe(false);
  });

  it('refuses to stay on the same stage', () => {
    expect(isAdvance('sealed', 'sealed')).toBe(false);
  });

  it('treats null as before every real stage', () => {
    expect(isAdvance(null, 'confirmed')).toBe(true);
  });
});

describe('stageForCarrierStatus', () => {
  it('maps PRE_TRANSIT to shipped, not a stage of its own', () => {
    // Deliberate: "a label exists" and "it is on its way" are the same news
    // to the buyer, and a separate row would be honest but useless.
    expect(stageForCarrierStatus('PRE_TRANSIT')).toBe('shipped');
  });

  it('maps TRANSIT and DELIVERED to their matching stages', () => {
    expect(stageForCarrierStatus('TRANSIT')).toBe('in_transit');
    expect(stageForCarrierStatus('DELIVERED')).toBe('delivered');
  });

  it('is case-insensitive, since carriers are not consistent about it', () => {
    expect(stageForCarrierStatus('transit')).toBe('in_transit');
  });

  it('maps exceptions and unknowns to no stage at all', () => {
    expect(stageForCarrierStatus('RETURNED')).toBeNull();
    expect(stageForCarrierStatus('FAILURE')).toBeNull();
    expect(stageForCarrierStatus('UNKNOWN')).toBeNull();
    expect(stageForCarrierStatus('SOMETHING_NEW_SHIPPO_ADDS_LATER')).toBeNull();
  });
});

describe('isException', () => {
  it('flags RETURNED and FAILURE', () => {
    expect(isException('RETURNED')).toBe(true);
    expect(isException('FAILURE')).toBe(true);
  });

  it('does not flag ordinary progress', () => {
    expect(isException('TRANSIT')).toBe(false);
    expect(isException('DELIVERED')).toBe(false);
  });
});

describe('nextManualStage', () => {
  it('offers the first manual stage from the start', () => {
    expect(nextManualStage(null)).toBe('packing');
    expect(nextManualStage('confirmed')).toBe('packing');
  });

  it('walks through packing, card_written, sealed in order', () => {
    expect(nextManualStage('packing')).toBe('card_written');
    expect(nextManualStage('card_written')).toBe('sealed');
  });

  it('returns null once every manual stage is done', () => {
    // sealed is the last manual stage — everything after is automatic.
    expect(nextManualStage('sealed')).toBeNull();
    expect(nextManualStage('shipped')).toBeNull();
    expect(nextManualStage('delivered')).toBeNull();
  });
});

describe('inferCarrier', () => {
  it('recognises a UPS tracking number', () => {
    expect(inferCarrier('1Z999AA10123456784')).toBe('ups');
  });

  it('recognises a FedEx 12-digit number', () => {
    expect(inferCarrier('123456789012')).toBe('fedex');
  });

  it('defaults to USPS for anything else, including Shippo test values', () => {
    // Guessing wrong towards USPS fails safely — Shippo just reports UNKNOWN —
    // so the fallback is deliberate, not an oversight.
    expect(inferCarrier('SHIPPO_TRANSIT')).toBe('usps');
    expect(inferCarrier('9405511899223197428492')).toBe('usps');
  });

  it('ignores whitespace and case the way a pasted number often has', () => {
    expect(inferCarrier(' 1z999aa10123456784 ')).toBe('ups');
  });
});

describe('carrierTrackingUrl', () => {
  it('strips spaces from a pasted tracking number', () => {
    expect(carrierTrackingUrl('usps', '9405 5118 9922 3197 4284 92')).toBe(
      'https://tools.usps.com/go/TrackConfirmAction?tLabels=9405511899223197428492',
    );
  });

  it('builds the right URL per carrier', () => {
    expect(carrierTrackingUrl('ups', '1Z999AA10123456784')).toContain('ups.com/track');
    expect(carrierTrackingUrl('fedex', '123456789012')).toContain('fedex.com/fedextrack');
  });

  it('falls back to USPS for an unrecognised carrier string', () => {
    expect(carrierTrackingUrl('dhl', 'ABC123')).toContain('usps.com');
  });
});

describe('carrierName', () => {
  it('gives the real names for the three known carriers', () => {
    expect(carrierName('usps')).toBe('USPS');
    expect(carrierName('ups')).toBe('UPS');
    expect(carrierName('fedex')).toBe('FedEx');
  });

  it('uppercases anything unrecognised rather than failing', () => {
    expect(carrierName('dhl')).toBe('DHL');
  });
});

describe('readMeta / currentStage', () => {
  it('reads a value by key, or an empty string if absent', () => {
    const meta = [{ key: 'foo', value: 'bar' }];
    expect(readMeta(meta, 'foo')).toBe('bar');
    expect(readMeta(meta, 'missing')).toBe('');
    expect(readMeta(undefined, 'foo')).toBe('');
  });

  it('defaults to confirmed for missing or garbage stage metadata', () => {
    expect(currentStage(undefined)).toBe('confirmed');
    expect(currentStage([{ key: META.stage, value: 'not_a_real_stage' }])).toBe('confirmed');
  });

  it('reads back a real stage that was actually stored', () => {
    expect(currentStage([{ key: META.stage, value: 'sealed' }])).toBe('sealed');
  });
});

describe('history', () => {
  it('starts empty and grows one entry per stage', () => {
    let history = readHistory(undefined);
    expect(history).toEqual([]);

    history = appendHistory(history, 'packing', '2026-01-01T00:00:00.000Z');
    history = appendHistory(history, 'sealed', '2026-01-02T00:00:00.000Z');
    expect(history).toEqual([
      { s: 'packing', at: '2026-01-01T00:00:00.000Z' },
      { s: 'sealed', at: '2026-01-02T00:00:00.000Z' },
    ]);
  });

  it('keeps the first time a stage was reached, not the latest', () => {
    // A duplicate webhook delivery must not overwrite real history with a
    // later, wrong timestamp for a stage that already happened.
    let history = appendHistory([], 'shipped', '2026-01-01T00:00:00.000Z');
    history = appendHistory(history, 'shipped', '2026-01-05T00:00:00.000Z');
    expect(history).toEqual([{ s: 'shipped', at: '2026-01-01T00:00:00.000Z' }]);
  });

  it('never throws on malformed metadata, and reads back nothing', () => {
    expect(readHistory([{ key: META.history, value: 'not json at all' }])).toEqual([]);
    expect(readHistory([{ key: META.history, value: '{"not":"an array"}' }])).toEqual([]);
    expect(readHistory([{ key: META.history, value: '[1, 2, "garbage"]' }])).toEqual([]);
  });

  it('builds a stage-to-timestamp map from the history', () => {
    const meta = [
      {
        key: META.history,
        value: JSON.stringify([
          { s: 'packing', at: '2026-01-01T00:00:00.000Z' },
          { s: 'shipped', at: '2026-01-03T00:00:00.000Z' },
        ]),
      },
    ];
    expect(historyMap(meta)).toEqual({
      packing: '2026-01-01T00:00:00.000Z',
      shipped: '2026-01-03T00:00:00.000Z',
    });
  });
});

describe('stageIndex', () => {
  it('orders every stage consistently with STAGES', () => {
    for (let i = 0; i < STAGES.length; i++) {
      expect(stageIndex(STAGES[i])).toBe(i);
    }
  });

  it('treats null as before the first stage', () => {
    expect(stageIndex(null)).toBeLessThan(stageIndex('confirmed'));
  });
});
