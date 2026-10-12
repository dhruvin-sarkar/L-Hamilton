"""Generate the site's notched outlines.

Three families, all the same kind of shape:

  - the footer panel's silhouette, wide and phone, used as CSS masks;
  - the notched frame of the next-race card on Home and of the two cards beside
    the On Track hero, plus the filled copy that masks the larger one;
  - the helmet wall's card line -- resting, hover and phone -- and the clip its
    photographs are cut to.

Each is a polygon with rounded corners and nothing else, so each is written
down here as its measurements: the box, the corner radius, where a slope leaves
one edge and where it joins the next, and how its two bends are rounded. The
path is constructed from those -- straight edges joined by circular arcs, every
arc tangent to both of the edges it joins.

The measurements are of the layout as it renders, taken off high-resolution
bitmaps of the panel and the cards (their edge profiles, fitted for the levels,
the radii and the two ends of each slope) and rounded to our own grid: half a
unit on the wide panel, a twentieth on the small shapes. The construction, the
arcs and the coordinates that come out of it -- written to a tenth of a unit on
the wide panel, a hundredth on the rest -- are this script's own.

A line that is stroked is drawn half its width inside the card, so the stroke's
outer face lands on the card's edge instead of being cut off by it: `inset`
moves every edge in, tightens the corners that point out and opens the ones
that point in, which is what keeps the line parallel to the card all the way
round a notch.

Run:  python tools/gen-frames.py
Out:  public/assets/footer/panel-mask-desktop.svg
      public/assets/footer/panel-mask-mobile.svg
      public/assets/ui/notch-mask.svg
      and, printed, every path string that lives inline in the pages, each with
      the file it belongs in and whether that file already carries it.
"""

import math
import pathlib
import re

APP = pathlib.Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------- construction

def bends_that_meet(foot, head, split):
    """Radii for a slope that is all bend: two arcs that meet `split` of the way
    along it, with no straight between them. Both ends lie on level edges."""
    run, rise = abs(head[0] - foot[0]), abs(head[1] - foot[1])
    reach = math.hypot(run, rise) / math.tan(math.atan2(rise, run) / 2)
    return split * reach, (1 - split) * reach


