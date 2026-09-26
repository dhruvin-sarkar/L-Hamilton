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
  /** Not classified and not disqualified: retirements. */
  dnfs: number;
  /** Struck from the result, whatever position he crossed the line in. */
  disqualifications: number;
  /** Races classified, and the sum of those finishing positions. */
  finishes: number;
  finishPositionSum: number;
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
  disqualifications: number;
  /** Mean finishing position over classified Grands Prix, to two places. */
  averageFinish: number;
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
  'points', 'sprintWins', 'dnfs', 'disqualifications', 'averageFinish', 'championships',
  'seasonsContested',
] as const;

const REQUIRED_SEASON = [
  'year', 'position', 'points', 'entries', 'wins', 'podiums', 'poles',
  'qualifyingWins', 'fastestLaps', 'sprintWins', 'dnfs', 'disqualifications', 'finishes',
  'finishPositionSum',
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
    disqualifications: row.disqualifications as number,
    finishes: row.finishes as number,
    finishPositionSum: row.finishPositionSum as number,
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

/* Every career total is the sum of its seasons. The generator derives them
   that way; checking it here catches a hand-edit or a partial write that
   changed one side and not the other. Points are compared to two places,
   because half-points seasons (2009, 2021) make the sum a float. */
{
  const total = (key: keyof CareerSeason): number =>
    seasons.reduce((n, s) => n + (s[key] as number), 0);
  const pairs: [keyof CareerRecord, number][] = [
    ['starts', total('entries')],
    ['wins', total('wins')],
    ['podiums', total('podiums')],
    ['poles', total('poles')],
    ['qualifyingWins', total('qualifyingWins')],
    ['fastestLaps', total('fastestLaps')],
    ['sprintWins', total('sprintWins')],
    ['dnfs', total('dnfs')],
    ['disqualifications', total('disqualifications')],
    ['points', Number(total('points').toFixed(2))],
  ];
  for (const [key, summed] of pairs) {
    if (career[key] !== summed) fail(`totals.${key} is ${career[key]} but the seasons sum to ${summed}`);
  }
}

/* Every race he entered is exactly one of classified, retired or
   disqualified. A season where they do not add up has lost or double-counted
   a result. */
for (const s of seasons) {
  if (s.finishes + s.dnfs + s.disqualifications !== s.entries) {
    fail(
      `${s.year}: ${s.finishes} classified + ${s.dnfs} DNF + ${s.disqualifications} DSQ ` +
        `does not make ${s.entries} entries`,
    );
  }
}

{
  const finishes = seasons.reduce((n, s) => n + s.finishes, 0);
  const positions = seasons.reduce((n, s) => n + s.finishPositionSum, 0);
  const average = Number((positions / finishes).toFixed(2));
  if (average !== career.averageFinish) {
    fail(`totals.averageFinish is ${career.averageFinish} but the seasons average to ${average}`);
  }
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

/* ------------------------------------------------------------------ *
 * Wins, circuits and the season calendar
 *
 * Same file, same validation discipline. These are shaped by the generator and
 * narrowed here; anything malformed throws at load rather than reaching a
 * component as undefined.
 * ------------------------------------------------------------------ */

export interface Win {
  season: number;
  round: number;
  raceName: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  circuitId: string;
  circuitName: string;
  country: string;
  locality: string;
  team: string;
  teamId: string;
  grid: number;
  laps: number;
  /** The winner's race time, e.g. "1:32:28.105". Null if the source lacked it. */
  raceTime: string | null;
  fastestLap: string | null;
  fromPole: boolean;
}

export interface CircuitRecord {
  id: string;
  name: string;
  country: string;
  locality: string;
  starts: number;
  wins: number;
  podiums: number;
  poles: number;
  bestFinish: number | null;
  firstRaced: number;
  lastRaced: number;
  /** Longest race he has completed here — the scheduled distance, inferred. */
  laps: number;
}

export interface RaceSession {
  date: string;
  time: string | null;
}

export interface RoundResult {
  position: number | null;
  positionText: string;
  points: number;
  grid: number;
  status: string;
}

export interface CalendarRound {
  season: number;
  round: number;
  raceName: string;
  circuitId: string;
  circuitName: string;
  country: string;
  locality: string;
  date: string;
  /** "13:00:00Z", or null where the source has no start time. */
  time: string | null;
  sessions: {
    practice1: RaceSession | null;
    practice2: RaceSession | null;
    practice3: RaceSession | null;
    /** Sprint weekends only. */
    sprintQualifying: RaceSession | null;
    qualifying: RaceSession | null;
    sprint: RaceSession | null;
  };
  /** Null until the round has been run. */
  result: RoundResult | null;
}

/* Every field of every record is read through a check, so the objects that
   leave this module are built here, field by field, rather than passed through
   from the JSON with a cast. A renamed or dropped field upstream throws at load
   instead of reaching a component as undefined. */

type Fields = Record<string, unknown>;

function list(value: unknown, where: string): Fields[] {
  if (!Array.isArray(value) || value.length === 0) fail(`${where} is empty or not an array`);
  return value.map((item, i) => {
    if (!item || typeof item !== 'object') fail(`${where}[${i}] is not an object`);
    return item as Fields;
  });
}

function textOrNull(value: unknown, where: string): string | null {
  return value === null ? null : text(value, where);
}

function numberOrNull(value: unknown, where: string): number | null {
  return value === null ? null : number(value, where);
}

function flag(value: unknown, where: string): boolean {
  if (typeof value !== 'boolean') fail(`${where} is ${JSON.stringify(value)}, expected a boolean`);
  return value;
}

/** YYYY-MM-DD, as the source writes every date. */
function isoDate(value: unknown, where: string): string {
  const date = text(value, where);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`${where} is "${date}", expected YYYY-MM-DD`);
  return date;
}

function raceSession(value: unknown, where: string): RaceSession | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object') fail(`${where} is not a session or null`);
  const s = value as Fields;
  return { date: isoDate(s.date, `${where}.date`), time: textOrNull(s.time, `${where}.time`) };
}

