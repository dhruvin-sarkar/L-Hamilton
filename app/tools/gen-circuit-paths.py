"""
Circuit centrelines and corner numbers for the calendar's track visualiser.

The reference draws each round's circuit in 3D from its own model file, which
this build does not ship. TrackScene.ts builds the same kind of object -- a lit
ribbon along the circuit with its corners numbered -- from the circuit's shape.
This script fetches those shapes once and writes them, normalised, to
src/content/generated/circuit-paths.json.

Sources, in order of preference:

  1. MultiViewer's circuit data, https://api.multiviewer.app/api/v1/circuits/
     <circuitKey>/<year>: the track traced from Formula 1 live-timing position
     data, with every corner's official number and position. The same record
     FastF1 reads for its circuit_info. Keyed by F1 live timing's circuit key,
     read from https://livetiming.formula1.com/static/<year>/Index.json.
  2. bacinger/f1-circuits (MIT, see src/content/LICENSE-f1-circuits.txt) for a
     circuit (1) does not carry: Madring and Sepang. Its GeoJSON is a
     centreline with no corners, so those two are drawn without corner numbers
     rather than with numbers invented for them.

Normalisation, for every circuit alike:
  - projected flat (MultiViewer's x/y already are; GeoJSON is projected
    equirectangular about its centre, x east, y north, never mirrored);
  - laid landscape on its principal axis, the way the reference's model
    lies Baku along the panel and circuits.riv lies every track (the camera
    turns it from there);
  - thinned (Douglas-Peucker) and scaled so the longer side of its bounding
    box is 100 units, centred on (0, 0);
  - the first point is on the start/finish line and the order is the racing
    direction, as both sources give it.

Run:  python tools/gen-circuit-paths.py
"""

import json
import math
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / 'src' / 'content' / 'generated' / 'circuit-paths.json'

MV = 'https://api.multiviewer.app/api/v1/circuits/{key}/{year}'
GEOJSON = 'https://raw.githubusercontent.com/bacinger/f1-circuits/master/circuits/{id}.geojson'

# Jolpica circuitId -> F1 live timing circuit key (MultiViewer), or a
# bacinger/f1-circuits id where MultiViewer has no record of the circuit.
CIRCUITS = {
    'albert_park': {'key': 10},
    'shanghai': {'key': 49},
    'suzuka': {'key': 46},
    'miami': {'key': 151},
    'villeneuve': {'key': 23},
    'monaco': {'key': 22},
    'catalunya': {'key': 15},
    'red_bull_ring': {'key': 19},
    'silverstone': {'key': 2},
    'spa': {'key': 7},
    'hungaroring': {'key': 4},
    'zandvoort': {'key': 55},
    'monza': {'key': 39},
    'madring': {'geojson': 'es-2026'},
    'baku': {'key': 144},
    'sepang': {'geojson': 'my-1999'},
    'marina_bay': {'key': 61},
    'americas': {'key': 9},
    'rodriguez': {'key': 65},
    'interlagos': {'key': 14},
    'vegas': {'key': 152},
    'losail': {'key': 150},
    'yas_marina': {'key': 70},
}

YEARS = (2026, 2025, 2024)
SIZE = 100.0
# Douglas-Peucker tolerance, in the normalised units: a tenth of a percent of
# the circuit's size, well under a pixel at the size the panel draws it.
TOLERANCE = 0.1


def get_json(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'lewishamilton-web build'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode('utf-8-sig'))


