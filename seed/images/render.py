#!/usr/bin/env python3
"""
Render Mistbox product images from the packaging spec.

These are flat top-down illustrations of the lid, not photographs — honest
placeholders that carry the real palette, emblem and typography until the
printed boxes exist and can be shot properly.

Needs Pillow, cairosvg, and the two Google fonts:

    pip install pillow cairosvg
    # Cormorant Garamond and Jost, from https://fonts.google.com
    python render.py --fonts /path/to/font/dir
"""

from __future__ import annotations

import argparse
import io
from pathlib import Path

import cairosvg
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).parent

# Packaging spec palette
FOREST = (43, 58, 49)
FIR = (74, 93, 78)
SAGE = (143, 163, 148)
PALE_SAGE = (185, 199, 188)
GOLD = (198, 164, 98)
BONE = (239, 233, 222)

# Six costed colourways: (name, lid ink, mark colour)
COLOURWAYS = {
    "01": ("forest / gold foil", FOREST, GOLD),
    "02": ("fir / gold foil", FIR, GOLD),
    "03": ("sage / bone", SAGE, BONE),
    "04": ("pale sage / forest", PALE_SAGE, FOREST),
    "05": ("bone / gold foil", BONE, GOLD),
    "06": ("bone / forest", BONE, FOREST),
}

CANVAS = 1600  # square product image
LID_W, LID_H = 1180, 918  # 9 × 7 in at ~131 px/in

EMBLEM_SVG = """
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 128" width="{w}" height="{h}">
  <g fill="none" stroke="{c}" stroke-width="1.5"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 120 V50 A42 42 0 0 1 92 50 V120"/>
    <path d="M8 120 H92"/>
    <path d="M18 86 L38 54 L52 76 L61 64 L84 86"/>
    <path d="M30 88 L26.4 94.5 h2.1 L24.6 99 h2.6 L22.5 103.5 h15 L35.4 99 h2.6 L33.6 94.5 h2.1 Z"/>
    <path d="M30 103.5 v4"/>
    <path d="M15 111 H85" stroke-dasharray="9 6"/>
  </g>
</svg>
"""

FIR_SVG = """
<svg xmlns="http://www.w3.org/2000/svg" viewBox="21 86 18 23" width="{w}" height="{h}">
  <g fill="none" stroke="{c}" stroke-width="1.1"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M30 88 L26.4 94.5 h2.1 L24.6 99 h2.6 L22.5 103.5 h15 L35.4 99 h2.6 L33.6 94.5 h2.1 Z"/>
    <path d="M30 103.5 v4"/>
  </g>
</svg>
"""


def hexof(rgb: tuple[int, int, int]) -> str:
    return "#%02x%02x%02x" % rgb


def svg_layer(template: str, width: int, height: int, colour: tuple[int, int, int]) -> Image.Image:
    png = cairosvg.svg2png(
        bytestring=template.format(w=width, h=height, c=hexof(colour)).encode(),
        output_width=width,
        output_height=height,
    )
    return Image.open(io.BytesIO(png)).convert("RGBA")


def load_font(fonts: Path, family: str, size: int, weight: int = 300) -> ImageFont.FreeTypeFont:
    candidates = list(fonts.rglob(f"*{family}*[[]wght[]].ttf")) + list(
        fonts.rglob(f"*{family}*.ttf")
    )
    candidates = [c for c in candidates if "Italic" not in c.name]
    if not candidates:
        raise SystemExit(f"Could not find a {family} .ttf under {fonts}")
    font = ImageFont.truetype(str(candidates[0]), size)
    try:
        font.set_variation_by_axes([weight])
    except Exception:
        pass  # static instance, nothing to set
    return font


def tracked_width(draw: ImageDraw.ImageDraw, text: str, font, tracking: float) -> float:
    """Width of `text` with `tracking` px added after every character."""
    total = sum(draw.textlength(ch, font=font) for ch in text)
    return total + tracking * max(0, len(text) - 1)


def draw_tracked(
    draw: ImageDraw.ImageDraw,
    centre_x: float,
    y: float,
    text: str,
    font,
    tracking: float,
    fill,
) -> None:
    """Uppercase tracked type, optically centred (tracking is not added after
    the final letter, which is the usual mistake)."""
    x = centre_x - tracked_width(draw, text, font, tracking) / 2
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + tracking