export const wins: Win[] = list(raw.wins, 'wins').map((w, i) => {
  const at = `wins[${i}]`;
  return {
    season: number(w.season, `${at}.season`),
    round: number(w.round, `${at}.round`),
    raceName: text(w.raceName, `${at}.raceName`),
    date: isoDate(w.date, `${at}.date`),
    circuitId: text(w.circuitId, `${at}.circuitId`),
    circuitName: text(w.circuitName, `${at}.circuitName`),
    country: text(w.country, `${at}.country`),
    locality: text(w.locality, `${at}.locality`),
    team: text(w.team, `${at}.team`),
    teamId: text(w.teamId, `${at}.teamId`),
    grid: number(w.grid, `${at}.grid`),
    laps: number(w.laps, `${at}.laps`),
    raceTime: textOrNull(w.raceTime, `${at}.raceTime`),
    fastestLap: textOrNull(w.fastestLap, `${at}.fastestLap`),
    fromPole: flag(w.fromPole, `${at}.fromPole`),
  };
});

if (wins.length !== career.wins) {
  fail(`totals.wins is ${career.wins} but the wins list has ${wins.length} entries`);
}

export const circuits: CircuitRecord[] = list(raw.circuits, 'circuits').map((c, i) => {
  const at = `circuits[${i}]`;
  return {
    id: text(c.id, `${at}.id`),
    name: text(c.name, `${at}.name`),
    country: text(c.country, `${at}.country`),
    locality: text(c.locality, `${at}.locality`),
    starts: number(c.starts, `${at}.starts`),
    wins: number(c.wins, `${at}.wins`),
    podiums: number(c.podiums, `${at}.podiums`),
    poles: number(c.poles, `${at}.poles`),
    bestFinish: numberOrNull(c.bestFinish, `${at}.bestFinish`),
    firstRaced: number(c.firstRaced, `${at}.firstRaced`),
    lastRaced: number(c.lastRaced, `${at}.lastRaced`),
    laps: number(c.laps, `${at}.laps`),
  };
});

/* The circuit record is a second fold of the same results, so it must add up
   to the career: every start, win, podium and pole happened somewhere. */
