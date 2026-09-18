#!/usr/bin/env bash
# Provision (or re-provision) a full catalogue — items, boxes, and every
# photo — against one Saleor instance, in the one order that actually works:
#
#   1. apply_category_photos.py  fills in any variant missing a photo, local-
#      only, no network call.
#   2. seed.py                   creates/updates every product and variant.
#      Must run before item_media.py: it can't attach media to a variant
#      that doesn't exist yet.
#   3. item_media.py             uploads and assigns each item's photo.
#   4. media.py                  uploads and assigns the box tiers' own
#      lid/band/seal photos — a separate script because box products carry
#      media at the product level, not per-variant.
#
# Usage:
#   seed/provision.sh <graphql-url> <staff-email> <staff-password>
#
# Example, against qa (credentials from 1Password — never typed or pasted):
#   seed/provision.sh https://api.qa.mist.box/graphql/ \
#     "$(op read op://Mistbox/mistbox-qa/QA_SUPERUSER_EMAIL)" \
#     "$(op read op://Mistbox/mistbox-qa/QA_SUPERUSER_PASSWORD)"
#
# Idempotent throughout: safe to re-run after adding new catalog.json items,
# and it will only create what's missing.
set -euo pipefail
cd "$(dirname "$0")"

URL="${1:?Usage: provision.sh <graphql-url> <staff-email> <staff-password>}"
EMAIL="${2:?Usage: provision.sh <graphql-url> <staff-email> <staff-password>}"
PASSWORD="${3:?Usage: provision.sh <graphql-url> <staff-email> <staff-password>}"

echo "== 1/4  filling in category photos for any variant missing one =="
python3 images/apply_category_photos.py

echo "== 2/4  seeding products and variants =="
python3 seed.py --url "$URL" --email "$EMAIL" --password "$PASSWORD"

echo "== 3/4  uploading and assigning item photos =="
python3 item_media.py --url "$URL" --email "$EMAIL" --password "$PASSWORD"

echo "== 4/4  uploading and assigning box tier photos =="
python3 media.py --url "$URL" --email "$EMAIL" --password "$PASSWORD"

echo
echo "Done. If this is a brand-new environment (first provision ever against"
echo "it), also run ops/set-site-domain.sh once — see that script's header."
