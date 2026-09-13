#!/usr/bin/env python3
"""
Seed a fresh Saleor instance with the Mistbox catalogue.

    pip install -r requirements.txt
    python seed.py --email admin@example.com --password admin

Idempotent: every object is looked up by slug first, so running it twice
updates rather than duplicates. Catalogue content lives in catalog.json —
edit that, not this file, when prices or stock change.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import requests

HERE = Path(__file__).parent


class SaleorClient:
    def __init__(self, url: str) -> None:
        self.url = url
        self.token: str | None = None
        self.session = requests.Session()

    def __call__(self, query: str, **variables: Any) -> dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        res = self.session.post(
            self.url,
            json={"query": query, "variables": variables},
            headers=headers,
            timeout=60,
        )
        res.raise_for_status()
        payload = res.json()
        if payload.get("errors"):
            raise RuntimeError(
                "GraphQL error: "
                + "; ".join(e.get("message", "?") for e in payload["errors"])
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
        check(data["tokenCreate"]["errors"], "Login")
        self.token = data["tokenCreate"]["token"]
        if not self.token:
            raise SystemExit("Login failed: no token returned.")


def check(errors: list[dict[str, Any]] | None, what: str) -> None:
    if errors:
        detail = " | ".join(
            ": ".join(str(x) for x in (e.get("field"), e.get("code"), e.get("message")) if x)
            for e in errors
        )
        raise SystemExit(f"{what} failed — {detail}")


def step(msg: str) -> None:
    print(f"  {msg}", flush=True)


# --------------------------------------------------------------------- steps


def ensure_warehouse(gql: SaleorClient, spec: dict[str, Any]) -> str:
    existing = gql(
        """
        query FindWarehouse($slug: String!) {
          warehouses(first: 1, filter: { slugs: [$slug] }) {
            edges { node { id name } }
          }
        }
        """,
        slug=spec["slug"],
    )
    edges = existing["warehouses"]["edges"]
    if edges:
        step(f"warehouse '{spec['name']}' already exists")
        return edges[0]["node"]["id"]

    data = gql(
        """
        mutation CreateWarehouse($input: WarehouseCreateInput!) {
          createWarehouse(input: $input) {
            warehouse { id }
            errors { field message code }
          }
        }
        """,
        input={"name": spec["name"], "slug": spec["slug"], "address": spec["address"]},
    )
    check(data["createWarehouse"]["errors"], "Creating warehouse")
    step(f"warehouse '{spec['name']}' created")
    return data["createWarehouse"]["warehouse"]["id"]


def ensure_channel(gql: SaleorClient, spec: dict[str, Any], warehouse_id: str) -> str:
    existing = gql(
        """
        query Channels { channels { id slug } }
        """
    )
    for channel in existing["channels"]:
        if channel["slug"] == spec["slug"]:
            step(f"channel '{spec['slug']}' already exists")
            return channel["id"]

    data = gql(
        """
        mutation CreateChannel($input: ChannelCreateInput!) {
          channelCreate(input: $input) {
            channel { id }
            errors { field message code }
          }
        }
        """,
        input={
            "name": spec["name"],
            "slug": spec["slug"],
            "currencyCode": spec["currency"],
            "defaultCountry": spec["country"],
            "isActive": True,
            "addWarehouses": [warehouse_id],
            "stockSettings": {"allocationStrategy": "PRIORITIZE_SORTING_ORDER"},
        },
    )
    check(data["channelCreate"]["errors"], "Creating channel")
    step(f"channel '{spec['slug']}' created")
    return data["channelCreate"]["channel"]["id"]


def ensure_shipping(
    gql: SaleorClient, spec: dict[str, Any], channel_id: str, warehouse_id: str
) -> None:
    zones = gql(
        """
        query Zones { shippingZones(first: 100) { edges { node { id name } } } }
        """
    )
    zone_id = next(
        (
            e["node"]["id"]
            for e in zones["shippingZones"]["edges"]
            if e["node"]["name"] == spec["zoneName"]
        ),
        None,
    )

    if zone_id is None:
        data = gql(
            """
            mutation CreateZone($input: ShippingZoneCreateInput!) {
              shippingZoneCreate(input: $input) {
                shippingZone { id }
                errors { field message code }
              }
            }
            """,
            input={
                "name": spec["zoneName"],
                "countries": spec["countries"],
                "addChannels": [channel_id],
                "addWarehouses": [warehouse_id],
            },
        )
        check(data["shippingZoneCreate"]["errors"], "Creating shipping zone")
        zone_id = data["shippingZoneCreate"]["shippingZone"]["id"]
        step(f"shipping zone '{spec['zoneName']}' created")
    else:
        step(f"shipping zone '{spec['zoneName']}' already exists")

    existing_methods = gql(
        """
        query ZoneMethods($id: ID!) {
          shippingZone(id: $id) { shippingMethods { id name } }
        }
        """,
        id=zone_id,
    )
    have = {m["name"] for m in (existing_methods["shippingZone"]["shippingMethods"] or [])}

    for method in spec["methods"]:
        if method["name"] in have:
            step(f"delivery method '{method['name']}' already exists")
            continue

        created = gql(
            """
            mutation CreateRate($input: ShippingPriceInput!) {
              shippingPriceCreate(input: $input) {
                shippingMethod { id }
                errors { field message code }
              }
            }
            """,
            input={
                "name": method["name"],
                "type": "PRICE",
                "shippingZone": zone_id,
                "minimumDeliveryDays": method.get("minDays"),
                "maximumDeliveryDays": method.get("maxDays"),
            },
        )
        check(created["shippingPriceCreate"]["errors"], "Creating delivery method")
        method_id = created["shippingPriceCreate"]["shippingMethod"]["id"]

        listing: dict[str, Any] = {"channelId": channel_id, "price": method["price"]}
        if "minimumOrderPrice" in method:
            listing["minimumOrderPrice"] = method["minimumOrderPrice"]

        priced = gql(
            """
            mutation PriceRate($id: ID!, $input: ShippingMethodChannelListingInput!) {
              shippingMethodChannelListingUpdate(id: $id, input: $input) {
                errors { field message code }
              }
            }
            """,
            id=method_id,
            input={"addChannels": [listing]},
        )
        check(
            priced["shippingMethodChannelListingUpdate"]["errors"],
            "Pricing delivery method",
        )
        step(f"delivery method '{method['name']}' created at ${method['price']}")


def set_metadata(gql: SaleorClient, object_id: str, pairs: dict[str, str]) -> None:
    """Public metadata on any Saleor object. Used for the things Saleor has no
    native field for — item dimensions, per-item box limits, a tier's recipe."""
    if not pairs:
        return
    data = gql(
        """
        mutation SetMeta($id: ID!, $input: [MetadataInput!]!) {
          updateMetadata(id: $id, input: $input) {
            errors { field message code }
          }
        }
        """,
        id=object_id,
        input=[{"key": k, "value": v} for k, v in pairs.items()],
    )
    check(data["updateMetadata"]["errors"], "Writing metadata")


