#!/usr/bin/env python3
"""
One-off: move from one-product-per-flavour to one-product-with-flavour-variants.

    python migrate_items_to_variants.py --email ... --password ... [--apply]

The first modelling pass gave every flavour its own product. Saleor's own answer
to "same thing, different flavour" is a variant, and using it makes swapping
native — the alternatives to an item are simply its sibling variants. This
script clears the old shape so `seed.py` can lay down the new one.

It is careful about two things:

  * **Order history survives.** Saleor copies `productName` and `productSku`
    onto every order line, so a past order still reads correctly after the
    product behind it is gone. Only the variant link goes null.
  * **Boxes composed in the dashboard survive.** A box's Contents attribute
    points at variant *ids*, which change when variants are recreated. Their
    SKUs are recorded first and re-pointed afterwards, so a box Daniya built by
    hand is not quietly emptied by a re-seed.

Dry run by default. Nothing is deleted without `--apply`.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from seed import SaleorClient, check, step

HERE = Path(__file__).parent
STASH = HERE / ".contents-stash.json"


def gift_box_contents(gql: SaleorClient) -> dict[str, list[str]]:
    """Box slug -> the SKUs it was composed from, before anything is deleted."""
    data = gql(
        """
        query BoxContents {
          products(first: 100, channel: "mistbox-us") {
            edges { node { slug productType { slug }
              attributes { attribute { slug } values { reference } } } }
          }
        }
        """
    )
    by_variant_id = variant_sku_index(gql)
    out: dict[str, list[str]] = {}
    for edge in data["products"]["edges"]:
        node = edge["node"]
        if node["productType"]["slug"] != "gift-box":
            continue
        attr = next(
            (a for a in node["attributes"] if a["attribute"]["slug"] == "contents"), None
        )
        skus = [
            by_variant_id[v["reference"]]
            for v in (attr["values"] if attr else [])
            if v["reference"] in by_variant_id
        ]
        if skus:
            out[node["slug"]] = skus
    return out


def variant_sku_index(gql: SaleorClient) -> dict[str, str]:
    data = gql(
        """
        query AllVariants {
          productVariants(first: 100) { edges { node { id sku } } }
        }
        """
    )
    return {e["node"]["id"]: e["node"]["sku"] for e in data["productVariants"]["edges"]}


def stale_items(gql: SaleorClient, keep_slugs: set[str]) -> list[dict[str, Any]]:
    data = gql(
        """
        query Items {
          products(first: 100, channel: "mistbox-us") {
            edges { node { id slug name productType { slug } } }
          }
        }
        """
    )
    return [
        e["node"]
        for e in data["products"]["edges"]
        if e["node"]["productType"]["slug"] == "box-item"
        and e["node"]["slug"] not in keep_slugs
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8000/graphql/")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--catalog", default=str(HERE / "catalog.json"))
    parser.add_argument("--apply", action="store_true", help="actually delete")
    args = parser.parse_args()

    catalog = json.loads(Path(args.catalog).read_text())
    keep = {i["slug"] for i in catalog.get("items", [])}

    gql = SaleorClient(args.url)
    gql.login(args.email, args.password)

    print("Remembering dashboard-composed boxes")
    contents = gift_box_contents(gql)
    for slug, skus in contents.items():
        step(f"{slug}: {', '.join(skus)}")
    if not contents:
        step("none found")

    print("\nStale single-variant item products")
    doomed = stale_items(gql, keep)
    for node in doomed:
        step(f"{node['slug']}  ({node['name']})")
    if not doomed:
        step("none — nothing to migrate")

    if not args.apply:
        print(f"\nDry run. {len(doomed)} product(s) would be deleted. Re-run with --apply.")
        return 0

    STASH.write_text(json.dumps(contents, indent=2))
    step(f"contents stashed to {STASH.name}")

    print("\nDeleting")
    for node in doomed:
        data = gql(
            """
            mutation DeleteItem($id: ID!) {
              productDelete(id: $id) { errors { field message code } }
            }
            """,
            id=node["id"],
        )
        check(data["productDelete"]["errors"], f"Deleting {node['slug']}")
        step(f"{node['slug']} deleted")

    print(
        f"\n{len(doomed)} removed. Now run seed.py, then "
        "restore_box_contents.py to re-point the boxes."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
