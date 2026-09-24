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
 * that the reference's seven-row block becomes), the full wins table, the
 * countdown to the next race, and the season schedule with its circuit panel.
 */

import './styles/on-track.css';
import Lenis from 'lenis';
import { gsap, mm, reducedMotion, ScrollTrigger } from './lib/motion';
import { mountChrome } from './lib/chrome';
import { hasTrack, mountCircuit } from './lib/circuit';
import { mountGalleryScroll } from './lib/gallery';
import { mountHelmetScroll } from './HelmetScroll';
import { mountReveals } from './lib/reveal';
import { mountHelmets, mountHofDrift, mountSocials, mountStore } from './lib/showcase';
import {
  age,
  driver,
  eras,
  preF1Championships,
  preF1Span,
  preF1Titles,
} from './content/hamilton';
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
  winsNewestFirst,
} from './content/live-stats';
import type { CalendarRound, RaceSession } from './content/live-stats';
import { flagUrl } from './content/countries';

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

/** The page's scroller, for the one place that moves the page on purpose: a
    calendar row taking the reader up to the panel it changed. Null under
    reduced motion, where there is no smoothing to go through. */
let smoothScroller: Lenis | null = null;

if (!reducedMotion) {
  const lenis = new Lenis({
    lerp: 0.1,
    smoothWheel: true,
    syncTouch: true,
    syncTouchLerp: 0.075,
    wheelMultiplier: 1,
    touchMultiplier: 1.25,
  });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  smoothScroller = lenis;
}

/* ------------------------------------------------------------------ *
 * The tail Home and On Track share
 *
 * Reference section 8 — the helmet wall, the socials block and the store call
 * to action. Its own study of them is explicit that On Track should reuse
 * Home's components rather than re-implement them, so it does: same partials,
 * same module, same measured motion. See src/lib/showcase.ts.
 *
 * The wall is built first, before any ScrollTrigger on this page exists, for
 * the reason it is built first on Home — twenty-six cards is most of the
 * document's height, and a trigger that measures before they are in the DOM
 * measures the wrong page.
 *
 * mountStore takes no ground reporter here. Home wires that to its WebGL
 * field's ground-cross model; this page has no field, and the visor animates
 * the same either way.
 * ------------------------------------------------------------------ */

mountGalleryScroll();
mountHelmets();
mountHofDrift();
mountSocials();
mountStore();

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
  'nine', 'ten', 'eleven', 'twelve',
];

/**
 * Small numbers spelled out, for the places where a figure sits inside a
 * sentence rather than in a table. Still derived — the value comes from the
 * data either way; this only decides how it reads.
 */
const spell = (n: number): string => SMALL_NUMBERS[n] ?? groups.format(n);

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
 * Three pure builders with no dependency on anything else on the page, kept
 * together and kept HERE rather than beside the section that first needed them.
 * The statement section near the top of the document draws a wreath and the
 * stat grid draws the scribble, so leaving these down beside the pre-F1 list
 * put both callers inside the temporal dead zone of `const LAUREL_LEAVES`.
 * ------------------------------------------------------------------ */

const LAUREL_LEAVES: [number, number, number, number, number][] = [
  // cx, cy, rx, ry, rotation
  [10.5, 17, 4.6, 2.4, -66],
  [12.5, 25, 4.6, 2.4, -50],
  [16, 32.5, 4.4, 2.3, -34],
  [20.5, 38.5, 4, 2.2, -18],
];

/** One branch, drawn in a 48x48 box with its base bottom-centre and its tip
    curling up and to the left. Both wreath shapes on this page are two of
    these, so the leaf geometry has one home. */
function laurelBranch(transform?: string): SVGGElement {
  const branch = document.createElementNS(SVG_NS, 'g');
  if (transform) branch.setAttribute('transform', transform);

  const stem = document.createElementNS(SVG_NS, 'path');
  stem.setAttribute('d', 'M23 43C12.5 38.5 8 27.5 9.5 14.5');
  stem.setAttribute('fill', 'none');
  stem.setAttribute('stroke', 'currentColor');
  stem.setAttribute('stroke-width', '1.6');
  stem.setAttribute('stroke-linecap', 'round');
  branch.appendChild(stem);

  for (const [cx, cy, rx, ry, angle] of LAUREL_LEAVES) {
    const leaf = document.createElementNS(SVG_NS, 'ellipse');
    leaf.setAttribute('cx', String(cx));
    leaf.setAttribute('cy', String(cy));
    leaf.setAttribute('rx', String(rx));
    leaf.setAttribute('ry', String(ry));
    leaf.setAttribute('transform', `rotate(${angle} ${cx} ${cy})`);
    leaf.setAttribute('fill', 'currentColor');
    branch.appendChild(leaf);
  }
  return branch;
}

