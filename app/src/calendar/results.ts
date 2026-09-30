/**
 * All results, season by season: the calendar page's third section.
 *
 * The reference's mechanics, read off its script (its `data-calendar-history`
 * accordion) and its styles:
 *
 *   - one row per season, newest first: a chevron, the year, the championship
 *     place -- a closed laurel beside a title (in the accent) or a runner-up
 *     (in grey) -- and the podium count;
 *   - a row opens its season on a click: a sub-header, then every Grand Prix
 *     of that year with its round, place and flag, date, finish (with the
 *     step's trophy on a podium) and his fastest lap. Opening is instant, and
 *     closes whichever season was open;
 *   - if the opened season's top is off screen or below 30% of it, the page
 *     is brought to it, 100px above its top, over 0.5s;
 *   - an open row, and a row under the pointer, fill with the accent and turn
 *     their ink black.
 *
 * Only finished seasons are listed, as on the reference, which runs 2025 back
 * to 2019 while its 2026 is under way: the season in progress already has
 * its rounds in the lists above. Nineteen seasons where the reference has
 * seven -- the same rows, more of them. Every figure comes from the
 * race-by-race record (live-stats `races`) and the season table
 * (`seasonsNewestFirst`); none is typed here.
 *
 * The rows are real disclosure buttons inside headings, so the keyboard and a
 * screen reader get the accordion the reference builds out of divs.
 */

import type Lenis from 'lenis';
import { gsap, mm, ScrollTrigger } from '../lib/motion';
import { el, pad2, place, raceDay } from '../lib/schedule';
import { closedReef, drawClosedReef } from '../lib/closed-reef';
import { calendar, races, seasonsNewestFirst } from '../content/live-stats';
import type { CareerSeason, RaceEntry } from '../content/live-stats';
import { flagUrl } from '../content/countries';
import { finishText, placeName, suffixClass } from './season';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The chevron: our own heavy caret, drawn pointing up. calendar.css turns it
    half round while its season is shut, as the reference turns its glyph, so
    a shut season points down and an open one up. */
function chevron(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'cal-results__chevron');
  svg.setAttribute('viewBox', '0 0 28 19');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M2.5 16 14 4.5 25.5 16');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '6');
  svg.appendChild(path);
  return svg;
}

/** A figure and its raised letters: 1ST, 12TH. */
function placed(n: number, className = 'cal-row__place'): HTMLSpanElement {
  const [figure, letters] = place(n);
  const node = el('span', className);
  node.append(el('span', 'ot-cal__major', figure), el('span', suffixClass(n), letters));
  return node;
}

/** One Grand Prix inside an open season. */
function raceRow(race: RaceEntry, season: readonly RaceEntry[]): HTMLLIElement {
  const item = el('li');
  const row = el('div', 'ot-cal__row cal-results__race');

  const round = el('span', 'ot-cal__cell');
  round.appendChild(el('span', 'cal-results__round ot-cal__major', pad2(race.round)));

  const name = placeName(race, season);
  const location = el('span', 'ot-cal__cell');
  location.appendChild(el('span', 'ot-cal__major ot-cal__nowrap', name));
  const flag = el('img', 'ot-cal__row-flag');
  flag.src = flagUrl(race.country);
  flag.alt = '';
  flag.width = 34;
  flag.height = 23;
  flag.loading = 'lazy';
  location.appendChild(flag);

  const day = raceDay(race.date);
  const when = el('span', 'ot-cal__cell');
  when.append(el('span', 'ot-cal__major', day.dayMonth), el('span', 'ot-cal__major', day.year));

  const finish = el('span', 'ot-cal__cell cal-row__finish');
  if (race.position && /^\d+$/.test(race.positionText)) {
    finish.appendChild(placed(race.position));
    if (race.position <= 3) finish.appendChild(el('span', `cal-row__trophy cal-row__trophy--p${race.position}`));
  } else {
    finish.appendChild(el('span', 'ot-cal__major', finishText(race.positionText)));
  }

  const lap = el('span', 'ot-cal__cell ot-cal__cell--unit');
  lap.appendChild(el('span', 'ot-cal__reg', race.fastestLap ?? '-'));
  if (race.fastestLap) lap.appendChild(el('span', 'ot-cal__unit', 's'));

  row.append(round, location, when, finish, lap, el('span', 'ot-cal__rule'));
  item.appendChild(row);
  return item;
}

interface Season {
  item: HTMLLIElement;
  trigger: HTMLButtonElement;
  content: HTMLElement;
}

