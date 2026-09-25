/**
 * /on-track — the stats and results hub.
 *
 * Every figure this renders is read from the data layer. There is no number
 * literal below and none in on-track.html either, which is the point: the
 * career totals move on a race weekend, and anything typed into markup is
 * something nobody will remember to change.
 *
 * Section order follows the reference (docs/ON-TRACK-REFERENCE.md §1). Built so
 * far: the page header, the career stat band (including the twenty-season table
 * that the reference's seven-row block becomes), the F1 result highlights, the
 * countdown to the next race, and the season schedule with its circuit panel.
 */

import './styles/on-track.css';
import Lenis from 'lenis';
import { gsap, mm, reducedMotion, ScrollTrigger, WIDE_AND_ANIMATED } from './lib/motion';
import { mountChrome } from './lib/chrome';
import { hasTrack, mountCircuit } from './lib/circuit';
import { mountGalleryScroll } from './lib/gallery';
import { mountHelmetScroll } from './HelmetScroll';
import { mountFooterMarquee } from './lib/marquee';
import { Signature } from './Signature';
import { mountReveals } from './lib/reveal';
import {
  mountCalloutCrest,
  mountHelmets,
  mountHofDrift,
  mountRiser,
  mountSocials,
} from './lib/showcase';
import {
  age,
  driver,
  eras,
  preF1Championships,
  preF1Span,
  preF1Titles,
  resultHighlights,
} from './content/hamilton';
import type { ResultHighlight } from './content/hamilton';
import {
  calendar,
  career,
  circuitById,
  lastRound,
  nextRound,
  provenance,
  roundStart,
  seasons,
  seasonsNewestFirst,
  wins,
} from './content/live-stats';
import type { CalendarRound, RaceSession } from './content/live-stats';
import { countryName, flagUrl } from './content/countries';
import { circuitFacts, formatKm } from './content/circuit-facts';

/* ------------------------------------------------------------------ *
 * Smooth scroll
 *
 * The same instance the homepage builds, with the same options and for the same
 * reasons — see main.ts. Each page owns its own scroller lifetime, but the
 * numbers must not diverge: `lerp` IS the scroll feel, and the reference
 * measures 0.1. `syncTouch` and `touchMultiplier` are the only two options here
 * that differ from Lenis's own defaults.
 *
 * ScrollTrigger is driven from Lenis rather than the native scroll event, and
 * Lenis is stepped from gsap's ticker, so the two share one clock.
 * ------------------------------------------------------------------ */

/** The page's scroller, for its one other user: a calendar row taking the
    reader up to the panel it changed. Null under reduced motion, where there
    is no smoothing to go through, and that user has to cope without one. */
let smoothScroller: Lenis | null = null;

if (!reducedMotion) {
  const instance = new Lenis({
    lerp: 0.1,
    smoothWheel: true,
    syncTouch: true,
    syncTouchLerp: 0.075,
    wheelMultiplier: 1,
    touchMultiplier: 1.25,
  });
  instance.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => instance.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  smoothScroller = instance;
}

/* ------------------------------------------------------------------ *
 * The tail Home and On Track share
 *
 * Reference sections 7 and 8 — the full-screen picture, the helmet wall, the
 * socials block and the footer's row. Its own study of them is explicit that
 * On Track should reuse Home's components rather than re-implement them, so it
 * does: same partials, same modules, same measured motion. See
 * src/lib/showcase.ts and src/lib/marquee.ts.
 *
 * The wall is built first, before any ScrollTrigger on this page exists, for
 * the reason it is built first on Home — twenty-six cards is most of the
 * document's height, and a trigger that measures before they are in the DOM
 * measures the wrong page.
 *
 * No mountStore: Home's big store section is not on this page. The reference's
 * On Track closes on the short callout instead, which is static markup.
 * ------------------------------------------------------------------ */

/* The reference's own timing for this page's gallery: travel from the moment
   the section enters, with a second of catch-up. See lib/gallery.ts. */
mountGalleryScroll({ start: 'rising', scrub: 1 });
mountHelmets();
mountRiser();
mountHofDrift();
mountCalloutCrest();
mountSocials();
mountFooterMarquee();

/* ------------------------------------------------------------------ *
 * Formatting — one place, so the table and the stat grid cannot disagree
 * about how a number looks.
 * ------------------------------------------------------------------ */

const groups = new Intl.NumberFormat('en-GB');

/** Points can be fractional — 2021 ended on 387.5 — but rarely are. */
const points = (n: number): string =>
  n % 1 === 0 ? groups.format(n) : groups.format(Math.trunc(n)) + String(n % 1).slice(1);

const SMALL_NUMBERS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen',
];

const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/**
 * Numbers under a hundred spelled out, for the places where a figure sits
 * inside a sentence rather than in a table -- "twenty seasons", as the
 * reference writes "seven seasons". Still derived: the value comes from the
 * data either way; this only decides how it reads. Anything else stays digits.
 */
function spell(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 100) return groups.format(n);
  if (n < SMALL_NUMBERS.length) return SMALL_NUMBERS[n] as string;
  const unit = n % 10;
  return `${TENS[Math.floor(n / 10)]}${unit ? `-${SMALL_NUMBERS[unit]}` : ''}`;
}

/**
 * Three-letter months, as the reference prints them. `toLocaleDateString`
 * cannot be trusted with this: en-GB's short September is "Sept".
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "2008-07-06" -> "6 Jul". Read in UTC, because the record's dates are
 * calendar days rather than instants, and a local zone west of Greenwich would
 * otherwise print every one of them a day early.
 */
