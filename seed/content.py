#!/usr/bin/env python3
"""
Seed the storefront's editable content pages into Saleor.

    python content.py --email you@example.com --password '...'

Saleor's Page model is its built-in CMS — the "Content" section of the
dashboard. Anything seeded here is meant to be edited there afterwards, by
someone who will never open this file. This script only puts the first draft
in place; it is not the source of truth once the page exists.

Idempotent: pages are looked up by slug and left alone if they already exist,
so re-running will not clobber edits made in the dashboard. Pass --overwrite
to deliberately reset a page back to the copy in this file.
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
        check(data["tokenCreate"]["errors"], "Signing in")
        self.token = data["tokenCreate"]["token"]


def check(errors: list[dict[str, Any]] | None, what: str) -> None:
    if errors:
        detail = "; ".join(
            ": ".join(filter(None, (e.get("field"), e.get("code"), e.get("message"))))
            for e in errors
        )
        raise SystemExit(f"{what} failed — {detail}")


def step(msg: str) -> None:
    print(f"  {msg}")


def editorjs(blocks: list[dict[str, Any]]) -> str:
    """Saleor stores rich text as EditorJS JSON. The dashboard editor reads and
    writes this same shape, which is what makes the page editable by hand."""
    return json.dumps({"time": 0, "blocks": blocks, "version": "2.24.3"})


def para(text: str) -> dict[str, Any]:
    return {"type": "paragraph", "data": {"text": text}}


def heading(text: str, level: int = 2) -> dict[str, Any]:
    return {"type": "header", "data": {"text": text, "level": level}}


# --------------------------------------------------------------- the content

# The first four paragraphs are the owner's own words, kept as written. The
# headings and the sections after "What I learned" are a draft expansion for
# her to rewrite, cut or replace in the dashboard — nothing in them asserts a
# fact about a real person, place or price that she has not said herself.
ABOUT_BLOCKS: list[dict[str, Any]] = [
    para(
        "My home is filled with original art from Pacific Northwest artists, but "
        "it wasn&rsquo;t always this way. I used to actually be terrified of buying "
        "original art&hellip;actually any art above like $100."
    ),
    para(
        "Every purchase felt permanent and I couldn&rsquo;t imagine loving something "
        "for the rest of my life&hellip;especially when it cost tens of thousands of "
        "dollars! And don&rsquo;t even get me started with art galleries. I "
        "wouldn&rsquo;t step foot in one for fear of being laughed at for asking "
        "about the price."
    ),
    para(
        "So for years I bought nothing. I filled the walls with things that were "
        "fine &mdash; a print I liked well enough, a frame that matched the couch, "
        "the sort of thing you stop seeing after a week. A house full of "
        "placeholders, waiting for the day I&rsquo;d earned the right to choose "
        "something real."
    ),
    heading("What changed"),
    para(
        "It took me a while to realize original art doesn&rsquo;t have to be tens of "
        "thousands of dollars. You can find original art for well under "
        "$5,000&hellip;actually a lot of times around $100 depending on the size!"
    ),
    para(
        "The first piece I bought was small. I remember carrying it home and being "
        "almost embarrassed at how much it changed the room &mdash; not the "
        "decoration of it, the feeling of it. Someone had made this. Their hand had "
        "been on it. That is a different thing to live with than something printed "
        "ten thousand times, and you feel the difference every single day."
    ),
    para(
        "What I&rsquo;d been afraid of, it turned out, was never really the price. "
        "It was walking into a room and being made to feel like I didn&rsquo;t "
        "belong there. Those are not the same fear, and only one of them is about "
        "money."
    ),
    heading("Why local makers"),
    para(
        "Since I love to shop local, I wanted to share my favorite Pacific Northwest "
        "artists making modern art that won&rsquo;t break the bank. While a lot of "
        "them also sell prints at much lower prices, I included the price range of "
        "their original artworks so you can get a sense of the investment."
    ),
    para(
        "Buying from someone nearby changes what the money means. It doesn&rsquo;t "
        "disappear into a warehouse &mdash; it goes to a person with a studio, "
        "usually one who will happily tell you what they were thinking about while "
        "they made the thing you just bought. I have never once regretted asking."
    ),
    heading("How Mistbox started"),
    para(
        "Mistbox grew out of that, honestly. I kept wanting to give people the "
        "feeling I&rsquo;d had carrying that first small piece home &mdash; that "
        "something chosen and made by hand had arrived, and it was theirs. So each "
        "box is gathered from makers here in Washington and Oregon, packed by hand, "
        "and sent with a card I write myself."
    ),
    para(
        "No filler. No surplus. Nothing chosen at random, and nothing in a box that "
        "I wouldn&rsquo;t be glad to receive.",
    ),
    para(
        "Now let&rsquo;s get your home filled with wall art you&rsquo;ll love &mdash; "
        "and maybe get a box in the mail to someone who could use one."
    ),
]

PAGES: list[dict[str, Any]] = [
    {
        "slug": "about",
        "title": "About",
        "blocks": ABOUT_BLOCKS,
        "seoTitle": "About — Mistbox",
        "seoDescription": (
            "Why Mistbox exists, and the Pacific Northwest artists and makers "
            "behind it."
        ),
    },
]


# ------------------------------------------------------- stage and email copy
#
# Every customer-facing word outside the catalogue lives here as an ordinary
# page, so Daniya can change it in the dashboard without a deploy.
#
# The storefront ships complete built-in defaults, identical to the copy below.
# These pages only *override* them, which is why the site worked before they
# existed and keeps working if one is deleted. Code owns the layout, the stage
# ordering and which carrier status maps to which stage; content owns words.
#
# Stage pages: the title is the label on the timeline, the first paragraph is
# the line underneath it.
STAGE_PAGES: list[dict[str, Any]] = [
    (
        "stage-confirmed",
        "Order confirmed",
        "We have your order and your card details are settled.",
    ),
    (
        "stage-packing",
        "Being packed",
        "Your box is being filled by hand in Seattle, on pale sage tissue.",
    ),
    (
        "stage-card-written",
        "Card written",
        "Your message has been written out in ink and laid on top.",
    ),
    ("stage-sealed", "Sealed", "Banded, sealed and waiting for the post."),
    (
        "stage-shipped",
        "On its way",
        "Handed to the carrier. Tracking is live below.",
    ),
    ("stage-in-transit", "In transit", "Travelling towards the delivery address."),
    ("stage-delivered", "Delivered", "It arrived. We hope it was opened slowly."),
]

# Email pages: the title is the subject line, the first paragraph is the big
# headline, and every paragraph after it is body copy.
EMAIL_PAGES: list[dict[str, Any]] = [
    (
        "email-order-confirmed",
        "Your Mistbox is confirmed",
        [
            "Your box is confirmed.",
            "Thank you — this is the receipt. We will write to you once more on "
            "the day it ships.",
        ],
    ),
    (
        "email-order-shipped",
        "Your Mistbox is on its way",
        [
            "It is on its way.",
            "Packed, sealed and handed to the carrier this morning. You can "
            "follow it below, and we will write once more when it arrives.",
        ],
    ),
    (
        "email-order-delivered",
        "Your Mistbox has arrived",
        [
            "It arrived.",
            "Your box was delivered today. We hope it was opened slowly.",
            "If you hear how it landed, we would love to know — just reply to "
            "this email.",
        ],
    ),
]


def _stage_spec(slug: str, title: str, note: str) -> dict[str, Any]:
    return {
        "slug": slug,
        "title": title,
        "blocks": [para(note)],
        "seoTitle": title,
        "seoDescription": "Order status wording. Not a public page.",
    }


def _email_spec(slug: str, subject: str, paragraphs: list[str]) -> dict[str, Any]:
    return {
        "slug": slug,
        "title": subject,
        "blocks": [para(t) for t in paragraphs],
        "seoTitle": subject,
        "seoDescription": "Email wording. Not a public page.",
    }


PAGES += [_stage_spec(*row) for row in STAGE_PAGES]
PAGES += [_email_spec(*row) for row in EMAIL_PAGES]

PAGE_TYPE_NAME = "Standard page"
PAGE_TYPE_SLUG = "standard-page"


# ------------------------------------------------------------------ mutations


def ensure_page_type(gql: SaleorClient) -> str:
    existing = gql(
        """
        query FindPageType($slug: String!) {
          pageTypes(first: 1, filter: { slugs: [$slug] }) {
            edges { node { id } }
          }
        }
        """,
        slug=PAGE_TYPE_SLUG,
    )
    edges = existing["pageTypes"]["edges"]
    if edges:
        step(f"page type '{PAGE_TYPE_NAME}' already exists")
        return edges[0]["node"]["id"]

    data = gql(
        """
        mutation CreatePageType($input: PageTypeCreateInput!) {
          pageTypeCreate(input: $input) {
            pageType { id }
            errors { field message code }
          }
        }
        """,
        input={"name": PAGE_TYPE_NAME, "slug": PAGE_TYPE_SLUG},
    )
    check(data["pageTypeCreate"]["errors"], "Creating page type")
    step(f"page type '{PAGE_TYPE_NAME}' created")
    return data["pageTypeCreate"]["pageType"]["id"]


def ensure_page(
    gql: SaleorClient, spec: dict[str, Any], type_id: str, overwrite: bool
) -> None:
    existing = gql(
        """
        query FindPage($slug: String!) {
          page(slug: $slug) { id title }
        }
        """,
        slug=spec["slug"],
    )
    page = existing["page"]

    content = editorjs(spec["blocks"])

    if page and not overwrite:
        step(
            f"page '{spec['slug']}' already exists — left as is "
            f"(--overwrite to reset it)"
        )
        return

    if page:
        data = gql(
            """
            mutation UpdatePage($id: ID!, $input: PageInput!) {
              pageUpdate(id: $id, input: $input) {
                errors { field message code }
              }
            }
            """,
            id=page["id"],
            input={
                "title": spec["title"],
                "content": content,
                "isPublished": True,
                "seo": {
                    "title": spec["seoTitle"],
                    "description": spec["seoDescription"],
                },
            },
        )
        check(data["pageUpdate"]["errors"], "Updating page")
        step(f"page '{spec['slug']}' reset to the copy in this file")
        return

    data = gql(
        """
        mutation CreatePage($input: PageCreateInput!) {
          pageCreate(input: $input) {
            page { id }
            errors { field message code }
          }
        }
        """,
        input={
            "slug": spec["slug"],
            "title": spec["title"],
            "content": content,
            "pageType": type_id,
            "isPublished": True,
            "seo": {"title": spec["seoTitle"], "description": spec["seoDescription"]},
        },
    )
    check(data["pageCreate"]["errors"], "Creating page")
    step(f"page '{spec['slug']}' created and published")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Seed Saleor with the Mistbox content pages."
    )
    parser.add_argument("--url", default="http://localhost:8000/graphql/")
    parser.add_argument("--email", required=True, help="Saleor superuser email")
    parser.add_argument("--password", required=True, help="Saleor superuser password")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Reset existing pages to the copy in this file, discarding dashboard edits",
    )
    args = parser.parse_args()

    gql = SaleorClient(args.url)
    print(f"Connecting to {args.url}")
    gql.login(args.email, args.password)
    print("Signed in.\n")

    print("Content")
    type_id = ensure_page_type(gql)
    for spec in PAGES:
        ensure_page(gql, spec, type_id, args.overwrite)

    print(
        "\nDone. Edit these in the dashboard under Content -> Models — the 3.23 "
        "dashboard calls pages 'Models', though the API still calls them pages.\n"
        "Changes appear within a few minutes; no redeploy."
    )
    print("  Dashboard      http://localhost:9000/models")
    print("  About page     http://localhost:3000/about")
    print("  Stage wording  pages beginning 'stage-' — title is the label on the")
    print("                 timeline, first paragraph is the line beneath it")
    print("  Email wording  pages beginning 'email-order-' — title is the subject,")
    print("                 first paragraph the headline, the rest the body")
    print("  Preview email  http://localhost:3000/api/dev/email-preview?type=shipped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
