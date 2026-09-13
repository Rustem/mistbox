"""Refuse a gift box that holds more pieces than it has room for.

This is the one Mistbox rule the Saleor dashboard can be made to enforce
itself, and getting there took two false starts worth recording.

**Not a webhook.** There is no synchronous product webhook in 3.23 — the sync
event enum is payment, tax and shipping only — and `product_updated` fires from
`_post_save_action`, after the write has committed. An app can report the
problem afterwards; it cannot refuse it.

**Not a signal on the assignment model.** The obvious hook, `pre_save` on
`AssignedProductAttributeValue`, never fires: Saleor writes those rows with
`bulk_create` (`saleor/attribute/utils.py:242`), and `bulk_create` sends no
per-row signals. A receiver there looks correct, loads cleanly, and silently
does nothing.

What does work is the one function every attribute assignment passes through,
wrapped before it writes. It receives the product and the complete set of
values, which is exactly what a count needs.

Two rules live here, both about what a box *can* contain: how many pieces fit,
and how many of one thing may go in. Stock and pricing deliberately do not —
they change minute to minute, and a composed box is allowed to name something
that has sold out since. `storefront/src/lib/box.ts` still refuses those at
checkout, which is where it matters.
"""

import logging
from base64 import b64encode
from functools import wraps

from django.core.exceptions import ValidationError

logger = logging.getLogger(__name__)

#: The attribute holding what is in a box.
CONTENTS = "contents"
#: The attribute holding how many pieces the box has room for.
SLOTS = "slots"
#: Where the same number lived before it became an attribute.
SLOTS_METADATA_KEY = "mistbox.slots"
#: How many of one item may go in a single box.
MAX_PER_BOX = "max-per-box"
#: Where *that* number lived before it became an attribute.
MAX_PER_BOX_METADATA_KEY = "max_per_box"

# The code is `invalid` on purpose, and it is the least-bad of a bad set. The
# dashboard renders an error's *code* through its own translation table and
# only shows the server's sentence in a toast, which Chrome dismisses the
# instant a second toast arrives. Probed alternatives are worse:
# `duplicated_input_item` renders as "Variant with these attributes already
# exists", which is untrue and confusing. `invalid` renders as "Invalid
# value" — useless, but at least not a lie.
#
# The sentence itself reaches a human through the Mistbox admin, which does not
# depend on the dashboard's rendering. See `storefront/src/app/embed/verdict`.


def _global_id(kind: str, pk) -> str:
    """The base64 id Saleor's GraphQL layer speaks in.

    `params={"attributes": [...]}` is how Saleor's own attribute errors name
    the offending attribute (see `prepare_error_list_from_error_attribute_mapping`
    in `attribute_assignment.py`), and it expects global ids, not primary keys.
    """
    return b64encode(f"{kind}:{pk}".encode()).decode()


def _attribute_id(slug: str) -> int | None:
    from saleor.attribute.models import Attribute

    return Attribute.objects.filter(slug=slug).values_list("id", flat=True).first()


def _capacity(product) -> int | None:
    """How many pieces this box holds, or None if nothing says.

    The attribute first, because it is the only one of the two anyone can
    change: 3.23's dashboard has no metadata editor.
    """
    from saleor.attribute.models.product import AssignedProductAttributeValue

    recorded = (
        AssignedProductAttributeValue.objects.filter(
            product=product, value__attribute__slug=SLOTS
        )
        .values_list("value__name", flat=True)
        .first()
    )
    if recorded is None:
        recorded = (product.metadata or {}).get(SLOTS_METADATA_KEY)

    try:
        capacity = int(str(recorded).strip())
    except (TypeError, ValueError):
        return None
    return capacity if capacity > 0 else None


def _numbers_for(product_ids, attribute_slug, metadata_key) -> dict[int, int]:
    """A per-product number, from its attribute or failing that its metadata.

    Two queries rather than one per product: a box of eight would otherwise be
    eight round trips inside someone's Save.
    """
    from saleor.attribute.models.product import AssignedProductAttributeValue
    from saleor.product.models import Product

    found: dict[int, int] = {}
    rows = AssignedProductAttributeValue.objects.filter(
        product_id__in=product_ids, value__attribute__slug=attribute_slug
    ).values_list("product_id", "value__name")
    for product_id, raw in rows:
        try:
            found[product_id] = int(str(raw).strip())
        except (TypeError, ValueError):
            continue

    missing = [p for p in product_ids if p not in found]
    if missing:
        for product_id, metadata in Product.objects.filter(id__in=missing).values_list(
            "id", "metadata"
        ):
            try:
                found[product_id] = int(str((metadata or {}).get(metadata_key)).strip())
            except (TypeError, ValueError):
                continue

    return found