def ensure_shop_settings(gql: SaleorClient) -> None:
    """Hold stock while a customer is still choosing.

    With one box SKU, "sold out between checkout and Stripe settling" was a
    rounding error. With ten shared item SKUs and several people building
    boxes at once it is a real path into the storefront's PAID BUT NOT ORDERED
    branch, so let Saleor reserve stock at checkoutCreate rather than building
    a reservation of our own.
    """
    data = gql(
        """
        mutation SetShop($input: ShopSettingsInput!) {
          shopSettingsUpdate(input: $input) {
            errors { field message code }
          }
        }
        """,
        input={"reserveStockDurationAnonymousUser": 30},
    )
    check(data["shopSettingsUpdate"]["errors"], "Updating shop settings")
    step("stock held for 30 minutes while a box is being filled")


def ensure_attribute(gql: SaleorClient, name: str, slug: str, values: list[str]) -> str:
    """A dropdown attribute on the item product type.

    These exist for the Saleor dashboard's benefit, not the storefront's:
    they are what make Catalog -> Products filterable by maker and by kind,
    which is the screen Daniya will actually manage stock from.
    """
    existing = gql(
        """
        query FindAttribute($slug: String!) {
          attributes(first: 1, filter: { slugs: [$slug] }) {
            edges { node { id } }
          }
        }
        """,
        slug=slug,
    )
    edges = existing["attributes"]["edges"]
    if edges:
        step(f"attribute '{name}' already exists")
        return edges[0]["node"]["id"]

    data = gql(
        """
        mutation CreateAttribute($input: AttributeCreateInput!) {
          attributeCreate(input: $input) {
            attribute { id }
            errors { field message code }
          }
        }
        """,
        input={
            "name": name,
            "slug": slug,
            "type": "PRODUCT_TYPE",
            "inputType": "DROPDOWN",
            "values": [{"name": v} for v in values],
        },
    )
    check(data["attributeCreate"]["errors"], "Creating attribute")
    step(f"attribute '{name}' created with {len(values)} values")
    return data["attributeCreate"]["attribute"]["id"]


