# Mistbox store

Self-hosted [Saleor](https://github.com/saleor/saleor) (Python/Django, BSD-3) as the
commerce backend, with a Next.js storefront in front of it. Inventory, orders and
customers live in the Saleor dashboard; the storefront is a landing page and an
order form that hands payment to Stripe.

```
mistbox/
├── docker-compose.yml     Saleor 3.23 (+ rules plugin), custom dashboard, Postgres, Valkey, worker, Mailpit
├── Dockerfile.saleor      Saleor image + saleor-plugin/  (enforces box rules at save time)
├── Dockerfile.dashboard   dashboard image + dashboard/   (shows a refused save's real reason)
├── saleor/                env files for the containers (dev placeholders only)
├── saleor-plugin/         Django plugin — refuses a box that breaks Mistbox's rules
├── dashboard/             injected script that surfaces the real refusal reason
├── env/                   op run templates (op:// references only, no secrets)
├── seed/                  one-shot script that creates the channel, delivery and boxes
├── storefront/            Next.js 16 app — landing page, order form, Stripe handoff
└── tools/                 validates every GraphQL document against Saleor's schema
```

---

## 1. Prerequisites

* **Docker Desktop** — <https://www.docker.com/products/docker-desktop>.
  In *Settings → Resources*, give it **at least 5 GB of memory**. Saleor will not
  start reliably below that on Apple Silicon.
* **Node 20+** and npm (you already have these).
* **Python 3.10+** for the seed script (macOS ships with 3.9; `brew install python`
  if `python3 -V` says 3.9).

## 2. Start Saleor

```bash
cd ~/code/mistbox

docker compose build                                       # Saleor + dashboard custom images
docker compose pull                                        # Postgres, Valkey, Mailpit (~2 GB, once)
docker compose run --rm api python3 manage.py migrate       # builds the database
docker compose run --rm api python3 manage.py createsuperuser
docker compose up -d
```

> **`api` and `dashboard` are built here, not pulled.** `api` bundles
> `saleor-plugin/` (refuses rule-breaking boxes at save time) and `dashboard`
> bundles the script in `dashboard/` (shows the real refusal reason). Rebuild
> either with `docker compose build api` / `docker compose build dashboard`.

Give it a minute on first boot, then:

| | |
|---|---|
| Dashboard | <http://localhost:9000> |
| GraphQL playground | <http://localhost:8000/graphql/> |
| Sent email (Mailpit) | <http://localhost:8025> |

Log into the dashboard with the superuser you just created.

> **Do not skip `migrate`.** Without it the API starts but every request 500s.

## 3. Seed the catalogue

```bash
cd seed
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python seed.py --email you@example.com --password 'your-password'
```

This creates the `mistbox-us` channel, a Seattle warehouse, a US delivery zone
with a $12 flat rate (free over $150), every individual item as its own tracked
SKU, and the two boxes:

| Box | SKU | Retail | Slots | COGS | Gross | Stock |
|---|---|---|---|---|---|---|
| The Mistbox | `MB-SIG-01` | $88 | 5 | $38.80 | 55.9% | 100 |
| The Mistbox, Grand | `MB-GRA-01` | $148 | 8 | $66.10 | 55.3% | 100 |

**A box SKU is the empty carton.** Its stock is cartons on the shelf — which is
what `seed/inventory-ledger.csv` has always recorded — its weight is the tare,
and its cost price is packaging only. What goes *inside* is tracked separately:

| | |
|---|---|
| Items | one Saleor product per thing that goes in a box, in the `Box item` product type and `Box items` category |
| Stock | real per-item stock, decremented when a box sells, because every item is its own order line |
| Price | `0.00` — items are never sold alone, so a retail price on one would be fiction. The box tier carries the price |
| Visibility | published so checkout can use them, `visibleInListings: false` so they never appear in the shop |
| Weight | a real per-item weight on the variant; summing every line on an order gives the parcel weight, tare included |
| Metadata | `dims_in`, `max_per_box` (how many of one item may go in a box), `low_stock_at`, `maker`, `kind` |

A tier's curated filling is a **recipe** — `mistbox.recipe` product metadata,
seeded from `catalog.json` — expanded into real item lines at checkout, so a
preset sale draws down the same stock a custom box does. `catalog.json` is the
source of truth: `seed.py` overwrites the recipe on every run, and past orders
are unaffected because the recipe is snapshotted onto the order.

Items, makers, per-item costs, weights and box recipes all live in
`seed/catalog.json`. Edit that file and re-run; it is idempotent.

### Building a new box in Saleor

Daniya can compose a box herself, without a developer or a re-seed:

1. **Catalog → Products → Create product**, product type **Gift box**.
2. Fill in **Contents** — a picker listing every item. What she chooses *is*
   the box: it becomes the order lines, the "What's inside" list on the site,
   and the packing checklist.
3. Add a variant with a SKU and the number of **cartons** in stock, set the
   price, and set the variant **weight to the empty carton's weight** — if she
   leaves it blank the shipping label falls back to an estimate and says so.
4. Publish it in the `mistbox-us` channel.

It appears on the storefront immediately, describes its own contents, and
selling it draws down the real stock of everything inside.

> **A box that breaks the rules can't be saved.** The `saleor-plugin/` Django
> plugin refuses a box with more pieces than the carton holds, or too many of
> one item, the moment it is saved — and the script in `dashboard/` replaces
> Saleor's generic "Invalid value" with the real reason.

> **Her picks always win.** A box's contents come from the Contents attribute
> when it is set, and only fall back to the seeded `mistbox.recipe` metadata
> when it is empty — so `seed.py` can be re-run without overwriting a box she
> composed by hand.

> **The item data is a placeholder.** Fernwater Tea Co., Ballard & Bell,
> Olympic Bee Company, Cedar & Cloth, Lopez Candleworks, Skagit Flats Creamery
> and Nooksack Woodshop do not exist, and every weight and dimension beside
> them is an estimate that has never met a scale. They stand in so the
> item-level inventory and the box builder can be built and tested. The real
> suppliers — **Seattle Chocolate**, **Franz Chocolate** and **Smith Tea**,
> shipping in their own retail packaging — replace them in `catalog.json`
> before launch, which is a data swap, not a code change. Naming a business you
> have no agreement with implies a partnership you do not have, the same trap
> the brand doc flagged around "Elate Box".

> **The Grand box contains cheese.** A 6 oz aged tomme is fine unrefrigerated for
> a two-to-three day transit in November and December, and hopeless in July. If
> you ever sell this box outside the cold months, that line needs to change or
> the box needs a cold pack.

### 3b. Attach the box images

```bash
python media.py --email you@example.com --password 'your-password'
```

Five images are already rendered in `seed/images/`: the forest/gold lid, the
fir/gold lid, both with the belly band in place, and the fir seal. They are flat
illustrations built from the packaging spec — real palette, real emblem, real
type — not photographs, and they should be replaced once printed boxes exist and
can be shot.

To re-render them (after a colourway change, say) you need Cormorant Garamond
and Jost from Google Fonts:

```bash
python images/render.py --fonts ~/Library/Fonts
```

### 3c. Inventory movements

Saleor Community tracks a current quantity per warehouse — it does not keep a
movement history. `seed/movements.json` keeps that history: receipts, samples,
damages and corrections, with the 100-unit main run recorded as a *planned*
receipt dated 5 November.

```bash
python inventory.py --email you@example.com --password 'your-password'
```

That writes `seed/inventory-ledger.csv` (a running balance per SKU, your audit
trail) and prints a reconciliation of ledger against Saleor:

```
SKU           LEDGER  SALEOR  ALLOC   FREE  VARIANCE
MB-SIG-01          4     100      0    100  +96 vs ledger
```

A variance is expected here — `seed.py` sets stock to the 100 you are planning
for, while the ledger counts only what has physically arrived. Add
`--include-planned` to count the November run, or `--apply` to overwrite Saleor
with the ledger balance. **`--apply` discards deductions from real orders**, so
it is for development databases only.

## 4. Secrets (1Password)

The storefront's secrets — the Saleor app token, the Stripe/Resend/Shippo keys,
the session-signing secrets — live in **1Password**, not in a file. There is no
committed or hand-edited `.env.local`; `op run` injects the values at start time.

One-time setup:

1. **Install the `op` CLI** and turn on 1Password → *Settings → Developer →
   Integrate with 1Password CLI*. (On an Intel Mac where `brew install
   1password-cli` fails, install the standalone binary from 1Password's download
   cache into `/usr/local/bin`.)
2. **Create the Saleor app token:** Dashboard → *Configuration → Webhooks &
   Events → Create App*, name it `Mistbox storefront`, grant **Manage orders**,
   **Manage checkouts**, **Handle payments**, **Manage products**, and copy the
   token (shown once).
3. **Create a `mistbox-dev` item** in the **Mistbox** 1Password vault with one
   field per variable — the names are listed in `storefront/.env.example`. Put
   the app token in `SALEOR_APP_TOKEN`; the Stripe keys come from step 6.

`env/mistbox.env.tpl` (committed — references only, no values) maps each variable
to `op://Mistbox/$MB_ENV/<NAME>`, so `MB_ENV` selects the environment
(`mistbox-dev` / `mistbox-qa` / `mistbox-prod`). Fuller detail, including qa/prod,
is in the engineering docs (Google Drive → **Mistbox → Website**: *Runbook* and
*Secrets Inventory*).

## 5. Run the storefront

```bash
cd storefront
npm install
MB_ENV=mistbox-dev op run --env-file=../env/mistbox.env.tpl -- npm run dev
```

<http://localhost:3000>

`op run` resolves the `op://` references and injects the secrets into the dev
server; if `MB_ENV` is unset it fails rather than run without them. Need a plain
file for a tool that expects one? `MB_ENV=mistbox-dev op inject -i
env/mistbox.env.tpl -o storefront/.env.local` writes one (it stays gitignored).

## 6. Stripe

You said you still need to set Stripe up. In test mode:

1. Create an account at <https://dashboard.stripe.com/register>, stay in **Test mode**
   (the toggle, top right).
2. **Developers → API keys** → copy the *secret* key (`sk_test_…`) into the
   `STRIPE_SECRET_KEY` field of the `mistbox-dev` item in 1Password.
3. Install the CLI and forward webhooks to your machine:

```bash
brew install stripe/stripe-cli/stripe
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

   That prints a `whsec_…` secret — put it in the `STRIPE_WEBHOOK_SECRET` field
   in 1Password and restart the dev server.

4. Place a test order with card `4242 4242 4242 4242`, any future expiry, any CVC.

**The webhook is what creates the order.** Stripe confirms the payment, the webhook
records it against the Saleor checkout and completes it, and *that* is the moment
stock is deducted. If `stripe listen` is not running, the customer pays and no order
appears — so it must be running in development, and configured as a real endpoint
before you go live.

## 7. Check the GraphQL still matches Saleor

Every query and mutation in the project is validated against Saleor 3.23's schema:

```bash
cd tools && npm install && node check-graphql.mjs
```

Run this after any Saleor upgrade — it catches renamed fields before customers do.

## 8. Run the unit tests

```bash
cd storefront && npm test
```

Vitest, covering the pure logic underneath the checkout and tracking flow —
stage ordering, the never-go-backwards rule, HTML sanitizing, session
sign/verify, the email templates. It needs nothing running: no Saleor, no
Stripe, no browser. `npm run test:watch` keeps it running while you edit.

This is a different layer from `tools/testpay.mjs` and the other Playwright
scripts, which exercise the real, live stack end to end and are the better
tool for "does a whole order actually work." Vitest is for the logic those
scripts depend on being right in the first place.

---

## How an order actually flows

```
storefront form
  → POST /api/checkout
      → checkoutCreate            (Saleor reserves nothing yet, but validates stock)
      → updateMetadata            (gift message, recipient name)
      → checkoutDeliveryMethodUpdate  (cheapest configured rate)
      → Stripe Checkout Session   (Stripe hosts the card form)
  → customer pays on Stripe
  → Stripe fires checkout.session.completed
      → POST /api/stripe/webhook
          → transactionCreate     (records the charge against the checkout)
          → checkoutComplete      (creates the order, deducts stock)
```

The gift message lands in the order's **metadata**, visible in the dashboard on the
order page — that is what you write onto the 4×6 insert card by hand.

## Known gaps

* **Sales tax is not configured.** Washington is destination-based and you will owe
  it on in-state sales. Saleor supports flat tax rates per country out of the box and
  Avalara through a plugin; neither is set up here. Decide this before real money.
* **No emails to customers.** Mail goes to Mailpit in development. Point `EMAIL_URL`
  in `saleor/common.env` at a real SMTP provider for production.
* **Oversell window.** Stock is checked when the checkout is created and deducted when
  Stripe confirms. Two people can start checkouts for the last box within that window.
  At 100 units the risk is small; the fix is `checkoutLinesAdd` reservations, which
  Saleor supports via `RESERVE_DURATION`.
* **Colourways are not modelled.** The packaging spec has six lid colourways; the
  catalogue currently has one variant per box. Add variant attributes when you decide
  which colourways actually go on sale.
* **`SECRET_KEY` in `saleor/common.env` is a development placeholder.** Fine for
  local dev; qa and prod supply it (and the database URL) from 1Password via
  `op run`, never from the committed file.
