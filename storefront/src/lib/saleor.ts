/**
 * Minimal Saleor GraphQL client. No codegen, no Apollo — one fetch wrapper.
 *
 * `saleorFetch`      — anonymous, safe for public catalog reads.
 * `saleorFetchAuthed` — uses SALEOR_APP_TOKEN. Server-only: never import
 *                       this into a Client Component.
 */

const PUBLIC_URL =
  process.env.NEXT_PUBLIC_SALEOR_API_URL ?? 'http://localhost:8000/graphql/';
const SERVER_URL = process.env.SALEOR_API_URL ?? PUBLIC_URL;

export const CHANNEL = process.env.NEXT_PUBLIC_SALEOR_CHANNEL ?? 'mistbox-us';

/**
 * The Saleor dashboard — a *different service on a different port* from the
 * API, not a path under it. Deriving it from `NEXT_PUBLIC_SALEOR_API_URL` gives
 * `localhost:8000/dashboard/...`, which is Django, which 404s.
 *
 * `NEXT_PUBLIC_` because the admin order list is a client component and links
 * into the dashboard from there. The default matches `docker-compose.yml`
 * (`dashboard` publishes 9000), so local dev needs no configuration.
 */
const DASHBOARD = (
  process.env.NEXT_PUBLIC_SALEOR_DASHBOARD_URL ?? 'http://localhost:9000'
).replace(/\/$/, '');

/** Deep link to a record in the Saleor dashboard. Ids are the base64 global
 *  ids Saleor hands out, which is exactly what the dashboard's routes take. */
export const dashboardLink = (kind: 'products' | 'orders', id: string): string =>
  `${DASHBOARD}/${kind}/${encodeURIComponent(id)}`;

export class SaleorError extends Error {
  constructor(message: string, readonly detail?: unknown) {
    super(message);
    this.name = 'SaleorError';
  }
}

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

async function request<T>(
  url: string,
  query: string,
  variables: Record<string, unknown>,
  headers: Record<string, string>,
  revalidate: number | false,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ query, variables }),
    next: revalidate === false ? { revalidate: 0 } : { revalidate },
  });

  if (!res.ok) {
    throw new SaleorError(`Saleor returned HTTP ${res.status}`, await res.text());
  }

  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new SaleorError(json.errors.map((e) => e.message).join('; '), json.errors);
  }
  if (!json.data) throw new SaleorError('Saleor returned no data');
  return json.data;
}

/** Anonymous read. Cached for `revalidate` seconds (default 60). */
export function saleorFetch<T>(
  query: string,
  variables: Record<string, unknown> = {},
  revalidate: number | false = 60,
): Promise<T> {
  return request<T>(SERVER_URL, query, variables, {}, revalidate);
}

/** Authenticated as the Mistbox app. Server-only, never cached. */
export function saleorFetchAuthed<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const token = process.env.SALEOR_APP_TOKEN;
  if (!token) {
    throw new SaleorError(
      'SALEOR_APP_TOKEN is not set. Create an app in the Saleor Dashboard ' +
        '(Configuration -> Webhooks & Events) with "Manage orders" and ' +
        '"Handle payments" permissions, then put its token in .env.local.',
    );
  }
  return request<T>(SERVER_URL, query, variables, { Authorization: `Bearer ${token}` }, false);
}

/** Saleor returns errors inside the payload, not just at the top level. */
export function assertNoUserErrors(
  errors: Array<{ field?: string | null; message?: string | null; code?: string }> | undefined,
  context: string,
): void {
  if (errors && errors.length > 0) {
    const detail = errors
      .map((e) => [e.field, e.code, e.message].filter(Boolean).join(': '))
      .join(' | ');
    throw new SaleorError(`${context} failed — ${detail}`, errors);
  }
}

export function formatMoney(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

/** The deployed site's own URL, with no trailing slash — every caller that
 *  builds a link (an email, a redirect, a Stripe success URL) needs exactly
 *  this, so it lives in one place rather than being retyped at each site. */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

/** `${firstName} ${lastName}`, trimmed — an address or account's display
 *  name, wherever one of either shape shows up. */
export function fullName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`.trim();
}
