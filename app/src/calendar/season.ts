/**
 * The season: the round panel with its track visualiser, every round already
 * run, and every round still to come.
 *
 * The reference's mechanics, read off its script and measured on its page:
 *
 *   - the panel shows the next round on arrival; its arrows step through every
 *     round of the season, wrapping at either end;
 *   - every value in the panel sits in a clip with an accent bar over it. On
 *     the panel's first arrival the clips open left to right and the bars
 *     retract; a swap closes the clips (0.5s, power2.in), rewrites the values,
 *     and opens them again the same way;
 *   - for a round already run the schedule's last two columns become his
 *     result in each session and his time or gap, and the UK-time note goes;
 *   - a row sends the panel to its round and scrolls the page to it, 8rem
 *     above its top, over 1.2s on an ease-in-out quad;
 *   - over each list a card follows the pointer, 20px right of it and 20px up:
 *     the round's picture over the rounds run, its circuit over those to come.
 *
 * Rows are buttons, so every round is reachable from the keyboard; the
 * reference's are clickable divs with no keyboard path.
 */

import type Lenis from 'lenis';
import { gsap, mm, reducedMotion, ScrollTrigger } from '../lib/motion';
import { hasTrack, mountCircuit } from '../lib/circuit';
import {
  el,
  monthAbbr,
  ordinal,
  place,
  raceDay,
  sessionWhen,
  spell,
  weekendSessions,
  weekendSpan,
} from '../lib/schedule';
import type { SessionKind } from '../lib/schedule';
import { calendar, circuitById, nextRound, roundStart } from '../content/live-stats';
import type { CalendarRound, RoundResult } from '../content/live-stats';
import { countryName, flagUrl } from '../content/countries';
import { circuitFacts, formatKm } from '../content/circuit-facts';
import { roundPhoto } from '../content/calendar-media';
import type { TrackMap } from '../lib/track3d';

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ------------------------------------------------------------------ *
 * Words for a round
 * ------------------------------------------------------------------ */

/** The reference names the Emirates' round by its emirate, as the sport does. */
const LIST_NAMES: Readonly<Record<string, string>> = { UAE: 'Abu Dhabi' };

/** A national Grand Prix carries its country's name: Italian, Spanish, United
    States -- and the British. */
function isNational(named: string, country: string): boolean {
  return named === 'British' || named.slice(0, 3).toLowerCase() === country.slice(0, 3).toLowerCase();
}

/**
 * Where a round is, as the reference's lists name it: the host country --
 * MEXICO, BRAZIL -- unless the country holds more than one Grand Prix that
 * season, when the race's own name tells them apart and the national race
 * keeps the country's: MIAMI, UNITED STATES, LAS VEGAS; EMILIA ROMAGNA,
 * ITALY. `season` is every round of the round's year. Derived from the race
 * names and countries in the record, not typed.
 */
export function placeName(
  round: Pick<CalendarRound, 'raceName' | 'country'>,
  season: readonly Pick<CalendarRound, 'country'>[],
): string {
  const country = countryName(round.country);
  const named = round.raceName.replace(/ Grand Prix.*$/, '');
  const shared = season.filter((other) => other.country === round.country).length > 1;
  if (shared && !isNational(named, country)) return named;
  return LIST_NAMES[round.country] ?? country;
}

/** An ordinal's raised letters: in the accent for a win, grey otherwise --
    the reference's `c-lime` and `c-grey-on-track` on its `is-super`. */
export function suffixClass(position: number): string {
  return `ot-cal__suffix cal-row__suffix${position === 1 ? ' cal-row__suffix--win' : ''}`;
}

/** A classification the way a timing screen prints it: 4TH, DNF, DSQ. */
export function finishText(positionText: string): string {
  const n = Number(positionText);
  if (Number.isInteger(n) && n > 0) return ordinal(n);
  const codes: Record<string, string> = { R: 'DNF', D: 'DSQ', E: 'DSQ', W: 'DNS', F: 'DNQ', N: 'NC' };
  const code = codes[positionText];
  if (!code) throw new Error(`[calendar] unknown classification "${positionText}"`);
  return code;
}