export function mountResults(section: HTMLElement, scroller: Lenis | null): void {
  const list = section.querySelector<HTMLElement>('[data-cal-seasons]');
  const para = section.querySelector<HTMLElement>('[data-cal-results-para]');
  if (!list || !para) throw new Error('[calendar] the results section has lost its list or its copy');

  const bySeason = new Map<number, RaceEntry[]>();
  for (const race of races) {
    const year = bySeason.get(race.season) ?? [];
    year.push(race);
    bySeason.set(race.season, year);
  }

  /* The calendar's season is finished once every round has a result. */
  const current = calendar[0]?.season;
  const underway = calendar.some((round) => !round.result);
  const finished = seasonsNewestFirst.filter((season) => !(underway && season.year === current));
  const newest = finished[0];
  const first = finished[finished.length - 1];
  if (!newest || !first) throw new Error('[calendar] no finished seasons in the record');
  const starts = races.filter((race) => race.season <= newest.year).length;
  para.textContent = `Lewis's ${starts} Grands Prix from ${first.year} to ${newest.year}. Open a season for every result.`;

  const wreaths: { mark: HTMLElement; branches: ReturnType<typeof closedReef>['branches'] }[] = [];

  const seasons: Season[] = finished.map((season: CareerSeason) => {
    const entries = bySeason.get(season.year);
    if (!entries?.length) throw new Error(`[calendar] no races recorded for ${season.year}`);
    if (entries.length !== season.entries) {
      throw new Error(
        `[calendar] ${season.year} has ${entries.length} races in the record but ${season.entries} entries in the season table`,
      );
    }

    const item = el('li', 'cal-results__item');
    const heading = el('h3', 'cal-results__heading');
    const trigger = el('button', 'ot-cal__row cal-results__trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-expanded', 'false');

    const chevronCell = el('span', 'cal-results__chevron-w');
    chevronCell.appendChild(chevron());

    const year = el('span', 'ot-cal__cell cal-results__year');
    year.appendChild(el('span', 'ot-cal__major', String(season.year)));

    const finish = el('span', 'ot-cal__cell cal-row__finish');
    finish.appendChild(placed(season.position));
    if (season.position <= 2) {
      const { svg, branches } = closedReef();
      const mark = el('span', `cal-results__reef cal-results__reef--p${season.position}`);
      mark.appendChild(svg);
      finish.appendChild(mark);
      wreaths.push({ mark, branches });
    }

    const podiums = el('span', 'ot-cal__cell');
    podiums.appendChild(el('span', 'ot-cal__major', String(season.podiums)));

    trigger.append(chevronCell, year, finish, podiums, el('span', 'cal-results__line'));

    trigger.setAttribute(
      'aria-label',
      `${season.year}, ${season.team}: ${place(season.position).join('')} in the championship, ` +
        `${season.podiums} podium${season.podiums === 1 ? '' : 's'}.`,
    );
    heading.appendChild(trigger);

    const content = el('div', 'cal-results__content');
    content.id = `cal-results-${season.year}`;
    content.hidden = true;
    content.setAttribute('role', 'region');
    content.setAttribute('aria-label', `${season.year} results`);
    trigger.setAttribute('aria-controls', content.id);

    const head = el('div', 'ot-cal__row ot-cal__row--head cal-results__subhead');
    head.setAttribute('aria-hidden', 'true');
    for (const label of ['Round', 'Location', 'Finish', 'Fastest lap']) {
      head.appendChild(el('p', 'ot-cal__eyebrow', label));
    }
    const racesList = el('ol', 'ot-cal__list cal-results__races');
    for (const race of entries) racesList.appendChild(raceRow(race, entries));
    content.append(head, racesList);

    item.append(heading, content);
    list.appendChild(item);
    return { item, trigger, content };
  });

  /* ------------------------------------------------------------ Opening */

  const setOpen = (season: Season, open: boolean): void => {
    season.item.classList.toggle('is-open', open);
    season.trigger.setAttribute('aria-expanded', String(open));
    season.content.hidden = !open;
  };

  const toggle = (season: Season): void => {
    const opening = season.content.hidden;
    for (const other of seasons) if (other !== season && !other.content.hidden) setOpen(other, false);
    setOpen(season, opening);
    /* The page below has moved; everything triggered by scroll re-measures. */
    ScrollTrigger.refresh();
    if (!opening) return;
    requestAnimationFrame(() => {
      const top = season.item.getBoundingClientRect().top;
      if (top >= 0 && top <= window.innerHeight * 0.3) return;
      if (scroller) scroller.scrollTo(season.item, { offset: -100, duration: 0.5 });
      else season.item.scrollIntoView({ block: 'start' });
    });
  };

  for (const season of seasons) season.trigger.addEventListener('click', () => toggle(season));

  /* The laurels grow once each as they come on screen, as the reference's
     Rive wreaths play; full-grown and still under reduced motion. */
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    const tweens = wreaths.map(({ mark, branches }) => {
      const growth = { g: 0 };
      drawClosedReef(branches, 0);
      return gsap.to(growth, {
        g: 1,
        duration: 1.1,
        ease: 'power2.out',
        onUpdate: () => drawClosedReef(branches, growth.g),
        scrollTrigger: { trigger: mark, start: 'top 80%', once: true },
      });
    });
    return () => {
      for (const tween of tweens) tween.kill();
      for (const { branches } of wreaths) drawClosedReef(branches, 1);
    };
  });
}