function shortDate(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`);
  const month = MONTHS[day.getUTCMonth()];
  if (month === undefined) throw new Error(`[on-track] "${iso}" is not an ISO date`);
  return `${day.getUTCDate()} ${month}`;
}

/** 1 -> 1st, 2 -> 2nd, 3 -> 3rd, 11 -> 11th. */
function ordinal(n: number): string {
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ------------------------------------------------------------------ *
 * Drawn marks
 *
 * Pure builders with no dependency on anything else on the page, kept together
 * and kept HERE rather than beside the section that first needed them: the
 * statement near the top of the document draws a wreath and the stat grid
 * draws the scribble, and a `const` declared down beside the pre-F1 list would
 * put both callers inside its temporal dead zone.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * The closed reef
 *
 * The small closed wreath the reference hangs beside each pre-F1 result (its
 * Rive "reef" artboard, played once as the result scrolls into view): two
 * laurel branches rising from a bare stem at the bottom centre, curling up the
 * sides almost into a circle and leaving a gap at the top. Redrawn here as an
 * original -- a curved stem with leaves at a regular step, the outer row
 * leaning out and up, the inner row in, and a fan of four at the tip -- and
 * grown the way the statement's reef is: the stem drawn on while the leaves
 * open one after another from the base.
 * ------------------------------------------------------------------ */

/** The left branch in the 60x60 box: a bare tail running in from the bottom
    centre (start, control), then the leafy stem (base, two controls, tip). */
const CLOSED_REEF_TAIL = [
  [27.2, 51.6],
  [24, 51.2],
] as const;
const CLOSED_REEF_STEM = [
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
const CLOSED_REEF_LEAVES: readonly (readonly [at: number, turn: number, length: number, lean: number])[] = [
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
const CLOSED_REEF_LEAF_WIDTH = 0.2;

function closedReefPoint(t: number): [number, number] {
  const [p0, p1, p2, p3] = CLOSED_REEF_STEM;
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

/** The stem's direction at `t`, in degrees clockwise from +x. */
function closedReefHeading(t: number): number {
  const [p0, p1, p2, p3] = CLOSED_REEF_STEM;
  const u = 1 - t;
  const dx = 3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]);
  const dy = 3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** Length of a polyline through `points`, for the stem's dash. */
function polylineLength(points: readonly (readonly [number, number])[]): number {
  let length = 0;
  let previous = points[0];
  for (const point of points) {
    if (previous) length += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    previous = point;
  }
  return length;
}

function closedReefBranch(mirror: string): ReefBranch {
  const group = document.createElementNS(SVG_NS, 'g');
  if (mirror) group.setAttribute('transform', mirror);

  const [tailStart, tailControl] = CLOSED_REEF_TAIL;
  const [base, c1, c2, tip] = CLOSED_REEF_STEM;
  const stem = document.createElementNS(SVG_NS, 'path');
  const xy = (p: readonly [number, number]): string => p.join(' ');
  stem.setAttribute('d', `M${xy(tailStart)}Q${xy(tailControl)} ${xy(base)}C${xy(c1)} ${xy(c2)} ${xy(tip)}`);
  stem.setAttribute('fill', 'none');
  stem.setAttribute('stroke', 'currentColor');
  stem.setAttribute('stroke-width', '0.9');
  stem.setAttribute('stroke-linecap', 'round');
  group.appendChild(stem);

  /* Measured once by sampling, so the dash covers the path and each leaf
     knows how far along the drawn line it sits. */
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
  const leafyLength = polylineLength(samples.map(closedReefPoint));
  const stemLength = tailLength + leafyLength;

  /* A leaf is a pointed lens drawn along +x from its own base, so a rotation
     aims it and a scale grows it out of the stem. */
  const leaves: ReefLeaf[] = CLOSED_REEF_LEAVES.map(([t, turn, length, lean]) => {
    const [x, y] = closedReefPoint(t);
    let angle = closedReefHeading(t) + turn;
    const toUpright = ((-90 - angle + 540) % 360) - 180;
    angle += lean * toUpright;
    const half = length * CLOSED_REEF_LEAF_WIDTH;
    const leaf = document.createElementNS(SVG_NS, 'path');
    leaf.setAttribute(
      'd',
      `M0 0C${length * 0.25} ${-half} ${length * 0.62} ${-half} ${length} 0` +
        `C${length * 0.62} ${half} ${length * 0.25} ${half} 0 0Z`,
    );
    leaf.setAttribute('fill', 'currentColor');
    group.appendChild(leaf);
    /* Opens as the drawn stem reaches it: `at` is its share of the whole line. */
    const at = (tailLength + t * leafyLength) / stemLength;
    return { el: leaf, x, y, angle, at };
  });

  return { group, stem, stemLength, leaves, mirror };
}

/** Both branches at growth `g`, 0 unseen to 1 full: the stem draws on just
    ahead of the leaves, which open in turn from the base. */
function drawClosedReef(branches: readonly ReefBranch[], g: number): void {
  const drawn = clamp01(g / 0.85);
  for (const branch of branches) {
    branch.stem.setAttribute('stroke-dasharray', String(branch.stemLength));
    branch.stem.setAttribute('stroke-dashoffset', String(branch.stemLength * (1 - drawn)));
    for (const leaf of branch.leaves) {
      /* Exactly 1 once grown: (1 - 0.8) / 0.2 is 0.9999999999999998 in floats. */
      const open = g >= 1 ? 1 : clamp01((g - leaf.at * 0.8) / 0.2);
      leaf.el.setAttribute(
        'transform',
        `translate(${leaf.x} ${leaf.y}) rotate(${leaf.angle}) scale(${open})`,
      );
    }
  }
}

/** The wreath's SVG and its two branches, for growing. Drawn by the caller. */
function closedReef(): { svg: SVGSVGElement; branches: ReefBranch[] } {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 60 60');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const branches = [closedReefBranch(''), closedReefBranch('translate(60 0) scale(-1 1)')];
  for (const branch of branches) svg.appendChild(branch.group);
  return { svg, branches };
}

/* ------------------------------------------------------------------ *
 * The reef
 *
 * The reference's 184x81 wreath under the statement ("reef" in its files) is a
 * Rive animation scrubbed by scroll: two laurel branches sprout together at the
 * bottom centre, then grow and part until they stand at the sides, leaving the
 * gap the helmet lands in. Measured off its canvas frame by frame, the growth
 * runs from 22% to 66% of its trigger (the wreath's top at the bottom of the
 * screen, to its bottom at the middle). Redrawn here as an original branch --
 * nine leaves alternating up a curved stem, and one at the tip -- and grown on
 * the same schedule.
 * ------------------------------------------------------------------ */

/** The left branch's stem, in the wreath's 184x81 box: base, two controls, tip. */
const REEF_STEM = [
  [48, 67],
  [25, 60],
  [20, 30],
  [42, 7],
] as const;

/** Where the base starts, relative to where it ends: at the wreath's centre line. */
const REEF_TRAVEL = 38;

interface ReefLeaf {
  readonly el: SVGPathElement;
  /** Where the leaf joins the stem, and the way it points. */
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  /** How far up the stem it sits, 0 at the base and 1 at the tip. */
  readonly at: number;
}

interface ReefBranch {
  readonly group: SVGGElement;
  readonly stem: SVGPathElement;
  readonly stemLength: number;
  readonly leaves: readonly ReefLeaf[];
  /** "" for the left branch; the mirror that makes the right one. */
  readonly mirror: string;
}

function reefPoint(t: number): [number, number] {
  const [p0, p1, p2, p3] = REEF_STEM;
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

/** The stem's direction at `t`, in degrees, pointing toward the tip. */
function reefHeading(t: number): number {
  const [p0, p1, p2, p3] = REEF_STEM;
  const u = 1 - t;
  const dx = 3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]);
  const dy = 3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function reefBranch(mirror: string): ReefBranch {
  const group = document.createElementNS(SVG_NS, 'g');

  const [p0, p1, p2, p3] = REEF_STEM;
  const stem = document.createElementNS(SVG_NS, 'path');
  stem.setAttribute('d', `M${p0} C${p1} ${p2} ${p3}`);
  stem.setAttribute('fill', 'none');
  stem.setAttribute('stroke', 'currentColor');
  stem.setAttribute('stroke-width', '1.4');
  stem.setAttribute('stroke-linecap', 'round');
  group.appendChild(stem);

  let stemLength = 0;
  for (let i = 0, prev = reefPoint(0); i < 24; i++) {
    const next = reefPoint((i + 1) / 24);
    stemLength += Math.hypot(next[0] - prev[0], next[1] - prev[1]);
    prev = next;
  }

  /* Eleven leaves alternating outer and inner, shrinking toward the tip, and a
     twelfth continuing the stem -- packed tight enough to overlap and hide it,
     as the reference's do. Outer ones splay a little wider than inner ones. A
     leaf is a pointed lens drawn along +x from its own base, so a rotation aims
     it and a scale grows it from the stem outward. */
  const leaves: ReefLeaf[] = [];
  const spots = Array.from({ length: 11 }, (_, i) => 0.06 + i * 0.085);
  spots.push(1);
  spots.forEach((at, i) => {
    const [x, y] = reefPoint(at);
    const tip = at === 1;
    const splay = tip ? 0 : i % 2 === 0 ? -34 : 28;
    const length = 13.5 - at * 3.5;
    const half = length * 0.25;
    const el = document.createElementNS(SVG_NS, 'path');
    el.setAttribute(
      'd',
      `M0 0C${length * 0.3} ${-half} ${length * 0.72} ${-half} ${length} 0` +
        `C${length * 0.72} ${half} ${length * 0.3} ${half} 0 0Z`,
    );
    el.setAttribute('fill', 'currentColor');
    group.appendChild(el);
    leaves.push({ el, x, y, angle: reefHeading(at) + splay, at });
  });

  return { group, stem, stemLength, leaves, mirror };
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Draws both branches at growth `g` (0 unseen, 1 full). The base slides out
 * from the centre line as the branch scales up about it; the stem draws in
 * just ahead of the leaves, which open one after another from the base, so
 * the branch sprouts rather than being traced and then filled.
 */
function drawReef(branches: readonly ReefBranch[], g: number): void {
  const [bx, by] = REEF_STEM[0];
  const scale = 0.15 + 0.85 * g;
  const slide = REEF_TRAVEL * (1 - g) ** 1.5;
  const drawn = clamp01(g / 0.8);
  for (const branch of branches) {
    branch.group.setAttribute(
      'transform',
      `${branch.mirror} translate(${slide} 0) translate(${bx} ${by}) scale(${scale}) translate(${-bx} ${-by})`,
    );
    branch.stem.setAttribute('stroke-dasharray', String(branch.stemLength));
    branch.stem.setAttribute('stroke-dashoffset', String(branch.stemLength * (1 - drawn)));
    for (const leaf of branch.leaves) {
      const open = clamp01((g - leaf.at * 0.8) / 0.2);
      leaf.el.setAttribute(
        'transform',
        `translate(${leaf.x} ${leaf.y}) rotate(${leaf.angle}) scale(${open})`,
      );
    }
  }
}

/** The wreath's SVG, drawn full-grown, and its two branches for animating. */
function reef(): { svg: SVGSVGElement; branches: ReefBranch[] } {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 184 81');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const branches = [reefBranch(''), reefBranch('translate(184 0) scale(-1 1)')];
  for (const branch of branches) svg.appendChild(branch.group);
  drawReef(branches, 1);
  return { svg, branches };
}

/**
 * The accent scrawl the reference draws over its win count — a Rive-animated
 * "P1" in lime. Drawn here rather than fetched: it is four strokes, and an
 * asset for four strokes is an asset to keep in step with the palette.
 */
function p1Scribble(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  /* The reference's mark is a Rive animation of a CURSIVE "P1" — one flowing
     gesture in its accent, slanted, with a long tail that sweeps out to the
     right past the number. The first attempt here drew a geometric outline in
     four disconnected strokes at nine viewBox units, which at ~13.5rem is 19
     device pixels: the P's stem, its bowl and the 1 all touched and it rendered
     as a solid lozenge.

     Redrawn as script. Three gestures rather than four — the 1 and its flourish
     are a single stroke, because in the reference they are a single movement —
     and at 7 units, which keeps the brush weight without closing the counters. */
  const strokes = [
    'M34 12C30 38 26 64 20 90', // the P's stem, leaning as it descends
    'M34 14C50 8 64 16 60 30C56 44 40 46 27 44', // its bowl
    'M62 34C68 28 74 24 80 20C78 42 74 62 70 82', // the 1: entry flick into the stem
    'M52 80C66 84 82 78 96 66', // the tail, sweeping out past the number
  ];
  for (const d of strokes) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
  }
  return svg;
}


function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ------------------------------------------------------------------ *
 * Simple text bindings
 * ------------------------------------------------------------------ */

const bindings: Record<string, string> = {
  'driver-name': driver.fullName,
  'driver-age': String(age()),
  'driver-birthplace': driver.birthplace,
  'driver-seasons': String(career.seasonsContested),
  'debut-year': String(driver.debutYear),
  /* The hero paragraph's two figures. Spelled rather than set as digits
     because they sit inside a sentence, and counted rather than typed because
     both move: the title count on a championship Sunday, the team count on a
     transfer. */
  'titles-word': spell(career.championships),
  'teams-word': spell(eras.length),
  /* The result highlights' blurb, "throughout his twenty seasons". Counted
     from the seasons record, the current one included, as the reference
     counts its own. */
  'seasons-word': spell(career.seasonsContested),
  /* The statement's "chasing eight": the title after the ones he has. */
  'next-title-word': spell(career.championships + 1),
  /* "Ferrari F1 since 2025", where the reference has its own team and year.
     Read off the era that has not ended, so the year comes from the same
     record as the team rather than from a second place that can disagree. */
  'team-since': (() => {
    const era = eras.find((e) => e.to === null);
    if (!era) throw new Error('[content] no open era in the content model');
    return `${era.team} F1 since ${era.from}`;
  })(),
};

for (const [key, value] of Object.entries(bindings)) {
  for (const node of document.querySelectorAll<HTMLElement>(`[data-bind="${key}"]`)) {
    node.textContent = value;
  }
}

/* ------------------------------------------------------------------ *
 * The hero card cluster
 *
 * Three panels, two subjects — the reference's arrangement exactly. A
 * "previous" card showing how the last round went, and then the next round
 * carried across TWO panels: the round number and where it is in the framed
 * card, the circuit and the weekend dates in the wide one beside it.
 *
 * Both subjects are chosen by the clock rather than by whether a result has
 * been recorded — see nextRound() and lastRound(). The two differ for most of a
 * race weekend, and going by the clock is what keeps the previous card from
 * still pointing at the race currently being run.
 *
 * Every panel is hidden in the markup and revealed here. Either can
 * legitimately have nothing to show — no previous round before a season opens,
 * no next round after it ends — and an empty outlined panel reads as a failure
 * rather than as an answer.
 * ------------------------------------------------------------------ */

/** Fills one `[data-x]` slot, and says so if the markup has moved out from under it. */
function slot(name: string, value: string): void {
  const node = document.querySelector<HTMLElement>(`[data-${name}]`);
  if (!node) throw new Error(`[hero] no [data-${name}] in the markup`);
  node.textContent = value;
}

function reveal(selector: string): void {
  const panel = document.querySelector<HTMLElement>(selector);
  if (panel) panel.hidden = false;
}

/**
 * The weekend as the reference's hero card prints it: two words, the days
 * zero-padded and hyphenated ("04-06") and the race day's month in three
 * letters ("Sep" -- not the "Sept" en-GB formatting now returns).
 */
function weekend(round: CalendarRound): { days: string; month: string } {
  const dates = [
    round.sessions.practice1?.date,
    round.sessions.practice2?.date,
    round.sessions.qualifying?.date,
    round.sessions.sprint?.date,
    round.date,
  ].filter((d): d is string => typeof d === 'string');

  const first = dates.reduce((a, b) => (a < b ? a : b));
  const day = (iso: string): string =>
    String(new Date(`${iso}T00:00:00Z`).getUTCDate()).padStart(2, '0');
  const month = MONTHS[new Date(`${round.date}T00:00:00Z`).getUTCMonth()];
  if (!month) throw new Error(`[hero] unreadable race date "${round.date}"`);
  return { days: `${day(first)}-${day(round.date)}`, month };
}

const previous = lastRound();
if (previous) {
  /* What actually happened, in the sport's own terms: a finished race gives a
     position, a retirement gives the status the timing screens print. */
  const outcome = previous.result
    ? previous.result.position
      ? `P${previous.result.position}`
      : previous.result.status
    : '\u2014';

  // The markup carries the "GP" as a second word, as the reference does.
  slot('prev-race', previous.raceName.replace(/ Grand Prix$/, ''));

  /* Spoken, not drawn \u2014 the card shows the circuit and the race name, as the
     reference's does. Phrased as a sentence rather than the "P3 / 15 pts" the
     figures used to carry, because it is only ever read aloud. */
  slot(
    'prev-outcome',
    previous.result
      ? `Finished ${outcome}, ${points(previous.result.points)} points.`
      : 'Result not yet published.',
  );

  /* The figure and its ordinal letters as two runs, the letters set small --
     the reference's "position" format. A car that did not finish prints what
     the timing screens print for it; a result not yet published leaves the
     row empty, as the reference's is then. */
  const finish = document.querySelector<HTMLElement>('[data-prev-finish]');
  const result = previous.result;
  if (finish && result?.position) {
    const place = ordinal(result.position);
    const digits = place.replace(/\D+$/, '');
    const figure = document.createElement('span');
    figure.textContent = digits;
    const letters = document.createElement('span');
    letters.className = 'ot-hero__finish-suffix';
    letters.textContent = place.slice(digits.length);
    finish.replaceChildren(figure, letters);
  } else if (finish && result) {
    const classified: Readonly<Record<string, string>> = { R: 'DNF', D: 'DSQ', W: 'DNS' };
    finish.textContent = classified[result.positionText] ?? result.positionText;
  }

  /* Same guard as every other circuit: a venue with no outline (the historic
     ones, say) leaves the card to the race name. */
  const prevCircuitHost = document.querySelector<HTMLElement>('[data-prev-circuit-host]');
  if (prevCircuitHost && hasTrack(previous.circuitId)) {
    void mountCircuit(prevCircuitHost, { circuitId: previous.circuitId }).catch(
      (error: unknown) => {
        console.warn('[on-track] previous-race circuit did not load', error);
      },
    );
  }

  reveal('[data-prev]');
}

const next = nextRound();
if (next) {
  slot('next-round', String(next.round));
  const flag = document.querySelector<HTMLImageElement>('[data-next-flag]');
  if (flag) {
    flag.src = flagUrl(next.country);
    flag.hidden = false;
  }

  /* Locality, except where it only repeats the race name — "Abu Dhabi" under a
     card already labelled Abu Dhabi says nothing. */
  const stripped = next.raceName.replace(/ Grand Prix$/, '');
  slot('next-where', next.locality && next.locality !== stripped ? next.locality : next.circuitName);

  /* "Ferrari F1 since 2025", where the reference has its own team and year.
     Read off the era that has not ended rather than off driver.currentTeam, so
     the year comes from the same record as the team. */
  const era = eras.find((e) => e.to === null);
  if (!era) throw new Error('[hero] no open era in the content model');
  slot('next-team', `${era.team} F1 since ${era.from}`);

  slot('round-circuit', next.circuitName);
  slot('round-country', next.country);
  const dates = weekend(next);
  slot('round-days', dates.days);
  slot('round-month', dates.month);

  /* The traced outline of the circuit itself, which is what the reference puts
   * in this slot rather than the circuit's name.
   *
   * Guarded on `hasTrack` rather than attempted and caught: circuits.riv
   * carries 24 tracks and circuit-outline.ts the two it lacks (Madring and
   * Sepang), and a venue outside both is an ordinary state, not a failure. It
   * keeps the name, which is why the name is still in the markup.
   *
   * Not awaited — the hero must not wait on a 36KB fetch and a wasm boot to
   * render. The name is on screen from the first frame and steps aside only
   * once a shape is actually drawing. */
  const circuitHost = document.querySelector<HTMLElement>('[data-round-circuit-host]');
  if (circuitHost && hasTrack(next.circuitId)) {
    void mountCircuit(circuitHost, { circuitId: next.circuitId }).then(
      () => {
        circuitHost.dataset.circuitDrawn = '';
      },
      (error: unknown) => {
        // Never fatal: the card is still complete without it.
        console.warn('[on-track] hero circuit did not load', error);
      },
    );
  }

  reveal('[data-next]');
  reveal('[data-round]');
}

/**
 * Runs a measurement again whenever the numbers it depends on can have changed.
 *
 * `document.fonts.ready` alone is not enough and the podium proved it. It
 * resolves once nothing is PENDING — and at module-evaluation time nothing is
 * pending yet, because layout has not asked for a face. So it fired
 * immediately, against the fallback, and the value stuck: the label was sized
 * from Oswald's much narrower glyphs and hung 192px clear of the digits it is
 * meant to sit against.
 *
 * `loadingdone` is the event that actually says "faces arrived". Both are
 * kept — `ready` covers the case where they were already cached, `loadingdone`
 * the case where they were not — and `refreshInit` covers a resize, since every
 * rem on this page is solved from the viewport.
 */
const remeasure = (fn: () => void): void => {
  void document.fonts.ready.then(fn);
  document.fonts.addEventListener('loadingdone', fn);
  ScrollTrigger.addEventListener('refreshInit', fn);
};

/** Width of the ink, not of the box — the number is a full-width flex row. */
const inkWidth = (host: HTMLElement): number =>
  host.childElementCount > 0
    ? [...host.children].reduce((w, c) => w + c.getBoundingClientRect().width, 0)
    : host.getBoundingClientRect().width;

/* ------------------------------------------------------------------ *
 * The gigantic podium number
 *
 * Reference `.on-t-podium-text-layout`: "56" at 114rem, in the face this page
 * shares with it. Its two digits span 1649px of their 1824px size, 0.904 of
 * an em. 207 at that size would run 2430px, so it is scaled until it spans the
 * same: the ratio goes to --podium-fit and the CSS multiplies the reference's
 * size by it, which lands 207 at 77.4rem. Two digits resolve to exactly 114.
 *
 * Then the scroll, the reference's own (its bundle's L_): over the layout's
 * `top bottom` to `bottom center`, eased power1.in and scrubbed, the digits
 * after the first rise 17.5rem while PODIUMS rises from 17.5rem below into the
 * space they leave. Both are one progress value here, --podium-p, and the
 * distances live in the CSS, so the narrow sizes need no second copy.
 * ------------------------------------------------------------------ */

/** What the reference's number spans, as a share of its font size: 1648.92 / 1824. */
const REFERENCE_SPAN_EM = 1648.92 / 1824;

const podium = document.querySelector<HTMLElement>('[data-podium]');
const gigantic = document.querySelector<HTMLElement>('[data-gigantic]');
const giganticSr = document.querySelector<HTMLElement>('[data-gigantic-sr]');

if (podium && gigantic && giganticSr) {
  const value = career.podiums;

  // The accessible mirror carries the real value as one readable string. The
  // visual copy is split into per-character spans and is aria-hidden, because
  // a screen reader announcing three separate digit nodes is not a number.
  giganticSr.textContent = `${groups.format(value)} podiums`;

  gigantic.textContent = '';
  for (const ch of String(value)) gigantic.appendChild(el('span', 'ot-podium__char', ch));

  /* Measured at the reference's own size, so the ratio is exact rather than
     scaled up from a probe. */
  const fit = (): void => {
    podium.style.removeProperty('--podium-fit');
    const size = Number.parseFloat(getComputedStyle(gigantic).fontSize);
    const ink = inkWidth(gigantic);
    if (!(size > 0) || !(ink > 0)) return;
    podium.style.setProperty('--podium-fit', String((size * REFERENCE_SPAN_EM) / ink));
  };
  /* Run once now — that first pass is what keeps the number sized correctly if
     a face never arrives at all — then again whenever the metrics change. */
  fit();
  remeasure(fit);

  /* The rise is spread over the reference's layout, which is its number's line
     box: 114rem at a 0.85 line, 1550px at 1728. Ours is that box scaled by
     --podium-fit, so a `bottom center` end arrived 445px of scroll early and the
     digits finished rising before the reader had scrolled as far. Dividing the
     fit back out restores the reference's distance, and the quotient does not
     depend on when the fit last ran, because the box scales with it. */
  const referenceBox = (): number =>
    gigantic.offsetHeight / (Number(podium.style.getPropertyValue('--podium-fit')) || 1);

  mm.add('(prefers-reduced-motion: no-preference)', () => {
    gsap.fromTo(
      podium,
      { '--podium-p': 0 },
      {
        '--podium-p': 1,
        ease: 'power1.in',
        scrollTrigger: {
          trigger: podium,
          start: 'top bottom',
          end: () => `+=${referenceBox() + window.innerHeight / 2}`,
          scrub: true,
        },
      },
    );
  });
}

/* ------------------------------------------------------------------ *
 * Headline career stats
 *
 * The reference's four, in its order: wins under the P1 scribble, poles,
 * average finish, fastest laps. Titles are not made a fifth figure -- the
 * reference has none -- and each title season is starred in the list below.
 * Starts and points go to the small print under the portrait.
 * ------------------------------------------------------------------ */

interface Stat {
  label: string;
  /** The counted figure, a whole number. */
  value: number;
  /** Decimals set small and grey after the figure, as the reference sets its
      average finish: ".89". */
  fraction?: string;
  /** Carries the accent scribble the reference draws over its win count. */
  scribble?: boolean;
}

/* "3.89" -> 3 and ".89". Already rounded to two places by the generator and
   checked against the seasons in live-stats.ts, so this only splits it. */
const averageFinish = career.averageFinish.toFixed(2);
const averagePoint = averageFinish.indexOf('.');

const STATS: Stat[] = [
  { label: 'Formula 1 wins', value: career.wins, scribble: true },
  { label: 'Pole positions', value: career.poles },
  {
    label: 'Average finish',
    value: Number(averageFinish.slice(0, averagePoint)),
    fraction: averageFinish.slice(averagePoint),
  },
  { label: 'Fastest laps', value: career.fastestLaps },
];

const statGrid = document.querySelector<HTMLElement>('[data-stat-grid]');

if (statGrid) {
  for (const stat of STATS) {
    const item = el('li', 'ot-stats__item');
    const settled = `${groups.format(stat.value)}${stat.fraction ?? ''}`;

    // Same mirror pattern as the gigantic number: the counter is aria-hidden
    // and an sr-only twin carries the settled value, so a count-up never reads
    // out as a stream of changing numbers.
    item.appendChild(el('span', 'sr-only', `${stat.label}: ${settled}`));

    // Swept in a line at a time, as the reference's labels are
    // (`.high-line-reveal` on each line of "FORMULA 1 / WINS").
    const label = el('span', 'ot-stats__label reveal-text', stat.label);
    label.setAttribute('aria-hidden', 'true');

    /* The reference puts the descriptor ABOVE the figure. The old order here
       was the other way up. */
    const figureWrap = el('span', 'ot-stats__figure');
    figureWrap.setAttribute('aria-hidden', 'true');

    const figure = el('span', 'ot-stats__value', groups.format(stat.value));
    figure.dataset.count = String(stat.value);
    figureWrap.appendChild(figure);

    /* The decimals are a counter of their own beside a point that never moves,
       as the reference sets them: `.` and `28` in two boxes. */
    if (stat.fraction) {
      figure.classList.add('ot-stats__value--whole');
      const decimals = stat.fraction.replace(/^\./, '');
      const counter = el('span', 'ot-stats__decimals', decimals);
      counter.dataset.count = String(Number(decimals));
      const fraction = el('span', 'ot-stats__fraction', '.');
      fraction.appendChild(counter);
      figureWrap.appendChild(fraction);
    }

    if (stat.scribble) {
      const scribble = el('span', 'ot-stats__scribble');
      scribble.appendChild(p1Scribble());
      figureWrap.appendChild(scribble);
    }

    item.append(label, figureWrap);
    statGrid.appendChild(item);
  }

  /* One size for the whole grid, solved from its widest figure.
   *
   * 17.5rem is the reference's size, and in Mona Sans at "wdth" 75 Hamilton's
   * three-digit counts fit it: "106" sets about 305px in a 397.5px column,
   * where the reference's widest two-digit figure is 209px. So this holds the
   * reference's size at every desktop width -- the root is fluid, figure and
   * column scale together -- and only steps in where a figure would otherwise
   * crowd the next column: to 92% of its own, which leaves at least a gutter
   * and a half of air between two numbers.
   *
   * Sized as a SET rather than per item, because four numbers at four sizes
   * read as four unrelated facts instead of one career. Measured before the
   * count-up below starts, while each figure still holds its settled string --
   * a figure showing "0" would measure one digit wide and size the grid for a
   * number that is about to grow. */
  const STAT_SPAN = 0.92;

  const figures = [...statGrid.querySelectorAll<HTMLElement>('.ot-stats__value')];

  const fitStats = (): void => {
    statGrid.style.removeProperty('--stat-size');
    const column = statGrid.firstElementChild?.clientWidth ?? 0;
    if (column <= 0) return;

    let widest = 0;
    for (const figure of figures) {
      /* Measure the SETTLED string. Once the count-up below is running a figure
         reads "0", and a grid sized from that would be sized for one digit. */
      const showing = figure.textContent;
      figure.textContent = groups.format(Number(figure.dataset.count));
      widest = Math.max(widest, inkWidth(figure));
      figure.textContent = showing;
    }

    if (widest <= 0) return;
    const scale = Math.min(1, (column * STAT_SPAN) / widest);
    statGrid.style.setProperty('--stat-size', `${17.5 * scale}rem`);
  };

  fitStats();
  remeasure(fitStats);

  /* Count-ups, the reference's `[data-car-counter]` to the number. Each
   * counter waits zero-padded to its own digit count ("000" under a
   * three-digit figure, "0" under the "3"), and once its top crosses 90% of the
   * screen counts up over 1s power1.out, keeping the padding as it goes. A
   * figure that sets with a group separator counts in groups instead, as the
   * reference's does. The average finish's decimals are the second counter,
   * "00" up to their value, beside a point that stays put.
   *
   * The targets are the data layer's own (data-count, written above from
   * `career`). The counters are aria-hidden; each item's sr-only twin states
   * the settled value, so none of this is ever read out mid-count. Wide and
   * animated only: elsewhere the settled figures are simply there. */
  mm.add(WIDE_AND_ANIMATED, () => {
    const counters = [...statGrid.querySelectorAll<HTMLElement>('[data-count]')];
    const settled = counters.map((counter) => counter.textContent ?? '');

    const tweens = counters.map((counter, i) => {
      const final = settled[i] ?? '';
      const target = Number(counter.dataset.count);
      const digits = final.replace(/\D/g, '').length;
      const grouped = /\D/.test(final);
      const show = (n: number): string =>
        grouped ? groups.format(n) : String(n).padStart(digits, '0');

      const state = { n: 0 };
      counter.textContent = '0'.repeat(Math.max(1, digits));
      return gsap.to(state, {
        n: target,
        duration: 1,
        ease: 'power1.out',
        scrollTrigger: { trigger: counter, start: 'top 90%', once: true },
        onUpdate: () => {
          counter.textContent = show(Math.round(state.n));
        },
      });
    });

    return () => {
      for (const tween of tweens) tween.kill();
      counters.forEach((counter, i) => {
        counter.textContent = settled[i] ?? '';
      });
    };
  });

  /* The P1 scribble's entrance: the reference's `phrase_p1` Rive, played once
   * by its `data-rive-scrolltrigger` handler when the canvas top passes 80% of
   * the screen. That handler holds the canvas at opacity 0 and raises it over
   * 0.1s (ease-in-out) as it plays. The animation is 85 frames at 60fps, but
   * its ink is all down by 1.05s -- sampled off the reference's own file: 50%
   * of the final ink at ~0.5s, 98% at 1.0s, 100% at 1.05s, near linear -- and
   * the last 0.37s holds the finished mark. So the four strokes are drawn in
   * order, each for its share of the total length, over those 1.05s. Drawn and
   * still below 992px and under reduced motion. */
  const P1_INK = 1.05;
  mm.add(WIDE_AND_ANIMATED, () => {
    const entrances = [...statGrid.querySelectorAll<HTMLElement>('.ot-stats__scribble')].map(
      (scribble) => {
        const paths = [...scribble.querySelectorAll<SVGPathElement>('path')];
        const lengths = paths.map((path) => path.getTotalLength());
        const total = lengths.reduce((a, b) => a + b, 0);

        /* A dash the stroke's own length, and a gap twice that, so the hidden
           stroke sits wholly inside the gap with no zero-length dash at either
           end for a round cap to paint as a dot. Set as attributes: GSAP rounds
           the CSS property to whole pixels, which leaves a sliver of every
           waiting stroke showing as a dot. */
        const hand = gsap.timeline({ paused: true });
        paths.forEach((path, i) => {
          const length = lengths[i] ?? 0;
          gsap.set(path, {
            attr: { 'stroke-dasharray': `${length} ${2 * length}`, 'stroke-dashoffset': length },
          });
          hand.to(path, {
            attr: { 'stroke-dashoffset': 0 },
            duration: (P1_INK * length) / total,
            ease: 'none',
          });
        });
        gsap.set(scribble, { opacity: 0 });

        return ScrollTrigger.create({
          trigger: scribble,
          start: 'top 80%',
          once: true,
          onEnter: () => {
            gsap.to(scribble, { opacity: 1, duration: 0.1, ease: 'power1.inOut' });
            hand.play();
          },
        });
      },
    );
    return () => {
      for (const trigger of entrances) trigger.kill();
    };
  });
}

/* ------------------------------------------------------------------ *
 * The statement, and the helmet that flies into it
 *
 * The reference's 3D helmet starts huge off the left of the hero, turns as it
 * crosses to the middle of this statement, and lands small between a pair of
 * laurel branches under it. HelmetScroll.ts rebuilds that journey with the
 * helmet supplied for this build; the three boxes it flies through are in the
 * markup ([data-helm-stop]), sized exactly as the reference sizes its own.
 *
 * Desktop only, as the stops are laid out for it. Under reduced motion it is
 * parked in the wreath and never moves -- the wreath reads as a wreath around
 * something, and empty it would read as a missing image.
 * ------------------------------------------------------------------ */

const hero = document.querySelector<HTMLElement>('.ot-hero');
const impact = document.querySelector<HTMLElement>('.ot-impact');
const wreath = document.querySelector<HTMLElement>('.ot-impact__wreath');
const helmStops = [...document.querySelectorAll<HTMLElement>('[data-helm-stop]')];

if (wreath) {
  const { svg, branches } = reef();
  wreath.prepend(svg);
  // Grown on scroll with the reference's trigger and smoothing; drawn
  // full-grown, and left so, when motion is reduced.
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    const growth = { g: 0 };
    const grow = gsap.to(growth, {
      g: 1,
      ease: 'none',
      paused: true,
      onUpdate: () => drawReef(branches, clamp01((growth.g - 0.22) / 0.44)),
    });
    const trigger = ScrollTrigger.create({
      trigger: wreath,
      start: 'top bottom',
      end: 'bottom center',
      scrub: 0.5,
      animation: grow,
    });
    return () => {
      trigger.kill();
      grow.kill();
      drawReef(branches, 1);
    };
  });
}

/* The signature over the eyebrow. The reference's is a Rive `signature_play`
   that fades in and writes itself once its top reaches 80% of the screen;
   stepped frame by frame, half its ink is down by 0.72s and all of it by
   1.63s, with a slow last tenth. Ours is the homepage's mark written by the
   homepage's pen, on that trigger and over that time. Under reduced motion the
   CSS mask draws it whole and none of this runs. */
const impactSign = document.querySelector<HTMLElement>('[data-impact-sign]');

if (impactSign && !reducedMotion) {
  fetch('/assets/brand/signature.svg')
    .then((res) => {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.text();
    })
    .then((markup) => {
      const colour = getComputedStyle(document.documentElement)
        .getPropertyValue('--grey-on-track')
        .trim();
      impactSign.dataset.writing = '';
      const pen = new Signature(impactSign, markup, colour);
      const canvas = impactSign.querySelector('canvas');

      /* The pen pins its canvas to the pixel size it measured, and this slot is
         sized in the fluid rem -- so on a resize the pin comes off and the CSS
         gets to size it again before the pen re-measures. */
      ScrollTrigger.addEventListener('refreshInit', () => {
        canvas?.style.removeProperty('width');
        canvas?.style.removeProperty('height');
        pen.resize();
      });

      const ink = { p: 0 };
      ScrollTrigger.create({
        trigger: impactSign,
        start: 'top 80%',
        once: true,
        onEnter: () => {
          gsap.to(ink, {
            p: 1,
            duration: 1.65,
            ease: 'sine.out',
            onUpdate: () => {
              pen.progress = ink.p;
            },
          });
        },
      });
    })
    .catch((err: unknown) => {
      // Decorative: the statement is complete without it. Loud to us, silent to
      // the reader, and the mask is put back so the mark is not simply missing.
      delete impactSign.dataset.writing;
      console.error('[statement] signature failed to load', err);
    });
}

if (hero && impact && helmStops.length === 3) {
  const stops = helmStops as [HTMLElement, HTMLElement, HTMLElement];
  mm.add('(min-width: 992px)', () =>
    mountHelmetScroll({ from: hero, to: impact, stops, still: reducedMotion }),
  );
}

/* ------------------------------------------------------------------ *
 * The header's entrance
 *
 * The reference's, read out of lando-gl.js rather than eyeballed. Once the
 * page is ready, TRACK's letters start dropping into place behind an oval
 * that has not opened yet. 750ms later every header timeline plays at once
 * (its k0 and o0): the oval opens from the top centre, the script word writes
 * itself on, the signature is written, the crest grows, and every text line
 * sweeps in — that last one through mountReveals below, on the same cue.
 *
 *   TRACK      each letter from -40% of its height, 1.5s power2.inOut,
 *              0.015s apart out from the centre. (The reference tweens the
 *              line too, but its line is an inline span, which a transform
 *              does not move — so on screen only the letters travel.) The
 *              oval: ellipse(20% 0% at 50% 0%) to ellipse(100% 120% at 50%
 *              0%), 1.5s power2.inOut, inside a box that clips.
 *   "on"       a one-second Rive write-on: the O from 0.07s to 0.3s, the N
 *              from 0.43s to 0.9s, sampled off the file frame by frame.
 *   signature  most of its ink down by 1.2s, the rest trickling to 1.9s.
 *   crest      the laurels grow up their stems from 0.42s to 0.97s; the
 *              helmet fades up inside them from 0.9s to 1.4s.
 *
 * The last three are stand-ins for Rive artwork this build cannot ship, so
 * they copy the timing and the direction of travel, not the strokes.
 *
 * "Ready" is the fonts, since TRACK and the reveal's line breaks are both set
 * in the real face. Nothing is cut or hidden under reduced motion.
 * ------------------------------------------------------------------ */

/** Seconds from ready to the moment every header timeline plays: the reference's k0. */
const HERO_CUE = 0.75;

const trackWord = document.querySelector<HTMLElement>('.ot-hero__track');
const scriptWord = document.querySelector<HTMLElement>('.ot-hero__on');
const crest = document.querySelector<SVGElement>('.ot-hero__crest');
const signHost = document.querySelector<HTMLElement>('.ot-hero__sign');

if (trackWord && scriptWord && crest && signHost) {
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    const trackText = trackWord.textContent ?? '';
    const letters = [...trackText].map((c) => el('span', 'ot-hero__track-char', c));
    trackWord.replaceChildren(...letters);

    const scriptText = scriptWord.textContent ?? '';
    const o = el('span', 'ot-hero__on-glyph ot-hero__on-glyph--o', scriptText.slice(0, 1));
    const n = el('span', 'ot-hero__on-glyph ot-hero__on-glyph--n', scriptText.slice(1));
    scriptWord.replaceChildren(o, n);

    gsap.set(trackWord, { clipPath: 'ellipse(20% 0% at 50% 0%)', overflow: 'clip' });
    gsap.set(letters, { yPercent: -40 });
    gsap.set([o, n], { '--write': 0 });
    // Hooks in the shared crest drawing (partials/crest.html); unset, it is whole.
    gsap.set(crest, { '--crest-branch-hide': '100%', '--crest-helmet': 0 });

    /* The signature is drawn by the same pen the homepage uses. The still mask
       is hidden at once rather than when the trace arrives, or it would show
       whole and then vanish to be written. */
    const pen = { p: 0 };
    let signature: Signature | null = null;
    let live = true;
    signHost.classList.add('is-writing');
    fetch('/assets/brand/signature.svg')
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.text();
      })
      .then((markup) => {
        if (!live) return;
        const ink = getComputedStyle(signHost).getPropertyValue('--grey-on-track').trim();
        signature = new Signature(signHost, markup, ink);
        signature.progress = pen.p;
      })
      .catch((err: unknown) => {
        // Decorative: the still mask comes back and the header is complete.
        console.error('[hero] signature failed to load', err);
        signHost.classList.remove('is-writing');
      });
    // Its canvas follows the fluid root, and the cached ink has to follow it.
    const sized = new ResizeObserver(() => signature?.resize());
    sized.observe(signHost);

    const entrance = gsap
      .timeline({ paused: true })
      .to(letters, {
        yPercent: 0,
        duration: 1.5,
        ease: 'power2.inOut',
        stagger: { amount: 0.015 * letters.length, from: 'center' },
      }, 0)
      .to(trackWord, {
        clipPath: 'ellipse(100% 120% at 50% 0%)',
        duration: 1.5,
        ease: 'power2.inOut',
      }, HERO_CUE)
      .to(o, { '--write': 1, duration: 0.23, ease: 'none' }, HERO_CUE + 0.07)
      .to(n, { '--write': 1, duration: 0.47, ease: 'none' }, HERO_CUE + 0.43)
      .to(pen, {
        p: 1,
        duration: 1.4,
        ease: 'sine.inOut',
        onUpdate: () => {
          if (signature) signature.progress = pen.p;
        },
      }, HERO_CUE)
      .to(crest, { '--crest-branch-hide': '0%', duration: 0.55, ease: 'none' }, HERO_CUE + 0.42)
      .to(crest, { '--crest-helmet': 1, duration: 0.5, ease: 'none' }, HERO_CUE + 0.9);

    void document.fonts.ready.then(() => entrance.play());

    return () => {
      live = false;
      entrance.kill();
      sized.disconnect();
      signature?.dispose();
      signHost.classList.remove('is-writing');
      trackWord.textContent = trackText;
      scriptWord.textContent = scriptText;
      gsap.set(trackWord, { clearProps: 'clipPath,overflow' });
      crest.style.removeProperty('--crest-branch-hide');
      crest.style.removeProperty('--crest-helmet');
    };
  });
}

/* ------------------------------------------------------------------ *
 * The podium photograph beside the cursor
 *
 * The reference's `.f1-highlight-mouse-over-w`, rebuilt from its bundle (V_):
 *
 *   - shown while the pointer is inside the number's layout, which is checked
 *     on every pointer move AND every scroll -- the layout moves under a still
 *     pointer, and the photo has to arrive and leave with it;
 *   - its top-left corner eased to 20px right of and 20px above the pointer,
 *     0.5s power2.out, from wherever it last was;
 *   - the photograph picked by how far across the layout the pointer is, one
 *     per tenth of its width, swapped outright;
 *   - revealed by an ellipse opening down from its top edge, 0.8s power2.out,
 *     and closed the same way at twice the speed.
 *
 * Its code also sweeps a lime panel off the photograph, but that panel's CSS
 * holds it at opacity 0 and nothing raises it: on screen there is no flash of
 * colour, so there is none here.
 *
 * Decoration: hidden from assistive tech, and built only from 992px up with a
 * fine pointer and motion allowed. Placeholder photographs until the real
 * podium set is supplied.
 * ------------------------------------------------------------------ */

const PODIUM_PHOTOS = Array.from(
  { length: 10 },
  (_, i) => `/assets/gallery/gallery-${String(i + 1).padStart(2, '0')}.webp`,
);

const podiumPhoto = document.querySelector<HTMLElement>('[data-podium-photo]');
const podiumImg = document.querySelector<HTMLImageElement>('[data-podium-img]');

if (podium && podiumPhoto && podiumImg) {
  mm.add(`${WIDE_AND_ANIMATED} and (hover: hover) and (pointer: fine)`, () => {
    // Fetched up front, as the reference's hidden list of them is, so a swap
    // under the pointer never shows an empty frame.
    for (const src of PODIUM_PHOTOS) new Image().src = src;
    podiumPhoto.hidden = false;

    const reveal = gsap.to(podiumPhoto, {
      clipPath: 'ellipse(120% 120% at 50% 0%)',
      duration: 0.8,
      ease: 'power2.out',
      paused: true,
    });
    const moveX = gsap.quickTo(podiumPhoto, 'x', { duration: 0.5, ease: 'power2.out' });
    const moveY = gsap.quickTo(podiumPhoto, 'y', { duration: 0.5, ease: 'power2.out' });

    let pointerX = Number.NaN;
    let pointerY = Number.NaN;
    let over = false;
    let inView = false;

    const update = (): void => {
      if (!inView) return;
      const box = podium.getBoundingClientRect();
      const inside =
        pointerX >= box.left &&
        pointerX <= box.right &&
        pointerY >= box.top &&
        pointerY <= box.bottom;
      if (inside !== over) {
        over = inside;
        if (inside) reveal.timeScale(1).play();
        else reveal.timeScale(2).reverse();
      }
      if (!inside) return;

      moveX(pointerX - box.left + 20);
      moveY(pointerY - box.top - 20);

      const at = Math.min(
        Math.floor(((pointerX - box.left) / box.width) * PODIUM_PHOTOS.length),
        PODIUM_PHOTOS.length - 1,
      );
      const src = PODIUM_PHOTOS[at];
      if (src && podiumImg.getAttribute('src') !== src) podiumImg.src = src;
    };

    const onPointer = (event: PointerEvent): void => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      update();
    };

    /* The LAST entry, not the first: a tab that was in the background delivers
       its queued crossings in one batch, oldest first, and reading [0] left
       the photo believing the number was still off screen. */
    const watch = new IntersectionObserver(
      (entries) => {
        inView = entries[entries.length - 1]?.isIntersecting ?? false;
      },
      { threshold: 0.1 },
    );
    watch.observe(podium);
    document.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('scroll', update, { passive: true });

    return () => {
      watch.disconnect();
      document.removeEventListener('pointermove', onPointer);
      window.removeEventListener('scroll', update);
      podiumPhoto.hidden = true;
    };
  });
}

/* ------------------------------------------------------------------ *
 * The career portrait's reveal
 *
 * The reference's `data-img-highlight="top, lime"`, to the number. The picture
 * starts hidden, clipped to an ellipse with no height at its top edge. When
 * its top crosses 80% of the screen the ellipse drops open over 0.8s
 * (power2.out) and shows an accent sheet lying over the photo; 0.4s in, that
 * sheet shrinks away toward the bottom edge over 0.6s (power2.out) as an
 * ellipse of its own, uncovering the picture top first.
 *
 * The sheet is the box's ::after, sized by --img-veil (1 covers, 0 gone).
 * Wide and animated only: elsewhere the picture is simply there, no sheet.
 * ------------------------------------------------------------------ */

/* The pre-F1 photograph carries the same `data-img-highlight="top, lime"` in
   the reference, so it runs the same reveal. */
const revealedImages = [
  ...document.querySelectorAll<HTMLElement>('[data-career-img], [data-junior-img]'),
];

mm.add(WIDE_AND_ANIMATED, () => {
  for (const box of revealedImages) {
    gsap.set(box, { clipPath: 'ellipse(120% 0% at 50% 0%)', '--img-veil': 1 });
    gsap
      .timeline({ scrollTrigger: { trigger: box, start: 'top 80%', once: true } })
      .to(box, { clipPath: 'ellipse(120% 120% at 50% 0%)', duration: 0.8, ease: 'power2.out' })
      .to(box, { '--img-veil': 0, duration: 0.6, ease: 'power2.out' }, '-=0.4');
  }
});

/* ------------------------------------------------------------------ *
 * Provenance
 *
 * The reference has nothing like this and does not need it — its numbers are a
 * CMS field. Ours are fetched, so the page says what they are current through.
 * CONTENT-DATA.md: "always show this on the site near any stat block".
 * ------------------------------------------------------------------ */

const provenanceNode = document.querySelector<HTMLElement>('[data-provenance]');

if (provenanceNode) {
  const race = provenance.latestRace;
  const when = new Date(race.date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  provenanceNode.textContent =
    `${groups.format(career.starts)} starts and ${points(career.points)} championship points. ` +
    `Current through the ${race.season} ${race.name}, round ${race.round}, ${when}. ` +
    `Counted from the race-by-race record. Average finish is taken over the Grands Prix ` +
    `he was classified in; a race without a classified finish has no position to average. ` +
    provenance.polesDefinition;
}

/* ------------------------------------------------------------------ *
 * Season-by-season table
 *
 * Completed seasons only, newest first -- the reference lists 2024 back to 2019
 * while its 2025 is being raced, because a finishing position is not one until
 * the last round has run. Nineteen rows where it has six; the title seasons are
 * starred.
 * ------------------------------------------------------------------ */

const seasonsBody = document.querySelector<HTMLElement>('[data-seasons-body]');
const seasonsCaption = document.querySelector<HTMLElement>('[data-seasons-caption]');

/* The calendar is the season being raced. While any of its rounds is still to
   start, that season's standing is provisional and stays off the list. */
const pastSeasons = seasonsNewestFirst.filter(
  (season) => !(next && season.year === next.season),
);

if (seasonsBody) {
  for (const season of pastSeasons) {
    const row = el('tr', 'ot-seasons__row');

    // The year is the row's header — that is what lets a screen reader say
    // "2020, Wins, 11" rather than reading a bare 11.
    const year = el('th', 'ot-seasons__cell ot-seasons__cell--year');
    year.setAttribute('scope', 'row');
    year.appendChild(el('span', 'ot-seasons__year', String(season.year)));
    if (season.isChampion) {
      // A visible mark plus a readable word: the mark alone would be silent to
      // anyone not looking at it.
      year.appendChild(el('span', 'sr-only', ' — world champion'));
      const crown = el('span', 'ot-seasons__crown', '★');
      crown.setAttribute('aria-hidden', 'true');
      year.appendChild(crown);
    }
    row.appendChild(year);

    /* Finish, with the ordinal's letters split off.
     *
     * The reference sets the digits at 2.0625rem and the "nd"/"th" at 1rem in
     * grey, nudged .1rem down and right -- `.text-descriptor.is-stat-offset`.
     * Splitting is what makes that possible; `ordinal()` returns one string.
     * The cell still reads as "2nd" to a screen reader because the two spans
     * are adjacent inline text with no separator between them. */
    const finish = el('td', 'ot-seasons__cell');
    const place = ordinal(season.position);
    const digits = place.replace(/\D+$/, '');
    finish.appendChild(el('span', 'ot-seasons__place', digits));
    finish.appendChild(el('span', 'ot-seasons__suffix', place.slice(digits.length)));
    row.appendChild(finish);

    row.appendChild(el('td', 'ot-seasons__cell', groups.format(season.podiums)));

    seasonsBody.appendChild(row);
  }

  if (seasonsCaption) {
    seasonsCaption.textContent =
      `Formula 1 season-by-season record, ${seasons[0]?.year}–` +
      `${seasons[seasons.length - 1]?.year}. ${career.seasonsContested} seasons, ` +
      `${career.championships} world championships.`;
  }

  /* Row entry, the reference's `[data-stat-list]` to the number, and the same
   * cascade the result highlights run below. The rows wait, clipped to
   * nothing, until the list's top crosses 90% of the screen. Then each opens
   * left to right over 0.6s (power2.out), 50ms behind the one above, over an
   * accent bar that pulls off to the right 0.3s in (0.6s, power2.inOut). No
   * opacity anywhere: the reference's rows are never faded.
   *
   * One timeline for the list, not a trigger per row, so nineteen rows read as
   * one cascade rather than nineteen separate arrivals.
   *
   * These are real table rows, and a clip on a `<tr>` is not one every engine
   * honours, so the clip is on the CELLS. Each cell turns the row's single
   * progress (`--row-open`, `--row-bar`) into its own share of it from where it
   * sits in the row (`--cell-start`, `--cell-span`), so the three cells open as
   * one edge travelling across the row -- see `.ot-seasons__cell` in
   * on-track.css. Wide and animated only: below 992px and under reduced motion
   * none of this is set and the table is simply there. */
  mm.add(WIDE_AND_ANIMATED, () => {
    const rows = [...seasonsBody.querySelectorAll<HTMLTableRowElement>('.ot-seasons__row')];

    const placeCells = (): void => {
      for (const row of rows) {
        const box = row.getBoundingClientRect();
        if (box.width <= 0) continue;
        for (const cell of row.cells) {
          const at = cell.getBoundingClientRect();
          cell.style.setProperty('--cell-start', String((at.left - box.left) / box.width));
          cell.style.setProperty('--cell-span', String(at.width / box.width));
        }
      }
    };

    placeCells();
    seasonsBody.dataset.rowsAnimated = '';
    gsap.set(rows, { '--row-open': 0, '--row-bar': 1 });
    const entry = gsap.timeline({
      scrollTrigger: { trigger: seasonsBody, start: 'top 90%', once: true },
      onStart: placeCells,
    });
    rows.forEach((row, i) => {
      const at = i * 0.05;
      entry.to(row, { '--row-open': 1, duration: 0.6, ease: 'power2.out' }, at);
      entry.to(row, { '--row-bar': 0, duration: 0.6, ease: 'power2.inOut' }, at + 0.3);
    });

    return () => {
      delete seasonsBody.dataset.rowsAnimated;
    };
  });
}

/* ------------------------------------------------------------------ *
 * F1 result highlights
 *
 * Reference section 2: seven Grands Prix in a full-bleed list. Which seven is
 * decided in content/hamilton.ts, which resolves each pick against the fetched
 * record and throws on one it cannot find -- so every venue, date and race time
 * below is the record's own, and nothing here is typed.
 * ------------------------------------------------------------------ */

/* A win is P1 by definition. Its figure and ordinal letters are split, as the
   reference's "position" format sets them: "1" and a raised "st". */
const WON = ordinal(1);
const WON_DIGITS = WON.replace(/\D+$/, '');

const hlList = document.querySelector<HTMLElement>('[data-hl-list]');
const hlRows = document.querySelector<HTMLElement>('[data-hl-rows]');
const hlCaption = document.querySelector<HTMLElement>('[data-hl-caption]');
const hlPhoto = document.querySelector<HTMLElement>('[data-hl-photo]');
const hlPhotoImg = document.querySelector<HTMLImageElement>('[data-hl-photo-img]');

/**
 * One row: series, venue, date, finish and time -- the reference's five
 * columns. Every part carries its table role, because the row is laid out as a
 * grid and a table whose display changes can drop its semantics.
 */
function highlightRow({ win, time, photo, trophy }: ResultHighlight): HTMLTableRowElement {
  const row = el('tr', 'ot-hl__grid ot-hl__row');
  row.setAttribute('role', 'row');
  row.dataset.photo = photo;

  const series = el('td', 'ot-hl__cell ot-hl__col--series');
  series.setAttribute('role', 'cell');
  series.appendChild(el('span', 'ot-hl__major', 'F1'));

  /* The venue is the row's header, so each figure is announced against it:
     "Turkey, When, 15 Nov 2020". The flag says the same thing again, so it is
     decoration. */
  const venue = el('th', 'ot-hl__cell');
  venue.scope = 'row';
  venue.setAttribute('role', 'rowheader');
  const flag = el('img');
  flag.src = flagUrl(win.country);
  flag.alt = '';
  flag.width = 34;
  flag.height = 23;
  flag.decoding = 'async';
  const flagBox = el('span', 'ot-hl__flag');
  flagBox.appendChild(flag);
  venue.append(el('span', 'ot-hl__major', countryName(win.country)), flagBox);

  /* Day and month, then the year in two figures, as the reference writes it.
     Read aloud, "08" is a number rather than a year, so the two figures are
     hidden and the full year is what a screen reader hears. */
  const when = el('td', 'ot-hl__cell');
  when.setAttribute('role', 'cell');
  const date = el('time', 'ot-hl__when');
  date.dateTime = win.date;
  const year = el('span', 'ot-hl__major ot-hl__yy', String(win.season).slice(-2));
  year.setAttribute('aria-hidden', 'true');
  date.append(
    el('span', 'ot-hl__major', shortDate(win.date)),
    year,
    el('span', 'sr-only', ` ${win.season}`),
  );
  when.appendChild(date);

  /* Drawn as a figure and its raised letters; heard as one word. The trophy
     beside it is the race's own in the reference, and decoration either way. */
  const finish = el('td', 'ot-hl__cell');
  finish.setAttribute('role', 'cell');
  const place = el('span', 'ot-hl__major ot-hl__place');
  place.setAttribute('aria-hidden', 'true');
  place.append(WON_DIGITS, el('span', 'ot-hl__sup', WON.slice(WON_DIGITS.length)));
  const cup = el('span', 'ot-hl__trophy');
  cup.setAttribute('aria-hidden', 'true');
  const cupImg = el('img');
  cupImg.src = trophy;
  cupImg.alt = '';
  cupImg.width = 64;
  cupImg.height = 64;
  cupImg.decoding = 'async';
  cup.appendChild(cupImg);
  finish.append(place, el('span', 'sr-only', WON), cup);

  const clock = el('td', 'ot-hl__cell ot-hl__col--time');
  clock.setAttribute('role', 'cell');
  clock.appendChild(el('span', 'ot-hl__time', time));

  row.append(series, venue, when, finish, clock);
  return row;
}

if (hlRows) {
  for (const highlight of resultHighlights) hlRows.appendChild(highlightRow(highlight));

  if (hlCaption) {
    hlCaption.textContent =
      `F1 result highlights: ${spell(resultHighlights.length)} of his ` +
      `${groups.format(career.wins)} Grand Prix wins, newest first.`;
  }

  /* Row entry, the reference's own to the number. The rows wait, clipped to
   * nothing, until the list's top crosses 90% of the screen. Then each opens
   * left to right over 0.6s, 50ms behind the one above, uncovering the accent
   * bar that lies over it -- and 0.3s into that the bar pulls off to the right,
   * so the row itself arrives in reading order.
   *
   * One timeline for the list, not a trigger per row: that is what makes seven
   * rows read as one cascade rather than seven separate arrivals. Under reduced
   * motion none of it is built and the rows are simply there. */
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    const rows = [...hlRows.querySelectorAll<HTMLElement>('.ot-hl__row')];
    gsap.set(rows, { clipPath: 'inset(0 100% 0 0)', '--hl-bar': 1 });
    const entry = gsap.timeline({
      scrollTrigger: { trigger: hlRows, start: 'top 90%', once: true },
    });
    rows.forEach((row, i) => {
      const at = i * 0.05;
      entry.to(row, { clipPath: 'inset(0 0% 0 0)', duration: 0.6, ease: 'power2.out' }, at);
      entry.to(row, { '--hl-bar': 0, duration: 0.6, ease: 'power2.inOut' }, at + 0.3);
    });
  });
}

/* ------------------------------------------------------------------ *
 * The photograph under the cursor
 *
 * A port of the reference's mechanics rather than a lookalike. Over the rows, a
 * 20.6 x 24.6rem picture of the race under the pointer follows it, 20px right
 * of and 20px above the tip, easing to each new position over 0.5s. It enters
 * by opening down from its top edge as an ellipse (0.8s, power2.out) and leaves
 * by closing the same way at double speed. The reference also stacks a lime
 * layer inside it that wipes away on entry -- but that layer is `opacity: 0` in
 * its stylesheet and nothing ever raises it, so what a reader sees there is the
 * ellipse alone, and that is what is built here.
 *
 * Two of its habits are kept, because they are part of how it feels:
 *   - entering with the mouse replays the opening at whatever speed the last
 *     exit left it (after the first visit, double); scrolling the list under a
 *     still pointer opens it at normal speed.
 *   - the picture keeps its place between visits, so it glides in from where
 *     the pointer last left -- from the list's top-left corner the first time.
 *
 * Decoration: aria-hidden, desktop and a fine pointer only (the reference hides
 * it below 992 as well), and never built under reduced motion.
 * ------------------------------------------------------------------ */

/** The reference's offset from the pointer, in CSS pixels at every size. */
const PHOTO_OFFSET = 20;

if (hlList && hlRows && hlPhoto && hlPhotoImg) {
  mm.add(
    '(min-width: 992px) and (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)',
    () => {
      hlPhoto.hidden = false;
      gsap.set(hlPhoto, { x: 0, y: 0 });

      const open = gsap.timeline({ paused: true }).to(hlPhoto, {
        clipPath: 'ellipse(120% 120% at 50% 0%)',
        duration: 0.8,
        ease: 'power2.out',
      });
      /* quickTo retargets one running tween per axis, which moves exactly as the
         reference's fresh 0.5s tween per mousemove does, without piling them up. */
      const toX = gsap.quickTo(hlPhoto, 'x', { duration: 0.5, ease: 'power2.out' });
      const toY = gsap.quickTo(hlPhoto, 'y', { duration: 0.5, ease: 'power2.out' });

      let over = false;
      let inView = false;
      // Unknown until the pointer first moves -- never a corner of the screen.
      let pointerX = Number.NaN;
      let pointerY = Number.NaN;

      /** The pointer against the rows: re-read on every move AND every scroll,
          because the list travels under a pointer that has not moved. */
      const track = (): void => {
        if (!inView) return;
        const rows = hlRows.getBoundingClientRect();
        const inside =
          pointerX >= rows.left &&
          pointerX <= rows.right &&
          pointerY >= rows.top &&
          pointerY <= rows.bottom;
        if (inside && !over) {
          over = true;
          open.timeScale(1).play();
        } else if (!inside && over) {
          over = false;
          open.timeScale(2).reverse();
        }
        if (inside) {
          const box = hlList.getBoundingClientRect();
          toX(pointerX - box.left + PHOTO_OFFSET);
          toY(pointerY - box.top - PHOTO_OFFSET);
        }
      };

      const onMove = (event: MouseEvent): void => {
        pointerX = event.clientX;
        pointerY = event.clientY;
        track();
      };
      const onEnter = (): void => {
        over = true;
        open.play();
      };
      const onLeave = (): void => {
        over = false;
        open.timeScale(2).reverse();
      };
      /* The race under the pointer, swapped outright as the reference swaps it:
         no fade between two races. */
      const onOver = (event: MouseEvent): void => {
        const target = event.target instanceof Element ? event.target : null;
        const src = target?.closest<HTMLElement>('.ot-hl__row')?.dataset.photo;
        if (src && hlPhotoImg.getAttribute('src') !== src) hlPhotoImg.src = src;
      };

      /* Fetched as the list comes into view rather than on the first hover, so
         a picture is never still arriving while it opens. */
      let fetched = false;
      const watch = new IntersectionObserver(
        ([entry]) => {
          inView = entry?.isIntersecting ?? false;
          if (!inView || fetched) return;
          fetched = true;
          for (const { photo } of resultHighlights) new Image().src = photo;
        },
        { threshold: 0.1 },
      );
      watch.observe(hlRows);

      hlRows.addEventListener('mouseenter', onEnter);
      hlRows.addEventListener('mouseleave', onLeave);
      hlRows.addEventListener('mouseover', onOver);
      document.addEventListener('mousemove', onMove, { passive: true });
      window.addEventListener('scroll', track, { passive: true });

      return () => {
        watch.disconnect();
        hlRows.removeEventListener('mouseenter', onEnter);
        hlRows.removeEventListener('mouseleave', onLeave);
        hlRows.removeEventListener('mouseover', onOver);
        document.removeEventListener('mousemove', onMove);
        window.removeEventListener('scroll', track);
        hlPhoto.hidden = true;
        hlPhotoImg.removeAttribute('src');
      };
    },
  );
}

/* ------------------------------------------------------------------ *
 * Gallery captions from the record
 *
 * The reference captions its gallery "Abu Dhabi GP, 2024" and pills the last
 * picture with the result. Ours do the same only where a picture can be placed
 * at a race the record holds: the figure names the season and circuit, and the
 * caption and pill are written from that win. A figure pointing at a race that
 * is not in the record is an error, not an empty caption.
 * ------------------------------------------------------------------ */

const WIN_POSITION = 1;

for (const figure of document.querySelectorAll<HTMLElement>('[data-gallery-race]')) {
  const [season, circuitId] = (figure.dataset.galleryRace ?? '').split(' ');
  const win = wins.find((w) => String(w.season) === season && w.circuitId === circuitId);
  if (!win) {
    throw new Error(`[gallery] no win at "${circuitId}" in ${season} -- fix data-gallery-race`);
  }
  const caption = figure.querySelector<HTMLElement>('.gallery__cap');
  if (!caption) throw new Error('[gallery] a dated figure has no caption');
  caption.textContent = `${win.raceName.replace(/ Grand Prix$/, '')} GP, ${win.season}`;

  const pill = figure.querySelector<HTMLElement>('[data-gallery-pill]');
  const place = pill?.querySelector<HTMLElement>('[data-gallery-pill-place]');
  if (pill && place) {
    /* The record lists wins rather than positions, and a win is first place
       by definition. Spoken as the phrase the two cells make together. */
    place.textContent = String(WIN_POSITION);
    pill.setAttribute('aria-label', `Finished ${ordinal(WIN_POSITION)}`);
    pill.hidden = false;
  }
}

/* ------------------------------------------------------------------ *
 * Pre-F1 career
 *
 * Reference section 5. Its achievements each carry a closed laurel whose
 * colour says whether the result was a title -- lime for a championship, grey
 * for a placing -- and whose Rive plays once as it scrolls into view. Both are
 * kept: the laurel is drawn above rather than lifted, and grows once, at the
 * reference's trigger. The label says "champion" or "2nd place" in words, so
 * the colour is never the only signal.
 *
 * Newest first, as the reference orders its own: the senior titles lead.
 * ------------------------------------------------------------------ */

const juniorGrid = document.querySelector<HTMLElement>('[data-junior-grid]');

if (juniorGrid) {
  const wreaths: { mark: HTMLElement; branches: ReefBranch[] }[] = [];

  for (const entry of [...preF1Championships].reverse()) {
    const item = el('li', 'ot-pref1__item');
    item.dataset.place = String(entry.position);

    const { svg, branches } = closedReef();
    drawClosedReef(branches, 1);
    const mark = el('span', 'ot-pref1__mark');
    mark.appendChild(svg);
    wreaths.push({ mark, branches });

    const result = entry.position === 1 ? 'champion' : '2nd place';
    const text = el('span', 'ot-pref1__text');
    text.append(
      el('span', 'ot-pref1__label reveal-text', `${entry.label} ${result}`),
      el('span', 'ot-pref1__year reveal-text', String(entry.year)),
    );

    item.append(mark, text);
    juniorGrid.appendChild(item);
  }

  /* Grown once each, as the reference plays each `reef` Rive when its canvas
     top passes 80% of the screen: its `main-play`, 110 frames at 60fps (1.83s),
     with the canvas raised from opacity 0 over 0.1s as it starts -- the same
     `data-rive-scrolltrigger` handler as the P1 and Race Day. Drawn full-grown,
     and left so, below 992px and when motion is reduced. */
  const REEF_PLAY = 1.83;
  const REEF_EASE = 'power2.inOut';
  mm.add(WIDE_AND_ANIMATED, () => {
    const tweens = wreaths.map(({ mark, branches }) => {
      const growth = { g: 0 };
      drawClosedReef(branches, 0);
      gsap.set(mark, { opacity: 0 });
      return gsap.to(growth, {
        g: 1,
        duration: REEF_PLAY,
        ease: REEF_EASE,
        onStart: () => {
          gsap.to(mark, { opacity: 1, duration: 0.1, ease: 'power1.inOut' });
        },
        onUpdate: () => drawClosedReef(branches, growth.g),
        scrollTrigger: { trigger: mark, start: 'top 80%', once: true },
      });
    });
    return () => {
      for (const tween of tweens) tween.kill();
      for (const { branches } of wreaths) drawClosedReef(branches, 1);
    };
  });

  const span = document.querySelector<HTMLElement>('[data-junior-span]');
  if (span) span.textContent = `${preF1Span.from}-${preF1Span.to}`;

  /* The reference's own sentence, with the count it leaves vague made exact
     and read from the list above rather than typed. Third person, never a
     quote. */
  const para = document.querySelector<HTMLElement>('[data-junior-para]');
  if (para) {
    para.textContent =
      'Prior to starting his Formula 1 career, Lewis had an illustrious junior ' +
      `career in karting and junior formulae, winning ${spell(preF1Titles)} ` +
      'championships on his way to the pinnacle of motorsport.';
  }
}

/* ------------------------------------------------------------------ *
 * Dates, as the countdown and the calendar print them
 *
 * In UK time, which is what the reference prints and footnotes (*UK TIME), and
 * with three-letter months from a fixed table: en-GB's own short September is
 * "Sept", where the reference -- like every timing screen -- reads SEP. The
 * table is MONTHS, declared once above for every date on the page.
 * ------------------------------------------------------------------ */

function monthAbbr(month: number): string {
  const name = MONTHS[month - 1];
  if (!name) throw new Error(`[calendar] no month ${month}`);
  return name;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

const ukClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h23',
});

interface UkWhen {
  day: number;
  month: number;
  /** "9:30", "13:00" -- the reference's own format, no leading zero. */
  time: string;
}

function ukWhen(instant: Date): UkWhen {
  const parts = new Map(ukClock.formatToParts(instant).map((p) => [p.type, p.value]));
  const read = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.get(type);
    if (value === undefined) throw new Error(`[calendar] no ${type} in ${instant.toISOString()}`);
    return value;
  };
  return {
    day: Number(read('day')),
    month: Number(read('month')),
    time: `${Number(read('hour'))}:${read('minute')}`,
  };
}

/** A session in UK time. Without a published start, its calendar day and TBC. */
function sessionWhen(session: RaceSession): UkWhen {
  if (session.time) return ukWhen(new Date(`${session.date}T${session.time}`));
  const [, month, day] = session.date.split('-').map(Number);
  if (!month || !day) throw new Error(`[calendar] unreadable session date "${session.date}"`);
  return { day, month, time: 'TBC' };
}

interface WeekendSession {
  label: string;
  session: RaceSession;
  race: boolean;
}

/**
 * A weekend's sessions in running order, the race last. A sprint weekend has
 * no second or third practice and a sprint instead; the calendar does not
 * carry sprint qualifying, so it is not invented here.
 */
function weekendSessions(round: CalendarRound): WeekendSession[] {
  const s = round.sessions;
  const listed: [string, RaceSession | null][] = [
    ['Practice 1', s.practice1],
    ['Practice 2', s.practice2],
    ['Practice 3', s.practice3],
    ['Sprint', s.sprint],
    ['Qualifying', s.qualifying],
  ];
  const at = (x: RaceSession): string => `${x.date}T${x.time ?? '00:00:00Z'}`;
  return [
    ...listed
      .filter((entry): entry is [string, RaceSession] => entry[1] !== null)
      .sort((a, b) => at(a[1]).localeCompare(at(b[1])))
      .map(([label, session]) => ({ label, session, race: false })),
    { label: 'Race', session: { date: round.date, time: round.time }, race: true },
  ];
}

/** "24-26" and "Sep" -- the weekend as both the panel and the table print it. */
function weekendSpan(round: CalendarRound): { days: string; month: string } {
  const sessions = weekendSessions(round);
  const first = sessionWhen((sessions[0] as WeekendSession).session);
  const race = sessionWhen((sessions[sessions.length - 1] as WeekendSession).session);
  return {
    days: `${pad2(first.day)}-${pad2(race.day)}`,
    month:
      first.month === race.month
        ? monthAbbr(race.month)
        : `${monthAbbr(first.month)}/${monthAbbr(race.month)}`,
  };
}

/* ------------------------------------------------------------------ *
 * Countdown to the next race
 *
 * Reference section 5. Its target is plain text in a hidden element and its
 * digits all sit at 00 because the race it points at is long past. Ours reads
 * the calendar and picks by the clock, so it cannot expire in place, and the
 * section goes away once the season has no race left to count to.
 * ------------------------------------------------------------------ */

const countdownSection = document.querySelector<HTMLElement>('[data-countdown]');
if (countdownSection) mountCountdown(countdownSection);

function mountCountdown(section: HTMLElement): void {
  const upcoming = nextRound();
  if (!upcoming) {
    // The season is over. Nothing to count to -- the reference's frozen 00s
    // read as broken, not as finished.
    section.hidden = true;
    return;
  }

  const digits = section.querySelector<HTMLElement>('[data-countdown-digits]');
  const sentence = section.querySelector<HTMLElement>('[data-countdown-sr]');
  if (!digits || !sentence) throw new Error('[countdown] the markup has lost its digits or its sentence');

  /* The circuit being counted to, lit, as the reference's is. A round the
     circuit file has no shape for leaves the slot empty rather than drawing
     some other track. */
  const circuitHost = section.querySelector<HTMLElement>('[data-countdown-circuit]');
  if (circuitHost && hasTrack(upcoming.circuitId)) {
    void mountCircuit(circuitHost, { circuitId: upcoming.circuitId, lit: true }).catch(
      (error: unknown) => console.warn('[on-track] countdown circuit did not load', error),
    );
  }

  const target = roundStart(upcoming);

  /* The static equivalent: the digits are a view of the start time, so the
     start time is what gets said. */
  const day = target.toLocaleDateString('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  sentence.textContent = upcoming.time
    ? `The next race is round ${upcoming.round}, the ${upcoming.raceName} at ${upcoming.circuitName}. ` +
      `It starts at ${ukWhen(target).time} UK time on ${day}.`
    : `The next race is round ${upcoming.round}, the ${upcoming.raceName} at ${upcoming.circuitName}, ` +
      `on ${day}. Its start time is not yet confirmed.`;

  /* Days is the one field whose width is not fixed: two figures inside a
   * season, three across a winter break. The reference sizes its row for
   * eight characters, so a ninth scales the whole row down by 8/9 -- solved
   * once and held, because a row that resized itself as the count fell
   * through 100 would jump under the reader. */
  const remaining = (): number => Math.max(0, target.getTime() - Date.now());
  const dayWidth = Math.max(2, String(Math.floor(remaining() / 86_400_000)).length);
  digits.style.setProperty('--count-scale', String(8 / (dayWidth + 6)));

  const UNITS: [string, number][] = [
    ['D', 86_400_000],
    ['H', 3_600_000],
    ['M', 60_000],
    ['S', 1000],
  ];
  const phrase = digits.querySelector('[data-countdown-phrase]');
  /* Each field holds the width of its zeros, so a ticking figure never nudges
     the row: the reference pins its seconds to 16rem for the same reason, and
     ours tick where its frozen 00s never had to. */
  const values = UNITS.map(([unit], i) => {
    const item = el('div', 'ot-count__item');
    const value = el('span', i === 3 ? 'ot-count__value ot-count__value--seconds' : 'ot-count__value', '00');
    value.style.setProperty('--figures', String(i === 0 ? dayWidth : 2));
    item.append(value, el('span', 'ot-count__unit', unit));
    digits.insertBefore(item, phrase);
    return value;
  });

  const render = (): boolean => {
    let left = remaining();
    UNITS.forEach(([, per], i) => {
      const n = Math.floor(left / per);
      left -= n * per;
      const value = values[i];
      if (value) value.textContent = String(n).padStart(i === 0 ? dayWidth : 2, '0');
    });
    return remaining() === 0;
  };
  render();

  /* One interval, cleared at zero. Under reduced motion the figures render once
     and hold: the start time is still stated in full, and what is dropped is a
     display changing every second, which is motion rather than information. */
  if (!reducedMotion) {
    const tick = window.setInterval(() => {
      if (render()) window.clearInterval(tick);
    }, 1000);
  }

  /* "Race Day", written across the digits once, when the script's box reaches
   * 80% down the viewport: the reference's `race-day` Rive, played by the same
   * `data-rive-scrolltrigger` handler as the P1, which also raises the canvas
   * from opacity 0 over 0.1s as it starts.
   *
   * Timed off the reference's own file rather than its timeline lengths. Its
   * main animation runs 210 frames (3.5s) and nests one 120-frame timeline per
   * stroke, but those do not overlap on screen: sampled frame by frame, the
   * word is written a stroke at a time with the pen lifted between them -- the
   * R down by 0.42s, "Race" by 1.2s, the D by 1.85s, "Day" by 2.6s, the
   * underline by 3.0s -- about 2.0s of ink and 1.0s of lifts, with the last
   * 0.5s holding the finished word. So: the strokes in the order the markup
   * lists them, each for its share of the length, 90ms apart, each easing on
   * and off the page (power1.inOut), and the hand itself running at a constant
   * rate. Written and still below 992px and under reduced motion. */
  const script = digits.querySelector<SVGSVGElement>('.ot-count__script');
  const strokes = [...digits.querySelectorAll<SVGPathElement>('[data-stroke]')];
  const RACE_DAY_INK = 3.0;
  const PEN_LIFT = 0.09;
  if (script && strokes.length) {
    mm.add(WIDE_AND_ANIMATED, () => {
      const lengths = strokes.map((path) => path.getTotalLength());
      const total = lengths.reduce((a, b) => a + b, 0);
      const inking = RACE_DAY_INK - PEN_LIFT * (strokes.length - 1);
      const hand = gsap.timeline({ paused: true });
      let at = 0;
      strokes.forEach((path, i) => {
        const length = lengths[i] ?? 0;
        const duration = (inking * length) / total;
        /* Attributes, not the CSS property: GSAP rounds that to whole pixels,
           which would leave a sliver of each waiting stroke as a dot. The gap
           is twice the dash so a hidden stroke has no dash end in it at all. */
        gsap.set(path, {
          attr: { 'stroke-dasharray': `${length} ${2 * length}`, 'stroke-dashoffset': length },
        });
        hand.to(path, { attr: { 'stroke-dashoffset': 0 }, duration, ease: 'power1.inOut' }, at);
        at += duration + PEN_LIFT;
      });
      gsap.set(script, { opacity: 0 });

      const trigger = ScrollTrigger.create({
        trigger: script,
        start: 'top 80%',
        once: true,
        onEnter: () => {
          gsap.to(script, { opacity: 1, duration: 0.1, ease: 'power1.inOut' });
          hand.play();
        },
      });
      return () => trigger.kill();
    });
  }
}

/* ------------------------------------------------------------------ *
 * Calendar: the round panel, the standings, and the five-round window
 *
 * Reference section 6. Its rows are clickable divs with a title attribute and
 * no keyboard path; ours are buttons, and the panel's arrows are buttons too.
 * Otherwise the mechanics are the reference's, read off its own script:
 *
 *   - the window is the three rounds before the next one, the next one, and
 *     the one after it; the arrows cycle those five, wrapping at either end;
 *   - every value in the panel sits in a clip with an accent bar over it. On
 *     the panel's first arrival the clips open left to right and the bars
 *     retract; a swap closes the clips (0.5s, power2.in), rewrites the values,
 *     and opens them again the same way;
 *   - a row sends the panel to its round and scrolls the page to it, 8rem
 *     above its top, over 1.2s on an ease-in-out quad;
 *   - over the rows a card follows the pointer, 20px right of it and 20px up,
 *     showing the hovered round's circuit.
 * ------------------------------------------------------------------ */

const calendarSection = document.querySelector<HTMLElement>('.ot-cal');
if (calendarSection) mountCalendar(calendarSection);

/** "retired from 4th on the grid", "finished 6th from 4th on the grid". */
function outcomeOf(result: NonNullable<CalendarRound['result']>): string {
  const grid = result.grid > 0 ? `${ordinal(result.grid)} on the grid` : 'the pit lane';
  if (result.position) return `finished ${ordinal(result.position)} from ${grid}`;
  if (result.positionText === 'D') return `was disqualified, having started from ${grid}`;
  if (result.status === 'Retired') return `retired from ${grid}`;
  return `did not finish (${result.status.toLowerCase()}), from ${grid}`;
}

/** "one win, two podiums and one pole position". */
function tallyOf(record: { wins: number; podiums: number; poles: number }): string {
  const counts: [number, string, string][] = [
    [record.wins, 'win', 'wins'],
    [record.podiums, 'podium', 'podiums'],
    [record.poles, 'pole position', 'pole positions'],
  ];
  const said = counts
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${spell(n)} ${n === 1 ? one : many}`);
  if (said.length < 2) return said.join('');
  return `${said.slice(0, -1).join(', ')} and ${said[said.length - 1]}`;
}

