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
import { gsap, reducedMotion, ScrollTrigger } from './lib/motion';
import { mountChrome } from './lib/chrome';
import { mountReveals } from './lib/reveal';
import {
  age,
  driver,
  preF1Championships,
  preF1Span,
  preF1Titles,
} from './content/hamilton';
import {
  calendar,
  career,
  circuitById,
  nextRound,
  provenance,
  roundStart,
  seasons,
  seasonsNewestFirst,
  wins,
  winsNewestFirst,
} from './content/live-stats';
import type { CalendarRound, RaceSession } from './content/live-stats';

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
};

for (const [key, value] of Object.entries(bindings)) {
  for (const node of document.querySelectorAll<HTMLElement>(`[data-bind="${key}"]`)) {
    node.textContent = value;
  }
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

const GIGANTIC_SPAN_REM = 228; // 114rem x 2 digits, from the reference

const gigantic = document.querySelector<HTMLElement>('[data-gigantic]');
const giganticSr = document.querySelector<HTMLElement>('[data-gigantic-sr]');

if (gigantic && giganticSr) {
  const value = career.podiums;
  const digits = String(value);

  // The accessible mirror carries the real value as one readable string. The
  // visual copy is split into per-character spans and is aria-hidden, because
  // a screen reader announcing three separate digit nodes is not a number.
  giganticSr.textContent = `${groups.format(value)} podiums`;

  gigantic.style.setProperty('--gigantic-size', `${GIGANTIC_SPAN_REM / digits.length}rem`);
  gigantic.textContent = '';
  for (const ch of digits) gigantic.appendChild(el('span', 'ot-gigantic__char', ch));

  if (!reducedMotion) {
    // Each digit rises into place on its own beat. The reference places its
    // chars individually — its second digit sits 42px higher than its first —
    // so a per-character offset is its idiom, not an invention here.
    gsap.from(gigantic.querySelectorAll('.ot-gigantic__char'), {
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
}

const STATS: Stat[] = [
  { label: 'World championships', value: career.championships },
  { label: 'Grand Prix wins', value: career.wins },
  { label: 'Pole positions', value: career.poles, note: 'Sprint-era rule applied' },
  { label: 'Fastest laps', value: career.fastestLaps },
  { label: 'Race starts', value: career.starts },
  { label: 'Career points', value: career.points, display: points(career.points) },
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

    const figure = el('span', 'ot-stats__value', stat.display ?? groups.format(stat.value));
    figure.setAttribute('aria-hidden', 'true');
    figure.dataset.count = String(stat.value);
    if (stat.display) figure.dataset.countDisplay = stat.display;

    const label = el('span', 'ot-stats__label', stat.label);
    label.setAttribute('aria-hidden', 'true');

    item.append(figure, label);
    if (stat.note) {
      const note = el('span', 'ot-stats__note', stat.note);
      note.setAttribute('aria-hidden', 'true');
      item.appendChild(note);
    }
    statGrid.appendChild(item);
  }

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

    row.appendChild(el('td', 'ot-seasons__cell', season.team));

    const cells: string[] = [
      ordinal(season.position),
      groups.format(season.entries),
      groups.format(season.wins),
      groups.format(season.podiums),
      groups.format(season.poles),
      points(season.points),
    ];
    for (const value of cells) {
      row.appendChild(el('td', 'ot-seasons__cell ot-seasons__cell--num', value));
    }

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
const LAUREL_LEAVES: [number, number, number, number, number][] = [
  // cx, cy, rx, ry, rotation
  [10.5, 17, 4.6, 2.4, -66],
  [12.5, 25, 4.6, 2.4, -50],
  [16, 32.5, 4.4, 2.3, -34],
  [20.5, 38.5, 4, 2.2, -18],
];

function laurel(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  for (const mirror of [false, true]) {
    const branch = document.createElementNS(NS, 'g');
    if (mirror) branch.setAttribute('transform', 'translate(48 0) scale(-1 1)');

    const stem = document.createElementNS(NS, 'path');
    stem.setAttribute('d', 'M23 43C12.5 38.5 8 27.5 9.5 14.5');
    stem.setAttribute('fill', 'none');
    stem.setAttribute('stroke', 'currentColor');
    stem.setAttribute('stroke-width', '1.6');
    stem.setAttribute('stroke-linecap', 'round');
    branch.appendChild(stem);

    for (const [cx, cy, rx, ry, angle] of LAUREL_LEAVES) {
      const leaf = document.createElementNS(NS, 'ellipse');
      leaf.setAttribute('cx', String(cx));
      leaf.setAttribute('cy', String(cy));
      leaf.setAttribute('rx', String(rx));
      leaf.setAttribute('ry', String(ry));
      leaf.setAttribute('transform', `rotate(${angle} ${cx} ${cy})`);
      leaf.setAttribute('fill', 'currentColor');
      branch.appendChild(leaf);
    }
    svg.appendChild(branch);
  }
  return svg;
}

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

  /** Fill the detail panel from one round. */
  const showRound = (round: CalendarRound): void => {
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
const lightBand = document.querySelector<HTMLElement>('.ot-band');

if (navInner && lightBand) {
  /* What the lockup is actually sitting on, rather than which section it is in.
   *
   * Keying off the band alone was wrong and the screenshot proved it: the
   * gigantic number is near-black ink ON the cream, tall enough to fill the
   * frame, so it passes under the nav inside the very section that is supposed
   * to mean "light ground". The lockup went dark ink on a dark glyph and
   * disappeared just as completely as the giallo had on the cream.
   *
   * So the test is the two grounds this page actually has, in order: the number
   * if it is under the nav, otherwise the band. */
  const navBand = (): number => navInner.getBoundingClientRect().bottom;

  const groundIsLight = (): number => {
    const nav = navBand();
    if (gigantic) {
      const g = gigantic.getBoundingClientRect();
      // Overlapping the nav's strip at all is enough — the lockup sits at the
      // top of that strip and the number's glyphs are solid.
      if (g.top < nav && g.bottom > 0) return 0;
    }
    const band = lightBand.getBoundingClientRect();
    return band.top < nav && band.bottom > 0 ? 1 : 0;
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