/** "retired from 4th on the grid", "finished 6th from 4th on the grid". */
function outcomeOf(result: RoundResult): string {
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
 * number from the data layer said in words -- the rule On Track follows.
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

/** His result and time in one session of a weekend already run. */
function sessionResult(kind: SessionKind, result: RoundResult): { place: string; time: string } {
  const dash = '–';
  switch (kind) {
    case 'race':
      return { place: finishText(result.positionText), time: result.time ?? dash };
    case 'qualifying':
      return {
        place: result.qualifying?.position ? ordinal(result.qualifying.position) : dash,
        time: result.qualifying?.time ?? dash,
      };
    case 'sprint':
      return result.sprint
        ? { place: finishText(result.sprint.positionText), time: result.sprint.time ?? dash }
        : { place: dash, time: dash };
    default:
      /* Practice and sprint qualifying are not classified in the record the
         site is built on (Jolpica carries qualifying, sprint and race results
         only), so those sessions read as a dash rather than as a figure from
         somewhere else. */
      return { place: dash, time: dash };
  }
}

/** The accent strike over a round already run: two brush strokes, our own. */
function strike(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'cal-row__strike');
  svg.setAttribute('viewBox', '0 0 69 33');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of ['M3 29C18 20 36 12 66 4', 'M20 25C32 19 44 14 55 11']) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '4.5');
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
  }
  return svg;
}

/* ------------------------------------------------------------------ *
 * The section
 * ------------------------------------------------------------------ */