/**
 * His record at a round's circuit, as a sentence: third-person narration built
 * from the circuit record and, for a round already run, its result. Where the
 * reference has a line of editorial copy per circuit, every clause here is a
 * number from the data layer said in words.
 */
function circuitStory(round: CalendarRound): string {
  const record = circuitById.get(round.circuitId);
  const where = round.locality;
  const outcome = round.result ? outcomeOf(round.result) : null;

  if (!record) return `${round.season} is his first Grand Prix in ${where}.`;
  if (record.starts === 1 && outcome && record.firstRaced === round.season) {
    return `His first Grand Prix in ${where}: he ${outcome}.`;
  }

  const starts = `${spell(record.starts)} ${record.starts === 1 ? 'start' : 'starts'}`;
  let text = `${starts.charAt(0).toUpperCase()}${starts.slice(1)} in ${where} since ${record.firstRaced}`;
  const tally = tallyOf(record);
  if (tally) text += `: ${tally}.`;
  else if (record.bestFinish) text += `, with a best finish of ${ordinal(record.bestFinish)}.`;
  else text += ', without a classified finish.';
  if (outcome) text += ` In ${round.season} he ${outcome}.`;
  return text;
}

/** A finishing place as figure and letters: 1 -> ["1", "st"]. */
function place(n: number): [string, string] {
  const text = ordinal(n);
  const figure = text.replace(/\D+$/, '');
  return [figure, text.slice(figure.length)];
}

