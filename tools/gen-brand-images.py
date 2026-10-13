"""
The pictures made from the LH mark: the tab icon's PNG copies and the share
card.

One piece of artwork is the source for all of them:
public/assets/brand/lh-monogram.svg, a Rosso Corsa rounded tile carrying the
mark in the site's dark. It is the tab icon itself wherever SVG icons are
drawn. This script reads that file (its tile, its colours, where the mark sits
and the mark's outlines) and draws the rest from it, so no copy can carry a
different mark or a different red.

  favicon-32.png        The tile at 32 x 32, corners transparent. The fallback
                        for a browser that does not draw an SVG icon.
  apple-touch-icon.png  180 x 180, the tile's ground to every edge and no
                        rounding: iOS cuts its own corners and paints black
                        behind anything transparent.
  share-card.png        1200 x 630, the picture a link to the site unfurls
                        with. This build ships no photography of its own to put
                        there (the project brief: no copyrighted media), so the card is
                        the mark over the wordmark as the nav sets it: "Lewis"
                        in Playfair Display italic over "HAMILTON" in condensed
                        Mona Sans, at the lockup's own ratio and tracking
                        (home.css, .wordmark). Both faces are OFL and shipped
                        in public/assets/fonts. Everything sits inside the
                        middle 630 px, because some previews crop to a square.

PNG throughout: not every scraper, and no touch icon, reads WebP.
vite.config.ts (headTags) writes the tags that name all three.

  python tools/gen-brand-images.py
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

APP = Path(__file__).resolve().parent.parent
BRAND = APP / "public/assets/brand"
ICON = BRAND / "lh-monogram.svg"
SANS = APP / "public/assets/fonts/mona-sans-latin-standard-normal.woff2"
SERIF_ITALIC = APP / "public/assets/fonts/playfair-display-latin-wght-italic.woff2"

WHITE = (247, 243, 241)  # --white; the card's one colour the icon does not have

Point = tuple[float, float]
Colour = tuple[int, int, int]


@dataclass(frozen=True)
class Artwork:
    """lh-monogram.svg, as numbers."""

    size: float                # the square viewBox
    radius: float              # the tile's corner
    ground: Colour             # the tile
    ink: Colour                # the mark
    offset: Point              # where the mark's own origin sits on the tile
    scale: float               # the mark's units to the tile's
    shapes: list[list[Point]]  # the mark's outlines, in its own units


def colour(value: str, what: str) -> Colour:
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise ValueError(f"{ICON.name}: {what} needs a #rrggbb fill, found {value!r}")
    return int(value[1:3], 16), int(value[3:5], 16), int(value[5:7], 16)


def outline(d: str) -> list[Point]:
    # The mark is straight-sided: every path is M x y, then L x y ..., then Z.
    if re.search(r"[^MLZ\d\s.,-]", d):
        raise ValueError(f"{ICON.name}: a path uses a command other than M, L and Z: {d}")
    numbers = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", d)]
    if len(numbers) < 6 or len(numbers) % 2:
        raise ValueError(f"{ICON.name}: cannot read the points of path {d}")
    return list(zip(numbers[0::2], numbers[1::2]))


def opening_tag(svg: str, name: str) -> str:
    """The opening tag of the file's one <name> element."""
    found = re.findall(rf"<{name}\b[^>]*>", svg)
    if len(found) != 1:
        raise ValueError(f"{ICON.name}: expected one <{name}>, found {len(found)}")
    return found[0]


def attribute(tag: str, name: str) -> str:
    found = re.search(rf'\s{name}="([^"]*)"', tag)
    if found is None:
        raise ValueError(f"{ICON.name}: {tag} has no {name} attribute")
    return found[1]


