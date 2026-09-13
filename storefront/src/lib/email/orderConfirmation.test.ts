import { describe, expect, it } from 'vitest';
import { orderConfirmation, orderConfirmationText, type EmailOrder } from './orderConfirmation';

/** A realistic paid order — the Grand box, one gift message, a real address. */
function makeOrder(overrides: Partial<EmailOrder> = {}): EmailOrder {
  return {
    number: '21',
    created: '2026-09-06T00:00:00.000Z',
    userEmail: 'buyer@example.com',
    total: { gross: { amount: 160, currency: 'USD' } },
    subtotal: { gross: { amount: 148 } },
    shippingPrice: { gross: { amount: 12 } },
    shippingMethodName: 'Standard delivery',
    lines: [
      {
        id: 'line-1',
        quantity: 1,
        productName: 'The Mistbox, Grand',
        variant: { id: 'variant-1' },
        totalPrice: { gross: { amount: 148 } },
      },
    ],
    shippingAddress: {
      firstName: 'Priya',
      lastName: 'Shah',
      streetAddress1: '400 Broad St',
      streetAddress2: null,
      city: 'Seattle',
      countryArea: 'WA',
      postalCode: '98109',
    },
    metadata: [],
    ...overrides,
  };
}

describe('orderConfirmation (HTML)', () => {
  it('shows the order number, total, and product name', () => {
    const html = orderConfirmation(makeOrder());
    expect(html).toContain('Order 21');
    expect(html).toContain('$160.00');
    expect(html).toContain('The Mistbox, Grand');
  });

  it('shows "Included" for free delivery rather than "$0.00"', () => {
    // This is the exact bug a receipt should never have: $0.00 reads like a
    // mistake, "Included" reads like a decision.
    const html = orderConfirmation(makeOrder({ shippingPrice: { gross: { amount: 0 } } }));
    expect(html).toContain('Included');
    expect(html).not.toContain('$0.00');
  });

  it('shows the real delivery charge when it is not free', () => {
    const html = orderConfirmation(makeOrder());
    expect(html).toContain('$12.00');
  });

  it('shows a quantity suffix only when more than one box was ordered', () => {
    const single = orderConfirmation(makeOrder());
    expect(single).not.toContain('&times;');

    const multiple = orderConfirmation(
      makeOrder({
        lines: [
          {
            id: 'line-1',
            quantity: 2,
            productName: 'The Mistbox, Grand',
            variant: { id: 'variant-1' },
            totalPrice: { gross: { amount: 296 } },
          },
        ],
      }),
    );
    expect(multiple).toContain('&times;');
    expect(multiple).toContain('2');
  });

  it('renders the gift message when present, and escapes it', () => {
    const html = orderConfirmation(
      makeOrder({ metadata: [{ key: 'gift_message', value: 'Happy <b>birthday</b>!' }] }),
    );
    expect(html).toContain('Written on your card');
    // The literal tag must never reach the email as real markup — it is
    // free-text a stranger typed into a web form.
    expect(html).toContain('Happy &lt;b&gt;birthday&lt;/b&gt;!');
    expect(html).not.toContain('Happy <b>birthday</b>!');
  });

  it('omits the gift-message section entirely when there is none', () => {
    const html = orderConfirmation(makeOrder());
    expect(html).not.toContain('Written on your card');
  });

  it('escapes a hostile shipping name rather than injecting it as markup', () => {
    const html = orderConfirmation(
      makeOrder({
        shippingAddress: {
          firstName: '<img src=x onerror=alert(1)>',
          lastName: 'Shah',
          streetAddress1: '400 Broad St',
          city: 'Seattle',
          countryArea: 'WA',
          postalCode: '98109',
        },
      }),
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('renders the address block only when an address exists', () => {
    expect(orderConfirmation(makeOrder())).toContain('Delivering to');
    expect(orderConfirmation(makeOrder({ shippingAddress: null }))).not.toContain('Delivering to');
  });

  it('shows the second address line only when one was given', () => {
    const withLine2 = orderConfirmation(
      makeOrder({
        shippingAddress: {
          firstName: 'Priya',
          lastName: 'Shah',
          streetAddress1: '400 Broad St',
          streetAddress2: 'Apt 4B',
          city: 'Seattle',
          countryArea: 'WA',
          postalCode: '98109',
        },
      }),
    );
    expect(withLine2).toContain('Apt 4B');
  });

  it('says who it was sent to and why, for the footer note', () => {
    const html = orderConfirmation(makeOrder({ userEmail: 'someone@mist.box' }));
    expect(html).toContain('someone@mist.box');
  });
});

describe('orderConfirmation (plain text)', () => {
  it('contains the essentials without any HTML', () => {
    const text = orderConfirmationText(makeOrder());
    expect(text).toContain('Order 21');
    expect(text).toContain('TOTAL');
    expect(text).toContain('$160.00');
    expect(text).not.toContain('<');
  });

  it('includes the gift message in quotes, unescaped — this is plain text', () => {
    const text = orderConfirmationText(
      makeOrder({ metadata: [{ key: 'gift_message', value: 'Happy birthday!' }] }),
    );
    expect(text).toContain('"Happy birthday!"');
  });

  it('omits the address block when there is no address', () => {
    const text = orderConfirmationText(makeOrder({ shippingAddress: null }));
    expect(text).not.toContain('DELIVERING TO');
  });
});

describe('an itemised box', () => {
  /** What a real box looks like: the carton priced, and everything that went
   *  in it priced too. A box is worth the sum of its parts. */
  const CONTENTS: Array<[string, number]> = [
    ['Cascade black tea, 50 g tin', 15],
    ['Dark chocolate with alder-smoked salt, 3 oz', 9],
    ['Wildflower honey, 4 oz', 10],
    ['Hand-dyed tea towel, pale sage', 17],
    ['Douglas fir soy candle, 4 oz', 21],
  ];

  const itemised = () =>
    makeOrder({
      total: { gross: { amount: 99, currency: 'USD' } },
      subtotal: { gross: { amount: 87 } },
      lines: [
        {
          id: 'l0',
          quantity: 1,
          productName: 'The Mistbox',
          variant: { id: 'v0' },
          totalPrice: { gross: { amount: 15 } },
        },
        ...CONTENTS.map(([productName, amount], i) => ({
          id: `l${i + 1}`,
          quantity: 1,
          productName,
          variant: { id: `v${i + 1}` },
          totalPrice: { gross: { amount } },
        })),
      ],
    });

  it('prices every item inside as well as the carton', () => {
    const html = orderConfirmation(itemised());
    expect(html).toContain('Cascade black tea, 50 g tin');
    expect(html).toContain('Douglas fir soy candle, 4 oz');
    expect(html).toContain('$21.00');
    // A line that priced out at zero is a seeding fault, not a free gift.
    expect(html).not.toContain('$0.00');
  });

  it('still shows the carton price, subtotal and total', () => {
    const html = orderConfirmation(itemised());
    expect(html).toContain('$15.00');
    expect(html).toContain('$87.00');
    expect(html).toContain('$99.00');
  });

  it('does the same in the plain-text alternative', () => {
    const text = orderConfirmationText(itemised());
    expect(text).toMatch(/The Mistbox\s+\$15\.00/);
    expect(text).toMatch(/Cascade black tea, 50 g tin\s+\$15\.00/);
    expect(text).not.toContain('$0.00');
  });

  it('leaves a pre-builder order — one priced line, nothing inside — unchanged', () => {
    const html = orderConfirmation(makeOrder());
    expect(html).toContain('The Mistbox, Grand');
    expect(html).toContain('$148.00');
  });
});

describe('the Mist Bird', () => {
  it('signs the email in both the hero band and the sign-off', () => {
    const html = orderConfirmation(makeOrder(), {
      birdSrc: 'https://mist.box/bird-climb.png',
      birdSignSrc: 'https://mist.box/bird-sign.png',
    });
    expect(html).toContain('bird-climb.png');
    expect(html).toContain('bird-sign.png');
    expect(html).toContain('Packed with care,');
    expect(html).toContain('the Mist Bird');
  });

  it('keeps the headline as live text, so a blocked image still reads', () => {
    const html = orderConfirmation(makeOrder(), { birdSrc: 'https://mist.box/bird-climb.png' });
    // The headline must be in the markup, not baked into the hero artwork.
    expect(html).toContain('Your box is confirmed.');
    expect(html).toContain('alt=""'); // the bird is decorative, never the message
  });

  it('signs the plain-text alternative too, where no mark can travel', () => {
    const text = orderConfirmationText(makeOrder());
    expect(text).toContain('Packed with care,');
    expect(text).toContain('the Mist Bird');
    expect(text).not.toContain('<');
  });

  it('falls back to the old masthead when no bird is supplied', () => {
    const html = orderConfirmation(makeOrder());
    // The gold hairline under the wordmark is the tell: it belongs to the
    // birdless masthead, and the hero band replaces it.
    expect(html).toContain('width:52px;background:#c6a462');
    expect(html).not.toContain('bird-');
  });
});
