# Saleor-container secrets — separate from env/mistbox.env.tpl on purpose.
# That file feeds the storefront process alone (including a bare
# `npm run dev` locally); this one feeds the Saleor `api`/`worker` containers
# when bringing up a qa/prod compose stack, and the two are combined in one
# `op run` call:
#
#   MB_ENV=mistbox-qa op run --env-file=env/mistbox.env.tpl --env-file=env/saleor.env.tpl \
#     -- docker compose -f docker-compose.yml -f docker-compose.qa.yml up -d
#
# Mixing the two into one file would make a plain `npm run dev` fail trying to
# resolve a Saleor-only field the mistbox-dev item has no reason to carry.
#
# qa keeps a containerized Postgres (only prod uses managed Postgres), so
# DATABASE_URL/CACHE_URL/CELERY_BROKER_URL stay as the plain container-network
# values already in saleor/backend.env — add them here only once prod points
# at a real external database.

SECRET_KEY=op://Mistbox/$MB_ENV/SECRET_KEY
# Required whenever DEBUG=False — dev's DEBUG=True auto-generates a throwaway
# one to a local file, which is exactly why this was invisible until the first
# real qa boot. Without it Saleor raises ImproperlyConfigured and both `api`
# and `worker` crash-loop. Generate with: openssl genrsa 2048
RSA_PRIVATE_KEY=op://Mistbox/$MB_ENV/RSA_PRIVATE_KEY
