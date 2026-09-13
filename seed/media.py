#!/usr/bin/env python3
"""
Attach the rendered box images to the Saleor products.

    python media.py --email you@example.com --password '...'

Uses the GraphQL multipart request spec, which is how Saleor accepts file
uploads. Idempotent: an image whose alt text is already on the product is
skipped, so re-running does not pile up duplicates.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import requests

HERE = Path(__file__).parent
IMAGES = HERE / "images"

# product slug -> [(file name, alt text), ...] in the order they should appear
ATTACHMENTS: dict[str, list[tuple[str, str]]] = {
    "the-mistbox": [
        ("mistbox-signature-lid.png", "Mistbox lid in forest with gold foil"),
        ("mistbox-signature-banded.png", "Mistbox with the belly band in place"),
        ("mistbox-seal.png", "The Mistbox fir seal in gold on forest"),
    ],
    "the-mistbox-grand": [
        ("mistbox-grand-lid.png", "Mistbox Grand lid in fir with gold foil"),
        ("mistbox-grand-banded.png", "Mistbox Grand with the belly band in place"),
        ("mistbox-seal.png", "The Mistbox fir seal in gold on forest"),
    ],
}

FIND_PRODUCT = """
query FindProduct($slug: String!) {
  products(first: 1, filter: { slugs: [$slug] }) {
    edges { node { id name media { id alt } } }
  }
}
"""

CREATE_MEDIA = """
mutation AddMedia($product: ID!, $alt: String!, $image: Upload!) {
  productMediaCreate(input: { product: $product, alt: $alt, image: $image }) {
    media { id alt }
    errors { field message code }
  }
}
"""


class Saleor:
    def __init__(self, url: str) -> None:
        self.url = url
        self.token: str | None = None
        self.session = requests.Session()

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    def query(self, query: str, **variables: Any) -> dict[str, Any]:
        res = self.session.post(
            self.url,
            json={"query": query, "variables": variables},
            headers={"Content-Type": "application/json", **self._headers()},
            timeout=60,
        )
        res.raise_for_status()
        payload = res.json()
        if payload.get("errors"):
            raise SystemExit(
                "GraphQL error: " + "; ".join(e.get("message", "?") for e in payload["errors"])
            )
        return payload["data"]

    def upload(self, query: str, variables: dict[str, Any], path: Path) -> dict[str, Any]:
        """GraphQL multipart request: operations + map + the file itself."""
        operations = {"query": query, "variables": {**variables, "image": None}}
        with path.open("rb") as handle:
            res = self.session.post(
                self.url,
                data={
                    "operations": json.dumps(operations),
                    "map": json.dumps({"0": ["variables.image"]}),
                },
                files={"0": (path.name, handle, "image/png")},
                headers=self._headers(),
                timeout=120,
            )
        res.raise_for_status()
        payload = res.json()
        if payload.get("errors"):
            raise SystemExit(
                "Upload error: " + "; ".join(e.get("message", "?") for e in payload["errors"])
            )
        return payload["data"]

    def login(self, email: str, password: str) -> None:
        data = self.query(
            """
            mutation Login($email: String!, $password: String!) {
              tokenCreate(email: $email, password: $password) {
                token
                errors { field message code }
              }
            }
            """,
            email=email,
            password=password,
        )
        errors = data["tokenCreate"]["errors"]
        if errors:
            raise SystemExit(f"Login failed: {errors}")
        self.token = data["tokenCreate"]["token"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:8000/graphql/")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()

    missing = [
        name
        for pairs in ATTACHMENTS.values()
        for name, _ in pairs
        if not (IMAGES / name).exists()
    ]
    if missing:
        raise SystemExit(
            "Missing images: "
            + ", ".join(sorted(set(missing)))
            + f"\nRun: python {IMAGES / 'render.py'} --fonts <font dir>"
        )

    saleor = Saleor(args.url)
    saleor.login(args.email, args.password)
    print("Signed in.\n")

    uploaded = skipped = 0

    for slug, pairs in ATTACHMENTS.items():
        found = saleor.query(FIND_PRODUCT, slug=slug)["products"]["edges"]
        if not found:
            print(f"  ! product '{slug}' not found — run seed.py first")
            continue

        product = found[0]["node"]
        have = {m["alt"] for m in (product["media"] or [])}
        print(product["name"])

        for name, alt in pairs:
            if alt in have:
                print(f"    = {name} already attached")
                skipped += 1
                continue

            data = saleor.upload(
                CREATE_MEDIA, {"product": product["id"], "alt": alt}, IMAGES / name
            )
            errors = data["productMediaCreate"]["errors"]
            if errors:
                print(f"    ! {name}: {errors}")
                continue
            print(f"    + {name}")
            uploaded += 1

    print(f"\n{uploaded} images uploaded, {skipped} already present.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except requests.exceptions.ConnectionError:
        sys.exit("Could not reach Saleor. Is `docker compose up` running?")
