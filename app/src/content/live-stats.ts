/**
 * The live-stats layer that `hamilton.ts` has always pointed at.
 *
 * `generated/career.json` is written by `tools/fetch-stats.mjs` from the
 * Jolpica-F1 API. This module is the only thing that reads it: it validates the
 * payload, narrows it to typed values, and throws on anything malformed.
 *
 * Why validate a file we generate ourselves? Because the generator runs against
 * a live third-party API on a different day to the build. A schema change
 * upstream, a truncated write, or a hand-edit would otherwise reach the page as
 * `undefined` and render as blank or NaN. CLAUDE.md: "If race or season data is
 * missing or malformed, throw and surface it in dev — never silently render
 * zeroes."
 */

import raw from './generated/career.json';

export interface CareerSeason {
  year: number;
  team: string;
  teamId: string;
  /** Championship finishing position. */
  position: number;
  points: number;
  /** Races entered. Includes retirements and non-classified finishes. */
  entries: number;
  wins: number;
  podiums: number;
  poles: number;
  /** Raw qualifying-session wins — differs from `poles` in 2021/22. */
  qualifyingWins: number;
  fastestLaps: number;
  sprintWins: number;
  dnfs: number;
  /** Derived, not sourced: position === 1. */
  isChampion: boolean;
}

export interface CareerRecord {
  starts: number;
  wins: number;
  podiums: number;
  poles: number;
  qualifyingWins: number;
  fastestLaps: number;
  points: number;
  sprintWins: number;
  dnfs: number;
  championships: number;
  seasonsContested: number;
}

export interface StatsProvenance {
  api: string;
  /** ISO 8601. Render this near any figure — the totals move every race. */
  fetchedAt: string;
  polesDefinition: string;
  latestRace: { season: string; round: string; name: string; date: string };
}

const REQUIRED_TOTALS = [
  'starts', 'wins', 'podiums', 'poles', 'qualifyingWins', 'fastestLaps',
  'points', 'sprintWins', 'dnfs', 'championships', 'seasonsContested',
] as const;

const REQUIRED_SEASON = [
  'year', 'position', 'points', 'entries', 'wins', 'podiums', 'poles',
  'qualifyingWins', 'fastestLaps', 'sprintWins', 'dnfs',
] as const;

function fail(what: string): never {
  throw new Error(
    `career.json is unusable: ${what}. Run \`npm run fetch-stats\` to regenerate it.`,
  );
}

function number(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${where} is ${JSON.stringify(value)}, expected a finite number`);
  }
  return value;
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${where} is ${JSON.stringify(value)}, expected a non-empty string`);
  }
  return value;
}

/* ------------------------------------------------------------------ *
 * Validate once, at module load — so a bad payload fails the page
 * immediately and visibly rather than at whichever component reads it first.
 * ------------------------------------------------------------------ */

if (!raw || typeof raw !== 'object') fail('the payload is not an object');
if (!Array.isArray(raw.seasons) || raw.seasons.length === 0) fail('seasons is empty');

export const provenance: StatsProvenance = {
  api: text(raw.source?.api, 'source.api'),
  fetchedAt: text(raw.source?.fetchedAt, 'source.fetchedAt'),
  polesDefinition: text(raw.source?.polesDefinition, 'source.polesDefinition'),
  latestRace: {
    season: text(raw.source?.latestRace?.season, 'source.latestRace.season'),
    round: text(raw.source?.latestRace?.round, 'source.latestRace.round'),
    name: text(raw.source?.latestRace?.name, 'source.latestRace.name'),
    date: text(raw.source?.latestRace?.date, 'source.latestRace.date'),
  },
};

export const career: CareerRecord = Object.fromEntries(
  REQUIRED_TOTALS.map((k) => [
    k,
    number((raw.totals as Record<string, unknown>)?.[k], `totals.${k}`),
  ]),
) as unknown as CareerRecord;

export const seasons: CareerSeason[] = raw.seasons.map((s, i) => {
  const row = s as Record<string, unknown>;
  for (const k of REQUIRED_SEASON) number(row[k], `seasons[${i}].${k}`);
  const position = row.position as number;
  return {
    year: row.year as number,
    team: text(row.team, `seasons[${i}].team`),
    teamId: text(row.teamId, `seasons[${i}].teamId`),
    position,
    points: row.points as number,
    entries: row.entries as number,
    wins: row.wins as number,
    podiums: row.podiums as number,
    poles: row.poles as number,
    qualifyingWins: row.qualifyingWins as number,
    fastestLaps: row.fastestLaps as number,
    sprintWins: row.sprintWins as number,
    dnfs: row.dnfs as number,
    isChampion: position === 1,
  };
});

/* ------------------------------------------------------------------ *
 * Cross-checks the generator cannot make, because they compare the fetched
 * record against the site's own stable constants.
 * ------------------------------------------------------------------ */

const championSeasons = seasons.filter((s) => s.isChampion).map((s) => s.year);

if (championSeasons.length !== career.championships) {
  fail(
    `totals.championships is ${career.championships} but ${championSeasons.length} ` +
      `seasons have position 1 (${championSeasons.join(', ')})`,
  );
}

if (seasons.length !== career.seasonsContested) {
  fail(`totals.seasonsContested is ${career.seasonsContested} but ${seasons.length} seasons exist`);
}

/** The title years, derived from results rather than declared. */
export const championshipYears: readonly number[] = championSeasons;

/** Seasons newest-first — the order every table on the site renders in. */
export const seasonsNewestFirst: CareerSeason[] = [...seasons].reverse();

/** Seasons grouped by team, in career order. Drives the era-tagged table. */
export const seasonsByTeam: { teamId: string; team: string; seasons: CareerSeason[] }[] =
  seasons.reduce<{ teamId: string; team: string; seasons: CareerSeason[] }[]>((groups, season) => {
    const last = groups[groups.length - 1];
    if (last && last.teamId === season.teamId) last.seasons.push(season);
    else groups.push({ teamId: season.teamId, team: season.team, seasons: [season] });
    return groups;
  }, []);

/** Best championship finish that was not a title — for "runner-up" style copy. */
export const bestNonTitleFinish: number = Math.min(
  ...seasons.filter((s) => !s.isChampion).map((s) => s.position),
);

/**
 * How stale the figures are, in whole days. The UI surfaces this rather than
 * presenting a race-weekend-sensitive number as settled fact.
 */
export function daysSinceFetch(now: Date = new Date()): number {
  const then = new Date(provenance.fetchedAt).getTime();
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}