def ensure_flavour_attribute(gql: SaleorClient, type_id: str, values: list[str]) -> str:
    """"Flavour" — the attribute that picks one variant of an item.

    Marked `variantSelection`, which is Saleor's own way of saying "this is the
    choice that distinguishes the variants." The dashboard then renders a
    proper flavour picker, and adding a scent is adding a variant rather than a
    whole new product. It is also what makes swapping native on the storefront:
    the alternatives to an item are simply its sibling variants, so the product
    *is* the swap group and no parallel grouping field is needed.
    """
    existing = gql(
        """
        query FindFlavour($slug: String!) {
          attributes(first: 1, filter: { slugs: [$slug] }) {
            edges { node { id } }
          }
        }
        """,
        slug="flavour",
    )
    edges = existing["attributes"]["edges"]
    if edges:
        attribute_id = edges[0]["node"]["id"]
        step("attribute 'Flavour' already exists")
    else:
        data = gql(
            """
            mutation CreateFlavour($input: AttributeCreateInput!) {
              attributeCreate(input: $input) {
                attribute { id }
                errors { field message code }
              }
            }
            """,
            input={
                "name": "Flavour",
                "slug": "flavour",
                "type": "PRODUCT_TYPE",
                "inputType": "DROPDOWN",
                "values": [{"name": v} for v in values],
            },
        )
        check(data["attributeCreate"]["errors"], "Creating flavour attribute")
        attribute_id = data["attributeCreate"]["attribute"]["id"]
        step(f"attribute 'Flavour' created with {len(values)} values")

    # Assigning it as a VARIANT attribute is what lets one product hold several
    # flavours. Saleor rejects a second assignment of the same attribute, so a
    # re-run is expected to fail here and is ignored.
    try:
        assigned = gql(
            """
            mutation AssignFlavour($productTypeId: ID!, $operations: [ProductAttributeAssignInput!]!) {
              productAttributeAssign(productTypeId: $productTypeId, operations: $operations) {
                errors { field message code }
              }
            }
            """,
            productTypeId=type_id,
            operations=[{"id": attribute_id, "type": "VARIANT", "variantSelection": True}],
        )
        if not assigned["productAttributeAssign"]["errors"]:
            step("'Flavour' assigned as the variant-selection attribute")
    except RuntimeError:
        pass

    return attribute_id


def ensure_numeric_attribute(gql: SaleorClient, name: str, slug: str) -> str:
    """A plain number on the item product page, editable in the dashboard.

    This is metadata's replacement, not a duplicate of it. Saleor 3.23's
    dashboard has no metadata editor at all — a product page ends at Taxes —
    so a rule kept in metadata is one nobody can see or change without a
    re-seed or a hand-written mutation. An attribute is the same fact in the
    one place the dashboard will actually show it.
    """
    existing = gql(
        """
        query FindNumericAttribute($slug: String!) {
          attributes(first: 1, filter: { slugs: [$slug] }) {
            edges { node { id } }
          }
        }
        """,
        slug=slug,
    )
    edges = existing["attributes"]["edges"]
    if edges:
        step(f"attribute '{name}' already exists")
        return edges[0]["node"]["id"]

    data = gql(
        """
        mutation CreateNumericAttribute($input: AttributeCreateInput!) {
          attributeCreate(input: $input) {
            attribute { id }
            errors { field message code }
          }
        }
        """,
        input={
            "name": name,
            "slug": slug,
            "type": "PRODUCT_TYPE",
            "inputType": "NUMERIC",
        },
    )
    check(data["attributeCreate"]["errors"], "Creating numeric attribute")
    step(f"attribute '{name}' created")
    return data["attributeCreate"]["attribute"]["id"]


def ensure_contents_attribute(gql: SaleorClient) -> str:
    """The "Contents" picker on a gift box, in the Saleor dashboard.

    Saleor has no concept of a product made of other products, so the link from
    a box to what is inside it has to be ours. Modelling it as a REFERENCE
    attribute pointing at product variants means Daniya composes a box the way
    she'd expect to — picking real items from a list on the product page — and
    never types JSON into a metadata field.

    A new box she builds this way needs no code change and no re-seed: the
    storefront reads this attribute, so the box appears on the site as soon as
    she publishes it.
    """
    existing = gql(
        """
        query FindContentsAttribute($slug: String!) {
          attributes(first: 1, filter: { slugs: [$slug] }) {
            edges { node { id } }
          }
        }
        """,
        slug="contents",
    )
    edges = existing["attributes"]["edges"]
    if edges:
        step("attribute 'Contents' already exists")
        return edges[0]["node"]["id"]

    data = gql(
        """
        mutation CreateContentsAttribute($input: AttributeCreateInput!) {
          attributeCreate(input: $input) {
            attribute { id }
            errors { field message code }
          }
        }
        """,
        input={
            "name": "Contents",
            "slug": "contents",
            "type": "PRODUCT_TYPE",
            "inputType": "REFERENCE",
            "entityType": "PRODUCT_VARIANT",
        },
    )
    check(data["attributeCreate"]["errors"], "Creating contents attribute")
    step("attribute 'Contents' created — boxes can be composed in the dashboard")
    return data["attributeCreate"]["attribute"]["id"]


def set_slots_attribute(
    gql: SaleorClient, slug: str, attribute_id: str, slots: int
) -> None:
    """Record how many pieces a box holds, where the dashboard can show it."""
    found = gql(
        """
        query FindBox($slug: String!) {
          product(slug: $slug) { id }
        }
        """,
        slug=slug,
    )
    product = found.get("product")
    if not product:
        return
    data = gql(
        """
        mutation SetSlots($id: ID!, $input: ProductInput!) {
          productUpdate(id: $id, input: $input) {
            errors { field message code }
          }
        }
        """,
        id=product["id"],
        input={"attributes": [{"id": attribute_id, "numeric": str(slots)}]},
    )
    check(data["productUpdate"]["errors"], "Setting slots")