def inset(corners, by):
    """The same outline, `by` inside itself."""
    n = len(corners)
    doubled_area = sum(
        corners[i][0] * corners[(i + 1) % n][1] - corners[(i + 1) % n][0] * corners[i][1]
        for i in range(n)
    )
    inward = 1 if doubled_area > 0 else -1
    edges = []
    for i in range(n):
        x0, y0, _ = corners[i]
        x1, y1, _ = corners[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        length = math.hypot(dx, dy)
        edges.append((x0 - dy / length * inward * by, y0 + dx / length * inward * by, dx, dy))
    out = []
    for i in range(n):
        ax, ay, adx, ady = edges[i - 1]
        bx, by_, bdx, bdy = edges[i]
        cross = adx * bdy - ady * bdx
        along = ((bx - ax) * bdy - (by_ - ay) * bdx) / cross
        points_out = cross * inward > 0
        radius = corners[i][2]
        out.append((
            ax + adx * along,
            ay + ady * along,
            max(0.0, radius - by) if points_out else radius + by,
        ))
    return out


def number(value, places):
    text = f"{value:.{places}f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


def outline(corners, places=2, box=(1.0, 1.0)):
    """Path data for a polygon given as (x, y, radius) corners, in order round the
    shape. `box` divides the coordinates through, for objectBoundingBox clips."""
    n = len(corners)
    arcs = []
    for i in range(n):
        px, py, radius = corners[i]
        ax, ay, _ = corners[i - 1]
        bx, by, _ = corners[(i + 1) % n]
        to_a = math.hypot(ax - px, ay - py)
        to_b = math.hypot(bx - px, by - py)
        ux, uy = (ax - px) / to_a, (ay - py) / to_a
        vx, vy = (bx - px) / to_b, (by - py) / to_b
        # Tangent length: how far along each edge the arc takes over from it.
        opening = math.acos(max(-1.0, min(1.0, ux * vx + uy * vy)))
        reach = radius / math.tan(opening / 2)
        turns_clockwise = (px - ax) * (by - py) - (py - ay) * (bx - px) > 0
        arcs.append((
            (px + ux * reach, py + uy * reach),
            (px + vx * reach, py + vy * reach),
            radius,
            1 if turns_clockwise else 0,
            reach,
        ))

    # Two bends on one edge cannot need more of it than there is.
    for i in range(n):
        x0, y0, _ = corners[i]
        x1, y1, _ = corners[(i + 1) % n]
        if arcs[i][4] + arcs[(i + 1) % n][4] > math.hypot(x1 - x0, y1 - y0) + 1e-6:
            raise ValueError(f"corners {i} and {(i + 1) % n} overlap on the edge between them")

    sx, sy = box

    def point(p):
        return f"{number(p[0] / sx, places)} {number(p[1] / sy, places)}"

    commands = []
    at = None
    for start, end, radius, sweep, _ in arcs:
        if at is None:
            commands.append("M" + point(start))
        elif math.hypot(start[0] - at[0], start[1] - at[1]) > 1e-6:
            commands.append("L" + point(start))
        if radius > 0:
            commands.append(
                f"A{number(radius / sx, places)} {number(radius / sy, places)} 0 0 {sweep} {point(end)}"
            )
        at = end
    return " ".join(commands) + " Z"


# -------------------------------------------------------------- footer panel
#
# A body with rounded corners, a tab standing proud of its top edge and a wider,
# shallower one hanging from its bottom edge. The top tab's sides are all bend
# -- an S with no straight in it, the two arcs meeting `split` of the way up --
# and the bottom tab's are straight slopes with both ends rounded.
#
# `canvas` is the SVG's own size and `box` the silhouette's within it. home.css
# gives .footer__panel each box's aspect ratio. `places` is how finely the path
# is written: the wide panel is drawn near 1:1, the phone one up to 2.5 times.

PANEL_WIDE = dict(
    file="public/assets/footer/panel-mask-desktop.svg",
    canvas=(1688, 896),
    box=(1688, 896),
    body=(43.5, 865.5),            # y of the body's top and bottom edges
    corner=30,
    top_tab=((679, 725), (964, 1016.5)),       # x: foot and head of the left slope, head and foot of the right
    split=0.594,
    bottom_tab=((260.5, 290), (1454, 1488)),   # x: the same four, for the tab underneath
    bend=30,
    places=1,
)

PANEL_PHONE = dict(
    file="public/assets/footer/panel-mask-mobile.svg",
    canvas=(382, 628),
    box=(381.94, 627.49),
    body=(9.85, 612),
    corner=12.9,
    top_tab=((153.65, 164.05), (218.1, 230)),
    split=0.594,
    bottom_tab=((50.95, 66.25), (315.95, 332.25)),
    bend=12.9,
    places=2,
)


def panel(m):
    width, height = m["box"]
    top, bottom = m["body"]
    (tl_foot, tl_head), (tr_head, tr_foot) = m["top_tab"]
    (bl_foot, bl_head), (br_head, br_foot) = m["bottom_tab"]
    left_foot, left_head = bends_that_meet((tl_foot, top), (tl_head, 0), m["split"])
    right_foot, right_head = bends_that_meet((tr_foot, top), (tr_head, 0), m["split"])
    return [
        (0, bottom, m["corner"]),
        (bl_foot, bottom, m["bend"]),
        (bl_head, height, m["bend"]),
        (br_head, height, m["bend"]),
        (br_foot, bottom, m["bend"]),
        (width, bottom, m["corner"]),
        (width, top, m["corner"]),
        (tr_foot, top, right_foot),
        (tr_head, 0, right_head),
        (tl_head, 0, left_head),
        (tl_foot, top, left_foot),
        (0, top, m["corner"]),
    ]


# ------------------------------------------------------------- notched card
#
# The next-race card: a rounded rectangle whose top edge is lowered over its
# left part, stepping up to full height on a slope, so the label can sit in the
# corner that is cut away. The large one runs square into the connector on its
# right. Stroked 1px, so the line is drawn half a unit in.

NOTCH = dict(
    height=244,
    corner=6,
    drop=19,              # how far the lowered part of the top edge sits below the rest
    slope=(59.5, 76.5),   # x where the slope leaves the lowered edge, and where it reaches the top
    bend=16,
    line=1,
)
NOTCH_SMALL_WIDTH = 119
NOTCH_LARGE_WIDTH = 275.5   # in a 276 viewBox; see .ot-hero__next in on-track.css


def notched_card(width, square_right=False):
    m = NOTCH
    foot, head = m["slope"]
    right = 0 if square_right else m["corner"]
    card = [
        (0, m["height"], m["corner"]),
        (width, m["height"], right),
        (width, 0, right),
        (head, 0, m["bend"]),
        (foot, m["drop"], m["bend"]),
        (0, m["drop"], m["corner"]),
    ]
    return inset(card, m["line"] / 2)


# -------------------------------------------------------------- helmet card
#
# The wall's card: a rounded rectangle with a shelf cut out of its bottom edge
# on the right, where the name and the year sit. The wide card's shelf starts
# near the middle; the phone card's starts near the left, for a longer label.
# Both slopes lean the same way, a little steeper than the next-race notch.

HELMET_WIDE = dict(
    view=(407, 411),
    box=(406.9, 411),         # the line stops a hair short of the view's right edge
    corner=8,
    shelf=38,                 # height of the cut
    slope=(221.95, 252.25),   # x where the slope leaves the bottom edge, and where it reaches the shelf
    bend=23,
)

HELMET_PHONE = dict(
    view=(187, 188),
    box=(186.1, 188),
    corner=8,
    shelf=17.4,
    slope=(42, 55.85),
    bend=10,
)

HELMET_RESTING_INSET = 0.5   # a 2px line that does not scale: its centre, half a unit in
HELMET_HOVER_INSET = 1       # a 2px line that scales with the card: wholly inside it


def helmet_card(m, by):
    width, height = m["box"]
    foot, head = m["slope"]
    card = [
        (0, 0, m["corner"]),
        (0, height, m["corner"]),
        (foot, height, m["bend"]),
        (head, height - m["shelf"], m["bend"]),
        (width, height - m["shelf"], m["corner"]),
        (width, 0, m["corner"]),
    ]
    return inset(card, by)


# -------------------------------------------------------------------- output

def write_mask(m):
    width, height = m["canvas"]
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">\n'
        f'<!-- Generated by tools/gen-frames.py. Read for its alpha only. -->\n'
        f'<path fill="#fff" d="{outline(panel(m), places=m["places"])}"/>\n'
        f'</svg>\n'
    )
    (APP / m["file"]).write_text(svg, encoding="utf-8", newline="\n")
    print(f'wrote  {m["file"]}  ({len(svg)} bytes)')


