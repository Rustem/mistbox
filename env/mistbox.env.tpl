# Mistbox secrets — resolved from 1Password at run time by `op run`.
#
# This file contains NO secret values, only op:// references, so it is safe to
# commit. The real values live in the 1Password "Mistbox" vault, one item per
# environment: mistbox-dev / mistbox-qa / mistbox-prod.
#
# Usage (pick the environment with MB_ENV):
#   cd storefront && MB_ENV=mistbox-dev op run --env-file=../env/mistbox.env.tpl -- npm run dev
#   MB_ENV=mistbox-qa   op run --env-file=env/mistbox.env.tpl -- docker compose -f docker-compose.yml -f docker-compose.qa.yml up -d
#   MB_ENV=mistbox-prod op run --env-file=env/mistbox.env.tpl -- <prod command>
#
# op substitutes $MB_ENV into each reference, so one template serves every
# environment. If MB_ENV is unset the references resolve to an empty item and
# op fails loudly — it never silently runs without secrets.

NEXT_PUBLIC_SALEOR_API_URL=op://Mistbox/$MB_ENV/NEXT_PUBLIC_SALEOR_API_URL
SALEOR_API_URL=op://Mistbox/$MB_ENV/SALEOR_API_URL
SALEOR_APP_TOKEN=op://Mistbox/$MB_ENV/SALEOR_APP_TOKEN
NEXT_PUBLIC_SALEOR_CHANNEL=op://Mistbox/$MB_ENV/NEXT_PUBLIC_SALEOR_CHANNEL
STRIPE_SECRET_KEY=op://Mistbox/$MB_ENV/STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET=op://Mistbox/$MB_ENV/STRIPE_WEBHOOK_SECRET
NEXT_PUBLIC_SITE_URL=op://Mistbox/$MB_ENV/NEXT_PUBLIC_SITE_URL
RESEND_API_KEY=op://Mistbox/$MB_ENV/RESEND_API_KEY
RESEND_FROM=op://Mistbox/$MB_ENV/RESEND_FROM
RESEND_REPLY_TO=op://Mistbox/$MB_ENV/RESEND_REPLY_TO
SHIPPO_API_TOKEN=op://Mistbox/$MB_ENV/SHIPPO_API_TOKEN
SHIPPO_WEBHOOK_TOKEN=op://Mistbox/$MB_ENV/SHIPPO_WEBHOOK_TOKEN
SALEOR_WEBHOOK_SECRET=op://Mistbox/$MB_ENV/SALEOR_WEBHOOK_SECRET
ORDER_REVEAL_SECRET=op://Mistbox/$MB_ENV/ORDER_REVEAL_SECRET
ADMIN_SESSION_SECRET=op://Mistbox/$MB_ENV/ADMIN_SESSION_SECRET