def restrict_contents_to(gql: SaleorClient, attribute_id: str, product_type_id: str) -> None:
    """Stop the Contents picker offering things that cannot go in a box.

    Left unset, a REFERENCE attribute offers *every* variant in the store —
    including the gift boxes themselves, so a box could be dropped inside a
    box. `referenceTypes` is Saleor's own way to narrow that, and it is the one
    Mistbox rule the dashboard can genuinely enforce on its own: caps and
    prices have no equivalent and have to live elsewhere.
    """
    data = gql(
        """
        mutation RestrictContents($id: ID!, $input: AttributeUpdateInput!) {
          attributeUpdate(id: $id, input: $input) {
            errors { field message code }
          }
        }
        """,
        id=attribute_id,
        input={"referenceTypes": [product_type_id]},
    )
    check(data["attributeUpdate"]["errors"], "Restricting Contents")
    step("Contents restricted to box items")


def ensure_product_type(
    gql: SaleorClient,
    name: str,
    slug: str,
    product_attributes: list[str] | None = None,
) -> str:
    existing = gql(
        """
        query FindType($slug: String!) {
          productTypes(first: 1, filter: { slugs: [$slug] }) {
            edges { node { id } }
          }
        }
        """,
        slug=slug,
    )
    edges = existing["productTypes"]["edges"]
    if edges:
        type_id = edges[0]["node"]["id"]
        step(f"product type '{name}' already exists")
    else:
        data = gql(
            """
            mutation CreateType($input: ProductTypeInput!) {
              productTypeCreate(input: $input) {
                productType { id }
                errors { field message code }
              }
            }
            """,
            input={
                "name": name,
                "slug": slug,
                "kind": "NORMAL",
                # True for items as well as boxes: a chocolate bar really does
                # ship. Shipping methods are PRICE-type, so weight never enters
                # Saleor's own rate logic — only Shippo's.
                "isShippingRequired": True,
                "isDigital": False,
            },
        )
        check(data["productTypeCreate"]["errors"], "Creating product type")
        type_id = data["productTypeCreate"]["productType"]["id"]
        step(f"product type '{name}' created")

    if product_attributes:
        assigned = gql(
            """
            mutation TypeAttributes($id: ID!, $input: ProductTypeInput!) {
              productTypeUpdate(id: $id, input: $input) {
                errors { field message code }
              }
            }
            """,
            id=type_id,
            input={"productAttributes": product_attributes},
        )
        check(assigned["productTypeUpdate"]["errors"], "Assigning type attributes")

    return type_id


def ensure_category(gql: SaleorClient, name: str, slug: str) -> str:
    """Saleor refuses to publish a product that has no category, so the
    catalogue needs one even though the storefront never lists by category."""
    existing = gql(
        """
        query FindCategory($slug: String!) {
          categories(first: 1, filter: { slugs: [$slug] }) {
            edges { node { id } }
          }
        }
        """,
        slug=slug,
    )
    edges = existing["categories"]["edges"]
    if edges:
        step(f"category '{name}' already exists")
        return edges[0]["node"]["id"]

    data = gql(
        """
        mutation CreateCategory($input: CategoryInput!) {
          categoryCreate(input: $input) {
            category { id }
            errors { field message code }
          }
        }
        """,
        input={"name": name, "slug": slug},
    )
    check(data["categoryCreate"]["errors"], "Creating category")
    step(f"category '{name}' created")
    return data["categoryCreate"]["category"]["id"]


def editorjs(spec: dict[str, Any], items: dict[str, dict[str, Any]] | None = None) -> str:
    """Saleor stores rich text as EditorJS JSON. The description is the pitch;
    the contents list is what actually sells a gift box.

    The contents list is now rendered from the tier's recipe joined against the
    item catalogue, so the marketing copy and the stock that gets decremented
    can never drift apart — they are the same list.
    """
    blocks: list[dict[str, Any]] = [
        {"id": "intro", "type": "paragraph", "data": {"text": spec["description"]}}
    ]
    lines = []
    for entry in spec.get("recipe") or []:
        item = (items or {}).get(entry["sku"])
        if not item:
            continue
        prefix = f"{entry['quantity']} × " if entry["quantity"] > 1 else ""
        flavour = item.get("variant", {}).get("flavour")
        label = f"{item['name']}, {flavour}" if flavour else item["name"]
        lines.append(f"{prefix}{label} — {item['maker']}")
    if lines:
        blocks.append(
            {"id": "inside", "type": "header", "data": {"text": "What's inside", "level": 3}}
        )
        blocks.append(
            {"id": "items", "type": "list", "data": {"style": "unordered", "items": lines}}
        )
    return json.dumps({"time": 0, "blocks": blocks, "version": "2.24.3"})