function mountCalendar(section: HTMLElement): void {
  const need = <T extends Element = HTMLElement>(selector: string): T => {
    const node = section.querySelector<T>(selector);
    if (!node) throw new Error(`[calendar] no ${selector} in the markup`);
    return node;
  };

  const panel = need('[data-cal-panel]');
  const list = need('[data-cal-list]');
  const rowsArea = need('[data-cal-rows]');
  const live = need('[data-cal-live]');
  const trackHost = need('[data-cal-track]');
  const sessionsHost = need('[data-cal-sessions]');
  const nameNode = need('[data-cal-name]');

  const opening = calendar[0];
  if (!opening) throw new Error('[calendar] the season calendar is empty');
  const season = opening.season;

  /* ---------------------------------------------- Heading and standings */

  need('[data-cal-year]').textContent = `${season} schedule`;
  need('[data-cal-blurb]').textContent =
    `Lewis's upcoming racing schedule, as he takes on the ${season} Formula 1 season.`;

  /* His championship place and the round it stands after -- the round the
     standings were last fetched at, not whichever the clock says has started,
     so the two figures always describe the same moment. Before a season's first
     result there is no place to state, and the pair steps aside. */
  const standing = seasons.find((s) => s.year === season);
  const after = provenance.latestRace.season === String(season) ? provenance.latestRace.round : null;
  const standings = need('.ot-cal__standings');
  if (standing && after) {
    const [figure, letters] = place(standing.position);
    need('[data-cal-standing]').textContent = figure;
    need('[data-cal-standing-suffix]').textContent = letters;
    need('[data-cal-round]').textContent = after;
  } else {
    standings.hidden = true;
  }

  /* ----------------------------------------------------------- Window */

  const upcoming = nextRound();
  const nextIndex = upcoming ? calendar.indexOf(upcoming) : calendar.length;
  const firstShown = Math.max(0, Math.min(nextIndex - 3, calendar.length - 5));
  const rounds = calendar.slice(firstShown, firstShown + 5);
  let current = upcoming ? rounds.indexOf(upcoming) : rounds.length - 1;

  const roundAt = (index: number): CalendarRound => {
    const round = rounds[index];
    if (!round) throw new Error(`[calendar] no round at window index ${index}`);
    return round;
  };

  /* ------------------------------------------------------ Swap targets */

  /** Wraps a value in its clip and bar. Closed until the panel arrives. */
  const wrap = (target: Element): void => {
    const clip = el('div', 'ot-cal__t');
    const bar = el('div', 'ot-cal__t-bar');
    target.before(clip);
    clip.append(target, bar);
    if (!reducedMotion) {
      gsap.set(clip, { clipPath: 'inset(0 100% 0 0)' });
      gsap.set(bar, { scaleX: 1 });
    }
  };

  for (const target of panel.querySelectorAll('[data-cal-target]')) wrap(target);

  const clips = (): HTMLElement[] => [...panel.querySelectorAll<HTMLElement>('.ot-cal__t')];
  const bars = (): HTMLElement[] => [...panel.querySelectorAll<HTMLElement>('.ot-cal__t-bar')];

  /* ------------------------------------------------------ The circuit */

  type Circuit = Awaited<ReturnType<typeof mountCircuit>>;
  let track: Promise<Circuit> | null = null;

  /** Points the large drawing at a round, or empties it for one without a shape. */
  const drawTrack = (round: CalendarRound): void => {
    const drawable = hasTrack(round.circuitId);
    trackHost.classList.toggle('is-empty', !drawable);
    if (!drawable) return;
    track ??= mountCircuit(trackHost, { circuitId: round.circuitId, lit: true, weight: 'thin' });
    void track.then(
      (handle) => trackHost.classList.toggle('is-empty', !handle.select(round.circuitId)),
      (error: unknown) => {
        console.warn('[on-track] calendar circuit did not load', error);
        track = null; // so a later round retries
      },
    );
  };

  /* ------------------------------------------------------ The values */

  const setText = (selector: string, value: string): void => {
    need(selector).textContent = value;
  };

  /** A figure, and its unit where it has one -- the panel's stat format. */
  const setStat = (selector: string, value: string, unit = ''): void => {
    const node = need(selector);
    node.replaceChildren(el('span', 'ot-cal__stat-value', value));
    if (unit) node.appendChild(el('span', 'ot-cal__stat-unit', unit));
  };

  /** Shrinks a name too long for the tab -- the frame's tab is ~29rem tall. */
  const fitName = (): void => {
    nameNode.style.removeProperty('--name-scale');
    /* Only up the tab: under 480px the name lies flat across the panel's top. */
    const style = getComputedStyle(nameNode);
    if (!style.writingMode.startsWith('vertical')) return;
    /* 25 of the section's own units, read back off the name's 4.5-unit size:
       the section's unit is not the root's below 992px. */
    const room = (Number.parseFloat(style.fontSize) / 4.5) * 25;
    const height = nameNode.getBoundingClientRect().height;
    if (height > room) nameNode.style.setProperty('--name-scale', (room / height).toFixed(3));
  };
  remeasure(fitName);

  const fill = (round: CalendarRound): void => {
    const record = circuitById.get(round.circuitId);
    const facts = circuitFacts(round);
    const span = weekendSpan(round);

    setText('[data-cal-days]', span.days);
    setText('[data-cal-month]', span.month);

    /* The circuit's figures, and the one that is his: the year he first
       raced here, or a dash where he never has. */
    setStat('[data-cal-length]', formatKm(facts.lengthKm), 'km');
    setStat('[data-cal-first]', record ? String(record.firstRaced) : '–');
    setStat('[data-cal-distance]', formatKm(facts.raceDistanceKm), 'km');
    setStat('[data-cal-laps]', String(facts.laps));

    setText('[data-cal-at]', round.locality);
    setText('[data-cal-story]', circuitStory(round));
    setText('[data-cal-name]', round.locality);
    fitName();

    const flag = need('[data-cal-flag]');
    const image = el('img');
    image.src = flagUrl(round.country);
    image.alt = '';
    image.width = 34;
    image.height = 20;
    flag.replaceChildren(image);

    sessionsHost.replaceChildren();
    for (const { label, session, race } of weekendSessions(round)) {
      const when = sessionWhen(session);
      const row = el('p', race ? 'ot-cal__session ot-cal__session--race' : 'ot-cal__session');
      row.append(
        el('span', undefined, label),
        /* Unpadded here, where the weekend's span pads: "4 SEP", "04-06". */
        el('span', undefined, `${when.day} ${monthAbbr(when.month)}`),
        el('span', undefined, when.time),
      );
      sessionsHost.appendChild(row);
      wrap(row);
    }
  };

  /* ----------------------------------------------------------- Rows */

  const buttons = rounds.map((round, index) => {
    const facts = circuitFacts(round);
    const distance = formatKm(facts.raceDistanceKm);
    const span = weekendSpan(round);
    const state = round === upcoming ? 'Next race.' : round.result ? `He ${outcomeOf(round.result)}.` : '';

    const item = el('li');
    const row = el('button', 'ot-cal__row');
    row.type = 'button';
    row.setAttribute('aria-controls', panel.id);
    const label =
      `Round ${round.round}, ${round.raceName}, ${round.locality}, ${span.days} ${span.month}, ` +
      `${facts.laps} laps, ${distance} km. ${state}`;
    row.setAttribute('aria-label', label.trim());

    const cell = (className = 'ot-cal__cell'): HTMLSpanElement => {
      const node = el('span', className);
      row.appendChild(node);
      return node;
    };

    cell().appendChild(el('span', 'ot-cal__major', String(round.round)));

    const location = cell();
    location.appendChild(el('span', 'ot-cal__major ot-cal__nowrap', round.country));
    const flag = el('img', 'ot-cal__row-flag');
    flag.src = flagUrl(round.country);
    flag.alt = '';
    flag.width = 34;
    flag.height = 23;
    location.appendChild(flag);

    const when = cell();
    when.append(
      el('span', 'ot-cal__major', span.days),
      el('span', 'ot-cal__major ot-cal__month', span.month),
    );

    cell().appendChild(el('span', 'ot-cal__major', String(facts.laps)));

    cell('ot-cal__cell ot-cal__cell--unit').append(
      el('span', 'ot-cal__reg', distance),
      el('span', 'ot-cal__unit', 'km'),
    );

    row.append(el('span', 'ot-cal__rule'), el('span', 'ot-cal__row-bar'));
    row.addEventListener('click', () => {
      show(index, true);
      travelToPanel();
    });

    item.appendChild(row);
    list.appendChild(item);
    return row;
  });

  const markActive = (): void => {
    buttons.forEach((row, i) => {
      row.classList.toggle('is-active', i === current);
      row.setAttribute('aria-pressed', String(i === current));
    });
  };

  /* ----------------------------------------------------------- Swaps */

  let arrived = false;
  let swap: ReturnType<typeof gsap.timeline> | null = null;

  const open = (): ReturnType<typeof gsap.timeline> =>
    gsap
      .timeline()
      .set(bars(), { scaleX: 1 })
      .to(clips(), { clipPath: 'inset(0 0% 0 0)', duration: 0.5, stagger: 0.015, ease: 'power2.out' })
      .to(bars(), { scaleX: 0, duration: 0.5, stagger: 0.015, ease: 'power2.inOut' }, '-=0.2');

  const show = (index: number, announce: boolean): void => {
    current = index;
    const round = roundAt(index);
    drawTrack(round);
    markActive();
    if (announce) live.textContent = `Showing round ${round.round}, the ${round.raceName}.`;

    if (reducedMotion || !arrived) {
      fill(round);
      return;
    }
    swap?.kill();
    swap = gsap
      .timeline()
      .to(clips(), { clipPath: 'inset(0 100% 0 0)', duration: 0.5, stagger: 0.015, ease: 'power2.in' })
      .call(() => {
        fill(round);
        swap?.add(open());
      });
  };

  const step = (by: number): void => {
    show((current + by + rounds.length) % rounds.length, true);
  };
  need('[data-cal-next]').addEventListener('click', () => step(1));
  need('[data-cal-prev]').addEventListener('click', () => step(-1));

  show(current, false);

  if (!reducedMotion) {
    ScrollTrigger.create({
      trigger: panel,
      start: 'top 90%',
      once: true,
      onEnter: () => {
        arrived = true;
        open();
      },
    });
  }

  /** A row's second job: take the reader to the panel it just changed. */
  const travelToPanel = (): void => {
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    const top = window.scrollY + panel.getBoundingClientRect().top - rem * 8;
    if (smoothScroller) {
      smoothScroller.scrollTo(top, {
        duration: 1.2,
        easing: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
      });
    } else {
      window.scrollTo({ top, behavior: 'auto' });
    }
    // Keyboard readers land where the change happened.
    panel.focus({ preventScroll: true });
  };

  /* ------------------------------------------------- Row entrance */

  if (!reducedMotion) {
    const rowBars = buttons.map((row) => row.querySelector('.ot-cal__row-bar'));
    gsap.set(buttons, { clipPath: 'inset(0 100% 0 0)' });
    gsap.set(rowBars, { scaleX: 1 });
    const enter = gsap.timeline({
      paused: true,
      scrollTrigger: { trigger: rowsArea, start: 'top 90%', once: true },
    });
    buttons.forEach((row, i) => {
      enter.to(row, { clipPath: 'inset(0 0% 0 0)', duration: 0.6, ease: 'power2.out' }, i * 0.05);
      enter.to(rowBars[i] ?? [], { scaleX: 0, duration: 0.6, ease: 'power2.inOut' }, i * 0.05 + 0.3);
    });
  }

  /* ----------------------------------------------------- Hover card
   *
   * Pointer-only and wide-only, as the reference's is (it is display:none
   * below 992px): a decoration over rows whose content is one click away in
   * the panel. Tracked from the document's pointer position rather than from
   * enter/leave on the rows, so it follows through the gaps and the vignette,
   * and re-checked on scroll so a still pointer over a moving list stays
   * right. */
  mm.add('(min-width: 992px) and (prefers-reduced-motion: no-preference)', () => {
    const card = need('[data-cal-card]');
    const reveal = need('[data-cal-card-reveal]');
    const shapeHost = need('[data-cal-card-circuit]');

    /* The reference's card never fades: it sits at full opacity and only the
       oval opens (0.8s power2.out) and closes (the same, reversed at double
       speed). Its inner accent sheet is `opacity: 0` in the reference's CSS,
       so it is timed here but never seen -- see `.ot-cal__card-reveal`. */
    gsap.set(card, { clipPath: 'ellipse(120% 0% at 50% 0%)', visibility: 'visible', x: 0, y: 0 });
    gsap.set(reveal, { clipPath: 'ellipse(120% 120% at 50% 100%)' });
    const appear = gsap
      .timeline({ paused: true })
      .to(card, { clipPath: 'ellipse(120% 120% at 50% 0%)', duration: 0.8, ease: 'power2.out' })
      .to(reveal, { clipPath: 'ellipse(120% 0% at 50% 100%)', duration: 0.6, ease: 'power2.out' }, '-=0.4');
    const toX = gsap.quickTo(card, 'x', { duration: 0.5, ease: 'power2.out' });
    const toY = gsap.quickTo(card, 'y', { duration: 0.5, ease: 'power2.out' });

    /* One canvas, retargeted per row -- the reference's own gesture. Black on
       the accent card: the light ground's ink. */
    const firstDrawable = rounds.find((r) => hasTrack(r.circuitId));
    let shape: Promise<Circuit> | null = firstDrawable
      ? mountCircuit(shapeHost, { circuitId: firstDrawable.circuitId, ground: 'light' })
      : null;
    shape?.catch((error: unknown) => {
      console.warn('[on-track] calendar card circuit did not load', error);
      shape = null;
    });
    const drawCard = (round: CalendarRound): void => {
      const drawable = hasTrack(round.circuitId);
      shapeHost.classList.toggle('is-empty', !drawable);
      if (drawable && shape) {
        void shape.then((handle) => shapeHost.classList.toggle('is-empty', !handle.select(round.circuitId)));
      }
    };

    let pointer: { x: number; y: number } | null = null;
    let over = false;
    let near = false;

    const follow = (): void => {
      if (!pointer || !near) return;
      const box = rowsArea.getBoundingClientRect();
      const inside =
        pointer.x >= box.left && pointer.x <= box.right && pointer.y >= box.top && pointer.y <= box.bottom;
      if (inside && !over) {
        over = true;
        appear.timeScale(1).play();
      } else if (!inside && over) {
        over = false;
        appear.timeScale(2).reverse();
      }
      if (inside) {
        toX(pointer.x - box.left + 20);
        toY(pointer.y - box.top - 20);
      }
    };

    const onMove = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') return;
      pointer = { x: event.clientX, y: event.clientY };
      follow();
    };
    const onOver = (event: PointerEvent): void => {
      const row = (event.target as Element | null)?.closest('.ot-cal__row');
      const index = row ? buttons.indexOf(row as HTMLButtonElement) : -1;
      if (index >= 0) drawCard(roundAt(index));
    };
    const watch = new IntersectionObserver(([entry]) => {
      near = entry?.isIntersecting ?? false;
    });

    watch.observe(rowsArea);
    document.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('scroll', follow, { passive: true });
    list.addEventListener('pointerover', onOver);

    return () => {
      watch.disconnect();
      document.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', follow);
      list.removeEventListener('pointerover', onOver);
      appear.kill();
      void shape?.then((handle) => handle.destroy());
    };
  });
}