export function mountSeason(section: HTMLElement, scroller: Lenis | null): void {
  const need = <T extends Element = HTMLElement>(selector: string): T => {
    const node = section.querySelector<T>(selector);
    if (!node) throw new Error(`[calendar] no ${selector} in the markup`);
    return node;
  };

  const panel = need('[data-cal-panel]');
  const live = need('[data-cal-live]');
  const glHost = need('[data-cal-gl]');
  const sessionsHost = need('[data-cal-sessions]');
  const nameNode = need('[data-cal-name]');
  const note = need('[data-cal-note]');
  const pastHeads = [...section.querySelectorAll<HTMLElement>('[data-cal-past]')];
  const previousList = need('[data-cal-previous]');
  const upcomingList = need('[data-cal-upcoming]');

  const rounds = calendar;
  const upcoming = nextRound();
  let current = upcoming ? rounds.indexOf(upcoming) : rounds.length - 1;

  /** Run, by the clock: a round is past the moment it starts. Its result may
      trail that until the record is fetched again. */
  const now = Date.now();
  const isPast = (round: CalendarRound): boolean => roundStart(round).getTime() <= now;

  const roundAt = (index: number): CalendarRound => {
    const round = rounds[index];
    if (!round) throw new Error(`[calendar] no round at index ${index}`);
    return round;
  };

  /* ------------------------------------------------------ Swap targets */

  /** Wraps each value in its clip and bar, closed until the panel arrives.
      All the wrapping first, then one set over the clips and one over the
      bars: a set per value, between insertions, made gsap read styles the
      insertion had just invalidated -- a forced style recalculation per
      value, 312ms of the page's start on a 4x-throttled phone. */
  const wrap = (targets: Iterable<Element>): void => {
    const made: { clips: HTMLElement[]; bars: HTMLElement[] } = { clips: [], bars: [] };
    for (const target of targets) {
      const clip = el('div', 'ot-cal__t');
      const bar = el('div', 'ot-cal__t-bar');
      target.before(clip);
      clip.append(target, bar);
      made.clips.push(clip);
      made.bars.push(bar);
    }
    if (!reducedMotion && made.clips.length) {
      gsap.set(made.clips, { clipPath: 'inset(0 100% 0 0)' });
      gsap.set(made.bars, { scaleX: 1 });
    }
  };

  wrap(panel.querySelectorAll('[data-cal-target]'));

  const clips = (): HTMLElement[] => [...panel.querySelectorAll<HTMLElement>('.ot-cal__t')];
  const bars = (): HTMLElement[] => [...panel.querySelectorAll<HTMLElement>('.ot-cal__t-bar')];

  /* ------------------------------------------------ Track visualiser */

  /* Every change of round turns the map forward, arrows or rows alike -- the
     reference's calendar sets its circuit the one way.

     The map is the page's one WebGL scene, and three.js is most of the page's
     script. Both wait: the module is fetched and the map mounted once the
     document has loaded (the loader panel covers the page until then, so the
     map is up before the page is shown) and the panel is within a screen of
     the viewport. Neither stands between the reader and the first paint, and
     a phone that never scrolls to the panel never builds a context. Until it
     mounts, a change of round only records the circuit; the map opens on it. */
  let map: TrackMap | null = null;
  let mapCircuit = roundAt(current).circuitId;
  const showOnMap = (circuitId: string): void => {
    mapCircuit = circuitId;
    map?.show(circuitId);
  };

  const loaded = new Promise<void>((resolve) => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', () => resolve(), { once: true });
  });
  const approach = new IntersectionObserver(
    ([entry]) => {
      if (!entry?.isIntersecting) return;
      approach.disconnect();
      void loaded
        .then(() => import('../lib/track3d'))
        .then(({ mountTrackMap }) => {
          map = mountTrackMap(glHost, mapCircuit);
        })
        .catch((error: unknown) => console.error('[calendar] the track map did not load', error));
    },
    { rootMargin: '100% 0px' },
  );
  approach.observe(glHost);

  /* ------------------------------------------------------ The values */

  const setText = (selector: string, value: string): void => {
    need(selector).textContent = value;
  };

  const setStat = (selector: string, value: string, unit = ''): void => {
    const node = need(selector);
    node.replaceChildren(el('span', 'ot-cal__stat-value', value));
    if (unit) node.appendChild(el('span', 'ot-cal__stat-unit', unit));
  };

  /** Shrinks a name too long for the tab -- the frame's tab is ~29rem tall. */
  const fitName = (): void => {
    nameNode.style.removeProperty('--name-scale');
    const style = getComputedStyle(nameNode);
    if (!style.writingMode.startsWith('vertical')) return;
    const room = (Number.parseFloat(style.fontSize) / 4.5) * 25;
    const height = nameNode.getBoundingClientRect().height;
    if (height > room) nameNode.style.setProperty('--name-scale', (room / height).toFixed(3));
  };
  void document.fonts.ready.then(fitName);
  window.addEventListener('resize', fitName);

  const fill = (round: CalendarRound): void => {
    const record = circuitById.get(round.circuitId);
    const facts = circuitFacts(round);
    const span = weekendSpan(round);

    setText('[data-cal-days]', span.days);
    setText('[data-cal-month]', span.month);

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

    /* A round already run and recorded shows his sessions; one to come, or
       one run but not yet in the record, shows the timetable. */
    const result = round.result;
    for (const head of pastHeads) head.hidden = !result;
    note.hidden = Boolean(result);

    sessionsHost.replaceChildren();
    const rows: HTMLElement[] = [];
    for (const { kind, label, session } of weekendSessions(round)) {
      const race = kind === 'race';
      const row = el('p', race ? 'ot-cal__session ot-cal__session--race' : 'ot-cal__session');
      if (result) {
        const done = sessionResult(kind, result);
        row.append(el('span', undefined, label), el('span', undefined, done.place), el('span', undefined, done.time));
      } else {
        const when = sessionWhen(session);
        row.append(
          el('span', undefined, label),
          el('span', undefined, `${when.day} ${monthAbbr(when.month)}`),
          el('span', undefined, when.time),
        );
      }
      sessionsHost.appendChild(row);
      rows.push(row);
    }
    wrap(rows);
  };

  /* ----------------------------------------------------------- Rows */

  const rowFor = (round: CalendarRound, index: number): HTMLButtonElement => {
    const past = isPast(round);
    const facts = circuitFacts(round);
    const name = placeName(round, rounds);

    const row = el('button', `ot-cal__row cal-row ${past ? 'cal-row--past' : 'cal-row--next'}`);
    row.type = 'button';
    row.setAttribute('aria-controls', panel.id);

    const cell = (className = 'ot-cal__cell'): HTMLSpanElement => {
      const node = el('span', className);
      row.appendChild(node);
      return node;
    };

    /* Round, struck through once it has been run. */
    const roundCell = cell('ot-cal__cell cal-row__round');
    const roundBox = el('span', 'cal-row__round-w');
    roundBox.appendChild(el('span', 'ot-cal__major', String(round.round).padStart(2, '0')));
    if (past) roundBox.appendChild(strike());
    roundCell.appendChild(roundBox);

    const location = cell();
    location.appendChild(el('span', 'ot-cal__major ot-cal__nowrap', name));
    const flag = el('img', 'ot-cal__row-flag');
    flag.src = flagUrl(round.country);
    flag.alt = '';
    flag.width = 34;
    flag.height = 23;
    /* The lists sit below the panel: their flags are not the first screen's,
       and fetched eagerly they held the load event -- and so the loader's
       reveal -- behind two dozen requests. */
    flag.loading = 'lazy';
    location.appendChild(flag);

    let label: string;
    if (past) {
      /* Race day, his finish, his fastest lap. */
      const day = raceDay(round.date);
      cell().append(
        el('span', 'ot-cal__major', day.dayMonth),
        el('span', 'ot-cal__major', day.year),
      );

      const finish = cell('ot-cal__cell cal-row__finish');
      const result = round.result;
      if (result?.position) {
        const [figure, letters] = place(result.position);
        const placed = el('span', 'cal-row__place');
        placed.append(el('span', 'ot-cal__major', figure), el('span', suffixClass(result.position), letters));
        finish.appendChild(placed);
        /* A podium's trophy, tinted for the step (calendar.css). */
        if (result.position <= 3) finish.appendChild(el('span', `cal-row__trophy cal-row__trophy--p${result.position}`));
      } else {
        finish.appendChild(el('span', 'ot-cal__major', result ? finishText(result.positionText) : 'TBC'));
      }

      const lap = cell('ot-cal__cell ot-cal__cell--unit');
      const fastest = result?.fastestLap ?? null;
      lap.append(el('span', 'ot-cal__reg', fastest ?? '-'));
      if (fastest) lap.append(el('span', 'ot-cal__unit', 's'));

      label =
        `Round ${round.round}, ${round.raceName}, ${day.dayMonth} ${round.season}. ` +
        (result
          ? `He ${outcomeOf(result)}${fastest ? `, fastest lap ${fastest}` : ''}.`
          : 'Result not yet recorded.');
    } else {
      const span = weekendSpan(round);
      cell().append(
        el('span', 'ot-cal__major', span.days),
        el('span', 'ot-cal__major ot-cal__month', span.month),
      );
      cell().appendChild(el('span', 'ot-cal__major', String(facts.laps)));
      const distance = formatKm(facts.raceDistanceKm);
      cell('ot-cal__cell ot-cal__cell--unit').append(
        el('span', 'ot-cal__reg', distance),
        el('span', 'ot-cal__unit', 'km'),
      );
      label =
        `Round ${round.round}, ${round.raceName}, ${name}, ${span.days} ${span.month}, ` +
        `${facts.laps} laps, ${distance} km.${round === upcoming ? ' Next race.' : ''}`;
    }
    row.setAttribute('aria-label', label);

    row.append(el('span', 'ot-cal__rule'), el('span', 'ot-cal__row-bar'));
    row.addEventListener('click', () => {
      show(index, true);
      travelToPanel();
    });
    return row;
  };

  const buttons = rounds.map((round, index) => {
    const row = rowFor(round, index);
    const item = el('li');
    item.appendChild(row);
    (isPast(round) ? previousList : upcomingList).appendChild(item);
    return row;
  });

  /* A list with nothing in it -- before the first round, after the last --
     steps aside rather than showing a header over no rows. */
  need('[data-cal-previous-wrap]').hidden = previousList.childElementCount === 0;
  need('[data-cal-upcoming-wrap]').hidden = upcomingList.childElementCount === 0;

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
    showOnMap(round.circuitId);
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
    if (scroller) {
      scroller.scrollTo(top, {
        duration: 1.2,
        easing: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
      });
    } else {
      window.scrollTo({ top, behavior: 'auto' });
    }
    panel.focus({ preventScroll: true });
  };

  /* ------------------------------------------------- Row entrance */

  /* The reference's stat-list reveal: one timeline per list, fired when the
     list's hover ground reaches 90% of the screen, each row opening from the
     left 0.05s after the one above (0.6s power2.out) and its accent bar
     retracting 0.3s into that (0.6s power2.inOut). */
  if (!reducedMotion) {
    const lists: [HTMLElement, HTMLElement][] = [
      [previousList, need('[data-cal-previous-wrap]')],
      [upcomingList, need('[data-cal-upcoming-wrap] [data-cal-area]')],
    ];
    for (const [list, ground] of lists) {
      const rows = [...list.querySelectorAll<HTMLElement>('.ot-cal__row')];
      if (!rows.length) continue;
      const rowBars = rows.map((row) => row.querySelector('.ot-cal__row-bar'));
      gsap.set(rows, { clipPath: 'inset(0 100% 0 0)' });
      gsap.set(rowBars, { scaleX: 1 });
      const enter = gsap.timeline({ scrollTrigger: { trigger: ground, start: 'top 90%', once: true } });
      rows.forEach((row, i) => {
        enter.to(row, { clipPath: 'inset(0 0% 0 0)', duration: 0.6, ease: 'power2.out' }, i * 0.05);
        enter.to(rowBars[i] ?? [], { scaleX: 0, duration: 0.6, ease: 'power2.inOut' }, i * 0.05 + 0.3);
      });
    }
  }

  /* ----------------------------------------------------- Hover cards */

  mm.add('(min-width: 992px) and (prefers-reduced-motion: no-preference)', () => {
    const cleanups = [
      mountCard(need('[data-cal-previous-wrap]'), buttons, rounds, 'photo'),
      mountCard(need('[data-cal-upcoming-wrap]'), buttons, rounds, 'circuit'),
    ];
    return () => {
      for (const done of cleanups) done();
    };
  });
}

