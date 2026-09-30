"""
Placeholder pictures for the calendar page's rounds.

The reference's card over its "rounds run" list shows a photograph of its
driver at each round. This build ships no race photography (CLAUDE.md: no
copyrighted media), so each round gets an image SLOT at a fixed path, and this
script fills every slot with an original graphic built from our own data:

  - the round's circuit, drawn from content/generated/circuit-paths.json
    (itself from MultiViewer / bacinger f1-circuits, see gen-circuit-paths.py),
    in Giallo Modena on the site's dark ground;
  - the round number and the race's place, set in Mona Sans (OFL, shipped in
    public/assets/fonts).

Every round of the season gets a file, run or not, so a round that finishes
after this is generated still has its picture. Replace any file with a
licensed photograph of the same name and size and the page picks it up.

  python tools/gen-calendar-placeholders.py

Writes app/public/assets/calendar/<season>-round-<nn>.webp at 660 x 788
(the card is 330 x 394 CSS px at 1728 wide; this is 2x).
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

APP = Path(__file__).resolve().parent.parent
CAREER = APP / "src/content/generated/career.json"
PATHS = APP / "src/content/generated/circuit-paths.json"
FONT = APP / "public/assets/fonts/mona-sans-latin-standard-normal.woff2"
OUT = APP / "public/assets/calendar"

W, H = 660, 788
SS = 2  # supersampling for the line work

GROUND = (26, 20, 22)       # --dark
GROUND_DEEP = (17, 16, 18)  # --black
ROSSO = (255, 40, 0)        # --rosso-corsa
GIALLO = (255, 242, 0)      # --giallo-modena
CREAM = (240, 235, 233)     # --text
GREY = (187, 173, 171)      # --grey-on-track


def font(size: int, weight: int, width: int = 100) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FONT), size)
    f.set_variation_by_axes([width, weight])
    return f


def ground() -> Image.Image:
    """The dark ground, warmed from below by a low rosso glow."""
    img = Image.new("RGB", (W, H), GROUND_DEEP)
    glow = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(glow)
    d.ellipse((-W * 0.4, H * 0.55, W * 1.4, H * 1.5), fill=110)
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    tint = Image.new("RGB", (W, H), ROSSO)
    img = Image.composite(tint, img, glow.point(lambda v: int(v * 0.55)))
    base = Image.new("RGB", (W, H), GROUND)
    return Image.blend(img, base, 0.25)


def circuit_layer(points: list[list[float]], box: tuple[int, int, int, int]) -> tuple[Image.Image, Image.Image]:
    """The circuit's line and its halo as two alpha masks, fitted into box."""
    x0, y0, x1, y1 = box
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    scale = min(x1 - x0, y1 - y0) / span
    cx = (max(xs) + min(xs)) / 2
    cy = (max(ys) + min(ys)) / 2
    mx = (x0 + x1) / 2
    my = (y0 + y1) / 2
    # Path y is north-up; image y runs down.
    pts = [((mx + (x - cx) * scale) * SS, (my - (y - cy) * scale) * SS) for x, y in points]
    pts.append(pts[0])

    line = Image.new("L", (W * SS, H * SS), 0)
    ImageDraw.Draw(line).line(pts, fill=255, width=5 * SS, joint="curve")
    line = line.resize((W, H), Image.LANCZOS)
    halo = line.filter(ImageFilter.GaussianBlur(10))
    return line, halo


def start_mark(points: list[list[float]], box: tuple[int, int, int, int]) -> tuple[float, float, float]:
    """Where the start/finish line sits, and the direction of racing there."""
    x0, y0, x1, y1 = box
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    scale = min(x1 - x0, y1 - y0) / span
    cx = (max(xs) + min(xs)) / 2
    cy = (max(ys) + min(ys)) / 2
    mx = (x0 + x1) / 2
    my = (y0 + y1) / 2
    (ax, ay), (bx, by) = points[0], points[1]
    sx, sy = mx + (ax - cx) * scale, my - (ay - cy) * scale
    angle = math.atan2(-(by - ay), bx - ax)
    return sx, sy, angle


NAMES = {"UK": "United Kingdom", "USA": "United States", "UAE": "United Arab Emirates"}


def place_name(r: dict) -> str:
    """The race's city if the race is named for it, else its country --
    the same rule as placeName() in src/calendar/season.ts, and the same
    country names as countryName() in src/content/countries.ts."""
    named = re.sub(r" Grand Prix.*$", "", r["raceName"])
    return named if named == r["locality"] else NAMES.get(r["country"], r["country"])


def render(r: dict, path: dict) -> Image.Image:
    img = ground()
    box = (70, 150, W - 70, H - 200)
    line, halo = circuit_layer(path["points"], box)
    img = Image.composite(Image.new("RGB", (W, H), GIALLO), img, halo.point(lambda v: int(v * 0.45)))
    img = Image.composite(Image.new("RGB", (W, H), GIALLO), img, line)

    d = ImageDraw.Draw(img)
    sx, sy, angle = start_mark(path["points"], box)
    nx, ny = -math.sin(angle), math.cos(angle)
    d.line((sx - nx * 16, sy + ny * 16, sx + nx * 16, sy - ny * 16), fill=CREAM, width=4)

    d.text((44, 40), f"Round {r['round']:02d}", font=font(30, 560), fill=GREY)
    d.text((44, 74), f"{r['season']}", font=font(30, 560), fill=GREY)

    title = place_name(r)
    size = 96
    while size > 40:
        f = font(size, 700, 75)
        if d.textlength(title, font=f) <= W - 88:
            break
        size -= 4
    f = font(size, 700, 75)
    bbox = d.textbbox((0, 0), title, font=f)
    d.text((44, H - 44 - bbox[3]), title, font=f, fill=CREAM)
    d.text((44, H - 44 - bbox[3] - 44), r["circuitName"], font=font(24, 480), fill=GREY)
    return img


def main() -> None:
    career = json.loads(CAREER.read_text(encoding="utf-8"))
    paths = json.loads(PATHS.read_text(encoding="utf-8"))["circuits"]
    OUT.mkdir(parents=True, exist_ok=True)
    for r in career["calendar"]:
        path = paths.get(r["circuitId"])
        if path is None:
            raise SystemExit(f"no circuit path for {r['circuitId']} -- run tools/gen-circuit-paths.py")
        name = f"{r['season']}-round-{r['round']:02d}.webp"
        render(r, path).save(OUT / name, "WEBP", quality=82, method=6)
        print("wrote", name)


if __name__ == "__main__":
    main()
