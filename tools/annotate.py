#!/usr/bin/env python3
"""
Label the screenshots captured by `tools/screens.mjs`.

    node tools/screens.mjs && python3 tools/annotate.py

Each shot gets a titled header in the brand palette and, where the capture
recorded one, numbered callouts pointing at what is new. Output lands in
docs/screens/<flow>/, one folder per flow, plus an index README.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent.parent
OUT = ROOT / "docs" / "screens"
RAW = OUT / ".raw"

FOREST = (43, 58, 49)
FIR = (74, 93, 78)
SAGE = (143, 163, 148)
GOLD = (198, 164, 98)
BONE = (239, 233, 222)
PAPER = (246, 242, 234)
WHITE = (255, 255, 255)

HEADER = 128
PAD = 34
MARGIN = 28


def font(size: int, serif: bool = False) -> ImageFont.FreeTypeFont:
    names = (
        ["/System/Library/Fonts/Supplemental/Georgia.ttf"]
        if serif
        else [
            "/System/Library/Fonts/Helvetica.ttc",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
        ]
    )
    for name in names:
        if Path(name).exists():
            return ImageFont.truetype(name, size)
    return ImageFont.load_default(size)


def wrap(draw: ImageDraw.ImageDraw, text: str, f, limit: int) -> list[str]:
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=f) <= limit:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def annotate(shot: dict) -> Path:
    src = Image.open(RAW / f"{shot['name']}.png").convert("RGB")
    marks = shot.get("marks", [])
    ox, oy = shot["origin"]["x"], shot["origin"]["y"]

    # Callout labels sit in a gutter to the right so they never cover the UI.
    gutter = 330 if marks else 0
    width = src.width + gutter + MARGIN * 2
    legend_h = 0

    canvas = Image.new("RGB", (width, HEADER + src.height + MARGIN * 2 + legend_h), PAPER)
    d = ImageDraw.Draw(canvas)

    # ---- header
    d.rectangle([0, 0, width, HEADER], fill=FOREST)
    d.text((MARGIN, 26), shot["flow"].upper(), font=font(15), fill=GOLD)
    d.text((MARGIN, 50), shot["title"], font=font(30, serif=True), fill=BONE)
    for i, line in enumerate(wrap(d, shot["note"], font(15), width - MARGIN * 2)[:2]):
        d.text((MARGIN, 92 + i * 19), line, font=font(15), fill=SAGE)

    canvas.paste(src, (MARGIN, HEADER + MARGIN))
    d.rectangle(
        [MARGIN, HEADER + MARGIN, MARGIN + src.width, HEADER + MARGIN + src.height],
        outline=(214, 206, 192),
        width=1,
    )

    # ---- callouts
    badge, label = font(19), font(16)

    # Two targets at the same height would stack their labels on top of each
    # other, so badges are placed in reading order and pushed apart to a
    # minimum gap. The leader line still points at the real element.
    placed: list[dict] = []
    for mark in marks:
        y = HEADER + MARGIN + (mark["y"] - oy)
        if y < HEADER or y + mark["h"] > HEADER + MARGIN + src.height:
            continue  # the clip cut this one off
        placed.append({**mark, "top": y})
    placed.sort(key=lambda m: m["top"])

    gap = 26 * (1 + max((len(wrap(d, m["text"], label, gutter - 60)) for m in placed), default=1))
    last = -1e9
    for i, mark in enumerate(placed, start=1):
        x = MARGIN + (mark["x"] - ox)
        y = mark["top"]
        w, h = mark["w"], mark["h"]

        d.rectangle([x - 6, y - 6, x + w + 6, y + h + 6], outline=GOLD, width=3)

        cy = max(y + h / 2, last + gap)
        last = cy
        bx = MARGIN + src.width + 26
        d.line([x + w + 6, y + h / 2, bx - 26, y + h / 2, bx - 26, cy, bx - 14, cy],
               fill=GOLD, width=2)
        d.ellipse([bx - 14 - 15, cy - 15, bx - 14 + 15, cy + 15], fill=GOLD)
        num = str(i)
        d.text(
            (bx - 14 - d.textlength(num, font=badge) / 2, cy - 12), num, font=badge, fill=FOREST
        )

        for j, line in enumerate(wrap(d, mark["text"], label, gutter - 60)):
            d.text((bx + 12, cy - 10 + j * 20), line, font=label, fill=FIR)

    dest = OUT / shot["flow"] / f"{shot['name']}.png"
    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dest, "PNG")
    return dest


def main() -> int:
    manifest = json.loads((RAW / "manifest.json").read_text())

    for flow in {s["flow"] for s in manifest}:
        shutil.rmtree(OUT / flow, ignore_errors=True)

    flows: dict[str, list[dict]] = {}
    for shot in manifest:
        dest = annotate(shot)
        flows.setdefault(shot["flow"], []).append({**shot, "file": dest})
        print(f"  {dest.relative_to(ROOT)}")

    titles = {
        "shop": "Shop — what a visitor sees",
        "build": "Build — choosing what goes in the box",
        "limits": "Limits — what the builder will not allow",
        "receipt": "Receipt — what the buyer gets back",
        "email": "Email — the confirmation",
        "pack": "Pack — Daniya's screen",
        "dashboard": "Dashboard — Saleor, where boxes and items are managed",
    }
    order = ["shop", "build", "limits", "receipt", "email", "pack", "dashboard"]

    lines = [
        "# Mistbox — the box builder, in screenshots",
        "",
        "Every shot is from the running app, captured by `node tools/screens.mjs`",
        "and labelled by `python3 tools/annotate.py`. Re-run both to refresh.",
        "",
        "> Item names, makers, weights and photography are **placeholders** until the",
        "> real Seattle Chocolate, Franz and Smith Tea catalogues arrive.",
        "",
    ]
    for flow in order:
        if flow not in flows:
            continue
        lines += [f"## {titles.get(flow, flow)}", ""]
        for shot in flows[flow]:
            rel = Path(shot["flow"]) / shot["file"].name
            lines += [f"**{shot['title']}**", "", shot["note"], "", f"![{shot['title']}]({rel})", ""]

    (OUT / "README.md").write_text("\n".join(lines))
    print(f"\n{len(manifest)} labelled shots in {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