def unit_cost(spec: dict[str, Any]) -> str:
    """A tier's own cost of goods is now the packaging ALONE.

    The contents' cost lives on the item lines, where the stock does. Adding
    it here as well would double-count every order — the tier and its items
    both appear on the same order.
    """
    return f"{float(spec.get('packagingCost', 0)):.2f}"


def recipe_sum(spec: dict[str, Any], items: dict[str, dict[str, Any]], field: str) -> float:
    """Total a per-variant money field over the curated filling.

    Both cost and price live on the variant, since two flavours of the same bar
    can be worth different money to buy in and so to sell on."""
    return sum(
        float(items[e["sku"]]["variant"][field]) * e["quantity"]
        for e in spec.get("recipe", [])
        if e["sku"] in items
    )


def packed_weight_kg(spec: dict[str, Any], items: dict[str, dict[str, Any]]) -> float:
    """Tare plus contents — what a curated box actually weighs.

    Every number in this sum is an unverified estimate until a real packed box
    goes on a scale; it exists to sanity-check the catalogue, never to price a
    label. The label reads real per-item weights out of Saleor instead.
    """
    return float(spec.get("weightKg", 0)) + sum(
        float(items[e["sku"]]["weightKg"]) * e["quantity"]
        for e in spec.get("recipe", [])
        if e["sku"] in items
    )  # weight is product-wide: flavours of one bar weigh the same


