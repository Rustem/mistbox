#!/usr/bin/env python3
"""
Attach a photo to every item variant.

    python images/render_items.py                     # draw them
    python item_media.py --email ... --password ...   # upload and assign

Saleor holds media on the *product* and lets each variant claim a subset of it
(`variantMediaAssign`). That is what makes a flavour look like a different
thing on screen: pick Cedar smoke and you see the cedar-smoke image, while a
variant with nothing assigned falls back to the product's first photo.

Idempotent: media is matched by alt text, so re-running neither duplicates
uploads nor re-assigns what is already assigned.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from media import Saleor  # same multipart upload the box images use

HERE = Path(__file__).parent
ITEMS = HERE / "images" / "items"

FIND_PRODUCT = """
query FindItem($slug: String!) {
  products(first: 1, filter: { slugs: [$slug] }) {
    edges { node { id name
      media { id alt }
      variants { id sku name media { id } } } }
  }
}
"""

CREATE_MEDIA = """
mutation AddItemMedia($product: ID!, $alt: String!, $image: Upload!) {
  productMediaCreate(input: { product: $product, alt: $alt, image: $image }) {
    media { id alt }
    errors { field message code }
  }
}
"""

ASSIGN = """
mutation AssignVariantMedia($variantId: ID!, $mediaId: ID!) {
  variantMediaAssign(variantId: $variantId, mediaId: $mediaId) {
    errors { field message code }
  }
}
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8000/graphql/")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--catalog", default=str(HERE / "catalog.json"))
    args = parser.parse_args()

    catalog = json.loads(Path(args.catalog).read_text())
    items = catalog.get("items", [])

    missing = [
        v["sku"]
        for item in items
        for v in item["variants"]
        if not (ITEMS / f"{v['sku'].lower()}.png").exists()
    ]
    if missing:
        raise SystemExit(
            "No image for: " + ", ".join(missing) + "\nRun: python images/render_items.py"
        )

    api = Saleor(args.url)
    api.login(args.email, args.password)

    uploaded = assigned = 0

    for item in items:
        found = api.query(FIND_PRODUCT, slug=item["slug"])["products"]["edges"]
        if not found:
            print(f"  {item['slug']}: not in Saleor — run seed.py first")
            continue
        product = found[0]["node"]
        by_alt: dict[str, str] = {m["alt"]: m["id"] for m in product["media"]}
        variants: dict[str, dict[str, Any]] = {v["sku"]: v for v in product["variants"]}

        print(f"  {product['name']}")
        for spec in item["variants"]:
            sku, flavour = spec["sku"], spec["flavour"]
            variant = variants.get(sku)
            if not variant:
                print(f"      {sku}: variant not found — skipped")
                continue

            alt = f"{item['name']} — {flavour}"
            media_id = by_alt.get(alt)
            if media_id is None:
                data = api.upload(
                    CREATE_MEDIA,
                    {"product": product["id"], "alt": alt},
                    ITEMS / f"{sku.lower()}.png",
                )
                errors = data["productMediaCreate"]["errors"]
                if errors:
                    raise SystemExit(f"Upload failed for {sku}: {errors}")
                media_id = data["productMediaCreate"]["media"]["id"]
                by_alt[alt] = media_id
                uploaded += 1

            if any(m["id"] == media_id for m in (variant["media"] or [])):
                print(f"      {sku:<12} {flavour} — already assigned")
                continue

            data = api.query(ASSIGN, variantId=variant["id"], mediaId=media_id)
            errors = data["variantMediaAssign"]["errors"]
            if errors:
                raise SystemExit(f"Assign failed for {sku}: {errors}")
            assigned += 1
            print(f"      {sku:<12} {flavour} — image assigned")

    print(f"\n{uploaded} uploaded, {assigned} assigned to variants.")
    print("These are flat placeholders. Replace them with real photography before launch.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
