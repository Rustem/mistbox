#!/usr/bin/env python3
"""
Re-point a dashboard-composed box at its items after a variant rebuild.

    python restore_box_contents.py --email ... --password ...

A box's Contents attribute holds variant *ids*. Recreating variants changes
those ids, which would silently empty a box someone composed by hand — so
`migrate_items_to_variants.py` stashes the SKUs first and this puts them back.

Safe to run twice: it sets the same references again.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from seed import SaleorClient, check, step

HERE = Path(__file__).parent
STASH = HERE / ".contents-stash.json"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8000/graphql/")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()

    if not STASH.exists():
        print(f"No {STASH.name} — nothing to restore.")
        return 0

    stash: dict[str, list[str]] = json.loads(STASH.read_text())
    gql = SaleorClient(args.url)
    gql.login(args.email, args.password)

    variants = gql(
        """
        query AllVariants {
          productVariants(first: 100) { edges { node { id sku } } }
        }
        """
    )
    id_by_sku = {e["node"]["sku"]: e["node"]["id"] for e in variants["productVariants"]["edges"]}

    attribute = gql(
        """
        query FindContents { attributes(first: 1, filter: { slugs: ["contents"] }) {
          edges { node { id } } } }
        """
    )
    attr_id = attribute["attributes"]["edges"][0]["node"]["id"]

    for slug, skus in stash.items():
        found = gql(
            """
            query FindBox($slug: String!) {
              products(first: 1, filter: { slugs: [$slug] }) { edges { node { id name } } }
            }
            """,
            slug=slug,
        )
        edges = found["products"]["edges"]
        if not edges:
            step(f"{slug} no longer exists — skipped")
            continue

        refs = [id_by_sku[sku] for sku in skus if sku in id_by_sku]
        missing = [sku for sku in skus if sku not in id_by_sku]

        data = gql(
            """
            mutation SetContents($id: ID!, $input: ProductInput!) {
              productUpdate(id: $id, input: $input) {
                errors { field message code }
              }
            }
            """,
            id=edges[0]["node"]["id"],
            input={"attributes": [{"id": attr_id, "references": refs}]},
        )
        check(data["productUpdate"]["errors"], f"Restoring {slug}")
        step(f"{edges[0]['node']['name']}: {len(refs)} item(s) restored" +
             (f" — {', '.join(missing)} no longer exist" if missing else ""))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