/* ------------------------------------------------------------------ *
 * Keyboard access to sideways overflow
 *
 * A scroll container is only operable by pointer unless it is focusable, so
 * without this whatever it holds past the edge is simply unreachable for
 * anyone driving the page from the keyboard. WCAG 2.1.1. (Neither table on the
 * page scrolls: the seasons list is three columns and the result highlights
 * drop to three below 480px, so both fit any width.)
 *
 * Applied only while it actually overflows: an unconditional tabindex would add
 * a tab stop on every desktop width, where there is nothing to scroll and the
 * stop does nothing but waste a keypress.
 * ------------------------------------------------------------------ */

const scrollRegions: [string, string][] = [
  /* The hero cluster is five outlined panels drawn at fixed aspect ratios.
     Below 992px it keeps those proportions and scrolls rather than reflowing,
     which puts the next round's circuit and dates off the right of a phone
     screen unless the region can be entered from the keyboard. */
  ['.ot-hero__ui', 'Previous and next race, scrollable'],
];

for (const [selector, label] of scrollRegions) {
  const scroller = document.querySelector<HTMLElement>(selector);
  if (!scroller) continue;

  const syncFocusable = (): void => {
    if (scroller.scrollWidth > scroller.clientWidth + 1) {
      scroller.tabIndex = 0;
      // Named and given a role, so it is announced as a region worth entering
      // rather than as an unlabelled focus stop.
      scroller.setAttribute('role', 'region');
      scroller.setAttribute('aria-label', label);
    } else {
      scroller.removeAttribute('tabindex');
      scroller.removeAttribute('role');
      scroller.removeAttribute('aria-label');
    }
  };
  syncFocusable();
  void document.fonts.ready.then(syncFocusable);
  window.addEventListener('resize', syncFocusable);
}