def douglas_peucker(points, tolerance, keep):
    """Thins an open polyline, never dropping an index in `keep`."""
    if len(points) < 3:
        return list(range(len(points)))
    kept = {0, len(points) - 1} | set(keep)
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        length = math.hypot(dx, dy) or 1e-9
        worst, at = -1.0, None
        for i in range(a + 1, b):
            px, py = points[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / length
            if d > worst:
                worst, at = d, i
        if at is not None and (worst > tolerance or any(a < k < b for k in keep)):
            kept.add(at)
            stack.append((a, at))
            stack.append((at, b))
    return sorted(kept)


def normalise(points, rotation_deg, corners):
    """Turns, centres and scales; corners ride along as indices."""
    t = math.radians(rotation_deg)
    c, s = math.cos(t), math.sin(t)
    turned = [(x * c - y * s, x * s + y * c) for x, y in points]
    xs = [p[0] for p in turned]
    ys = [p[1] for p in turned]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    scale = SIZE / max(max(xs) - min(xs), max(ys) - min(ys))
    scaled = [((x - cx) * scale, (y - cy) * scale) for x, y in turned]

    keep = [k['index'] for k in corners]
    kept = douglas_peucker(scaled, TOLERANCE, keep)
    remap = {old: new for new, old in enumerate(kept)}
    return (
        [[round(scaled[i][0], 2), round(scaled[i][1], 2)] for i in kept],
        [{'number': k['number'], 'letter': k['letter'], 'index': remap[k['index']]} for k in corners],
    )


def principal_rotation(points):
    """The rotation, in degrees, that lays a shape's principal axis flat."""
    n = len(points)
    mx = sum(p[0] for p in points) / n
    my = sum(p[1] for p in points) / n
    sxx = sum((p[0] - mx) ** 2 for p in points)
    syy = sum((p[1] - my) ** 2 for p in points)
    sxy = sum((p[0] - mx) * (p[1] - my) for p in points)
    return -math.degrees(0.5 * math.atan2(2 * sxy, sxx - syy))


def from_multiviewer(circuit_id, key):
    for year in YEARS:
        try:
            data = get_json(MV.format(key=key, year=year))
        except Exception:
            continue
        points = list(zip(data['x'], data['y']))
        # The trace is a lap: its last point sits back on the line.
        if math.hypot(points[0][0] - points[-1][0], points[0][1] - points[-1][1]) < 1e-6:
            points.pop()

        def nearest(px, py):
            return min(range(len(points)), key=lambda i: (points[i][0] - px) ** 2 + (points[i][1] - py) ** 2)

        corners = [
            {
                'number': c['number'],
                'letter': c.get('letter') or '',
                'index': nearest(c['trackPosition']['x'], c['trackPosition']['y']),
            }
            for c in data['corners']
        ]
        pts, cns = normalise(points, principal_rotation(points), corners)
        return {
            'points': pts,
            'corners': cns,
            'source': MV.format(key=key, year=year),
        }
    raise SystemExit(f'{circuit_id}: MultiViewer has no circuit {key} for {YEARS}')


def from_geojson(circuit_id, geo_id):
    url = GEOJSON.format(id=geo_id)
    data = get_json(url)
    feature = data['features'][0] if data.get('type') == 'FeatureCollection' else data
    coords = feature['geometry']['coordinates']
    lat0 = sum(c[1] for c in coords) / len(coords)
    lon0 = sum(c[0] for c in coords) / len(coords)
    metres = 111_320.0  # per degree of latitude; longitude scaled by cos(latitude)
    shrink = math.cos(math.radians(lat0))
    points = [((lon - lon0) * shrink * metres, (lat - lat0) * metres) for lon, lat in coords]
    if math.hypot(points[0][0] - points[-1][0], points[0][1] - points[-1][1]) < 1.0:
        points.pop()
    pts, _ = normalise(points, principal_rotation(points), [])
    return {'points': pts, 'corners': [], 'source': url}


def main():
    out = {}
    for circuit_id, spec in CIRCUITS.items():
        if 'key' in spec:
            out[circuit_id] = from_multiviewer(circuit_id, spec['key'])
        else:
            out[circuit_id] = from_geojson(circuit_id, spec['geojson'])
        entry = out[circuit_id]
        print(f"  {circuit_id:14} {len(entry['points']):4} points {len(entry['corners']):3} corners")
        time.sleep(0.3)

    payload = {
        '$comment': 'GENERATED by tools/gen-circuit-paths.py. Do not edit by hand.',
        'size': SIZE,
        'circuits': out,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'Wrote {OUT.relative_to(HERE.parent)} ({OUT.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    sys.exit(main())
