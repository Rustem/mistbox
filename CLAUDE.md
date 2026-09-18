# Mistbox

Self-hosted Saleor 3.23 + Next.js 16 storefront. Full engineering docs (architecture,
environments, runbooks) live in the Mistbox Drive folder — start there for anything
beyond what's below. This file is for the sharp, easy-to-repeat mistakes.

## Deploying to a new environment (qa, and eventually prod)

Two steps, in this order, the first time any environment goes live:

1. **`ops/set-site-domain.sh <domain> "<name>"`** — every fresh Saleor install
   defaults Django's Sites-framework domain to `localhost:8000`, and nothing in a
   normal deploy touches it. Left alone, every media/thumbnail URL Saleor returns
   is absolute-but-wrong for that environment — it just happens to still resolve
   on whatever machine has something on port 8000, so it can look like it's
   working right up until a real visitor loads the page. This is not optional
   for qa or prod. Restart `api`+`worker` afterward (the script prints the
   command) — the Sites value is cached in-process.
2. **`seed/provision.sh <graphql-url> <email> <password>`** — seeds every
   product/variant, then uploads and assigns every photo (items and box tiers)
   in the one order that actually works. Idempotent; re-run any time
   `catalog.json` changes.

Self-hosted Saleor with local filesystem media storage (no S3/CDN) also needs
Caddy serving `/media/*` directly from the shared `saleor-media` volume — see
the Caddyfile's own comment on `api.<env>.mist.box`. Without it, `Product.thumbnail`
and `ProductMedia.url` 404 the moment anything's been thumbnailed once, because
Saleor's own DEBUG=False build never serves `/media/` itself. Already wired for
qa; a new prod overlay needs the same block.

## Known sharp edges

- **`ALLOWED_CLIENT_HOSTS`** wants bare hostnames, no scheme — an `https://`
  prefix makes every entry silently fail to match.
- **`RSA_PRIVATE_KEY`** must be set explicitly whenever `DEBUG=False`. Dev's
  `DEBUG=True` silently auto-generates a throwaway one, which is exactly why
  this only ever surfaces the first time a new non-dev environment boots.
- **Docker networking**: a service with no explicit `networks:` falls onto
  Compose's default network, invisible to anything explicitly on
  `saleor-backend-tier` — a service that 502s despite `docker compose ps`
  saying healthy is almost always this.
- **SSH to the deploy boxes**: use `-o IdentitiesOnly=yes -i <key>` explicitly.
  An agent holding several keys can exhaust `MaxAuthTries` before ever offering
  the right one, and the error ("Permission denied (publickey)") gives no hint
  that's what happened.

## Local dev

`docker compose -f docker-compose.yml -f docker-compose.dev.yml up`. Only
`docker-compose.dev.yml` republishes ports — never add it to a remote
environment's compose invocation, it would reopen ports that box deliberately
keeps closed.
