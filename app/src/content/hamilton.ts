/**
 * The one source of truth for Hamilton data.
 *
 * Split deliberately into two halves, because they have different truth values:
 *
 *   STABLE   — biography, team tenure, championship years. These do not change
 *              race to race and are safe to hold here.
 *   VOLATILE — career totals. Hamilton is racing *right now*; every one of these
 *              moves on a race weekend. They are NOT written here: they come
 *              from `live-stats.ts`, which validates the record fetched from the
 *              Jolpica-F1 API, and they carry a `lastUpdated` the UI must
 *              surface rather than presenting them as settled fact.
 *
 * See docs/CONTENT-DATA.md. Do not hardcode a number anywhere else in the app.
 */

import { career, provenance, wins } from './live-stats';
import type { Win } from './live-stats';

export type TeamId = 'mclaren' | 'mercedes' | 'ferrari';

export interface Era {
  id: TeamId;
  team: string;
  from: number;
  to: number | null; // null = ongoing
  blurb: string;
}

export interface Season {
  year: number;
  team: TeamId;
  /** Championship finishing position. */
  position: number | null;
  points: number;
  wins: number;
  podiums: number;
  poles: number;
  isChampion: boolean;
}

export interface CareerTotals {
  starts: number;
  wins: number;
  podiums: number;
  poles: number;
  fastestLaps: number;
  points: number;
  championships: number;
  /** ISO 8601 date. Render this near any figure below. */
  lastUpdated: string;
  /**
   * True once these are traceable to the live structured source and have passed
   * the generator's and loader's cross-checks. It is not a claim that a human
   * has confirmed them: published tallies still disagree by a few
   * wins/poles/podiums, partly because they were published between different
   * 2026 races and partly because they count non-classified finishes — and
   * sprint-era poles — differently.
   */
  verified: boolean;
}

/* ------------------------------------------------------------------ *
 * Stable
 * ------------------------------------------------------------------ */

export const driver = {
  firstName: 'Lewis',
  lastName: 'Hamilton',
  fullName: 'Lewis Carl Davidson Hamilton',
  dateOfBirth: '1985-01-07',
  birthplace: 'Stevenage, UK',
  nationality: 'British',
  number: 44,
  currentTeam: 'Ferrari',
  debutYear: 2007,
} as const;

export const eras: Era[] = [
  {
    id: 'mclaren',
    team: 'McLaren',
    from: 2007,
    to: 2012,
    blurb: 'Rookie season to championship contender. A title in his second year.',
  },
  {
    id: 'mercedes',
    team: 'Mercedes',
    from: 2013,
    to: 2024,
    blurb: 'Twelve seasons, six championships, and the most decorated run in the sport.',
  },
  {
    id: 'ferrari',
    team: 'Ferrari',
    from: 2025,
    to: null,
    blurb: 'The move that reshaped the grid. Still being written.',
  },
];

/** The seven title years — stable, and the spine of the career narrative. */
export const championshipYears = [2008, 2014, 2015, 2017, 2018, 2019, 2020] as const;

/**
 * The pre-Formula 1 championship record — 1995 to 2006.
 *
 * Stable, and held here rather than fetched, because unlike the career totals
 * these cannot move: a 1995 cadet karting title is settled. The API cannot
 * supply them either — Jolpica covers Formula 1 only.
 *
 * The list is not a selection of highlights. It is a rule: **every championship
 * he finished first or second in before reaching Formula 1**, which is why the
 * two runners-up are here beside the ten titles and why nothing that is not a
 * championship is. His one-off international wins — the 2000 Karting World Cup
 * at Suzuka, the 2004 Bahrain Superprix, the 2005 Masters of Formula 3 — are
 * not, because folding one-off events into a list of championships would make
 * the list mean nothing.
 *
 * Every entry carries the source it was verified against. CONTENT-DATA.md:
 * every number must come from a real source and be traceable.
 */
export interface JuniorChampionship {
  year: number;
  /** The championship, as its organiser names it. */
  series: string;
  /** The class contested. Null where the championship has only one. */
  category: string | null;
  /**
   * The championship as the pre-F1 grid prints it, before "champion" or
   * "2nd place" -- the reference's own register ("renault 2.0 eurocup
   * champion"), so two lines at most. The class is kept where it fits and
   * dropped where it would push the label to a third line; the year printed
   * beneath tells a series won twice apart. `category` keeps the full record.
   */
  label: string;
  /** The entrant. Null through the karting years, where it is not recorded. */
  team: string | null;
  /** 1 or 2 — the list holds only those, by the rule above. */
  position: 1 | 2;
  /** Third-person site copy. Never a quote, never a number without a source. */
  note: string | null;
  source: string;
}

