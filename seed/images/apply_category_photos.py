#!/usr/bin/env python3
"""
Fill in a per-variant photo for every fixture item that doesn't have one yet,
using one stock photo per category from images/categories/.

    python images/apply_category_photos.py

Real product photography is rendered per variant (render_items.py) so that a
flavour is visibly a different thing on screen. The 60-item QA fixture catalog
has no such photography, so this script assigns the *same* category photo to
every variant of every fixture item — one Chocolate photo for all chocolate
items, one Tea photo for all tea items, and so on. That's a coarser signal
than a real photo per flavour, but it's honest: these are QA-only stand-ins for
sourcing invented fixture products, not real product photography.

Only fills gaps. A SKU that already has images/items/<sku>.png (the 9 original,
illustrated items) is left untouched — this never overwrites real renders.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

HERE = Path(__file__).parent
CATALOG = HERE.parent / "catalog.json"
CATEGORIES = HERE / "categories"
ITEMS = HERE / "items"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", default=str(CATALOG))
    args = parser.parse_args()

    catalog = json.loads(Path(args.catalog).read_text())
    items = catalog.get("items", [])

    filled = skipped = 0
    for item in items:
        kind_slug = item["kind"].lower()
        category_photo = CATEGORIES / f"{kind_slug}.png"
        if not category_photo.exists():
            raise SystemExit(
                f"No category photo for kind {item['kind']!r} "
                f"(expected {category_photo})"
            )

        for variant in item["variants"]:
            dest = ITEMS / f"{variant['sku'].lower()}.png"
            if dest.exists():
                skipped += 1
                continue
            shutil.copyfile(category_photo, dest)
            filled += 1

    print(f"{filled} variant photos filled from {len(list(CATEGORIES.glob('*.png')))} category photos.")
    print(f"{skipped} already had their own image and were left alone.")
    print("Next: python item_media.py --email ... --password ...")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
