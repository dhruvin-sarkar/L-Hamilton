"""Generate the footer panel's contour pattern.

Committed alongside its output so the asset can be regenerated identically:
the seed is fixed, and the file is a silhouette (white on transparent) meant to
be used as a CSS mask over a token colour, not as artwork with a baked palette.
"""
import math, os, random

# Resolved from this file, so it can be run from anywhere.
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "..", "public", "assets", "footer", "contours.svg")

random.seed(20250902)
W, H = 1688, 896

def blob(cx, cy, r, harmonics, steps=34):
    pts = []
    for i in range(steps):
        a = 2 * math.pi * i / steps
        k = 1.0
        for (amp, freq, phase) in harmonics:
            k += amp * math.sin(freq * a + phase)
        pts.append((cx + r * k * math.cos(a), cy + r * k * math.sin(a)))
    return pts

def catmull(pts):
    """Closed Catmull-Rom through the points, emitted as cubic beziers."""
    n = len(pts)
    d = [f"M{pts[0][0]:.0f} {pts[0][1]:.0f}"]
    for i in range(n):
        p0, p1 = pts[(i - 1) % n], pts[i]
        p2, p3 = pts[(i + 1) % n], pts[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d.append(f"C{c1[0]:.0f} {c1[1]:.0f} {c2[0]:.0f} {c2[1]:.0f} {p2[0]:.0f} {p2[1]:.0f}")
    return "".join(d) + "Z"

# Few, large, calm. An earlier pass used ten centres with rings 74-104 apart and
# harmonics up to 0.15 — at this scale the rings crossed each other and the
# whole thing read as scribble instead of as height lines.
FAMILIES = [
    (120,   90, 100, 5, 118),
    (620, -120, 130, 5, 132),
    (1300,  60, 110, 5, 126),
    (1660, 470, 105, 4, 122),
    (230,  700, 115, 5, 128),
    (980,  900, 125, 5, 120),
    (1520, 860,  95, 4, 118),
    (880,  380,  80, 4, 112),
    (-80,  420,  90, 4, 124),
]

paths = []
for (cx, cy, r0, rings, step) in FAMILIES:
    base = [(random.uniform(0.03, 0.075), f, random.uniform(0, 6.283)) for f in (2, 3)]
    for i in range(rings):
        # The wobble relaxes as the rings grow, the way real contours do, and
        # the phase drifts so they are not simply scaled copies of each other.
        harm = [(amp * (1 - i / (rings * 1.8)), f, ph + i * 0.11) for (amp, f, ph) in base]
        paths.append(catmull(blob(cx, cy, r0 + i * step, harm)))

body = "\n".join(f'<path d="{d}"/>' for d in paths)
svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" fill="none">\n'
    f'<g stroke="#fff" stroke-width="1.8" fill="none">\n{body}\n</g>\n</svg>\n'
)
open(OUT, "w").write(svg)
print("paths:", len(paths), "bytes:", len(svg))