export const preF1Championships: JuniorChampionship[] = [
  {
    year: 1995,
    series: 'Super One National Championship',
    label: 'Super One Comer Cadet',
    category: 'Comer Cadet',
    team: null,
    position: 1,
    note: 'The youngest winner of the British cadet title, at ten years old.',
    source: 'https://en.wikipedia.org/wiki/Lewis_Hamilton',
  },
  {
    year: 1995,
    series: 'STP Karting Championship',
    label: 'STP Karting',
    category: null,
    team: null,
    position: 1,
    note: null,
    source: 'https://www.racefans.net/lewis-hamilton/',
  },
  {
    year: 1996,
    series: 'Champions of the Future',
    label: 'Champions of the Future',
    category: 'MSA British Cadet',
    team: null,
    position: 1,
    note: null,
    source: 'https://en.wikipedia.org/wiki/Formula_Kart_Stars',
  },
  {
    year: 1996,
    series: 'Five Nations Championship',
    label: 'Five Nations Cadet',
    category: 'Cadet',
    team: null,
    position: 1,
    note: null,
    source: 'https://www.racefans.net/lewis-hamilton/',
  },
  {
    year: 1997,
    series: 'Super One National Championship',
    label: 'Super One Junior Yamaha',
    category: 'Junior Yamaha',
    team: null,
    position: 1,
    note: null,
    source: 'https://en.wikipedia.org/wiki/Lewis_Hamilton',
  },
  {
    year: 1997,
    series: 'Champions of the Future',
    label: 'Champions of the Future',
    category: 'Formula Yamaha',
    team: null,
    position: 1,
    note: null,
    source: 'https://en.wikipedia.org/wiki/Formula_Kart_Stars',
  },
  {
    year: 1998,
    series: 'Champions of the Future',
    label: 'Champions of the Future',
    category: 'Junior Intercontinental A',
    team: null,
    position: 2,
    note: null,
    source: 'https://www.racefans.net/lewis-hamilton/',
  },
  {
    year: 1999,
    series: 'CIK-FIA Karting European Championship',
    label: 'CIK-FIA European ICA Junior',
    category: 'ICA-Junior',
    team: null,
    position: 2,
    note: 'Beaten to the title by Reinhard Kofler.',
    source: 'https://www.fiakarting.com/history/1999',
  },
  {
    year: 2000,
    series: 'CIK-FIA Karting European Championship',
    label: 'CIK-FIA European Formula A',
    category: 'Formula A',
    team: 'Team MBM.com',
    position: 1,
    note: "Seventy-five points to Nico Rosberg's fifty-one.",
    source: 'https://en.wikipedia.org/wiki/Karting_European_Championship',
  },
  {
    year: 2003,
    series: 'Formula Renault 2.0 UK Championship',
    label: 'Formula Renault 2.0 UK',
    category: null,
    team: 'Manor Motorsport',
    position: 1,
    note: 'Ten wins, eleven poles and nine fastest laps.',
    source: 'https://en.wikipedia.org/wiki/British_Formula_Renault_Championship',
  },
  {
    year: 2005,
    series: 'Formula 3 Euro Series',
    label: 'Formula 3 Euro Series',
    category: null,
    team: 'ASM Formule 3',
    position: 1,
    note: 'Fifteen wins from twenty races, and thirteen poles.',
    source: 'https://en.wikipedia.org/wiki/2005_Formula_3_Euro_Series',
  },
  {
    year: 2006,
    series: 'GP2 Series',
    label: 'GP2 Series',
    category: null,
    team: 'ART Grand Prix',
    position: 1,
    note: 'Champion at the first attempt, ahead of Nelson Piquet Jr.',
    source: 'https://en.wikipedia.org/wiki/2006_GP2_Series',
  },
];

/** Championships won before Formula 1. Counted, never typed. */
export const preF1Titles: number = preF1Championships.filter((c) => c.position === 1).length;

/** The span the list covers, derived so the heading cannot drift from the data. */
export const preF1Span: { from: number; to: number } = {
  from: Math.min(...preF1Championships.map((c) => c.year)),
  to: Math.max(...preF1Championships.map((c) => c.year)),
};

/* ------------------------------------------------------------------ *
 * Volatile
 * ------------------------------------------------------------------ */

/**
 * Sourced, no longer placeholder. `live-stats.ts` reads the generated record
 * that `tools/fetch-stats.mjs` derives from the Jolpica-F1 API, and this is the
 * projection of it onto the shape the rest of the app already consumed.
 *
 * `verified: true` here means *traceable to a live structured source and
 * internally cross-checked* — not that a human has signed it off. Two checks
 * earn it: the generator counts wins and fastest laps by two independent routes
 * and refuses to write on a mismatch, and `live-stats.ts` asserts that the
 * seasons finishing P1 are exactly the years `championshipYears` declares
 * above. CONTENT-DATA.md still asks for human re-verification before launch and
 * after every race weekend.
 */