def write_notch_mask(d):
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 276 244">\n'
        '<!-- The On Track "next" card\'s notched outline (#ot-notch-lg in on-track.html),\n'
        '     filled: a mask that keeps the card\'s patterned cell inside its frame.\n'
        '     Generated by tools/gen-frames.py. -->\n'
        f'<path d="{d}"/>\n'
        '</svg>\n'
    )
    (APP / "public/assets/ui/notch-mask.svg").write_text(svg, encoding="utf-8", newline="\n")
    print(f"wrote  public/assets/ui/notch-mask.svg  ({len(svg)} bytes)")


def carried(file, d):
    """Whether `file` already holds this path, however its lines are wrapped."""
    text = (APP / file).read_text(encoding="utf-8")
    text = re.sub(r"'\s*\+\s*'", "", text)   # a string split across lines in TypeScript
    return " ".join(d.split()) in " ".join(text.split())


def main():
    write_mask(PANEL_WIDE)
    write_mask(PANEL_PHONE)

    small = outline(notched_card(NOTCH_SMALL_WIDTH))
    large = outline(notched_card(NOTCH_LARGE_WIDTH, square_right=True))
    write_notch_mask(large)

    resting = helmet_card(HELMET_WIDE, HELMET_RESTING_INSET)
    phone = helmet_card(HELMET_PHONE, HELMET_RESTING_INSET)
    inline = [
        ("notched card, 119 x 244", small,
         ["index.html", "on-track.html"]),
        ("notched card, 276 x 244", large,
         ["on-track.html"]),
        ("helmet card, resting line (HOF_CARD_PATH)", outline(resting),
         ["src/lib/showcase.ts"]),
        ("helmet card, hover line (HOF_CARD_PATH_ON)", outline(helmet_card(HELMET_WIDE, HELMET_HOVER_INSET)),
         ["src/lib/showcase.ts"]),
        ("helmet card, phone (HOF_CARD_PATH_NARROW)", outline(phone),
         ["src/lib/showcase.ts"]),
        # The photograph's clip is the resting line itself, in the 0..1 box.
        ("helmet clip (#hof-card)", outline(resting, places=6, box=HELMET_WIDE["view"]),
         ["partials/helmets.html"]),
        ("helmet clip, phone (#hof-card-narrow)", outline(phone, places=6, box=HELMET_PHONE["view"]),
         ["partials/helmets.html"]),
    ]
    stale = 0
    for name, d, files in inline:
        print(f"\n{name}\n  {d}")
        for file in files:
            ok = carried(file, d)
            stale += not ok
            print(f"  {'in sync' if ok else 'STALE  '}  {file}")
    if stale:
        print(f"\n{stale} inline path(s) differ from what this script generates: paste them in.")


if __name__ == "__main__":
    main()