def ensure_item(
    gql: SaleorClient,
    spec: dict[str, Any],
    type_id: str,
    category_id: str,
    channel_id: str,
    warehouse_id: str,
    maker_attr: str,
    kind_attr: str,
    cap_attr: str,
    flavour_attr: str,
) -> None:
    """One kind of thing that goes in a box, with a variant per flavour.

    The product is the thing ("Soy candle, 4 oz"); each variant is the specific
    one you get ("Cedar smoke"). That split is Saleor's own — SKU, stock, cost
    and weight live on the variant — and it is what makes swapping a flavour
    native: the alternatives are the sibling variants, so the product is the
    swap group.

    Anything that costs a different amount belongs in a different product, not
    a different variant. A 4 oz and an 8 oz candle sit on the same shelf but
    not in the same box, and if they were variants a customer swapping a scent
    could swap up a size and quietly move the margin.

    Three things separate an item from a box:
      * `visibleInListings: False` — orderable, never shoppable. Saleor hides
        it from the anonymous products query while checkout ignores that flag.
      * priced at 0.00 — an item is never sold alone, so a price would be
        fiction, and a thing that cannot cost anything cannot leak into a total.
      * a real per-variant weight — the only weight the shipping label reads.
    """
    existing = gql(
        """
        query FindItem($slug: String!) {
          products(first: 1, filter: { slugs: [$slug] }) {
            edges { node { id variants { id sku } } }
          }
        }
        """,
        slug=spec["slug"],
    )
    edges = existing["products"]["edges"]

    if edges:
        product_id = edges[0]["node"]["id"]
        known = {v["sku"]: v["id"] for v in (edges[0]["node"]["variants"] or [])}
        # catalog.json is the source of truth for the name too. Without this a
        # rename never reaches Saleor, and every future order snapshots the old
        # name — which is how "Hand-dyed tea towel, pale sage" ended up sitting
        # next to a Deep fir variant on a packing card.
        renamed = gql(
            """
            mutation RenameItem($id: ID!, $input: ProductInput!) {
              productUpdate(id: $id, input: $input) {
                errors { field message code }
              }
            }
            """,
            id=product_id,
            input={"name": spec["name"]},
        )
        check(renamed["productUpdate"]["errors"], "Renaming item")
        step(f"item '{spec['name']}' already exists")
    else:
        created = gql(
            """
            mutation CreateItem($input: ProductCreateInput!) {
              productCreate(input: $input) {
                product { id }
                errors { field message code }
              }
            }
            """,
            input={
                "name": spec["name"],
                "slug": spec["slug"],
                "productType": type_id,
                "category": category_id,
                "description": json.dumps(
                    {
                        "time": 0,
                        "blocks": [
                            {
                                "id": "maker",
                                "type": "paragraph",
                                "data": {"text": f"{spec['name']} — {spec['maker']}."},
                            }
                        ],
                        "version": "2.24.3",
                    }
                ),
            },
        )
        check(created["productCreate"]["errors"], "Creating item")
        product_id = created["productCreate"]["product"]["id"]
        known = {}
        step(f"item '{spec['name']}' created")

    # Written here rather than in the create branch so that a product which
    # already existed picks up an attribute added later — which is every
    # product, the first time a new one like `max-per-box` appears.
    attributed = gql(
        """
        mutation SetItemAttributes($id: ID!, $input: ProductInput!) {
          productUpdate(id: $id, input: $input) {
            errors { field message code }
          }
        }
        """,
        id=product_id,
        input={
            "attributes": [
                {"id": maker_attr, "dropdown": {"value": spec["maker"]}},
                {"id": kind_attr, "dropdown": {"value": spec["kind"]}},
                {"id": cap_attr, "numeric": str(spec["maxPerBox"])},
            ]
        },
    )
    check(attributed["productUpdate"]["errors"], "Setting item attributes")

    published = gql(
        """
        mutation PublishItem($id: ID!, $input: ProductChannelListingUpdateInput!) {
          productChannelListingUpdate(id: $id, input: $input) {
            errors { field message code }
          }
        }
        """,
        id=product_id,
        input={
            "updateChannels": [
                {
                    "channelId": channel_id,
                    "isPublished": True,
                    # The one flag that makes an item unbrowsable.
                    "visibleInListings": False,
                    "isAvailableForPurchase": True,
                }
            ]
        },
    )
    check(published["productChannelListingUpdate"]["errors"], "Publishing item")

    # Everything that is true of every flavour lives on the product: how much
    # room it takes, how many may go in one box, what it is and who made it.
    set_metadata(
        gql,
        product_id,
        {
            "dims_in": "x".join(str(d) for d in spec["dimsIn"]),
            "max_per_box": str(spec["maxPerBox"]),
            "low_stock_at": str(spec.get("lowStockAt", 12)),
            "maker": spec["maker"],
            "kind": spec["kind"],
        },
    )

    for variant in spec["variants"]:
        sku = variant["sku"]
        variant_id = known.get(sku)

        if variant_id is None:
            made = gql(
                """
                mutation CreateItemVariant($input: ProductVariantCreateInput!) {
                  productVariantCreate(input: $input) {
                    productVariant { id }
                    errors { field message code }
                  }
                }
                """,
                input={
                    "product": product_id,
                    "sku": sku,
                    "name": variant["flavour"],
                    "trackInventory": True,
                    "weight": spec["weightKg"],
                    "attributes": [
                        {"id": flavour_attr, "dropdown": {"value": variant["flavour"]}}
                    ],
                    "stocks": [{"warehouse": warehouse_id, "quantity": variant["stock"]}],
                },
            )
            check(made["productVariantCreate"]["errors"], "Creating item variant")
            variant_id = made["productVariantCreate"]["productVariant"]["id"]
            step(f"  {sku:<12} {variant['flavour']} created, {variant['stock']} in stock")
        else:
            updated = gql(
                """
                mutation UpdateItemVariant($id: ID!, $input: ProductVariantInput!) {
                  productVariantUpdate(id: $id, input: $input) {
                    errors { field message code }
                  }
                }
                """,
                id=variant_id,
                input={
                    "name": variant["flavour"],
                    "weight": spec["weightKg"],
                    "trackInventory": True,
                    # Also set on the update path: a variant seeded before
                    # flavours existed is named "Each" and has no flavour
                    # value, which would leave a blank entry in the picker.
                    "attributes": [
                        {"id": flavour_attr, "dropdown": {"value": variant["flavour"]}}
                    ],
                },
            )
            check(updated["productVariantUpdate"]["errors"], "Updating item variant")

            stocked = gql(
                """
                mutation SetItemStock($variantId: ID!, $stocks: [StockInput!]!) {
                  productVariantStocksUpdate(variantId: $variantId, stocks: $stocks) {
                    errors { field message code }
                  }
                }
                """,
                variantId=variant_id,
                stocks=[{"warehouse": warehouse_id, "quantity": variant["stock"]}],
            )
            check(stocked["productVariantStocksUpdate"]["errors"], "Updating item stock")
            step(f"  {sku:<12} {variant['flavour']} stock set to {variant['stock']}")

        priced = gql(
            """
            mutation PriceItem($id: ID!, $input: [ProductVariantChannelListingAddInput!]!) {
              productVariantChannelListingUpdate(id: $id, input: $input) {
                errors { field message code }
              }
            }
            """,
            id=variant_id,
            input=[
                {
                    "channelId": channel_id,
                    # An item carries its own price, so a box costs what is in
                    # it. Items were priced at 0.00 while the box was a flat
                    # $88/$148 — that made every box the same price whatever it
                    # held, and the margin on one swung 19 points on the
                    # customer's choice alone.
                    "price": variant["price"],
                    "costPrice": variant["cost"],
                }
            ],
        )
        check(priced["productVariantChannelListingUpdate"]["errors"], "Pricing item")


