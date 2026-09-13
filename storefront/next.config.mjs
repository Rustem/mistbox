/** @type {import('next').NextConfig} */

// Next 16 refuses to optimise images whose host resolves to a private IP, as
// SSRF protection. In local development Saleor genuinely is on localhost, so
// the product photos 400 without an exception — but the exception should
// follow the actual upstream, not the build mode: `next build && next start`
// against a local Saleor is still local. Point SALEOR_API_URL at a real host
// and the protection comes back on by itself.
const saleorUrl =
  process.env.SALEOR_API_URL ??
  process.env.NEXT_PUBLIC_SALEOR_API_URL ??
  'http://localhost:8000/graphql/';

const saleorIsLocal = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i.test(
  (() => {
    try {
      return new URL(saleorUrl).hostname;
    } catch {
      return '';
    }
  })(),
);

const nextConfig = {
  /**
   * Who may put this site in an iframe.
   *
   * Until this was added nothing set `frame-ancestors` or `X-Frame-Options` at
   * all, so every page — `/admin` included — could be framed by anyone. The
   * default is now `'none'`, and the single exception is `/embed`, which
   * exists to be rendered inside the Saleor dashboard.
   *
   * Order matters: for the same path and header key Next keeps the *last*
   * rule, so the narrow `/embed` rule has to come second.
   *
   * `/embed` is a subtree rather than one page inside `/admin` on purpose.
   * "Everything under /embed is framed, nothing else is" survives someone
   * adding a page later; "one particular admin page is an exception" does not.
   *
   * Not `middleware.ts`: that convention is deprecated and renamed to
   * `proxy.ts` in Next 16, so a middleware file would be silently ignored and
   * the site would stay framable while looking fixed.
   */
  async headers() {
    const dashboard = (
      process.env.NEXT_PUBLIC_SALEOR_DASHBOARD_URL ?? 'http://localhost:9000'
    ).replace(/\/$/, '');
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }],
      },
      {
        source: '/embed/:path*',
        headers: [{ key: 'Content-Security-Policy', value: `frame-ancestors ${dashboard}` }],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost', port: '8000' },
      { protocol: 'https', hostname: '**' },
    ],
    // Next 16 defaults this to 4 hours. The pages themselves revalidate every
    // 60s, so leaving it would mean a product photo swapped in the dashboard
    // lagged hours behind the text that changed with it.
    minimumCacheTTL: 60,
    dangerouslyAllowLocalIP: saleorIsLocal,
  },
};

export default nextConfig;