for (const key of ['starts', 'wins', 'podiums', 'poles'] as const) {
  const summed = circuits.reduce((n, c) => n + c[key], 0);
  if (summed !== career[key]) {
    fail(`the circuit records sum to ${summed} ${key}, but totals.${key} is ${career[key]}`);
  }
}

export const circuitById: ReadonlyMap<string, CircuitRecord> = new Map(
  circuits.map((c) => [c.id, c]),
);

export const calendar: CalendarRound[] = list(raw.calendar, 'calendar').map((r, i) => {
  const at = `calendar[${i}]`;
  if (!r.sessions || typeof r.sessions !== 'object') fail(`${at}.sessions is missing`);
  const s = r.sessions as Fields;
  let result: RoundResult | null = null;
  if (r.result !== null) {
    if (!r.result || typeof r.result !== 'object') fail(`${at}.result is not a result or null`);
    const x = r.result as Fields;
    result = {
      position: numberOrNull(x.position, `${at}.result.position`),
      positionText: text(x.positionText, `${at}.result.positionText`),
      points: number(x.points, `${at}.result.points`),
      grid: number(x.grid, `${at}.result.grid`),
      status: text(x.status, `${at}.result.status`),
    };
  }
  return {
    season: number(r.season, `${at}.season`),
    round: number(r.round, `${at}.round`),
    raceName: text(r.raceName, `${at}.raceName`),
    circuitId: text(r.circuitId, `${at}.circuitId`),
    circuitName: text(r.circuitName, `${at}.circuitName`),
    country: text(r.country, `${at}.country`),
    locality: text(r.locality, `${at}.locality`),
    date: isoDate(r.date, `${at}.date`),
    time: textOrNull(r.time, `${at}.time`),
    sessions: {
      practice1: raceSession(s.practice1, `${at}.sessions.practice1`),
      practice2: raceSession(s.practice2, `${at}.sessions.practice2`),
      practice3: raceSession(s.practice3, `${at}.sessions.practice3`),
      sprintQualifying: raceSession(s.sprintQualifying, `${at}.sessions.sprintQualifying`),
      qualifying: raceSession(s.qualifying, `${at}.sessions.qualifying`),
      sprint: raceSession(s.sprint, `${at}.sessions.sprint`),
    },
    result,
  };
});

/* One season, in round order. The countdown and "next round" take the first
   round whose start is still ahead, which is only right if they are sorted. */
calendar.forEach((r, i) => {
  if (String(r.season) !== provenance.latestRace.season) {
    fail(`calendar[${i}] is ${r.season}, but the record is current through ${provenance.latestRace.season}`);
  }
  const previous = calendar[i - 1];
  if (previous && r.round !== previous.round + 1) {
    fail(`calendar[${i}] is round ${r.round}, expected ${previous.round + 1}`);
  }
});

/**
 * When a round actually starts, as a real instant.
 *
 * The source splits date and time and marks the time UTC. Combining them into
 * one ISO string is what makes the comparison below correct across time zones:
 * parsing the bare date alone would resolve to local midnight and put a race up
 * to a day on the wrong side of "now".
 */
export function roundStart(round: CalendarRound): Date {
  return new Date(round.time ? `${round.date}T${round.time}` : `${round.date}T00:00:00Z`);
}

/**
 * The next round that has not yet started, by the clock — NOT by whether a
 * result has been recorded.
 *
 * Those two differ for most of a race weekend: a round is in the past the
 * moment it is run, but its result does not reach this file until the record is
 * fetched again. Going by the clock keeps the countdown and the schedule right
 * between fetches instead of pointing at a race that has already happened.
 */
export function nextRound(now: Date = new Date()): CalendarRound | null {
  return calendar.find((r) => roundStart(r).getTime() > now.getTime()) ?? null;
}

/** The most recent round already started. Null before the season opens. */
export function lastRound(now: Date = new Date()): CalendarRound | null {
  const past = calendar.filter((r) => roundStart(r).getTime() <= now.getTime());
  return past.length ? (past[past.length - 1] as CalendarRound) : null;
}

/** Wins newest-first — the order a results feed reads in. */
export const winsNewestFirst: Win[] = [...wins].reverse();