def paper_ground() -> Image.Image:
    """Bone background with a very slight warm vignette, so the box sits on
    something rather than floating on flat colour."""
    img = Image.new("RGB", (CANVAS, CANVAS), BONE)
    vignette = Image.new("L", (CANVAS, CANVAS), 0)
    ImageDraw.Draw(vignette).ellipse(
        (-CANVAS * 0.25, -CANVAS * 0.25, CANVAS * 1.25, CANVAS * 1.25), fill=90
    )
    vignette = vignette.filter(ImageFilter.GaussianBlur(CANVAS // 8))
    shade = Image.new("RGB", (CANVAS, CANVAS), (222, 214, 200))
    return Image.composite(img, shade, vignette)


def lid(fonts: Path, colourway: str, band: bool = False) -> Image.Image:
    label, ink, mark = COLOURWAYS[colourway]
    img = paper_ground()

    x0 = (CANVAS - LID_W) // 2
    y0 = (CANVAS - LID_H) // 2
    box = (x0, y0, x0 + LID_W, y0 + LID_H)

    # drop shadow
    shadow = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rectangle(
        (x0 + 10, y0 + 22, x0 + LID_W + 10, y0 + LID_H + 26), fill=(40, 46, 40, 70)
    )
    img = Image.alpha_composite(
        img.convert("RGBA"), shadow.filter(ImageFilter.GaussianBlur(26))
    ).convert("RGB")

    draw = ImageDraw.Draw(img)
    draw.rectangle(box, fill=ink)

    # blind deboss border — an inset rule, slightly darker or lighter than
    # the ink depending on how dark the lid is
    inset = 46
    lightish = sum(ink) > 480
    deboss = tuple(max(0, c - 18) for c in ink) if lightish else tuple(min(255, c + 20) for c in ink)
    draw.rectangle(
        (x0 + inset, y0 + inset, x0 + LID_W - inset, y0 + LID_H - inset),
        outline=deboss,
        width=2,
    )

    centre_x = x0 + LID_W / 2

    # emblem
    em_w = 190
    em_h = int(em_w * 1.28)
    emblem = svg_layer(EMBLEM_SVG, em_w, em_h, mark)
    img.paste(emblem, (int(centre_x - em_w / 2), y0 + 196), emblem)

    # wordmark — Cormorant Garamond Light, 0.38em tracking
    wm_size = 108
    wm_font = load_font(fonts, "CormorantGaramond", wm_size, 300)
    draw_tracked(draw, centre_x, y0 + 440, "MISTBOX", wm_font, wm_size * 0.38, mark)

    # tagline — Jost Light, 0.30em tracking, two lines, on the lid under
    # the wordmark exactly as the copy system says
    tag_size = 27
    tag_font = load_font(fonts, "Jost", tag_size, 300)
    draw_tracked(draw, centre_x, y0 + 620, "THOUGHTFULLY GATHERED", tag_font, tag_size * 0.30, mark)
    draw_tracked(draw, centre_x, y0 + 672, "BEAUTIFULLY GIVEN", tag_font, tag_size * 0.30, mark)

    if band:
        # The belly band wraps the 7 x 3 in girth, so on a 9 x 7 lid it runs
        # across the 9 in dimension: a 4 in vertical stripe. It is centred, and
        # it crosses the mark -- removing it reveals the wordmark. That is the
        # design decision recorded in the packaging spec, not an accident.
        band_w = int(LID_W * 4 / 9)
        bx = int(centre_x - band_w / 2)
        overhang = 20

        shadow = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rectangle(
            (bx - 6, y0 - overhang, bx + band_w + 6, y0 + LID_H + overhang),
            fill=(20, 26, 20, 120),
        )
        img = Image.alpha_composite(
            img.convert("RGBA"), shadow.filter(ImageFilter.GaussianBlur(9))
        ).convert("RGB")
        draw = ImageDraw.Draw(img)

        band_ink = BONE if ink != BONE else FOREST
        band_type = FOREST if band_ink == BONE else BONE

        draw.rectangle(
            (bx, y0 - overhang, bx + band_w, y0 + LID_H + overhang), fill=band_ink
        )
        # the folded edges where the band turns under the box
        fold = tuple(max(0, c - 22) for c in band_ink)
        draw.rectangle((bx, y0 - overhang, bx + band_w, y0 - overhang + 7), fill=fold)
        draw.rectangle(
            (bx, y0 + LID_H + overhang - 7, bx + band_w, y0 + LID_H + overhang), fill=fold
        )

        bt_size = 23
        bt_font = load_font(fonts, "Jost", bt_size, 300)
        mid = y0 + LID_H / 2
        draw_tracked(
            draw, centre_x, mid - bt_size * 1.9, "INSPIRED BY NATURE.",
            bt_font, bt_size * 0.30, band_type,
        )
        draw_tracked(
            draw, centre_x, mid + bt_size * 0.4, "MADE TO CONNECT.",
            bt_font, bt_size * 0.30, band_type,
        )

    return img


def seal(fonts: Path) -> Image.Image:
    """The 2 in kiss-cut sticker seal: forest flood, gold fir, no wordmark."""
    size = 900
    img = paper_ground().resize((size, size))
    draw = ImageDraw.Draw(img)
    pad = 120
    draw.ellipse((pad, pad, size - pad, size - pad), fill=FOREST)
    draw.ellipse(
        (pad + 26, pad + 26, size - pad - 26, size - pad - 26), outline=GOLD, width=2
    )
    fir_w = 300
    fir_h = int(fir_w * 23 / 18)
    fir = svg_layer(FIR_SVG, fir_w, fir_h, GOLD)
    img.paste(fir, ((size - fir_w) // 2, (size - fir_h) // 2), fir)
    return img


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fonts", default="/usr/share/fonts", help="directory holding the TTFs")
    parser.add_argument("--out", default=str(HERE))
    args = parser.parse_args()

    fonts = Path(args.fonts)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    jobs = {
        "mistbox-signature-lid.png": lambda: lid(fonts, "01"),
        "mistbox-signature-banded.png": lambda: lid(fonts, "01", band=True),
        "mistbox-grand-lid.png": lambda: lid(fonts, "02"),
        "mistbox-grand-banded.png": lambda: lid(fonts, "02", band=True),
        "mistbox-seal.png": lambda: seal(fonts),
    }

    for name, make in jobs.items():
        path = out / name
        make().save(path, "PNG", optimize=True)
        print(f"  {name}")

    print(f"\n{len(jobs)} images written to {out}")


if __name__ == "__main__":
    main()