def ensure_product(
    gql: SaleorClient,
    spec: dict[str, Any],
    type_id: str,
    category_id: str,
    channel_id: str,
    warehouse_id: str,
    items: dict[str, dict[str, Any]] | None = None,
) -> None:
    existing = gql(
        """
        query FindProduct($slug: String!) {
          products(first: 1, filter: { slugs: [$slug] }) {
            edges { node { id category { id } variants { id sku } } }
          }
        }
        """,
        slug=spec["slug"],
    )
    edges = existing["products"]["edges"]

    if edges:
        product_id = edges[0]["node"]["id"]
        variants = edges[0]["node"]["variants"] or []
        step(f"product '{spec['name']}' already exists")
        # a product seeded before the category existed cannot be published
        if not edges[0]["node"].get("category"):
            fixed = gql(
                """
                mutation SetCategory($id: ID!, $input: ProductInput!) {
                  productUpdate(id: $id, input: $input) {
                    errors { field message code }
                  }
                }
                """,
                id=product_id,
                input={"category": category_id},
            )
            check(fixed["productUpdate"]["errors"], "Assigning category")
            step(f"category assigned to '{spec['name']}'")
    else:
        created = gql(
            """
            mutation CreateProduct($input: ProductCreateInput!) {
              productCreate(input: $input) {
                product { id }
                errors { field message code }
              }
            }
            """,
            input={
                "name": spec["name"],
                "slug": spec["slug"],
                "productType": type_id,
                "category": category_id,
                "description": editorjs(spec, items),
                # TARE, not the packed weight: this product is the empty
                # carton, tissue, band and card. The contents' weight rides on
                # the item lines, so summing every line on an order gives the
                # real parcel weight with no separate packaging allowance.
                "weight": spec.get("weightKg"),
                "attributes": [],
            },
        )
        check(created["productCreate"]["errors"], "Creating product")
        product_id = created["productCreate"]["product"]["id"]
        variants = []
        step(f"product '{spec['name']}' created")

    # publish in the channel before adding variants, so the variant listing
    # has a published product to attach to
    published = gql(
        """
        mutation PublishProduct($id: ID!, $input: ProductChannelListingUpdateInput!) {
          productChannelListingUpdate(id: $id, input: $input) {
            errors { field message code }
          }
        }
        """,
        id=product_id,
        input={
            "updateChannels": [
                {
                    "channelId": channel_id,
                    "isPublished": True,
                    "visibleInListings": True,
                    "isAvailableForPurchase": True,
                }
            ]
        },
    )
    check(published["productChannelListingUpdate"]["errors"], "Publishing product")

    variant_id = next((v["id"] for v in variants if v["sku"] == spec["sku"]), None)

    if variant_id is None:
        made = gql(
            """
            mutation CreateVariant($input: ProductVariantCreateInput!) {
              productVariantCreate(input: $input) {
                productVariant { id }
                errors { field message code }
              }
            }
            """,
            input={
                "product": product_id,
                "sku": spec["sku"],
                "name": "Forest / gold",
                "trackInventory": True,
                # The tare has to sit on the VARIANT, not only the product:
                # `ProductVariant.weight` does not fall back to the product's
                # weight when it is read, so a product-level-only weight comes
                # back null and the parcel silently loses its carton.
                "weight": spec.get("weightKg"),
                "attributes": [],
                "stocks": [{"warehouse": warehouse_id, "quantity": spec["stock"]}],
            },
        )
        check(made["productVariantCreate"]["errors"], "Creating variant")
        variant_id = made["productVariantCreate"]["productVariant"]["id"]
        step(f"  variant {spec['sku']} created with {spec['stock']} in stock")
    else:
        reweighed = gql(
            """
            mutation SetVariantWeight($id: ID!, $input: ProductVariantInput!) {
              productVariantUpdate(id: $id, input: $input) {
                errors { field message code }
              }
            }
            """,
            id=variant_id,
            input={"weight": spec.get("weightKg")},
        )
        check(reweighed["productVariantUpdate"]["errors"], "Setting carton tare")

        updated = gql(
            """
            mutation SetStock($variantId: ID!, $stocks: [StockInput!]!) {
              productVariantStocksUpdate(variantId: $variantId, stocks: $stocks) {
                errors { field message code }
              }
            }
            """,
            variantId=variant_id,
            stocks=[{"warehouse": warehouse_id, "quantity": spec["stock"]}],
        )
        check(updated["productVariantStocksUpdate"]["errors"], "Updating stock")
        step(f"  variant {spec['sku']} stock {spec['stock']}, tare {spec.get('weightKg')} kg")

    priced = gql(
        """
        mutation PriceVariant($id: ID!, $input: [ProductVariantChannelListingAddInput!]!) {
          productVariantChannelListingUpdate(id: $id, input: $input) {
            errors { field message code }
          }
        }
        """,
        id=variant_id,
        input=[
            {
                "channelId": channel_id,
                "price": spec["price"],
                "costPrice": unit_cost(spec),
            }
        ],
    )
    check(priced["productVariantChannelListingUpdate"]["errors"], "Pricing variant")
    step(f"  variant {spec['sku']} priced at ${spec['price']}")

    # What the storefront needs to expand a tier into real item lines, and to
    # know how many slots it has. catalog.json is the source of truth for
    # these: seed.py overwrites them on every run, so editing the recipe in
    # the dashboard will not survive. Past orders are unaffected either way —
    # the recipe is snapshotted onto the order at checkout.
    set_metadata(
        gql,
        product_id,
        {
            "mistbox.slots": str(spec["slots"]),
            "mistbox.recipe": json.dumps(spec.get("recipe", []), separators=(",", ":")),
            "mistbox.carton": json.dumps(spec.get("carton", {}), separators=(",", ":")),
        },
    )
    step(f"  {spec['slots']} slots and a {len(spec.get('recipe', []))}-item recipe recorded")


