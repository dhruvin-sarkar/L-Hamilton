/**
 * /calendar -- the season, round by round, and every Grand Prix before it.
 *
 * The reference's calendar page, in its order: the hero, the season (the
 * standings, the round panel with its track visualiser, every round run and
 * every round to come), all results season by season, the countdown, the
 * footer. Every figure is read from the data layer -- live-stats (Jolpica),
 * circuit-facts (formula1.com) and countries -- and nothing in calendar.html
 * is typed.
 *
 * The panel and the countdown are the components On Track already shows, and
 * the reference shares them between its two pages the same way: this page
 * takes their styles from on-track.css and their behaviour from lib/.
 */

import './styles/on-track.css';
import './styles/calendar.css';
import Lenis from 'lenis';
import { gsap, reducedMotion, ScrollTrigger } from './lib/motion';
import { mountChrome } from './lib/chrome';
import { mountCountdown } from './lib/countdown';
import { mountFooterMarquee } from './lib/marquee';
import { mountReveals } from './lib/reveal';
import { place } from './lib/schedule';
import { Signature } from './Signature';
import { calendar, nextRound, provenance, seasons } from './content/live-stats';
import { mountSeason } from './calendar/season';
import { mountResults } from './calendar/results';
import { mountOvalScroll } from './calendar/oval';

/* ------------------------------------------------------------------ *
 * Smooth scroll -- the instance every page builds, with the same options.
 * See on-track.ts: `lerp` is the scroll feel, and the reference measures 0.1.
 * ------------------------------------------------------------------ */

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

mountFooterMarquee(smoothScroller);

/* ------------------------------------------------------------------ *
 * The season this page is about
 * ------------------------------------------------------------------ */

const opening = calendar[0];
if (!opening) throw new Error('[calendar] the season calendar is empty');
const season = opening.season;

const need = <T extends Element = HTMLElement>(selector: string): T => {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`[calendar] no ${selector} in the markup`);
  return node;
};

/* ------------------------------------------------------------------ *
 * Hero: "Upcoming" over the season and "calendar", the mark written across
 * ------------------------------------------------------------------ */

need('[data-cal-hero-year]').textContent = `${season} calendar`;

/* The reference's signature is a Rive file written on as the page arrives.
   Ours is the site's mark, written by the pen the other pages use, in the
   accent the reference draws its own in. Under reduced motion the CSS mask
   shows it whole and none of this runs. */
const heroSign = need('[data-cal-hero-sign]');
if (!reducedMotion) {
  heroSign.classList.add('is-writing');
  fetch('/assets/brand/signature.svg')
    .then((res) => {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.text();
    })
    .then((markup) => {
      const ink = getComputedStyle(heroSign).getPropertyValue('--accent').trim();
      const pen = new Signature(heroSign, markup, ink);
      new ResizeObserver(() => pen.resize()).observe(heroSign);
      const progress = { p: 0 };
      void document.fonts.ready.then(() =>
        gsap.to(progress, {
          p: 1,
          delay: 0.4,
          duration: 1.65,
          ease: 'sine.out',
          onUpdate: () => {
            pen.progress = progress.p;
          },
        }),
      );
    })
    .catch((err: unknown) => {
      // Decorative: the mask comes back and the hero is complete without it.
      heroSign.classList.remove('is-writing');
      console.error('[calendar] signature failed to load', err);
    });
}

/* ------------------------------------------------------------------ *
 * The season's title row: a line of copy, his standing, the round
 * ------------------------------------------------------------------ */

const upcoming = nextRound();
const run = calendar.filter((r) => r.result).length;
need('[data-cal-lede]').textContent = !run
  ? `The ${season} Formula 1 season is about to begin, view Lewis's schedule below.`
  : upcoming
    ? "The Formula 1 season is underway, view Lewis's schedule below."
    : `The ${season} Formula 1 season is complete, view Lewis's results below.`;

/* His championship place and the round it stands after -- the round the
   standings were last fetched at, so the two figures describe one moment.
   Before a season's first result there is no place to state. */
const standing = seasons.find((s) => s.year === season);
const after = provenance.latestRace.season === String(season) ? provenance.latestRace.round : null;
if (standing && after) {
  const [figure, letters] = place(standing.position);
  need('[data-cal-standing]').textContent = figure;
  need('[data-cal-standing-suffix]').textContent = letters;
  need('[data-cal-round]').textContent = after;
} else {
  need('[data-cal-standings]').hidden = true;
}

/* The two buttons are in-page links; with the smooth scroller they travel
   through it, and keyboard readers land on the thing they asked for. */
for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-cal-jump]')) {
  link.addEventListener('click', (event) => {
    const id = link.hash.slice(1);
    const target = id ? document.getElementById(id) : null;
    if (!target) return;
    event.preventDefault();
    if (smoothScroller) smoothScroller.scrollTo(target, { duration: 1.2 });
    else target.scrollIntoView();
    target.focus({ preventScroll: true });
    history.replaceState(null, '', link.hash);
  });
}

/* ------------------------------------------------------------------ *
 * The sections
 * ------------------------------------------------------------------ */

mountSeason(need('.cal-sched'), smoothScroller);
mountResults(need('.cal-results'));
mountCountdown(need('[data-countdown]'));

/* ------------------------------------------------------------------ *
 * Chrome, reveals, and the entrance
 * ------------------------------------------------------------------ */

mountChrome();

mountReveals({
  immediate: '.cal-hero',
  whenReady: (runReveals) => void document.fonts.ready.then(runReveals),
});

void document.fonts.ready.then(() => {
  for (const block of document.querySelectorAll<HTMLElement>('[data-oval-scroll]')) {
    mountOvalScroll(block);
  }
  document.body.classList.add('is-ready');
  ScrollTrigger.refresh();
});