/* ------------------------------------------------------------------ *
 * The card that follows the pointer over a list
 *
 * Pointer-only and wide-only, as the reference's is (display:none below
 * 992px): a decoration over rows whose content is one click away in the panel.
 * Tracked from the document's pointer position rather than from enter/leave on
 * the rows, so it follows through the gaps, and re-checked on scroll so a still
 * pointer over a moving list stays right. On On Track's measurements: in over
 * 0.8s with the accent curtain lifting after it, out twice as fast, following
 * on a 0.5s power2.out.
 * ------------------------------------------------------------------ */

function mountCard(
  wrap: HTMLElement,
  buttons: HTMLButtonElement[],
  rounds: CalendarRound[],
  kind: 'photo' | 'circuit',
): () => void {
  const area = wrap.matches('[data-cal-area]') ? wrap : wrap.querySelector<HTMLElement>('[data-cal-area]');
  const card = wrap.querySelector<HTMLElement>('[data-cal-card]');
  const reveal = wrap.querySelector<HTMLElement>('[data-cal-card-reveal]');
  if (!area || !card || !reveal) throw new Error('[calendar] a list has lost its hover card');

  gsap.set(card, { clipPath: 'ellipse(120% 0% at 50% 0%)', autoAlpha: 0, x: 0, y: 0 });
  gsap.set(reveal, { clipPath: 'ellipse(120% 120% at 50% 100%)' });
  const appear = gsap
    .timeline({ paused: true })
    .to(card, { clipPath: 'ellipse(120% 120% at 50% 0%)', autoAlpha: 1, duration: 0.8, ease: 'power2.out' })
    .to(reveal, { clipPath: 'ellipse(120% 0% at 50% 100%)', duration: 0.6, ease: 'power2.out' }, '-=0.4');
  const toX = gsap.quickTo(card, 'x', { duration: 0.5, ease: 'power2.out' });
  const toY = gsap.quickTo(card, 'y', { duration: 0.5, ease: 'power2.out' });

  /* What the card shows for a row. */
  let draw: (round: CalendarRound) => void;
  let dispose = (): void => {};

  if (kind === 'photo') {
    const frame = card.querySelector<HTMLElement>('[data-cal-card-photo]');
    if (!frame) throw new Error('[calendar] the photo card has no frame');
    const img = el('img', 'cal-card__img');
    img.alt = '';
    img.width = 330;
    img.height = 394;
    img.decoding = 'async';
    frame.appendChild(img);
    draw = (round) => {
      const src = roundPhoto(round);
      if (img.getAttribute('src') !== src) img.src = src;
    };
    dispose = () => img.remove();
  } else {
    const shapeHost = card.querySelector<HTMLElement>('[data-cal-card-circuit]');
    if (!shapeHost) throw new Error('[calendar] the circuit card has no shape host');
    type Circuit = Awaited<ReturnType<typeof mountCircuit>>;
    const firstDrawable = rounds.find((r) => hasTrack(r.circuitId));
    let shape: Promise<Circuit> | null = firstDrawable
      ? mountCircuit(shapeHost, { circuitId: firstDrawable.circuitId, ground: 'light' })
      : null;
    shape?.catch((error: unknown) => {
      console.warn('[calendar] card circuit did not load', error);
      shape = null;
    });
    draw = (round) => {
      const drawable = hasTrack(round.circuitId);
      shapeHost.classList.toggle('is-empty', !drawable);
      if (drawable && shape) {
        void shape.then((handle) => shapeHost.classList.toggle('is-empty', !handle.select(round.circuitId)));
      }
    };
    dispose = () => void shape?.then((handle) => handle.destroy());
  }

  let pointer: { x: number; y: number } | null = null;
  let over = false;
  let near = false;

  const follow = (): void => {
    if (!pointer || !near) return;
    const box = area.getBoundingClientRect();
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
    const round = rounds[index];
    if (round) draw(round);
  };
  const watch = new IntersectionObserver(([entry]) => {
    near = entry?.isIntersecting ?? false;
  });

  watch.observe(area);
  document.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('scroll', follow, { passive: true });
  area.addEventListener('pointerover', onOver);

  return () => {
    watch.disconnect();
    document.removeEventListener('pointermove', onMove);
    window.removeEventListener('scroll', follow);
    area.removeEventListener('pointerover', onOver);
    appear.kill();
    dispose();
  };
}
