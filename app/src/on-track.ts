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
import { Signature } from './Signature';
import { mountReveals } from './lib/reveal';
import { mountHelmets, mountHofDrift, mountSocials, mountStore } from './lib/showcase';
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
} from './content/live-stats';
import type { CalendarRound, RaceSession } from './content/live-stats';
import { countryName, flagUrl } from './content/countries';

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

  mm.add('(prefers-reduced-motion: no-preference)', () => {
    gsap.fromTo(
      podium,
      { '--podium-p': 0 },
      {
        '--podium-p': 1,
        ease: 'power1.in',
        scrollTrigger: { trigger: podium, start: 'top bottom', end: 'bottom center', scrub: true },
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

  /* Provenance, as on the stat band — but a different kind. The career totals
     move every race weekend and so carry the date they were fetched; these do
     not move at all, so what matters is where each one came from, which is the
     link on the result itself. */
  const note = document.querySelector<HTMLElement>('[data-junior-note]');
  if (note) {
    note.textContent =
      'Each result links to the source it was verified against. Unlike the career ' +
      'totals above, none of these can change.';
  }
}

/* ------------------------------------------------------------------ *
 * Countdown to the next race
 *
 * The reference reads its target from plain text in a hidden element, and its
 * digits all sit at 00 because the race it points at is long past. Ours reads
 * the calendar and picks by the clock, so it cannot expire in place.
 * ------------------------------------------------------------------ */

const countdownSection = document.querySelector<HTMLElement>('[data-countdown]');
const countdownDigits = document.querySelector<HTMLElement>('[data-countdown-digits]');
const countdownSr = document.querySelector<HTMLElement>('[data-countdown-sr]');
const countdownRace = document.querySelector<HTMLElement>('[data-countdown-race]');

const UNITS = [
  { key: 'days', label: 'day', short: 'D', per: 86_400_000 },
  { key: 'hours', label: 'hour', short: 'H', per: 3_600_000 },
  { key: 'minutes', label: 'minute', short: 'M', per: 60_000 },
  { key: 'seconds', label: 'second', short: 'S', per: 1000 },
] as const;

if (countdownSection && countdownDigits) {
  const upcoming = nextRound();

  if (!upcoming) {
    // The season is over. Say nothing rather than counting down to nothing —
    // the reference's own countdown sits frozen at 00 and reads as broken.
    countdownSection.hidden = true;
  } else {
    /* The circuit being counted down to, in the accent. Mounted here rather
       than beside the hero's so it is only ever built for a race that is
       actually still ahead — the branch above hides the whole section once the
       season is done, and a canvas booting into a hidden section is work for
       nothing. */
    const countdownCircuit = document.querySelector<HTMLElement>('[data-countdown-circuit]');
    if (countdownCircuit && hasTrack(upcoming.circuitId)) {
      void mountCircuit(countdownCircuit, {
        circuitId: upcoming.circuitId,
        lit: true,
      }).then(
        () => {
          // Revealed only once there is something in it — see the markup.
          countdownCircuit.hidden = false;
        },
        (error: unknown) => {
          console.warn('[on-track] countdown circuit did not load', error);
        },
      );
    }

    const target = roundStart(upcoming);

    /* The row has to fit its container, and days is the one field whose width
     * is not fixed: two figures inside a season, three across a winter break.
     *
     * Same solve as the gigantic number. The reference sets 17.5rem for eight
     * characters, so the size is scaled by the count actually needed — and
     * measured once, then held, because a row that resized itself as the count
     * fell through 100 would jump under the reader. */
    const COUNTDOWN_SPAN_REM = 140; // 17.5rem x 8 characters, from the reference
    const dayWidth = Math.max(
      2,
      String(Math.floor(Math.max(0, target.getTime() - Date.now()) / 86_400_000)).length,
    );
    countdownDigits.style.setProperty(
      '--countdown-size',
      `${COUNTDOWN_SPAN_REM / (dayWidth + 6)}rem`,
    );

    const cells = UNITS.map((unit) => {
      const item = el('div', 'ot-countdown__item');
      const value = el('span', 'ot-countdown__value', '00');
      value.dataset.unit = unit.key;
      item.append(value, el('span', 'ot-countdown__unit', unit.short));
      countdownDigits.appendChild(item);
      return { unit, value };
    });

    if (countdownRace) {
      const when = target.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      /* The locality is dropped where the circuit's own name already contains
         it — "Autodromo Nazionale di Monza, Monza" and "Silverstone Circuit,
         Silverstone" say one thing twice, while "Circuit Gilles Villeneuve,
         Montreal" says two. */
      const place = upcoming.circuitName.toLowerCase().includes(upcoming.locality.toLowerCase())
        ? upcoming.circuitName
        : `${upcoming.circuitName}, ${upcoming.locality}`;
      countdownRace.textContent =
        `Round ${upcoming.round} · ${upcoming.raceName} · ${place} · ${when}`;
    }

    const render = (): boolean => {
      let remaining = target.getTime() - Date.now();
      const done = remaining <= 0;
      if (done) remaining = 0;

      const parts: string[] = [];
      for (const { unit, value } of cells) {
        const n = Math.floor(remaining / unit.per);
        remaining -= n * unit.per;
        value.textContent = String(n).padStart(unit.key === 'days' ? dayWidth : 2, '0');
        // The visible digits are aria-hidden, so this sentence is the whole of
        // what a screen reader gets. "1 days" is not English.
        parts.push(`${n} ${unit.label}${n === 1 ? '' : 's'}`);
      }
      if (countdownSr) {
        countdownSr.textContent = done
          ? `${upcoming.raceName} is under way.`
          : `${parts.join(', ')} until the ${upcoming.raceName}.`;
      }
      return done;
    };

    render();

    if (!reducedMotion) {
      /* One interval, cleared the moment it reaches zero.
       *
       * setInterval rather than a rAF loop: this changes once a second, and a
       * per-frame loop would wake the page sixty times to write the same
       * string. */
      const tick = window.setInterval(() => {
        if (render()) window.clearInterval(tick);
      }, 1000);
    }
    /* Under reduced motion it renders once and stops. The remaining time is
       still stated in full and the live region carries it — what is dropped is
       the per-second update, which is motion, not information. */
  }
}

/* ------------------------------------------------------------------ *
 * Season schedule, and the circuit panel it drives
 *
 * The reference's rows are clickable divs carrying a title attribute — no
 * tabindex, no keyboard path, so the whole mechanic is mouse-only. CLAUDE.md
 * requires keyboard operability, so each row here is a real button and the
 * panel it controls is wired with aria-controls.
 * ------------------------------------------------------------------ */

const scheduleList = document.querySelector<HTMLElement>('[data-schedule]');
const circuitPanel = document.querySelector<HTMLElement>('[data-circuit]');

function timeLabel(session: { date: string; time: string | null }): string {
  const when = new Date(
    session.time ? `${session.date}T${session.time}` : `${session.date}T00:00:00Z`,
  );
  return session.time
    ? when.toLocaleString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : when.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

if (scheduleList && circuitPanel) {
  const nowRound = nextRound();
  circuitPanel.id = 'ot-circuit-panel';

  const roundState = (round: CalendarRound): 'past' | 'next' | 'upcoming' =>
    round.result ? 'past' : nowRound && round.round === nowRound.round ? 'next' : 'upcoming';

  /* The panel's traced circuit, built once and retargeted — which is exactly
   * how the reference does it. Its `.f1-highlight-circuit-rive` is a single
   * canvas whose track input the rows switch on hover; a canvas per row would
   * be 23 wasm-backed surfaces to draw one shape.
   *
   * Held as a promise rather than awaited, so the panel renders immediately and
   * every later retarget queues behind the same single load. */
  const shapeHost = circuitPanel.querySelector<HTMLElement>('[data-circuit-shape]');
  let shape: ReturnType<typeof mountCircuit> | null = null;

  /** Points the drawing at a round, building it on the first one that has a shape. */
  const drawCircuit = (round: CalendarRound): void => {
    if (!shapeHost || !hasTrack(round.circuitId)) return;
    shape ??= mountCircuit(shapeHost, { circuitId: round.circuitId });
    void shape.then(
      (handle) => handle.select(round.circuitId),
      (error: unknown) => {
        console.warn('[on-track] schedule circuit did not load', error);
        // Cleared so a later round retries rather than resolving the same
        // rejection forever.
        shape = null;
      },
    );
  };

  /** Fill the detail panel from one round. */
  const showRound = (round: CalendarRound): void => {
    drawCircuit(round);
    const record = circuitById.get(round.circuitId);

    const set = (sel: string, value: string) => {
      const node = circuitPanel.querySelector<HTMLElement>(sel);
      if (node) node.textContent = value;
    };
    set('[data-circuit-round]', `Round ${round.round} of ${calendar.length}`);
    set('[data-circuit-name]', round.circuitName);
    set('[data-circuit-where]', `${round.locality}, ${round.country}`);

    const stats = circuitPanel.querySelector<HTMLElement>('[data-circuit-stats]');
    if (stats) {
      stats.textContent = '';
      /* A circuit he has never raced is a real state, not an error — the 2026
         calendar visits venues new to it. Say so, rather than printing a row of
         zeroes that reads like a bad record. */
      const rows: [string, string][] = record
        ? [
            ['Starts', groups.format(record.starts)],
            ['Wins', groups.format(record.wins)],
            ['Podiums', groups.format(record.podiums)],
            ['Poles', groups.format(record.poles)],
            ['Best finish', record.bestFinish ? ordinal(record.bestFinish) : '—'],
            ['First raced', String(record.firstRaced)],
          ]
        : [['Record', 'No previous start at this circuit']];

      for (const [label, value] of rows) {
        const pair = el('div', 'ot-circuit__pair');
        pair.append(el('dt', 'ot-circuit__label', label), el('dd', 'ot-circuit__value', value));
        stats.appendChild(pair);
      }
    }

    const sessions = circuitPanel.querySelector<HTMLElement>('[data-circuit-sessions]');
    if (sessions) {
      sessions.textContent = '';
      const schedule: [string, RaceSession | null][] = [
        ['Practice 1', round.sessions.practice1],
        ['Practice 2', round.sessions.practice2],
        ['Practice 3', round.sessions.practice3],
        ['Sprint', round.sessions.sprint],
        ['Qualifying', round.sessions.qualifying],
      ];
      for (const [label, session] of schedule) {
        if (!session) continue; // a sprint weekend has no P3, a normal one no sprint
        const line = el('p', 'ot-circuit__session');
        line.append(
          el('span', 'ot-circuit__session-label', label),
          el('span', 'ot-circuit__session-time', timeLabel(session)),
        );
        sessions.appendChild(line);
      }
      const race = el('p', 'ot-circuit__session ot-circuit__session--race');
      race.append(
        el('span', 'ot-circuit__session-label', 'Race'),
        el('span', 'ot-circuit__session-time', timeLabel({ date: round.date, time: round.time })),
      );
      sessions.appendChild(race);

      // The reference footnotes its schedule *UK TIME. Ours renders in the
      // reader's own zone, so it names that zone rather than asserting one they
      // may not be in.
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      sessions.appendChild(el('p', 'ot-circuit__note', `Times shown in your local zone (${zone}).`));
    }
  };

  const buttons: HTMLButtonElement[] = [];

  const select = (round: CalendarRound, index: number, focus = false): void => {
    showRound(round);
    buttons.forEach((b, i) => {
      const active = i === index;
      b.classList.toggle('is-active', active);
      // aria-pressed, not aria-selected: these are toggle buttons in a toolbar,
      // not tabs, and aria-selected outside a listbox or tablist means nothing.
      b.setAttribute('aria-pressed', String(active));
      /* Roving tabindex. Without it the schedule is 23 tab stops standing
       * between the rest of the page and the footer, and every one of them has
       * to be pressed past to leave the section. One stop enters the list, and
       * the arrow keys below move inside it — the ARIA toolbar pattern, which
       * is why the container carries that role. */
      b.tabIndex = active ? 0 : -1;
    });
    if (focus) buttons[index]?.focus();
  };

  scheduleList.setAttribute('role', 'toolbar');
  scheduleList.setAttribute('aria-orientation', 'vertical');
  scheduleList.setAttribute('aria-label', `Rounds of the ${calendar[0]?.season ?? ''} season`);

  calendar.forEach((round, index) => {
    const state = roundState(round);
    const button = el('button', `ot-round is-${state}`);
    button.type = 'button';
    button.setAttribute('aria-controls', circuitPanel.id);
    button.setAttribute('aria-pressed', 'false');
    // Overwritten by the first select() below; set here so the list is never
    // momentarily a 23-stop tab trap if that call ever fails to run.
    button.tabIndex = -1;

    /* The locality, not the country: the name column has already stripped
     * "Grand Prix" off the race name, so "Dutch / Netherlands" would be one
     * fact twice where "Dutch / Zandvoort" names the circuit's town.
     *
     * Except where the town IS the race — Abu Dhabi, Miami, Singapore — and the
     * two columns read identically. There the circuit's own name is the second
     * fact: "Abu Dhabi / Yas Marina Circuit". */
    const shortName = round.raceName.replace(/ Grand Prix$/, '');
    const where =
      round.locality.toLowerCase() === shortName.toLowerCase() ? round.circuitName : round.locality;

    button.append(
      el('span', 'ot-round__num', String(round.round).padStart(2, '0')),
      el('span', 'ot-round__name', shortName),
      el('span', 'ot-round__where', where),
      el('span', 'ot-round__date', shortDate(round.date)),
    );

    /* The outcome gets its own column. The reference strikes through the round
       number of a completed race and shows the finish in its place; keeping
       them apart leaves the number legible. */
    const outcome = el('span', 'ot-round__outcome');
    if (round.result) {
      outcome.textContent = round.result.position
        ? ordinal(round.result.position)
        : round.result.positionText; // "R" for a retirement, "D" for a disqualification
      if (round.result.position === 1) outcome.classList.add('is-win');
      if (!round.result.position) outcome.classList.add('is-dnf');
    } else {
      outcome.textContent = state === 'next' ? 'Next' : '—';
    }
    button.appendChild(outcome);

    // The visible row is a terse grid; the accessible name has to be a sentence.
    button.appendChild(
      el(
        'span',
        'sr-only',
        `Round ${round.round}, ${round.raceName}, ${round.country}, ${shortDate(round.date)}. ` +
          (round.result
            ? `Finished ${
                round.result.position ? ordinal(round.result.position) : round.result.status
              }.`
            : state === 'next'
              ? 'The next race.'
              : 'Upcoming.') +
          ' Show his record at this circuit.',
      ),
    );

    button.addEventListener('click', () => select(round, index));
    buttons.push(button);
    scheduleList.appendChild(button);
  });

  /* Hover retargets the drawing without changing the selection — the
   * reference's own gesture, where each row carries a
   * `data-rive-circuit-hover-target` naming the track its one canvas should
   * switch to. Reading a row is a different act from choosing one, and only the
   * shape follows the pointer; the panel's figures stay with what was selected,
   * so nothing a reader is mid-way through reading moves under them.
   *
   * Delegated and bound to `pointerover`, which bubbles — `mouseenter` does
   * not, and would need 23 listeners to say the same thing. Touch is excluded
   * because a tap fires pointerover immediately before click, which would draw
   * a circuit the reader is already selecting. */
  scheduleList.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const row = (event.target as Element | null)?.closest('.ot-round');
    if (!row) return;
    const round = calendar[buttons.indexOf(row as HTMLButtonElement)];
    if (round) drawCircuit(round);
  });

  /* Back to the selected round when the pointer leaves the list, so the shape
     and the figures beside it agree again. */
  scheduleList.addEventListener('pointerleave', () => {
    const active = calendar[buttons.findIndex((b) => b.classList.contains('is-active'))];
    if (active) drawCircuit(active);
  });

  /* Arrow keys move between rounds — the other half of the roving tabindex
     above. Home and End jump to the season's first and last round. */
  scheduleList.addEventListener('keydown', (event) => {
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const moves: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowRight: index + 1,
      ArrowUp: index - 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: buttons.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const clamped = Math.max(0, Math.min(buttons.length - 1, target));
    const round = calendar[clamped];
    if (round) select(round, clamped, true);
  });

  // Open on the next race — the round a visitor is most likely here for.
  const openingIndex = nowRound ? calendar.findIndex((r) => r.round === nowRound.round) : 0;
  const opening = calendar[Math.max(0, openingIndex)];
  if (opening) select(opening, Math.max(0, openingIndex));

  const yearNode = document.querySelector<HTMLElement>('[data-schedule-year]');
  if (yearNode && calendar[0]) yearNode.textContent = String(calendar[0].season);
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
   `document.fonts.ready` resolves even when a face fails, so this cannot hang.
   The header's lines then wait for its cue, with everything else in it. */
mountReveals({
  immediate: '.ot-hero',
  whenReady: (run) => void document.fonts.ready.then(() => gsap.delayedCall(HERO_CUE, run)),
});

void document.fonts.ready.then(() => {
  document.body.classList.add('is-ready');
  // Row heights and the gigantic number both settle with the real face, and
  // every trigger below them is positioned off that.
  ScrollTrigger.refresh();
});