/** The closed wreath the pre-F1 list marks its titles with. */
function laurel(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.append(laurelBranch(), laurelBranch('translate(48 0) scale(-1 1)'));
  return svg;
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

/** The weekend as the calendar prints it: "21\u201323 Aug". */
function weekend(round: CalendarRound): string {
  const days = [
    round.sessions.practice1?.date,
    round.sessions.practice2?.date,
    round.sessions.qualifying?.date,
    round.sessions.sprint?.date,
    round.date,
  ].filter((d): d is string => typeof d === 'string');

  const first = days.reduce((a, b) => (a < b ? a : b));
  const opens = new Date(`${first}T00:00:00Z`).getUTCDate();
  return `${opens}\u2013${shortDate(round.date)}`;
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

  slot('prev-race', `${previous.raceName.replace(/ Grand Prix$/, '')} GP`);

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

  /* Same guard as every other circuit: two rounds of the 2026 calendar have no
     shape in the file, and the race name carries the card either way. */
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
  slot('round-dates', weekend(next));

  /* The traced outline of the circuit itself, which is what the reference puts
   * in this slot rather than the circuit's name.
   *
   * Guarded on `hasTrack` rather than attempted and caught: the file carries 24
   * tracks and the 2026 calendar has two it does not know (Madrid and Sepang),
   * so a round without a shape is an ordinary state, not a failure. Those keep
   * the name, which is why the name is still in the markup.
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

/* ------------------------------------------------------------------ *
 * The gigantic number
 *
 * The reference sets its two-digit number at 114rem and lets it span most of
 * the container. Ours is 207 — three digits — and holding 114rem would simply
 * run it off the side.
 *
 * So the size is solved from the digit count instead of fixed: total width is
 * roughly digits x size, so `size = REFERENCE_SPAN / digits` keeps the number
 * spanning the same measure however many digits it grows to. Two digits
 * resolves to exactly the reference's 114rem, which is the check that this is
 * a generalisation of its value rather than a replacement for it.
 * ------------------------------------------------------------------ */

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

/**
 * Scales an element's type so its rendered text spans a target width.
 *
 * The reference's two sizes here — 114rem for the number, 17.5rem for the word
 * — are widths expressed as font sizes IN ITS FACE. Reusing them assumed our
 * face has its advance width, and it does not: Mona Sans at wdth 75 is far more
 * condensed than Archivo Narrow. Hamilton's podium count is also three digits
 * where Lando's is two. The two errors compounded — "207" came out some 400px
 * wider than the container and lost a digit off each edge, while "PODIUMS",
 * still at its absolute 17.5rem, grew to 65% of the number's width and buried
 * it.
 *
 * Measured instead: render at a probe size, read what the glyphs actually
 * occupy, scale by the ratio. Correct for any face and any digit count.
 */
const PROBE_REM = 20;

/** Width of the ink, not of the box — the number is a full-width flex row. */
const inkWidth = (host: HTMLElement): number =>
  host.childElementCount > 0
    ? [...host.children].reduce((w, c) => w + c.getBoundingClientRect().width, 0)
    : host.getBoundingClientRect().width;

/**
 * Distance from an element's own top to the baseline its text sits on.
 *
 * A zero-sized inline-block sits ON the baseline by definition, so dropping one
 * in and reading its top is the only way at a value the box model otherwise
 * hides. Removed immediately; it never survives a frame.
 *
 * Returned as an OFFSET, not as a viewport y, and that is the whole point.
 * `getBoundingClientRect` reports post-transform positions, and every digit of
 * the podium number is parked 18% low by the `gsap.from` below until its
 * ScrollTrigger fires. An absolute reading therefore came back 192px past the
 * real baseline, and the word was placed against a position the digit only
 * occupies before it animates in. Subtracting the host's own rect cancels any
 * transform on it, because both readings carry the same one.
 */
const baselineOffset = (host: HTMLElement): number => {
  const probe = document.createElement('span');
  probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  host.appendChild(probe);
  const y = probe.getBoundingClientRect().top - host.getBoundingClientRect().top;
  probe.remove();
  return y;
};

const fitToWidth = (host: HTMLElement, prop: string, target: number): void => {
  if (target <= 0) return;
  host.style.setProperty(prop, `${PROBE_REM}rem`);
  const ink = inkWidth(host);
  if (ink <= 0) return;
  host.style.setProperty(prop, `${(PROBE_REM * target) / ink}rem`);
};

/* ------------------------------------------------------------------ *
 * The gigantic podium number
 *
 * Reference `.on-t-podium-text-layout`, measured at a 1728 viewport: the
 * number's glyphs span 1649 of the 1688 container and the word spans 849.
 * Ratios rather than sizes, so the composition survives a change of face or of
 * digit count.
 *
 * The word overlapping the number's bottom-right is the reference's own doing,
 * not a defect to design around — both are the same cream and they merge where
 * they meet. It reads only because the number is seven times the word's height,
 * so the collision lands where the digit is a thin curve. Holding both ratios
 * is what keeps that true at three digits.
 * ------------------------------------------------------------------ */

const NUMBER_SPAN = 1649 / 1688;
const LABEL_SPAN = 849 / 1688;

const gigantic = document.querySelector<HTMLElement>('[data-gigantic]');
const giganticSr = document.querySelector<HTMLElement>('[data-gigantic-sr]');
const giganticLabel = document.querySelector<HTMLElement>('[data-gigantic-label]');

if (gigantic && giganticSr) {
  const value = career.podiums;

  // The accessible mirror carries the real value as one readable string. The
  // visual copy is split into per-character spans and is aria-hidden, because
  // a screen reader announcing three separate digit nodes is not a number.
  giganticSr.textContent = `${groups.format(value)} podiums`;

  gigantic.textContent = '';
  for (const ch of String(value)) gigantic.appendChild(el('span', 'ot-podium__char', ch));

  const fit = (): void => {
    const host = gigantic.parentElement;
    const room = host?.clientWidth ?? 0;
    fitToWidth(gigantic, '--gigantic-size', room * NUMBER_SPAN);
    if (!host || !giganticLabel) return;
    fitToWidth(giganticLabel, '--podium-label-size', room * LABEL_SPAN);

    /* Drop the word clear of the digits.
     *
     * The reference does NOT do this, and at first that looked like the thing
     * to copy: its word bites the bottom 14% of its digits and stays perfectly
     * readable. Ours reproduces that bite to the percent — and came out
     * illegible, because the band it bites is glyph-dependent. The reference's
     * right digit is a 6, whose bowl is open counter exactly there, so its word
     * crosses black. Hamilton's are a 0 and a 7, solid strokes at that height,
     * and "PODIUMS" read as "OD/MS" with the P and the IU eaten.
     *
     * So the relationship survives — right-aligned, hung off the number's
     * bottom, same two width ratios — and only the collision goes. Measured
     * from the rendered baseline rather than set as an em, because the offset
     * depends on the face's ascent and would be a magic number in any other
     * font. */
    const last = gigantic.lastElementChild;
    if (!(last instanceof HTMLElement)) return;
    host.style.setProperty('--podium-label-drop', '0px');
    /* The chars are flex items on a stretched cross axis, so an untransformed
       char's top is the row's top — which is what makes it safe to add the
       offset to the row's rect rather than to the digit's own. */
    const baseline = gigantic.getBoundingClientRect().top + baselineOffset(last);
    const drop = baseline - giganticLabel.getBoundingClientRect().top;
    host.style.setProperty('--podium-label-drop', `${Math.max(0, Math.round(drop))}px`);
  };
  /* Run once now — that first pass is what keeps the number sized correctly if
     a face never arrives at all — then again whenever the metrics change. */
  fit();
  remeasure(fit);

  if (!reducedMotion) {
    // Each digit rises into place on its own beat. The reference places its
    // chars individually — its second digit sits 42px higher than its first —
    // so a per-character offset is its idiom, not an invention here.
    gsap.from(gigantic.querySelectorAll('.ot-podium__char'), {
      yPercent: 18,
      opacity: 0,
      duration: 1.1,
      ease: 'expo.out',
      stagger: 0.08,
      scrollTrigger: { trigger: gigantic, start: 'top 85%' },
    });
  }
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

    if (stat.fraction) {
      figure.classList.add('ot-stats__value--whole');
      figureWrap.appendChild(el('span', 'ot-stats__fraction', stat.fraction));
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

  /* Count-ups, on the whole part only. The average finish's decimals are
     static beside it: counting through fractional intermediates would spin a
     decimal place that means nothing. */
  if (!reducedMotion) {
    for (const figure of figures) {
      const target = Number(figure.dataset.count);
      const state = { n: 0 };
      figure.textContent = '0';
      gsap.to(state, {
        n: target,
        duration: 1.6,
        ease: 'expo.out',
        scrollTrigger: { trigger: figure, start: 'top 90%' },
        onUpdate: () => {
          figure.textContent = groups.format(Math.round(state.n));
        },
      });
    }
  }
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

if (hero && impact && helmStops.length === 3) {
  const stops = helmStops as [HTMLElement, HTMLElement, HTMLElement];
  mm.add('(min-width: 992px)', () =>
    mountHelmetScroll({ from: hero, to: impact, stops, still: reducedMotion }),
  );
}

/* ------------------------------------------------------------------ *
 * The podium photograph under the cursor
 *
 * The reference reveals a different podium picture wherever the pointer
 * crosses its gigantic number, each one wiped in behind a flash of its accent.
 * Same mechanic here, over our own gallery.
 *
 * Pointer-driven decoration: hidden from assistive tech, never built under
 * reduced motion, and never built for a device without a fine pointer — on a
 * touch screen there is no hover to reveal it with and the images would be
 * fetched for nothing.
 * ------------------------------------------------------------------ */

const PODIUM_PHOTOS = [
  '/assets/gallery/gallery-01.webp',
  '/assets/gallery/gallery-03.webp',
  '/assets/gallery/gallery-05.webp',
  '/assets/gallery/gallery-07.webp',
  '/assets/gallery/gallery-09.webp',
  '/assets/gallery/gallery-11.webp',
];

/** How far the pointer travels before the next photograph is swapped in. */
const PHOTO_SWAP_DISTANCE = 190;

const podium = document.querySelector<HTMLElement>('[data-podium]');
const podiumPhoto = document.querySelector<HTMLElement>('[data-podium-photo]');
const podiumImg = document.querySelector<HTMLImageElement>('[data-podium-img]');
const podiumWipe = document.querySelector<HTMLElement>('[data-podium-wipe]');

if (
  podium &&
  podiumPhoto &&
  podiumImg &&
  podiumWipe &&
  !reducedMotion &&
  window.matchMedia('(hover: hover) and (pointer: fine)').matches
) {
  let shown = -1;
  let lastX = 0;
  let lastY = 0;
  let travelled = PHOTO_SWAP_DISTANCE; // so the first move already swaps

  // quickTo retargets one running tween rather than starting a new one per
  // pointermove, which is the difference between the photo following the
  // cursor and the photo fighting itself.
  const moveX = gsap.quickTo(podiumPhoto, 'x', { duration: 0.5, ease: 'power3.out' });
  const moveY = gsap.quickTo(podiumPhoto, 'y', { duration: 0.5, ease: 'power3.out' });

  /* Swapping the picture is just swapping the picture.
   *
   * The accent band used to fire on every swap, so crossing the number strobed
   * red between photographs and each one arrived from behind a full-bleed
   * flash. The band belongs to the frame's ARRIVAL — it is how the picture
   * enters the page once — and the reference wipes it in the same way: one
   * reveal, then the image simply follows the cursor and changes. */
  const swap = (): void => {
    shown = (shown + 1) % PODIUM_PHOTOS.length;
    podiumImg.src = PODIUM_PHOTOS[shown] as string;
  };

  const wipeIn = (): void => {
    gsap.fromTo(
      podiumWipe,
      { opacity: 1, scaleY: 1, transformOrigin: '50% 100%' },
      { scaleY: 0, duration: 0.45, ease: 'power3.inOut' },
    );
  };

  podium.addEventListener('pointermove', (event) => {
    const box = podium.getBoundingClientRect();
    const x = event.clientX - box.left - podiumPhoto.offsetWidth / 2;
    const y = event.clientY - box.top - podiumPhoto.offsetHeight / 2;

    travelled += Math.hypot(event.clientX - lastX, event.clientY - lastY);
    lastX = event.clientX;
    lastY = event.clientY;

    if (podiumPhoto.hidden) {
      podiumPhoto.hidden = false;
      // Placed before the first tween so it does not fly in from the corner.
      gsap.set(podiumPhoto, { x, y });
      gsap.fromTo(podiumPhoto, { opacity: 0 }, { opacity: 1, duration: 0.3 });
      // The first frame needs a picture before the band lifts off it.
      swap();
      travelled = 0;
      wipeIn();
    }
    if (travelled >= PHOTO_SWAP_DISTANCE) {
      travelled = 0;
      swap();
    }

    moveX(x);
    moveY(y);
  });

  podium.addEventListener('pointerleave', () => {
    gsap.to(podiumPhoto, {
      opacity: 0,
      duration: 0.3,
      onComplete: () => {
        podiumPhoto.hidden = true;
      },
    });
  });
}

/* ------------------------------------------------------------------ *
 * The career portrait's accent wipe
 *
 * The reference's `data-img-highlight="top, lime"` — a band of colour covering
 * the picture, which lifts away downward so the image arrives from the top. The
 * same idea as the text reveal, on the other axis.
 * ------------------------------------------------------------------ */

const careerImg = document.querySelector<HTMLElement>('[data-career-img]');

if (careerImg && !reducedMotion) {
  gsap.fromTo(
    careerImg,
    { '--img-wipe': 1 },
    {
      '--img-wipe': 0,
      duration: 0.9,
      ease: 'power3.inOut',
      scrollTrigger: { trigger: careerImg, start: 'top 85%' },
    },
  );
}

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

  /* Row entry.
   *
   * The reference wipes each row with a lime bar (`.item-reveal`, scaleX 0 to
   * 1). Twenty rows on twenty separate observers would arrive at twenty
   * slightly different scroll positions, so they are batched: each row's delay
   * comes from its index within the batch, which is what makes the table read
   * downward instead of flickering. */
  if (!reducedMotion) {
    ScrollTrigger.batch(seasonsBody.querySelectorAll('.ot-seasons__row'), {
      start: 'top 92%',
      onEnter: (batch) =>
        gsap.to(batch, {
          '--row-wipe': 1,
          opacity: 1,
          duration: 0.62,
          ease: 'power3.out',
          stagger: 0.045,
          overwrite: true,
        }),
    });
  }
}

/* ------------------------------------------------------------------ *
 * Race wins
 *
 * The reference's section 2 is a seven-row block of career wins. Hamilton has
 * 106, so the rows stay and the tail goes behind a disclosure: the ten most
 * recent render open, the rest are built once and revealed by the button.
 *
 * Built eagerly rather than on first open, so the hidden rows are in the
 * accessible tree and findable by browser find-in-page from the start.
 * ------------------------------------------------------------------ */

const WINS_VISIBLE = 10;

const winsBody = document.querySelector<HTMLElement>('[data-wins-body]');
const winsToggle = document.querySelector<HTMLButtonElement>('[data-wins-toggle]');
const winsToggleLabel = document.querySelector<HTMLElement>('[data-wins-toggle-label]');
const winsBlurb = document.querySelector<HTMLElement>('[data-wins-blurb]');
const winsCaption = document.querySelector<HTMLElement>('[data-wins-caption]');

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

if (winsBody) {
  winsNewestFirst.forEach((win, index) => {
    const row = el('tr', 'ot-seasons__row ot-wins__row');
    row.dataset.team = win.teamId;
    if (index >= WINS_VISIBLE) row.hidden = true;

    const name = el('th', 'ot-seasons__cell ot-seasons__cell--year');
    name.setAttribute('scope', 'row');
    name.appendChild(el('span', 'ot-seasons__year', win.raceName.replace(/ Grand Prix$/, '')));
    if (win.fromPole) {
      // Pole-to-flag is the win worth marking. Mark plus word, so it is never
      // glyph-only.
      name.appendChild(el('span', 'sr-only', ' — won from pole position'));
      const mark = el('span', 'ot-wins__pole', '◆');
      mark.setAttribute('aria-hidden', 'true');
      name.appendChild(mark);
    }
    row.appendChild(name);

    const season = el('td', 'ot-seasons__cell');
    season.append(
      el('span', 'ot-wins__season', String(win.season)),
      el('span', 'ot-wins__date', ` ${shortDate(win.date)}`),
    );
    row.appendChild(season);

    row.appendChild(el('td', 'ot-seasons__cell', win.team));
    for (const value of [`P${win.grid}`, groups.format(win.laps), win.raceTime ?? '—']) {
      row.appendChild(el('td', 'ot-seasons__cell ot-seasons__cell--num', value));
    }
    winsBody.appendChild(row);
  });

  const fromPole = wins.filter((w) => w.fromPole).length;

  if (winsBlurb) {
    winsBlurb.textContent =
      `${groups.format(career.wins)} Grand Prix victories across three teams, ` +
      `${groups.format(fromPole)} of them from pole position. Listed newest first.`;
  }
  if (winsCaption) {
    winsCaption.textContent = `Career Grand Prix wins, ${groups.format(
      career.wins,
    )} in total, newest first.`;
  }

  /* Same row entry as the season table, and for the same reason: the reference
   * gives its wins rows the `.item-reveal` wipe too (§6.1). Batched, so the
   * hundred-odd rows read downward rather than each finding its own trigger.
   *
   * The hidden tail is included. A `hidden` row has no box, so its trigger
   * resolves to nothing until the disclosure opens — which is why the toggle
   * calls `ScrollTrigger.refresh()`. */
  if (!reducedMotion) {
    ScrollTrigger.batch(winsBody.querySelectorAll('.ot-wins__row'), {
      start: 'top 92%',
      onEnter: (batch) =>
        gsap.to(batch, {
          '--row-wipe': 1,
          opacity: 1,
          duration: 0.62,
          ease: 'power3.out',
          stagger: 0.045,
          overwrite: true,
        }),
    });
  }

  if (winsToggle && winsToggleLabel) {
    if (winsNewestFirst.length <= WINS_VISIBLE) {
      winsToggle.hidden = true;
    } else {
      winsToggleLabel.textContent = `Show all ${groups.format(career.wins)} wins`;
      winsToggle.addEventListener('click', () => {
        const open = winsToggle.getAttribute('aria-expanded') === 'true';
        winsToggle.setAttribute('aria-expanded', String(!open));
        for (const [i, row] of [...winsBody.children].entries()) {
          if (i >= WINS_VISIBLE) (row as HTMLElement).hidden = open;
        }
        winsToggleLabel.textContent = open
          ? `Show all ${groups.format(career.wins)} wins`
          : 'Show only the ten most recent';
        // Collapsing removes thousands of pixels above the reader; put them back
        // on the control they just pressed rather than wherever that lands them.
        if (open) winsToggle.scrollIntoView({ block: 'center', behavior: 'auto' });
        ScrollTrigger.refresh();
      });
    }
  }
}

/* ------------------------------------------------------------------ *
 * Pre-F1 career
 *
 * Reference section 4. Its eight achievements each carry a laurel-wreath Rive
 * whose colour input encodes whether the result was a title — lime for a
 * championship, grey for a placing. That is the section's one real idea, and it
 * is kept; the laurel below is drawn here rather than lifted, and the colour is
 * never the only signal, because "Champion" and "Runner-up" are written out.
 * ------------------------------------------------------------------ */

const juniorGrid = document.querySelector<HTMLElement>('[data-junior-grid]');

/** One laurel branch, mirrored in the markup to make the wreath. */
if (juniorGrid) {
  for (const entry of preF1Championships) {
    const item = el('li', 'ot-junior__item');
    item.dataset.place = String(entry.position);

    const mark = el('span', 'ot-junior__mark');
    mark.appendChild(laurel());
    item.appendChild(mark);

    item.append(
      el('span', 'ot-junior__year', String(entry.year)),
      el('span', 'ot-junior__series', entry.series),
    );

    /* The class is what distinguishes two championships of the same name — he
       won Champions of the Future twice, in different categories, and Super One
       twice. Without it the grid reads as a duplicate. */
    if (entry.category) item.appendChild(el('span', 'ot-junior__class', entry.category));
    if (entry.team) item.appendChild(el('span', 'ot-junior__class', entry.team));

    // Written out, so the laurel's colour is a second signal rather than the
    // only one. WCAG 1.4.1.
    item.appendChild(
      el('span', 'ot-junior__place', entry.position === 1 ? 'Champion' : 'Runner-up'),
    );

    const line = el('p', 'ot-junior__note-line');
    if (entry.note) line.appendChild(document.createTextNode(`${entry.note} `));

    /* One citation per result, rather than a list of hosts at the foot of the
       section. A host name is not a citation — it does not say which page
       carried which result, and CONTENT-DATA.md asks for figures that are
       traceable, not merely attributed. */
    const cite = el('a', 'ot-junior__cite', new URL(entry.source).hostname.replace(/^www\./, ''));
    cite.href = entry.source;
    cite.rel = 'noreferrer';
    cite.appendChild(
      el(
        'span',
        'sr-only',
        ` — source for the ${entry.year} ${entry.series}${
          entry.category ? ` ${entry.category}` : ''
        } result`,
      ),
    );
    line.appendChild(cite);
    item.appendChild(line);

    juniorGrid.appendChild(item);
  }

  const runnersUp = preF1Championships.length - preF1Titles;
  const blurb = document.querySelector<HTMLElement>('[data-junior-blurb]');
  if (blurb) {
    const sentence =
      `${spell(preF1Titles)} championships won before he reached Formula 1, ` +
      `and the ${spell(runnersUp)} he did not. ` +
      'Every championship he finished first or second in, in order.';
    blurb.textContent = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  }

  const span = document.querySelector<HTMLElement>('[data-junior-span]');
  if (span) span.textContent = `${preF1Span.from}–${preF1Span.to}`;
}

/* ------------------------------------------------------------------ *
 * Dates, as the countdown and the calendar print them
 *
 * In UK time, which is what the reference prints and footnotes (*UK TIME), and
 * with three-letter months from a fixed table: en-GB's own short September is
 * "Sept", where the reference -- like every timing screen -- reads SEP.
 * ------------------------------------------------------------------ */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
   * 80% down the viewport -- the reference's trigger. Each stroke is revealed
   * along its own length, in the order the markup lists them, and the whole
   * hand is eased as one gesture so it starts and lands softly rather than
   * every stroke doing so. Under reduced motion it is simply there. */
  const script = digits.querySelector<SVGSVGElement>('.ot-count__script');
  const strokes = [...digits.querySelectorAll<SVGPathElement>('[data-stroke]')];
  if (script && strokes.length && !reducedMotion) {
    const lengths = strokes.map((path) => path.getTotalLength());
    const total = lengths.reduce((a, b) => a + b, 0);
    const hand = gsap.timeline({ paused: true });
    strokes.forEach((path, i) => {
      const length = lengths[i] ?? 0;
      gsap.set(path, { strokeDasharray: `${length} ${length}`, strokeDashoffset: length });
      hand.to(path, { strokeDashoffset: 0, duration: length / total, ease: 'none' });
    });
    ScrollTrigger.create({
      trigger: script,
      start: 'top 80%',
      once: true,
      onEnter: () => {
        gsap.to(hand, { progress: 1, duration: 1.6, ease: 'power1.inOut' });
      },
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
    const span = weekendSpan(round);

    setText('[data-cal-days]', span.days);
    setText('[data-cal-month]', span.month);

    setStat('[data-cal-starts]', String(record?.starts ?? 0));
    setStat('[data-cal-first]', record ? String(record.firstRaced) : '–');
    if (record?.bestFinish) {
      const [figure, letters] = place(record.bestFinish);
      setStat('[data-cal-best]', figure, letters);
    } else {
      // Raced here and never classified, or never raced here at all.
      setStat('[data-cal-best]', record ? 'DNF' : '–');
    }
    setStat('[data-cal-wins]', String(record?.wins ?? 0));

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
    const record = circuitById.get(round.circuitId);
    const span = weekendSpan(round);
    const state = round === upcoming ? 'Next race.' : round.result ? `He ${outcomeOf(round.result)}.` : '';

    const item = el('li');
    const row = el('button', 'ot-cal__row');
    row.type = 'button';
    row.setAttribute('aria-controls', panel.id);
    row.setAttribute(
      'aria-label',
      `Round ${round.round}, ${round.raceName}, ${round.locality}, ${span.days} ${span.month}. ${state}`.trim(),
    );

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

    cell().appendChild(el('span', 'ot-cal__major', String(record?.wins ?? 0)));

    const best = cell('ot-cal__cell ot-cal__cell--unit');
    if (record?.bestFinish) {
      const [figure, letters] = place(record.bestFinish);
      best.append(el('span', 'ot-cal__reg', figure), el('span', 'ot-cal__unit', letters));
    } else {
      best.appendChild(el('span', 'ot-cal__reg', record ? 'DNF' : '–'));
    }

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

    gsap.set(card, { clipPath: 'ellipse(120% 0% at 50% 0%)', autoAlpha: 0, x: 0, y: 0 });
    gsap.set(reveal, { clipPath: 'ellipse(120% 120% at 50% 100%)' });
    const appear = gsap
      .timeline({ paused: true })
      .to(card, { clipPath: 'ellipse(120% 120% at 50% 0%)', autoAlpha: 1, duration: 0.8, ease: 'power2.out' })
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
 * Keyboard access to the tables' sideways overflow
 *
 * Below about 992px the wins table is wider than its column and its wrapper
 * scrolls it sideways. A scroll container is only operable by pointer unless
 * it is focusable, so without this the last few columns — laps and race time —
 * are simply unreachable for anyone driving the page from the keyboard.
 * WCAG 2.1.1. (The seasons list is three columns and fits any width.)
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
  ['[data-wins]', 'Career race wins, scrollable'],
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
 * Nav ink over the light band
 *
 * The nav is fixed and coloured for the dark hero: the given name in Rosso and
 * the surname in Giallo Modena. The stat band below it is cream, and Giallo on
 * that cream measures about 1.06:1 — not "a bit low", the same colour. The
 * surname simply disappeared, and the rest of the lockup sat unreadable over
 * the gigantic number.
 *
 * home.css already solves this: `--nav-ink` is `--nav-invert * (1 -
 * --nav-ground-dark)`, and the wordmark mixes toward the page's ink as it
 * rises. The homepage drives `--nav-ground-dark` from its GL ground; this page
 * has no GL, so it drives `--nav-invert` directly and leaves the other term at
 * its initial 0.
 *
 * Scrubbed rather than toggled, so the lockup crosses with the edge it is
 * crossing instead of snapping a frame early or late.
 * ------------------------------------------------------------------ */

const navInner = document.querySelector<HTMLElement>('.nav-inner');
/* Every light ground on this page.
 *
 * Measured, not assumed: sampling the painted background under the nav strip
 * every 400px down the document returns cream at 1386-5005 and again from
 * 14444 to the footer. The first is the stat band. The second is the socials
 * and store sections this page shares with Home — both carry their own light
 * ground rather than taking it from the field, which is why they are still
 * cream on a page that has no field at all. */
/* `.ot-band` used to be here. It is dark now — the reference's On Track page
   paints one near-black from its hero to its footer, sampled every 1000px down
   its document, and this band was the only place ours stepped to a light
   ground. Leaving it listed inverted the nav over four thousand pixels of dark
   page. */
const lightBands = ['.socials', '.shop']
  .map((selector) => document.querySelector<HTMLElement>(selector))
  .filter((el): el is HTMLElement => el !== null);

if (navInner && lightBands.length) {
  /* What the lockup is actually sitting on, rather than which section it is in.
   *
   * Keying off the band alone was wrong and the screenshot proved it: the
   * gigantic number is near-black ink ON the cream, tall enough to fill the
   * frame, so it passes under the nav inside the very section that is supposed
   * to mean "light ground". The lockup went dark ink on a dark glyph and
   * disappeared just as completely as the giallo had on the cream.
   *
   * So the test is the grounds this page actually has, in order: the number if
   * it is under the nav, otherwise any of the light sections. */
  const navBand = (): number => navInner.getBoundingClientRect().bottom;

  const groundIsLight = (): number => {
    const nav = navBand();
    if (gigantic) {
      const g = gigantic.getBoundingClientRect();
      // Overlapping the nav's strip at all is enough — the lockup sits at the
      // top of that strip and the number's glyphs are solid.
      if (g.top < nav && g.bottom > 0) return 0;
    }
    return lightBands.some((el) => {
      const box = el.getBoundingClientRect();
      return box.top < nav && box.bottom > 0;
    })
      ? 1
      : 0;
  };

  if (reducedMotion) {
    const apply = () => navInner.style.setProperty('--nav-invert', String(groundIsLight()));
    apply();
    window.addEventListener('scroll', apply, { passive: true });
  } else {
    /* quickTo, so the crossing is a short blend rather than a snap on the frame
       an edge happens to pass. It retargets one running tween instead of
       spawning a tween per scroll event. */
    const toInvert = gsap.quickTo(navInner, '--nav-invert', {
      duration: 0.35,
      ease: 'power2.out',
    });
    ScrollTrigger.create({
      trigger: document.body,
      start: 0,
      end: 'max',
      onUpdate: () => toInvert(groundIsLight()),
      onRefresh: () => toInvert(groundIsLight()),
    });
  }
}

/* ------------------------------------------------------------------ *
 * Chrome, reveals, and the entrance
 * ------------------------------------------------------------------ */

mountChrome();

/* This page has no WebGL entrance to wait on, so "ready" is simply the fonts
   having landed — the reveal splits are measured against line boxes, and
   cutting them against the fallback face puts the breaks in the wrong places.
   `document.fonts.ready` resolves even when a face fails, so this cannot hang. */
mountReveals({
  immediate: '.ot-hero',
  whenReady: (run) => void document.fonts.ready.then(run),
});

void document.fonts.ready.then(() => {
  document.body.classList.add('is-ready');
  // Row heights and the gigantic number both settle with the real face, and
  // every trigger below them is positioned off that.
  ScrollTrigger.refresh();
});
