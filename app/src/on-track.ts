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

/**
 * The same branch twice, opened out — the reference's 184x81 "reef", whose two
 * halves stand apart so the travelling mark can land in the gap between them.
 * Each branch is scaled to the 81px height, which leaves the middle clear and
 * matches the 20% inset its own landing anchor uses.
 */
function laurelPair(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 184 81');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const scale = 81 / 48;
  svg.append(
    laurelBranch(`scale(${scale})`),
    laurelBranch(`translate(184 0) scale(${-scale} ${scale})`),
  );
  return svg;
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
 * The reference shows four. CLAUDE.md asks for championships to join them
 * rather than becoming a section of its own, and starts and points belong here
 * too — they are the two figures the season table sums to, so showing them lets
 * a reader check the table against its own total.
 * ------------------------------------------------------------------ */

interface Stat {
  label: string;
  value: number;
  /** Rendered instead of the plain grouped number, where one is needed. */
  display?: string;
  /** Shown under the figure where the number needs qualifying. */
  note?: string;
  /** Carries the accent scribble the reference draws over its win count. */
  scribble?: boolean;
}

const STATS: Stat[] = [
  /* The reference's four, with its "average finish" replaced by the number
     that is the whole point of him. Two by two, as its grid is — starts and
     points are not dropped, they move to the provenance line under the grid,
     which is where a figure that qualifies the others belongs. */
  { label: 'World championships', value: career.championships },
  { label: 'Formula 1 wins', value: career.wins, scribble: true },
  { label: 'Pole positions', value: career.poles, note: 'Sprint-era rule applied' },
  { label: 'Fastest laps', value: career.fastestLaps },
];

const statGrid = document.querySelector<HTMLElement>('[data-stat-grid]');

if (statGrid) {
  for (const stat of STATS) {
    const item = el('li', 'ot-stats__item');

    // Same mirror pattern as the gigantic number: the counter is aria-hidden
    // and an sr-only twin carries the settled value, so a count-up never reads
    // out as a stream of changing numbers.
    item.appendChild(
      el('span', 'sr-only', `${stat.label}: ${stat.display ?? groups.format(stat.value)}`),
    );

    const label = el('span', 'ot-stats__label', stat.label);
    label.setAttribute('aria-hidden', 'true');

    /* The reference puts the descriptor ABOVE the figure. The old order here
       was the other way up. */
    const figureWrap = el('span', 'ot-stats__figure');
    figureWrap.setAttribute('aria-hidden', 'true');

    const figure = el('span', 'ot-stats__value', stat.display ?? groups.format(stat.value));
    figure.dataset.count = String(stat.value);
    if (stat.display) figure.dataset.countDisplay = stat.display;
    figureWrap.appendChild(figure);

    if (stat.scribble) {
      const scribble = el('span', 'ot-stats__scribble');
      scribble.appendChild(p1Scribble());
      figureWrap.appendChild(scribble);
    }

    item.append(label, figureWrap);
    if (stat.note) {
      const note = el('span', 'ot-stats__note', stat.note);
      note.setAttribute('aria-hidden', 'true');
      item.appendChild(note);
    }
    statGrid.appendChild(item);
  }

  /* One size for the whole grid, solved from its widest figure.
   *
   * 17.5rem is the reference's size and stays the size wherever it fits — its
   * numbers are two digits and clear their column with room. Hamilton's win and
   * pole counts are three, and three digits at 17.5rem measured 447px in a
   * 377px column: the figures overflowed and ran into each other across the
   * grid's 38px gutter.
   *
   * Sized as a SET rather than per item, because four numbers at four sizes
   * read as four unrelated facts instead of one career. Measured before the
   * count-up below starts, while each figure still holds its settled string —
   * a figure showing "0" would measure one digit wide and size the grid for a
   * number that is about to grow. */
  /* Reference `.f1-car-stats-grid`, measured at 1728: its columns are 397.5px
     wide and its two-digit figures 262px, so a figure takes 0.659 of its column
     and the next one starts 155px clear. That gap is the grid's legibility, and
     it is what the first fix here spent — sized only to avoid overflow, "105"
     filled 98% of its column and sat 46px from "69", so the two read as one
     number.
   *
   * Holding the ratio instead reproduces the reference's own 17.5rem at two
   * digits, which is the check that this generalises its value rather than
   * replacing it, and it degrades correctly at three. Capped at 17.5rem so a
   * set of single-digit figures is not inflated past the size it designed. */
  const STAT_SPAN = 262 / 397.5;

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
      figure.textContent =
        figure.dataset.countDisplay ?? groups.format(Number(figure.dataset.count));
      widest = Math.max(widest, inkWidth(figure));
      figure.textContent = showing;
    }

    if (widest <= 0) return;
    const scale = Math.min(1, (column * STAT_SPAN) / widest);
    statGrid.style.setProperty('--stat-size', `${17.5 * scale}rem`);
  };

  fitStats();
  remeasure(fitStats);

  /* Count-ups.
   *
   * Integers count as integers. Points is the one fractional total, and
   * counting through fractional intermediates would spin a decimal place that
   * means nothing — so it counts on the whole part and lands on the real value
   * at the end. */
  if (!reducedMotion) {
    for (const figure of statGrid.querySelectorAll<HTMLElement>('.ot-stats__value')) {
      const target = Number(figure.dataset.count);
      const display = figure.dataset.countDisplay;
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
        onComplete: () => {
          figure.textContent = display ?? groups.format(target);
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

if (wreath) wreath.prepend(laurelPair());

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
    `Counted from the race-by-race record. ${provenance.polesDefinition}`;
}

/* ------------------------------------------------------------------ *
 * Season-by-season table
 *
 * Twenty rows where the reference has seven. Championship seasons are marked,
 * and each row carries its team, because with three teams the era is part of
 * reading the row rather than a caption above it.
 * ------------------------------------------------------------------ */

const seasonsBody = document.querySelector<HTMLElement>('[data-seasons-body]');
const seasonsCaption = document.querySelector<HTMLElement>('[data-seasons-caption]');

if (seasonsBody) {
  // Newest first, matching the helmet wall and the way results are read.
  for (const season of seasonsNewestFirst) {
    const row = el('tr', 'ot-seasons__row');
    row.dataset.team = season.teamId;
    if (season.isChampion) row.classList.add('is-champion');

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
       * between the wins disclosure and the footer, and every one of them has
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
 * Keyboard access to the tables' sideways overflow
 *
 * Below about 992px both tables are wider than their column and their wrapper
 * scrolls them sideways. A scroll container is only operable by pointer unless
 * it is focusable, so without this the last few columns — poles and points on
 * one, laps and race time on the other — are simply unreachable for anyone
 * driving the page from the keyboard. WCAG 2.1.1.
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
  ['[data-seasons]', 'Season-by-season record, scrollable'],
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
