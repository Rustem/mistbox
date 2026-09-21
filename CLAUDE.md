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
- **SSH to the deploy boxes**: use `vmssh` (`ops/vmssh`, put its directory on
  `PATH`) instead of raw `ssh`. An agent holding several keys can exhaust
  `MaxAuthTries` before ever offering the right one, and the error
  ("Permission denied (publickey)") gives no hint that's what happened.
  `vmssh` sidesteps it entirely by fetching the deploy key fresh from
  1Password and connecting with `-o IdentitiesOnly=yes`.

## Debugging "admin did X, customer never saw Y"

Every order-lifecycle effect here follows the same shape: **a Saleor event →
one webhook → a Next.js route → several independent, failure-isolated side
effects, each logged with its own outcome.** (`storefront/src/app/api/saleor/webhook/route.ts`
is the reference example: one incoming event fans out to a metadata-stage
advance, a Shippo registration, and a customer email — any one of the three
can fail without blocking the other two.) That shape is *why* this class of
bug is fast to diagnose once you know where to look, rather than a mystery.
Worked example: [Sept 2026] a customer never got their "shipped" email even
though the admin dashboard showed tracking added — root cause was a stale
webhook secret (below).

1. **Name the Saleor event that should have fired.** The admin action (add
   tracking, confirm an order, etc.) corresponds to a specific async event
   Saleor emits — check `tools/register-webhooks.mjs` for what's actually
   subscribed. If you can't name the event, you don't yet know which webhook
   route to even look at.

2. **Grep the storefront logs for `[mistbox]`, scoped to that route.**
   `vmssh deploy 'cd ~/code/mistbox && docker compose -f docker-compose.yml -f docker-compose.qa.yml logs storefront --since 24h | grep "mistbox\]"'`
   Every side effect in this codebase logs its own success or failure with a
   specific, literal reason — trust that line before hypothesizing further.
   `SHIPPO REGISTRATION FAILED: ...`, `SHIPPED EMAIL NOT SENT: ...`, and
   `saleor webhook rejected: ...` are not generic errors; they name exactly
   which step failed and why.

3. **Nothing in the logs at all?** The webhook likely never left Saleor.
   Check it's actually registered and active:
   `{ app { webhooks { id name targetUrl isActive } } }` via the app token —
   not the top-level `webhooks` query, which returns an empty list rather than
   an error for an app token and will make a real registration look missing.

4. **Something arrived but got rejected?** For a secret-based check
   (`X-Mistbox-Webhook-Secret` and similar), Saleor never lets you read a
   webhook's configured secret back out — you can't diff it against 1Password.
   The only fix is to delete and recreate the webhook with the current secret
   value. This happens because some registration scripts (`register-webhooks.mjs`)
   read credentials from a local file, not from the environment's own
   1Password item — if that local file's value ever drifts from what's
   actually deployed, the two silently disagree forever, with no error until
   something tries to use it.

5. **Check the order's own state, not just Saleor's.** `mistbox_stage` /
   `mistbox_history` in order metadata is this app's own record of how far
   processing actually got — compare it against what Saleor's native fields
   show (fulfillment present, tracking present). A mismatch (Saleor looks
   done, our stage is one step behind) tells you precisely which side effect
   never ran.

6. **Once the root cause is fixed, it's usually safe to replay the missed
   event by hand** — POST the same payload directly to the webhook route with
   the correct secret — rather than asking the admin to redo the original
   action. Check the idempotency guard first (here, a `shippoRegistered`
   metadata flag) so a replay can't double-fire a side effect that isn't safe
   to repeat (Shippo tracking registration is not idempotent; a duplicate
   registration cannot be undone).

## Local dev

`docker compose -f docker-compose.yml -f docker-compose.dev.yml up`. Only
`docker-compose.dev.yml` republishes ports — never add it to a remote
environment's compose invocation, it would reopen ports that box deliberately
keeps closed.