# ---------------------------------------------------------------------- main


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed Saleor with the Mistbox catalogue.")
    parser.add_argument("--url", default="http://localhost:8000/graphql/")
    parser.add_argument("--email", required=True, help="Saleor superuser email")
    parser.add_argument("--password", required=True, help="Saleor superuser password")
    parser.add_argument("--catalog", default=str(HERE / "catalog.json"))
    args = parser.parse_args()

    catalog = json.loads(Path(args.catalog).read_text())

    gql = SaleorClient(args.url)
    print(f"Connecting to {args.url}")
    gql.login(args.email, args.password)
    print("Signed in.\n")

    print("Warehouse and channel")
    warehouse_id = ensure_warehouse(gql, catalog["warehouse"])
    channel_id = ensure_channel(gql, catalog["channel"], warehouse_id)

    print("\nDelivery")
    ensure_shipping(gql, catalog["shipping"], channel_id, warehouse_id)

    print("\nStock reservation")
    ensure_shop_settings(gql)

    items = catalog.get("items", [])
    # Indexed by variant SKU, because that is what a recipe names — each entry
    # carries the product (weight, dims, cap) and the variant (cost, stock).
    items_by_sku = {
        v["sku"]: {**i, "variant": v} for i in items for v in i["variants"]
    }

    print("\nItems")
    if items:
        maker_attr = ensure_attribute(
            gql, "Maker", "maker", sorted({i["maker"] for i in items})
        )
        kind_attr = ensure_attribute(
            gql, "Kind", "item-kind", sorted({i["kind"] for i in items})
        )
        cap_attr = ensure_numeric_attribute(gql, "Max per box", "max-per-box")
        item_type_id = ensure_product_type(
            gql, "Box item", "box-item", [maker_attr, kind_attr, cap_attr]
        )
        flavours = sorted({v["flavour"] for i in items for v in i["variants"]})
        flavour_attr = ensure_flavour_attribute(gql, item_type_id, flavours)
        item_category_id = ensure_category(gql, "Box items", "box-items")
        for item in items:
            ensure_item(
                gql,
                item,
                item_type_id,
                item_category_id,
                channel_id,
                warehouse_id,
                maker_attr,
                kind_attr,
                cap_attr,
                flavour_attr,
            )

    print("\nBoxes")
    contents_attr = ensure_contents_attribute(gql)
    if items:
        restrict_contents_to(gql, contents_attr, item_type_id)
    # Capacity is now the authority on how many pieces a box holds, so it has
    # to be something a person can actually change — and 3.23's dashboard has
    # no metadata editor. Same reasoning, and the same mechanism, as
    # `max-per-box` on the items.
    slots_attr = ensure_numeric_attribute(gql, "Slots", "slots")
    type_id = ensure_product_type(gql, "Gift box", "gift-box", [contents_attr, slots_attr])
    category_id = ensure_category(gql, "Gift boxes", "gift-boxes")
    for product in catalog["products"]:
        ensure_product(
            gql, product, type_id, category_id, channel_id, warehouse_id, items_by_sku
        )
        set_slots_attribute(gql, product["slug"], slots_attr, product["slots"])

    print("\nMargins")
    for p in catalog["products"]:
        # A tier's own costPrice is packaging only; the contents' cost sits on
        # the item lines. Real per-order COGS is therefore packaging plus
        # whatever was actually chosen — shown here for the curated recipe.
        packaging = float(unit_cost(p))
        goods = recipe_sum(p, items_by_sku, "cost")
        cogs = packaging + goods
        # The tier's own price is the carton; a box is worth that plus whatever
        # is in it. The curated recipe is what that comes to as shipped.
        carton = float(p["price"])
        price = carton + recipe_sum(p, items_by_sku, "price")
        step(
            f"{p['name']}: ${price:.2f} as curated "
            f"(${carton:.2f} carton + ${price - carton:.2f} contents), "
            f"${cogs:.2f} cost, {100 * (price - cogs) / price:.1f}% gross"
        )
        step(
            f"  {p['slots']} slots · curated fill weighs about "
            f"{packed_weight_kg(p, items_by_sku):.2f} kg (estimated, never weighed)"
        )

    total = sum(p["stock"] for p in catalog["products"])
    print(
        f"\nDone. {len(catalog['products'])} boxes, {total} units in stock, "
        f"channel '{catalog['channel']['slug']}'."
    )
    print("Dashboard: http://localhost:9000   Storefront: http://localhost:3000")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except requests.exceptions.ConnectionError:
        sys.exit("Could not reach Saleor. Is `docker compose up` running?")
    except (RuntimeError, SystemExit) as exc:
        sys.exit(str(exc))