/* ------------------------------------------------------------------ *
 * Nav ink
 *
 * Nothing to cross. The nav is coloured for a dark ground, and this page no
 * longer has a light one: the reference's On Track paints its near-black from
 * the hero to the footer, the stat band followed it there, and the tail now
 * does too — the socials sit on the wall's ground and Home's cream store
 * section is not on this page. The inversion that used to run here watched
 * exactly those two sections and nothing else, so it went with them.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Chrome, reveals, and the entrance
 * ------------------------------------------------------------------ */

mountChrome();

/* This page has no WebGL entrance to wait on, so "ready" is simply the fonts
   having landed — the reveal splits are measured against line boxes, and
   cutting them against the fallback face puts the breaks in the wrong places.
   `document.fonts.ready` resolves even when a face fails, so this cannot hang.
   The header's lines then wait for its cue, with everything else in it. */
mountReveals({
  immediate: '.ot-hero',
  /* The gallery's captions and callout arrive on the X axis. The reference
     fires each as its item's left edge passes 95% of the screen width (the
     first column's as its top passes 90% of the height, while the section is
     still rising) -- one margin covers both. */
  sideways: '.gallery',
  sidewaysMargin: '0px -5% -10% 0px',
  whenReady: (run) => void document.fonts.ready.then(() => gsap.delayedCall(HERO_CUE, run)),
});

void document.fonts.ready.then(() => {
  document.body.classList.add('is-ready');
  // Row heights and the gigantic number both settle with the real face, and
  // every trigger below them is positioned off that.
  ScrollTrigger.refresh();
});
