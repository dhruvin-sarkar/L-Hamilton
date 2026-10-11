"""
The share card: the picture a link to the site unfurls with.

A link pasted into a message or a post is drawn from the page's Open Graph and
Twitter tags (written by vite.config.ts, headTags), and those need an image.
This build ships no photography of its own to put there (CLAUDE.md: no
copyrighted media), so the card is an original graphic made from what the site
already owns:

  - a Rosso Corsa ground;
  - the LH monogram, read from public/assets/brand/lh-monogram.svg, so the
    card and the site cannot carry two different marks;
  - the wordmark as the nav sets it: "Lewis" in Playfair Display italic over
    "HAMILTON" in condensed Mona Sans, at the lockup's own ratio and tracking
    (home.css, .wordmark). Both faces are OFL and shipped in
    public/assets/fonts.

Everything sits inside the middle 630 px, because some previews crop the card
to a square.

  python tools/gen-brand-images.py

Writes app/public/assets/brand/share-card.png at 1200 x 630, the size the
large-card previews are drawn from. PNG, because not every scraper reads WebP.
"""

from __future__ import annotations

import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

APP = Path(__file__).resolve().parent.parent
BRAND = APP / "public/assets/brand"
MARK = BRAND / "lh-monogram.svg"
SANS = APP / "public/assets/fonts/mona-sans-latin-standard-normal.woff2"
SERIF_ITALIC = APP / "public/assets/fonts/playfair-display-latin-wght-italic.woff2"

ROSSO = (255, 40, 0)     # --rosso-corsa
DARK = (26, 20, 22)      # --dark
WHITE = (247, 243, 241)  # --white

SS = 4  # supersampling: Pillow fills polygons without smoothing their edges

Point = tuple[float, float]


def mark_shapes() -> list[list[Point]]:
    """The monogram's outlines, in the SVG's own units."""
    shapes: list[list[Point]] = []
    for d in re.findall(r'<path\b[^>]*\bd="([^"]+)"', MARK.read_text(encoding="utf8")):
        # The mark is straight-sided: every path is M x y, then L x y ..., then Z.
        if re.search(r"[^MLZ\d\s.,-]", d):
            raise ValueError(f"{MARK.name}: a path uses a command other than M, L and Z: {d}")
        numbers = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", d)]
        if len(numbers) < 6 or len(numbers) % 2:
            raise ValueError(f"{MARK.name}: cannot read the points of path {d}")
        shapes.append(list(zip(numbers[0::2], numbers[1::2])))
    if not shapes:
        raise ValueError(f"{MARK.name}: no <path> found")
    return shapes


def bounds(shapes: list[list[Point]]) -> tuple[float, float, float, float]:
    xs = [x for shape in shapes for x, _ in shape]
    ys = [y for shape in shapes for _, y in shape]
    return min(xs), min(ys), max(xs), max(ys)


def draw_mark(draw: ImageDraw.ImageDraw, shapes: list[list[Point]], left: float, top: float, height: float, fill) -> None:
    """The mark `height` tall with its top-left corner at (left, top)."""
    x0, y0, _, y1 = bounds(shapes)
    scale = height / (y1 - y0)
    for shape in shapes:
        draw.polygon([(left + (x - x0) * scale, top + (y - y0) * scale) for x, y in shape], fill=fill)


def sans(size: float, weight: int, width: int) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(SANS), round(size))
    font.set_variation_by_axes([width, weight])
    return font


def serif_italic(size: float, weight: int) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(SERIF_ITALIC), round(size))
    font.set_variation_by_axes([weight])
    return font


def tracked_width(text: str, font: ImageFont.FreeTypeFont, tracking: float) -> float:
    return sum(font.getlength(ch) for ch in text) + tracking * (len(text) - 1)


def draw_tracked(draw: ImageDraw.ImageDraw, x: float, baseline: float, text: str, font: ImageFont.FreeTypeFont, tracking: float, fill) -> None:
    """Text set a glyph at a time, which is the only way Pillow tracks it."""
    for ch in text:
        draw.text((x, baseline), ch, font=font, fill=fill, anchor="ls")
        x += font.getlength(ch) + tracking


def share_card() -> Image.Image:
    W, H = 1200, 630
    img = Image.new("RGB", (W * SS, H * SS), ROSSO)
    draw = ImageDraw.Draw(img)
    shapes = mark_shapes()

    # The lockup, from .wordmark in home.css: the surname sets the size, the
    # given name is 0.616 of it, the surname is tracked -0.03em.
    surname_size = 150 * SS
    surname = sans(surname_size, weight=800, width=75)
    given = serif_italic(surname_size * 0.616, weight=500)
    tracking = -0.03 * surname_size

    mark_height = 232 * SS
    mark_gap = 50 * SS     # mark to the top of "Lewis"
    line_gap = 26 * SS     # the baseline of "Lewis" to the cap line of "HAMILTON"

    # Ink heights above the baseline, so the block is centred on what is drawn
    # rather than on line boxes that include each face's unused ascent.
    given_ascent = -given.getbbox("Lewis", anchor="ls")[1]
    cap_height = -surname.getbbox("HAMILTON", anchor="ls")[1]

    block = mark_height + mark_gap + given_ascent + line_gap + cap_height
    top = (H * SS - block) / 2

    x0, y0, x1, y1 = bounds(shapes)
    mark_width = mark_height * (x1 - x0) / (y1 - y0)
    draw_mark(draw, shapes, (W * SS - mark_width) / 2, top, mark_height, DARK)

    surname_width = tracked_width("HAMILTON", surname, tracking)
    left = (W * SS - surname_width) / 2
    given_baseline = top + mark_height + mark_gap + given_ascent
    # -0.05em, as the lockup does: an italic's leading edge sits further right
    # than a cap's.
    draw.text((left - 0.05 * given.size, given_baseline), "Lewis", font=given, fill=DARK, anchor="ls")
    draw_tracked(draw, left, given_baseline + line_gap + cap_height, "HAMILTON", surname, tracking, WHITE)

    return img.resize((W, H), Image.Resampling.LANCZOS)


def main() -> None:
    out = BRAND / "share-card.png"
    share_card().save(out, "PNG", optimize=True)
    print(f"{out.relative_to(APP)}  {out.stat().st_size} bytes")


if __name__ == "__main__":
    main()
