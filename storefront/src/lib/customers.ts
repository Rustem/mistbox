import { CUSTOMER_CREATE, FIND_USER_BY_EMAIL } from '@/lib/queries';
import { saleorFetchAuthed } from '@/lib/saleor';
import { META, readMeta, type MetadataItem } from '@/lib/orderStatus';
import type { EmailOrder } from '@/lib/email/orderConfirmation';

type ShippingAddress = NonNullable<EmailOrder['shippingAddress']>;

/**
 * Deliberately checkout-shaped, not order-shaped: this must run *before*
 * `checkoutComplete`, using the checkout's own email and address, or the
 * customer record it creates always arrives one step too late to be linked —
 * see the note on `CHECKOUT_FOR_COMPLETION`.
 */
type CheckoutForCustomerSync = {
  email: string | null;
  shippingAddress: ShippingAddress | null;
  metadata: MetadataItem[];
  /** For the log line only — a checkout id, since no order number exists yet. */
  reference: string;
};

export type ExistingUser = { id: string; isStaff: boolean };

export type FindOrCreateResult =
  | { kind: 'existing'; user: ExistingUser }
  /** `customerCreate` failed with `UNIQUE` right after a lookup miss — Saleor
   *  hides some accounts (superusers, at least) from `user(email:)` even
   *  though they exist, so this *is* "already there," just surfaced a
   *  different way. */
  | { kind: 'hidden' }
  | { kind: 'created' }
  | { kind: 'failed'; message: string };

/**
 * Look up a Saleor customer by email, creating one if the lookup finds
 * nothing — and folding Saleor's own lie about that lookup into the result
 * rather than making every caller rediscover it.
 *
 * `user(email:)` hides superuser accounts from a non-superuser caller even
 * though they exist. Left alone, that turns into a `customerCreate` call
 * that fails because the email really is taken — which every caller needs to
 * recognise as "an account is already there," not as a real failure. This is
 * the one place that fact is known, so it is the one place that handles it.
 */
export async function findOrCreateCustomer(
  email: string,
  input: Record<string, unknown>,
): Promise<FindOrCreateResult> {
  const existing = await saleorFetchAuthed<{ user: ExistingUser | null }>(FIND_USER_BY_EMAIL, {
    email,
  });
  if (existing.user) return { kind: 'existing', user: existing.user };

  const created = await saleorFetchAuthed<{
    customerCreate: { errors: Array<{ message: string | null; code: string | null }> };
  }>(CUSTOMER_CREATE, { input: { email, ...input } });

  const errors = created.customerCreate.errors;
  if (!errors.length) return { kind: 'created' };
  if (errors.some((e) => e.code === 'UNIQUE')) return { kind: 'hidden' };
  return { kind: 'failed', message: errors.map((e) => e.message).join('; ') };
}

/**
 * Give every order a real entry in Saleor's own Customers screen, without the
 * buyer ever creating an account.
 *
 * Mistbox's checkout is deliberately guest-only — no login, no password, no
 * friction on a gift purchase. Saleor's Customers view, though, only lists
 * registered accounts: a guest checkout leaves nothing there to search, filter
 * by order count, or attach a note to, even though the order itself already
 * holds the email, name and address permanently.
 *
 * The fix doesn't touch checkout at all. `customerCreate` accepts no password
 * and sends nothing unless a `redirectUrl` is passed — omitted here on
 * purpose — so the record it creates cannot be logged into and the buyer is
 * never notified. It exists purely so Saleor's own tooling has something to
 * show. Saleor already links an order to a matching account by email (seen
 * happen automatically once a customer record exists), so nothing else here
 * needs to touch the order.
 *
 * Never throws: this runs after the order already exists and the customer has
 * already paid, so a failure here must cost nothing more than a missing
 * Customers-tab entry — never a retried webhook or a second charge.
 */
export async function ensureCustomerRecord(checkout: CheckoutForCustomerSync): Promise<void> {
  try {
    const email = checkout.email?.trim();
    if (!email) return;

    const a = checkout.shippingAddress;
    const optedIn = readMeta(checkout.metadata, META.newsletterOptIn) === 'true';

    const result = await findOrCreateCustomer(email, {
      firstName: a?.firstName ?? '',
      lastName: a?.lastName ?? '',
      // No redirectUrl: this is the line that keeps the record invisible to
      // the buyer. Passing one would email them a "set your password" link
      // for an account they never asked for.
      defaultShippingAddress: a
        ? {
            firstName: a.firstName,
            lastName: a.lastName,
            streetAddress1: a.streetAddress1,
            streetAddress2: a.streetAddress2 || undefined,
            city: a.city,
            countryArea: a.countryArea,
            postalCode: a.postalCode,
            country: 'US',
          }
        : undefined,
      metadata: [{ key: META.newsletterOptIn, value: String(optedIn) }],
    });

    // An account already there — a repeat buyer, a staff account sharing an
    // email, or one Saleor's own lookup hid from us — is left exactly as it
    // is either way: this only ever fills in a gap, never edits a record
    // that already exists.
    if (result.kind === 'existing' || result.kind === 'hidden') return;

    if (result.kind === 'failed') {
      console.warn(`[mistbox] customer record not created for ${email}:`, result.message);
      return;
    }

    console.log(`[mistbox] customer record created for ${email} (${checkout.reference})`);
  } catch (error) {
    console.warn(
      `[mistbox] customer sync failed for ${checkout.reference}:`,
      error instanceof Error ? error.message : error,
    );
  }
}