def read_artwork() -> Artwork:
    """The icon as drawn in the SVG. Anything this cannot read stops the run."""
    # Read with patterns rather than an XML parser: the file is five tags of
    # our own, and every one of them is checked here.
    svg = ICON.read_text(encoding="utf8")
    number = r"(-?\d+(?:\.\d+)?)"
    box = re.fullmatch(rf"0 0 {number} {number}", attribute(opening_tag(svg, "svg"), "viewBox"))
    if box is None or box[1] != box[2]:
        raise ValueError(f"{ICON.name}: expected a square viewBox starting at 0 0")
    tile = opening_tag(svg, "rect")
    mark = opening_tag(svg, "g")
    placed = re.fullmatch(rf"translate\({number}[ ,]+{number}\) scale\({number}\)", attribute(mark, "transform"))
    if placed is None:
        raise ValueError(f'{ICON.name}: the mark\'s transform must read "translate(x y) scale(s)"')
    shapes = [outline(attribute(path, "d")) for path in re.findall(r"<path\b[^>]*>", svg)]
    if not shapes:
        raise ValueError(f"{ICON.name}: no <path> in the mark")
    return Artwork(
        size=float(box[1]),
        radius=float(attribute(tile, "rx")),
        ground=colour(attribute(tile, "fill"), "the tile"),
        ink=colour(attribute(mark, "fill"), "the mark"),
        offset=(float(placed[1]), float(placed[2])),
        scale=float(placed[3]),
        shapes=shapes,
    )


def bounds(shapes: list[list[Point]]) -> tuple[float, float, float, float]:
    xs = [x for shape in shapes for x, _ in shape]
    ys = [y for shape in shapes for _, y in shape]
    return min(xs), min(ys), max(xs), max(ys)


def draw_mark(draw: ImageDraw.ImageDraw, art: Artwork, origin: Point, scale: float, fill) -> None:
    """The mark with its own (0, 0) at `origin`, `scale` pixels to each of its units."""
    for shape in art.shapes:
        draw.polygon([(origin[0] + x * scale, origin[1] + y * scale) for x, y in shape], fill=fill)


def icon(art: Artwork, pixels: int, rounded: bool) -> Image.Image:
    """The tile at pixels x pixels: with its corners, or as a full square."""
    # Drawn large and scaled down, because Pillow fills shapes without smoothing
    # their edges.
    big = max(4, 1024 // pixels) * pixels
    k = big / art.size
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if rounded:
        draw.rounded_rectangle((0, 0, big - 1, big - 1), radius=art.radius * k, fill=(*art.ground, 255))
    else:
        draw.rectangle((0, 0, big, big), fill=(*art.ground, 255))
    draw_mark(draw, art, (art.offset[0] * k, art.offset[1] * k), art.scale * k, (*art.ink, 255))
    img = img.resize((pixels, pixels), Image.Resampling.LANCZOS)
    return img if rounded else img.convert("RGB")


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


def share_card(art: Artwork) -> Image.Image:
    W, H = 1200, 630
    SS = 4  # supersampling, for the mark's edges
    img = Image.new("RGB", (W * SS, H * SS), art.ground)
    draw = ImageDraw.Draw(img)

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

    x0, y0, x1, y1 = bounds(art.shapes)
    k = mark_height / (y1 - y0)
    draw_mark(draw, art, ((W * SS - (x1 - x0) * k) / 2 - x0 * k, top - y0 * k), k, art.ink)

    left = (W * SS - tracked_width("HAMILTON", surname, tracking)) / 2
    given_baseline = top + mark_height + mark_gap + given_ascent
    # -0.05em, as the lockup does: an italic's leading edge sits further right
    # than a cap's.
    draw.text((left - 0.05 * given.size, given_baseline), "Lewis", font=given, fill=art.ink, anchor="ls")
    draw_tracked(draw, left, given_baseline + line_gap + cap_height, "HAMILTON", surname, tracking, WHITE)

    return img.resize((W, H), Image.Resampling.LANCZOS)


def main() -> None:
    art = read_artwork()
    for name, image in (
        ("favicon-32.png", icon(art, 32, rounded=True)),
        ("apple-touch-icon.png", icon(art, 180, rounded=False)),
        ("share-card.png", share_card(art)),
    ):
        out = BRAND / name
        image.save(out, "PNG", optimize=True)
        print(f"{out.relative_to(APP)}  {image.width} x {image.height}  {out.stat().st_size} bytes")


if __name__ == "__main__":
    main()
