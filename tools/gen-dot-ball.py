"""Generate the socials ornament: a sphere drawn as a field of dots.

The reference puts a 56x56 Rive animation ("icon-ball") centred above the
"WHAT'S UP / ON SOCIALS" heading. This project substitutes SVG for Rive
everywhere else it appears — the monogram and the menu button are both SVG +
GSAP against the reference's Rive — so this is the same trade, and the artwork
is generated here rather than traced from anything.

The sphere illusion is the projection doing the work, not shading. Dots sit on
a latitude/longitude grid and are projected orthographically:

    x = R * cos(lat) * sin(lon)
    y = R * sin(lat)

Longitude is stepped evenly in ANGLE, so its projection into x compresses as
sin(lon) approaches +/-1 — the dots bunch toward the left and right rim exactly
the way the meridians of a globe do, and the eye reads curvature from the
spacing alone. Dot radius falls off toward the rim and the poles so the
silhouette softens instead of ending on a hard edge.

Run:  python tools/gen-dot-ball.py
Out:  public/assets/brand/dot-ball.svg
"""

import math
import pathlib

SIZE = 56.0           # matches the reference's 56x56 box
R = SIZE / 2.0 - 1.2  # leave room for the outermost dot's own radius
LATITUDES = 13        # rows from pole to pole
LONGITUDES = 22       # meridians around the full turn
DOT_MIN = 0.42
DOT_MAX = 1.02


def dots():
    """Return (cx, cy, r) for every dot on the sphere."""
    out = []
    for i in range(LATITUDES):
        # -1..1 across the sphere, excluding the exact poles: a pole is a single
        # point, and stepping onto it would stack every meridian in one place.
        t = -1.0 + 2.0 * (i + 0.5) / LATITUDES
        lat = t * (math.pi / 2.0)
        ring = math.cos(lat)
        y = SIZE / 2.0 + R * math.sin(lat)

        # Fewer dots per ring near the poles, so density stays even rather than
        # crowding into the top and bottom.
        count = max(4, int(round(LONGITUDES * ring)))
        for j in range(count):
            lon = 2.0 * math.pi * j / count
            x = SIZE / 2.0 + R * ring * math.sin(lon)

            # Smallest where the surface is turning away from the viewer.
            facing = abs(math.cos(lon)) * ring
            r = DOT_MIN + (DOT_MAX - DOT_MIN) * facing
            out.append((x, y, r))
    return out


def main():
    placed = dots()
    body = "\n".join(
        f'  <circle cx="{x:.2f}" cy="{y:.2f}" r="{r:.2f}" />' for x, y, r in placed
    )
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE:.0f} {SIZE:.0f}" '
        f'width="{SIZE:.0f}" height="{SIZE:.0f}" fill="currentColor" '
        f'role="presentation">\n{body}\n</svg>\n'
    )
    out = pathlib.Path(__file__).resolve().parent.parent / "public/assets/brand/dot-ball.svg"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(svg, encoding="utf-8")
    print(f"{out}  ({len(placed)} dots, {len(svg)} bytes)")


if __name__ == "__main__":
    main()
