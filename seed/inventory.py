#!/usr/bin/env python3
"""
Reconcile Saleor's stock against a supply-side movement ledger.

Saleor Community tracks a current quantity per warehouse, not a movement
history — so this keeps the history. `movements.json` records what came in and
what was lost or given away; Saleor records what was sold. This script compares
the two and tells you where they disagree.

    python inventory.py --email you@… --password '…'            # report only
    python inventory.py --email … --password … --apply          # write to Saleor
    python inventory.py … --include-planned                     # count future receipts

`--apply` OVERWRITES Saleor's quantities with the ledger balance. That discards
any deduction from real orders, so use it on a development database only.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import requests

HERE = Path(__file__).parent
LEDGER_CSV = HERE / "inventory-ledger.csv"

VARIANT_STOCK = """
query VariantStock($sku: String!) {
  productVariant(sku: $sku) {
    id
    name
    product { name }
    stocks {
      id
      quantity
      quantityAllocated
      warehouse { id name }
    }
  }
}
"""

SET_STOCK = """
mutation SetStock($variantId: ID!, $stocks: [StockInput!]!) {
  productVariantStocksUpdate(variantId: $variantId, stocks: $stocks) {
    errors { field message code }
  }
}
"""


class Saleor:
    def __init__(self, url: str) -> None:
        self.url = url
        self.token: str | None = None
        self.session = requests.Session()

    def __call__(self, query: str, **variables: Any) -> dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        res = self.session.post(
            self.url, json={"query": query, "variables": variables}, headers=headers, timeout=60
        )
        res.raise_for_status()
        payload = res.json()
        if payload.get("errors"):
            raise SystemExit(
                "GraphQL error: " + "; ".join(e.get("message", "?") for e in payload["errors"])
            )
        return payload["data"]

    def login(self, email: str, password: str) -> None:
        data = self(
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
        if data["tokenCreate"]["errors"]:
            raise SystemExit(f"Login failed: {data['tokenCreate']['errors']}")
        self.token = data["tokenCreate"]["token"]


def write_ledger(movements: list[dict[str, Any]]) -> None:
    """A running balance per SKU, in date order — the audit trail Saleor
    does not keep for you."""
    running: dict[str, int] = defaultdict(int)
    rows = []
    for m in sorted(movements, key=lambda m: (m["date"], m["sku"])):
        running[m["sku"]] += m["quantity"]
        rows.append(
            {
                "date": m["date"],
                "sku": m["sku"],
                "type": m["type"],
                "quantity": m["quantity"],
                "balance": running[m["sku"]],
                "planned": "yes" if m.get("planned") else "",
                "note": m.get("note", ""),
            }
        )

    with LEDGER_CSV.open("w", newline="") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=["date", "sku", "type", "quantity", "balance", "planned", "note"]
        )
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:8000/graphql/")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--movements", default=str(HERE / "movements.json"))
    parser.add_argument(
        "--include-planned",
        action="store_true",
        help="count receipts marked planned:true as if they had arrived",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="overwrite Saleor's quantities with the ledger balance (dev databases only)",
    )
    args = parser.parse_args()

    movements = json.loads(Path(args.movements).read_text())["movements"]
    write_ledger(movements)
    print(f"Ledger written to {LEDGER_CSV.name} ({len(movements)} movements)\n")

    counted = [m for m in movements if args.include_planned or not m.get("planned")]
    expected: dict[str, int] = defaultdict(int)
    for m in counted:
        expected[m["sku"]] += m["quantity"]

    planned_only = sum(m["quantity"] for m in movements if m.get("planned"))
    if planned_only and not args.include_planned:
        print(f"Excluding {planned_only} units on planned receipts. --include-planned to count them.\n")

    saleor = Saleor(args.url)
    saleor.login(args.email, args.password)

    print(f"{'SKU':<12} {'LEDGER':>7} {'SALEOR':>7} {'ALLOC':>6} {'FREE':>6}  VARIANCE")
    print("-" * 60)

    variances = 0

    for sku in sorted(expected):
        data = saleor(VARIANT_STOCK, sku=sku)
        variant = data["productVariant"]
        if not variant:
            print(f"{sku:<12} {expected[sku]:>7}        —      —      —  not in Saleor")
            variances += 1
            continue

        stocks = variant["stocks"] or []
        on_hand = sum(s["quantity"] for s in stocks)
        allocated = sum(s["quantityAllocated"] for s in stocks)
        free = on_hand - allocated
        delta = on_hand - expected[sku]

        flag = "ok" if delta == 0 else f"{delta:+d} vs ledger"
        if delta:
            variances += 1
        print(f"{sku:<12} {expected[sku]:>7} {on_hand:>7} {allocated:>6} {free:>6}  {flag}")

        if args.apply and delta != 0:
            if not stocks:
                print(f"             ! {sku} has no warehouse stock row; run seed.py first")
                continue
            warehouse = stocks[0]["warehouse"]["id"]
            result = saleor(
                SET_STOCK,
                variantId=variant["id"],
                stocks=[{"warehouse": warehouse, "quantity": expected[sku]}],
            )
            errors = result["productVariantStocksUpdate"]["errors"]
            if errors:
                print(f"             ! {errors}")
            else:
                print(f"             -> set to {expected[sku]}")

    print()
    if variances == 0:
        print("Saleor agrees with the ledger.")
    elif args.apply:
        print(f"{variances} variance(s) written to Saleor.")
    else:
        print(
            f"{variances} variance(s). A variance is normal once you have sold something —\n"
            "the ledger counts supply, Saleor counts supply minus sales. Investigate\n"
            "anything you cannot explain by orders. Use --apply only on a dev database."
        )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except requests.exceptions.ConnectionError:
        sys.exit("Could not reach Saleor. Is `docker compose up` running?")