def _refuse_too_many_of_one_thing(box, values, contents_id) -> None:
    """The rule that started this: three chocolate bars against a cap of two.

    Counted per *product*, not per flavour — two flavours of one bar are still
    two bars, which is the whole reason the cap sits on the product.
    """
    from collections import Counter

    from saleor.product.models import ProductVariant

    variant_ids = [v.reference_variant_id for v in values if v.reference_variant_id]
    if not variant_ids:
        return

    variants = ProductVariant.objects.filter(id__in=variant_ids).values_list(
        "id", "product_id", "product__name"
    )
    product_of = {vid: (pid, name) for vid, pid, name in variants}

    counts = Counter(
        product_of[vid][0] for vid in variant_ids if vid in product_of
    )
    caps = _numbers_for(list(counts), MAX_PER_BOX, MAX_PER_BOX_METADATA_KEY)

    for product_id, used in counts.items():
        cap = caps.get(product_id)
        if cap is None or used <= cap:
            continue
        name = next(n for _, pid, n in variants if pid == product_id)
        logger.info(
            "Mistbox refused a box with too many of one item: %s, cap %s, got %s",
            name,
            cap,
            used,
        )
        raise ValidationError(
            {
                "attributes": ValidationError(
                    f"Only {cap} {name} fit in a box"
                    + (", in any mix of flavours" if cap > 1 else "")
                    + f" — {box.name} has {used}.",
                    code="invalid",
                    params={"attributes": [_global_id("Attribute", contents_id)]},
                )
            }
        )


def _refuse_an_overfilled_box(instance, attr_val_map) -> None:
    from saleor.product.models import Product

    # The same function assigns attributes to variants and pages too.
    if not isinstance(instance, Product):
        return

    contents_id = _attribute_id(CONTENTS)
    if contents_id is None or contents_id not in attr_val_map:
        return

    values = attr_val_map[contents_id]
    _refuse_too_many_of_one_thing(instance, values, contents_id)

    capacity = _capacity(instance)
    # A box whose size was never recorded is not something to block a save
    # over. Say nothing and let the storefront's own validation speak.
    if capacity is None:
        return

    pieces = len(values)
    if pieces <= capacity:
        return

    logger.info(
        "Mistbox refused an overfilled box: %s holds %s, got %s",
        instance.slug,
        capacity,
        pieces,
    )
    # Keyed to `attributes` and given a code, rather than raised as a bare
    # string. A field-less error arrives in the dashboard as an anonymous
    # toast, and the generic "Invalid value" one it raises alongside outlives
    # it — so the only message left on screen is the one that says nothing.
    raise ValidationError(
        {
            "attributes": ValidationError(
                f"{instance.name} holds {capacity} "
                f"{'piece' if capacity == 1 else 'pieces'} — this is {pieces}. "
                f"Remove {pieces - capacity} and save again.",
                code="invalid",
                params={"attributes": [_global_id("Attribute", contents_id)]},
            )
        }
    )


def install() -> None:
    """Wrap the assignment helper, in the namespace its caller actually uses.

    `attribute_assignment.py` does `from ....attribute.utils import
    associate_attribute_values_to_instance`, which binds the function by name
    at import. Patching it where it is *defined* would therefore change
    nothing — the caller is already holding the original.
    """
    from saleor.graphql.attribute.utils import attribute_assignment as caller

    original = caller.associate_attribute_values_to_instance
    if getattr(original, "__mistbox__", False):
        return

    @wraps(original)
    def guarded(instance, attr_val_map):
        _refuse_an_overfilled_box(instance, attr_val_map)
        return original(instance, attr_val_map)

    guarded.__mistbox__ = True
    caller.associate_attribute_values_to_instance = guarded
    logger.info("Mistbox box-capacity rule installed")
