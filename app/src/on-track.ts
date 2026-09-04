/**
 * /on-track — the stats and results hub.
 *
 * Every figure this renders is read from the data layer. There is no number
 * literal below and none in on-track.html either, which is the point: the
 * career totals move on a race weekend, and anything typed into markup is
 * something nobody will remember to change.
 *
 * Section order follows the reference (docs/ON-TRACK-REFERENCE.md §1). Built so
 * far: the page header and the career stat band, including the twenty-season
 * table that the reference's seven-row block becomes.
 */

import './styles/on-track.css';
import Lenis from 'lenis';
import { gsap, reducedMotion, ScrollTrigger } from './lib/motion';
import { mountChrome } from './lib/chrome';
import { mountReveals } from './lib/reveal';
import { age, driver } from './content/hamilton';
import { career, provenance, seasons, seasonsNewestFirst } from './content/live-stats';

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
 * Keyboard access to the season table's overflow
 *
 * Below about 992px the table is wider than its column and `.ot-seasons`
 * scrolls it sideways. A scroll container is only operable by pointer unless it
 * is focusable, so without this the last few columns — poles and points — are
 * simply unreachable for anyone driving the page from the keyboard. WCAG 2.1.1.
 *
 * Applied only while it actually overflows: an unconditional tabindex would add
 * a tab stop on every desktop width, where there is nothing to scroll and the
 * stop does nothing but waste a keypress.
 * ------------------------------------------------------------------ */

const seasonsScroller = document.querySelector<HTMLElement>('[data-seasons]');

if (seasonsScroller) {
  const syncFocusable = (): void => {
    const scrolls = seasonsScroller.scrollWidth > seasonsScroller.clientWidth + 1;
    if (scrolls) {
      seasonsScroller.tabIndex = 0;
      // Named and given a role, so it is announced as a region worth entering
      // rather than as an unlabelled focus stop.
      seasonsScroller.setAttribute('role', 'region');
      seasonsScroller.setAttribute('aria-label', 'Season-by-season record, scrollable');
    } else {
      seasonsScroller.removeAttribute('tabindex');
      seasonsScroller.removeAttribute('role');
      seasonsScroller.removeAttribute('aria-label');
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
