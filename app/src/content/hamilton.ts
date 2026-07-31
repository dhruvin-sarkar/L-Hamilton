/**
 * The one source of truth for Hamilton data.
 *
 * Split deliberately into two halves, because they have different truth values:
 *
 *   STABLE   — biography, team tenure, championship years. These do not change
 *              race to race and are safe to hold here.
 *   VOLATILE — career totals. Hamilton is racing *right now*; every one of these
 *              moves on a race weekend. They are marked `verified: false` and
 *              carry a `lastUpdated`, and the UI must surface that rather than
 *              presenting them as settled fact.
 *
 * See docs/CONTENT-DATA.md. Do not hardcode a number anywhere else in the app.
 */

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
   * False until a live fetch has replaced these. Public sources disagreed by
   * several wins/poles/podiums at the time of writing, partly because they were
   * published between different 2026 races and partly because they count
   * non-classified finishes differently.
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
 * Placeholder totals. Deliberately zeroed and explicitly unverified — these
 * exist so the UI has a shape to render, NOT so they can ship. `live-stats.ts`
 * replaces them at build time.
 */
export const careerTotals: CareerTotals = {
  starts: 0,
  wins: 0,
  podiums: 0,
  poles: 0,
  fastestLaps: 0,
  points: 0,
  championships: championshipYears.length, // the one total that is stable
  lastUpdated: '1970-01-01',
  verified: false,
};

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
