#!/usr/bin/env python3
"""
Render a placeholder photo for every item variant.

    python images/render_items.py

These are flat illustrations built from the packaging palette — a tin, a bar, a
jar, a candle — not photographs, and they exist so the builder and the shop can
be designed and reviewed before any real product photography exists. Each
variant gets its own image so a flavour is visibly a different thing on screen:
that is the whole point of assigning media per variant rather than per product.

Replace every one of these with real photography before launch.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
CATALOG = HERE.parent / "catalog.json"
OUT = HERE / "items"

# The packaging palette, same values render.py uses.
FOREST = (43, 58, 49)
FIR = (74, 93, 78)
SAGE = (143, 163, 148)
PALE_SAGE = (185, 199, 188)
GOLD = (198, 164, 98)
BONE = (239, 233, 222)
PAPER = (246, 242, 234)

SIZE = 1000

# A colour per flavour, so two scents of the same candle read as two things.
# Kept inside the brand's own range rather than reaching for arbitrary hues.
FLAVOUR_TINT: dict[str, tuple[int, int, int]] = {
    "Cascade black": (58, 52, 46),
    "Misty green": (108, 128, 106),
    "Cedar mint tisane": (128, 158, 138),
    "Alder-smoked salt": (74, 56, 44),
    "Dark milk": (110, 78, 54),
    "Truffle mix": (86, 62, 58),
    "Wildflower": (198, 154, 74),
    "Lavender": (140, 128, 164),
    "Original": (206, 186, 140),
    "Pale sage": PALE_SAGE,
    "Deep fir": FIR,
    "Douglas fir": (62, 86, 68),
    "Cedar smoke": (104, 90, 74),
    "First rain": (120, 136, 148),
    "Hand-planed": (150, 118, 84),
}


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """Whatever serif the machine has. These are placeholders; the brand faces
    are only worth wiring up for artwork that ships."""
    for name in (
        "/System/Library/Fonts/Supplemental/Georgia.ttf",
        "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
        "/Library/Fonts/Georgia.ttf",
    ):
        if Path(name).exists():
            return ImageFont.truetype(name, size)
    return ImageFont.load_default(size)


def centred(draw: ImageDraw.ImageDraw, y: int, text: str, f, fill, spacing: int = 0) -> None:
    if spacing:
        total = sum(draw.textlength(ch, font=f) + spacing for ch in text) - spacing
        x = (SIZE - total) / 2
        for ch in text:
            draw.text((x, y), ch, font=f, fill=fill)
            x += draw.textlength(ch, font=f) + spacing
    else:
        w = draw.textlength(text, font=f)
        draw.text(((SIZE - w) / 2, y), text, font=f, fill=fill)


def wrap(draw: ImageDraw.ImageDraw, text: str, f, limit: int) -> list[str]:
    words, lines, line = text.split(), [], ""
    for word in words:
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=f) <= limit:
            line = trial
        else:
            if line:
                lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def shape_for(kind: str, slug: str) -> str:
    if "candle" in slug:
        return "candle"
    if "tea" in slug and "towel" not in slug:
        return "tin"
    if "chocolate" in slug:
        return "bar"
    if "honey" in slug:
        return "jar"
    if "towel" in slug:
        return "towel"
    if "tomme" in slug:
        return "wedge"
    return "block"


def draw_object(d: ImageDraw.ImageDraw, shape: str, tint: tuple[int, int, int]) -> None:
    """A simple flat silhouette, centred, so the eye can tell a tin from a bar."""
    cx, cy = SIZE // 2, 470
    edge = tuple(max(0, c - 22) for c in tint)

    if shape == "tin":
        d.rounded_rectangle([cx - 130, cy - 150, cx + 130, cy + 150], 18, fill=tint, outline=edge, width=3)
        d.rounded_rectangle([cx - 140, cy - 175, cx + 140, cy - 120], 14, fill=edge)
        d.line([cx - 130, cy + 40, cx + 130, cy + 40], fill=BONE, width=2)
    elif shape == "bar":
        d.rounded_rectangle([cx - 210, cy - 105, cx + 210, cy + 105], 14, fill=tint, outline=edge, width=3)
        for i in range(1, 4):
            x = cx - 210 + i * 105
            d.line([x, cy - 105, x, cy + 105], fill=edge, width=3)
        d.line([cx - 210, cy, cx + 210, cy], fill=edge, width=3)
    elif shape == "jar":
        d.rounded_rectangle([cx - 105, cy - 90, cx + 105, cy + 160], 26, fill=tint, outline=edge, width=3)
        d.rounded_rectangle([cx - 118, cy - 140, cx + 118, cy - 84], 14, fill=edge)
        d.ellipse([cx - 62, cy - 30, cx + 62, cy + 92], fill=BONE)
    elif shape == "candle":
        d.rounded_rectangle([cx - 120, cy - 70, cx + 120, cy + 150], 16, fill=tint, outline=edge, width=3)
        d.ellipse([cx - 120, cy - 100, cx + 120, cy - 40], fill=edge)
        d.line([cx, cy - 100, cx, cy - 145], fill=FOREST, width=6)
        d.ellipse([cx - 16, cy - 195, cx + 16, cy - 140], fill=GOLD)
    elif shape == "towel":
        d.rounded_rectangle([cx - 165, cy - 165, cx + 165, cy + 165], 10, fill=tint, outline=edge, width=3)
        for i in range(1, 5):
            y = cy - 165 + i * 66
            d.line([cx - 165, y, cx + 165, y], fill=BONE, width=2)
        d.line([cx - 120, cy - 165, cx - 120, cy + 165], fill=BONE, width=2)
    elif shape == "wedge":
        d.polygon([(cx - 190, cy + 120), (cx + 190, cy + 120), (cx + 60, cy - 130)], fill=tint, outline=edge)
        d.ellipse([cx - 70, cy + 20, cx - 30, cy + 60], fill=BONE)
        d.ellipse([cx + 10, cy + 50, cx + 44, cy + 84], fill=BONE)
    else:
        d.rounded_rectangle([cx - 180, cy - 60, cx + 180, cy + 60], 8, fill=tint, outline=edge, width=3)
        for i in range(1, 6):
            x = cx - 180 + i * 60
            d.line([x, cy - 60, x, cy + 60], fill=edge, width=2)


def render(product: dict, variant: dict, path: Path) -> None:
    tint = FLAVOUR_TINT.get(variant["flavour"], SAGE)
    img = Image.new("RGB", (SIZE, SIZE), PAPER)
    d = ImageDraw.Draw(img)

    d.rectangle([40, 40, SIZE - 40, SIZE - 40], outline=PALE_SAGE, width=2)
    draw_object(d, shape_for(product["kind"], product["slug"]), tint)

    d.line([SIZE // 2 - 40, 690, SIZE // 2 + 40, 690], fill=GOLD, width=2)

    name_font, flavour_font, small = font(40), font(52), font(24)
    y = 730
    for line in wrap(d, product["name"], name_font, 720):
        centred(d, y, line, name_font, FIR)
        y += 50
    centred(d, y + 6, variant["flavour"], flavour_font, FOREST)
    centred(d, y + 78, product["maker"].upper(), small, SAGE, spacing=3)

    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", default=str(CATALOG))
    args = parser.parse_args()

    catalog = json.loads(Path(args.catalog).read_text())
    count = 0
    for product in catalog.get("items", []):
        for variant in product["variants"]:
            out = OUT / f"{variant['sku'].lower()}.png"
            render(product, variant, out)
            print(f"  {out.relative_to(HERE.parent)}  {product['name']} — {variant['flavour']}")
            count += 1
    print(f"\n{count} placeholder item images. Replace with real photography before launch.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