export const careerTotals: CareerTotals = {
  starts: career.starts,
  wins: career.wins,
  podiums: career.podiums,
  poles: career.poles,
  fastestLaps: career.fastestLaps,
  points: career.points,
  championships: career.championships,
  lastUpdated: provenance.fetchedAt.slice(0, 10),
  verified: true,
};

/**
 * What the totals are current through. Render this near any stat block — the
 * figures move on a race weekend, and a bare number implies a permanence it
 * does not have.
 */
export const statsCurrentThrough = provenance.latestRace;

/* ------------------------------------------------------------------ *
 * F1 result highlights
 * ------------------------------------------------------------------ */

/**
 * The Grands Prix On Track lists under "F1 result highlights".
 *
 * The reference fills that block with every win its driver has, which is
 * seven. Hamilton has more than a hundred, so the same seven rows are a
 * selection -- and the selection is all this file holds: a season and a round.
 * The venue, the date and the race time each row prints are read off the
 * fetched wins record, and a pick that matches no win there throws at load
 * rather than rendering a row nobody can trace.
 *
 * `photo` is the picture that follows the cursor over the row, and every one
 * below is a PLACEHOLDER from the site's own gallery until photography of the
 * race itself is supplied. `trophy` is the drawing beside the finish: the
 * reference draws each race's own trophy, and until those are supplied every
 * row carries the same cup, drawn for this site. Swapping either is a change to
 * one path here and nowhere else.
 */
interface HighlightPick {
  season: number;
  round: number;
  photo: string;
  trophy: string;
}

const TROPHY = '/assets/highlights/trophy.svg';

const HIGHLIGHT_PICKS: readonly HighlightPick[] = [
  // His first win with Ferrari.
  { season: 2026, round: 7, photo: '/assets/gallery/gallery-04.webp', trophy: TROPHY },
  // From tenth on the grid, after being sent to the back of the sprint.
  { season: 2021, round: 19, photo: '/assets/gallery/gallery-11.webp', trophy: TROPHY },
  // The win that sealed his seventh world title.
  { season: 2020, round: 14, photo: '/assets/gallery/gallery-01.webp', trophy: TROPHY },
  // Win number 92, which took the all-time record.
  { season: 2020, round: 12, photo: '/assets/gallery/gallery-09.webp', trophy: TROPHY },
  // From fourteenth on the grid, the furthest back he has ever won from.
  { season: 2018, round: 11, photo: '/assets/gallery/gallery-10.webp', trophy: TROPHY },
  // Silverstone in the wet, won by more than a minute.
  { season: 2008, round: 9, photo: '/assets/gallery/gallery-07.webp', trophy: TROPHY },
  // His first Grand Prix win.
  { season: 2007, round: 6, photo: '/assets/gallery/gallery-03.webp', trophy: TROPHY },
];

export interface ResultHighlight {
  win: Win;
  /** The winner's race time, required here: a highlight row prints it. */
  time: string;
  photo: string;
  trophy: string;
}

/** The picks resolved against the record, newest first as the reference lists them. */
export const resultHighlights: readonly ResultHighlight[] = HIGHLIGHT_PICKS.map((pick) => {
  const win = wins.find((w) => w.season === pick.season && w.round === pick.round);
  const where = `result highlight ${pick.season} round ${pick.round}`;
  if (!win) throw new Error(`[content] ${where} is not a win in career.json`);
  if (!win.raceTime) throw new Error(`[content] ${where} has no race time in career.json`);
  return { win, time: win.raceTime, photo: pick.photo, trophy: pick.trophy };
}).sort((a, b) => b.win.date.localeCompare(a.win.date));

/* ------------------------------------------------------------------ *
 * Derived
 * ------------------------------------------------------------------ */

/** Age from date of birth. Never hardcode an age — it is wrong within a year. */
export function age(on: Date = new Date()): number {
  const dob = new Date(driver.dateOfBirth);
  let years = on.getFullYear() - dob.getFullYear();
  const monthDelta = on.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && on.getDate() < dob.getDate())) years--;
  return years;
}

/** Seasons contested, inclusive of the current one. */
export function seasonsRacing(on: Date = new Date()): number {
  return on.getFullYear() - driver.debutYear + 1;
}

export function eraFor(year: number): Era | undefined {
  return eras.find((e) => year >= e.from && (e.to === null || year <= e.to));
}
