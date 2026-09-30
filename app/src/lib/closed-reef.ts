/**
 * The closed reef: the small closed laurel wreath the reference hangs beside a
 * title or a runner-up (its Rive "reef" artboard, state machine "reef_play",
 * played once as it scrolls into view) -- beside the junior titles on On Track
 * and beside the championship finishes in the calendar page's results.
 *
 * Drawn as an original: two branches rising from a bare stem at the bottom
 * centre and curling up the sides almost into a circle, a gap left at the top;
 * a curved stem with leaves at a regular step, the outer row leaning out and
 * up, the inner row in, and a fan of four at the tip. Grown the way On Track
 * grows its own: the stem drawn on while the leaves open one after another
 * from the base.
 *
 * The same drawing as on-track.ts's closedReef(), which predates this module
 * and sits in a file this page may not edit; On Track can import this one.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The left branch in the 60x60 box: a bare tail running in from the bottom
    centre (start, control), then the leafy stem (base, two controls, tip). */
const TAIL = [
  [27.2, 51.6],
  [24, 51.2],
] as const;
const STEM = [
  [21, 50.3],
  [7, 45.5],
  [6, 20],
  [20, 14],
] as const;

/**
 * The left branch's leaves, painted in this order: where each joins the stem
 * (0 base to 1 tip), its turn off the stem in degrees (negative is outward),
 * its length, and how far it then leans toward upright (0 none, 1 fully).
 */
const LEAVES: readonly (readonly [at: number, turn: number, length: number, lean: number])[] = [
  // Outer row: the lowest lies along the ground, the top ones stand up.
  [0.02, -15, 8, 0],
  [0.12, -38, 8.4, 0.2],
  [0.22, -42, 8.6, 0.1],
  [0.32, -42, 8.4, 0.1],
  [0.42, -40, 8.2, 0.1],
  [0.52, -36, 8.4, 0.2],
  [0.62, -30, 9.6, 0.3],
  [0.72, -28, 10, 0.3],
  [0.82, -28, 10, 0.3],
  // Inner row.
  [0.07, 52, 8.8, 0],
  [0.2, 48, 9.2, 0],
  [0.33, 45, 8, 0],
  [0.46, 45, 7.8, 0],
  [0.59, 45, 8, 0],
  [0.72, 45, 7.6, 0],
  [0.85, 45, 7, 0],
  // The fan at the tip.
  [0.96, -50, 8.4, 0],
  [0.97, 38, 6, 0],
  [1, -25, 8.8, 0],
  [1, 8, 7, 0],
];

/** A leaf's width over its length: a slim pointed lens. */
const LEAF_WIDTH = 0.2;

interface Leaf {
  readonly el: SVGPathElement;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  /** Its share of the whole drawn line, base to tip. */
  readonly at: number;
}

export interface ReefBranch {
  readonly group: SVGGElement;
  readonly stem: SVGPathElement;
  readonly stemLength: number;
  readonly leaves: readonly Leaf[];
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function stemPoint(t: number): [number, number] {
  const [p0, p1, p2, p3] = STEM;
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

/** The stem's direction at `t`, in degrees clockwise from +x. */
function stemHeading(t: number): number {
  const [p0, p1, p2, p3] = STEM;
  const u = 1 - t;
  const dx = 3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]);
  const dy = 3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function polylineLength(points: readonly (readonly [number, number])[]): number {
  let length = 0;
  let previous = points[0];
  for (const point of points) {
    if (previous) length += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    previous = point;
  }
  return length;
}

function branch(mirror: string): ReefBranch {
  const group = document.createElementNS(SVG_NS, 'g');
  if (mirror) group.setAttribute('transform', mirror);

  const [tailStart, tailControl] = TAIL;
  const [base, c1, c2, tip] = STEM;
  const xy = (p: readonly [number, number]): string => p.join(' ');
  const stem = document.createElementNS(SVG_NS, 'path');
  stem.setAttribute('d', `M${xy(tailStart)}Q${xy(tailControl)} ${xy(base)}C${xy(c1)} ${xy(c2)} ${xy(tip)}`);
  stem.setAttribute('fill', 'none');
  stem.setAttribute('stroke', 'currentColor');
  stem.setAttribute('stroke-width', '0.9');
  stem.setAttribute('stroke-linecap', 'round');
  group.appendChild(stem);

  const samples = Array.from({ length: 49 }, (_, i) => i / 48);
  const tailLength = polylineLength(
    samples.map((t): [number, number] => {
      const u = 1 - t;
      return [
        u * u * tailStart[0] + 2 * u * t * tailControl[0] + t * t * base[0],
        u * u * tailStart[1] + 2 * u * t * tailControl[1] + t * t * base[1],
      ];
    }),
  );
  const leafyLength = polylineLength(samples.map(stemPoint));
  const stemLength = tailLength + leafyLength;

  const leaves = LEAVES.map(([t, turn, length, lean]): Leaf => {
    const [x, y] = stemPoint(t);
    let angle = stemHeading(t) + turn;
    const toUpright = ((-90 - angle + 540) % 360) - 180;
    angle += lean * toUpright;
    const half = length * LEAF_WIDTH;
    const leaf = document.createElementNS(SVG_NS, 'path');
    leaf.setAttribute(
      'd',
      `M0 0C${length * 0.25} ${-half} ${length * 0.62} ${-half} ${length} 0` +
        `C${length * 0.62} ${half} ${length * 0.25} ${half} 0 0Z`,
    );
    leaf.setAttribute('fill', 'currentColor');
    group.appendChild(leaf);
    return { el: leaf, x, y, angle, at: (tailLength + t * leafyLength) / stemLength };
  });

  return { group, stem, stemLength, leaves };
}

/** Both branches at growth `g`, 0 unseen to 1 full. */
export function drawClosedReef(branches: readonly ReefBranch[], g: number): void {
  const drawn = clamp01(g / 0.85);
  for (const b of branches) {
    b.stem.setAttribute('stroke-dasharray', String(b.stemLength));
    b.stem.setAttribute('stroke-dashoffset', String(b.stemLength * (1 - drawn)));
    for (const leaf of b.leaves) {
      const open = g >= 1 ? 1 : clamp01((g - leaf.at * 0.8) / 0.2);
      leaf.el.setAttribute('transform', `translate(${leaf.x} ${leaf.y}) rotate(${leaf.angle}) scale(${open})`);
    }
  }
}

/** The wreath's SVG, full-grown, and its branches for growing it. */
export function closedReef(): { svg: SVGSVGElement; branches: ReefBranch[] } {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 60 60');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const branches = [branch(''), branch('translate(60 0) scale(-1 1)')];
  for (const b of branches) svg.appendChild(b.group);
  drawClosedReef(branches, 1);
  return { svg, branches };
}
