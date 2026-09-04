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

import { career, provenance } from './live-stats';

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
