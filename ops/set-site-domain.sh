#!/usr/bin/env bash
# Set Django's Sites-framework domain — the value Saleor falls back to when it
# builds an absolute media/thumbnail URL with no request context to read a
# Host header from.
#
# Every fresh Saleor install ships this as "localhost:8000" (the dev
# default) and nothing in a normal deploy ever touches it. Left alone, every
# image URL Saleor returns is absolute-but-wrong for that environment: it
# still "looks" like it works from the machine that happens to run something
# on port 8000, and 404s for everyone else. This bit qa on 2026-09-17 — every
# box-tier card image silently pointed at localhost:8000 until this was found
# and fixed by hand. Run this once, right after seeding a fresh environment
# for the first time — see docs/ "01 First Deploy" — and it is safe to
# re-run any time (idempotent: setting the same domain twice is a no-op).
#
# Usage (from inside an SSH session, in ~/code/mistbox, qa/prod):
#   set -a; source /etc/mistbox/op-token.env; set +a
#   MB_ENV=mistbox-qa ./ops/set-site-domain.sh api.qa.mist.box "Mistbox QA"
#
# Usage (local dev, no op-token needed):
#   ./ops/set-site-domain.sh localhost:8000 "Mistbox Dev"
set -euo pipefail

DOMAIN="${1:?Usage: set-site-domain.sh <domain> <site-name> [compose-files]}"
NAME="${2:?Usage: set-site-domain.sh <domain> <site-name> [compose-files]}"
COMPOSE_FILES="${3:-docker-compose.yml -f docker-compose.qa.yml}"

run() {
  if [ -n "${MB_ENV:-}" ]; then
    # shellcheck disable=SC2086
    MB_ENV="$MB_ENV" op run --env-file=env/saleor.env.tpl -- \
      docker compose -f $COMPOSE_FILES run --rm -T api python3 manage.py shell -c "$1"
  else
    # shellcheck disable=SC2086
    docker compose -f $COMPOSE_FILES run --rm -T api python3 manage.py shell -c "$1"
  fi
}

run "
from django.contrib.sites.models import Site
s = Site.objects.get_current()
s.domain = '$DOMAIN'
s.name = '$NAME'
s.save()
print('Site domain set to', s.domain, '/', s.name)
"

echo "Now restart api+worker so the in-process Site cache picks this up:"
echo "  MB_ENV=\$MB_ENV op run --env-file=env/mistbox.env.tpl --env-file=env/saleor.env.tpl -- \\"
echo "    docker compose -f $COMPOSE_FILES up -d --no-deps --force-recreate api worker"
