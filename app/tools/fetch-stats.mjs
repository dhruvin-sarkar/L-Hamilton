/**
 * Build-time fetch of Hamilton's career record from the Jolpica-F1 API.
 *
 * CONTENT-DATA.md names Jolpica (`api.jolpi.ca/ergast/f1`, the maintained
 * successor to the retired Ergast) as the primary structured source, and
 * CLAUDE.md forbids hand-typing any number. So nothing here is transcribed:
 * every figure is either counted from the race-by-race record or read from the
 * official season standings.
 *
 * Two deliberate sourcing choices:
 *
 *   POINTS come from `driverStandings`, not from summing race results. The
 *   standings are the championship's own arithmetic — they already include
 *   sprint points and any post-race penalty revision. Summing the results
 *   ourselves would drift from the official total without saying so.
 *
 *   WINS / PODIUMS / POLES / FASTEST LAPS are counted from the full result and
 *   qualifying records rather than read from a summary endpoint, so the same
 *   pass yields both the career total and the per-season breakdown, and the two
 *   cannot disagree with each other.
 *
 * Fails loudly. Any non-200, any season that returns no standing, any drop in a
 * career total versus what is already committed, and this throws rather than
 * writing a file — CONTENT-DATA.md rule 4, "never silently fall back to stale
 * hardcoded numbers presented as current".
 *
 * Run:  npm run fetch-stats
 * Out:  src/content/generated/career.json
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const API = 'https://api.jolpi.ca/ergast/f1';
const DRIVER = 'hamilton';
const DEBUT = 2007;

/**
 * What counts as a pole position — the record books' rule, not the qualifying
 * session's.
 *
 * The record books (formula1.com, Wikipedia, StatsF1) credit pole to the driver
 * who STARTS the Grand Prix from the front of the grid, so a grid penalty or a
 * qualifying exclusion moves the pole with it. Counting qualifying-session P1s
 * instead overstated Hamilton by one, and the difference is three races:
 *
 *   2007 Hungary  qualified 2nd; Alonso was penalised and Hamilton started
 *                 first. A pole in the record books, not in the session.
 *   2012 Spain    fastest, then excluded from qualifying for a fuel breach;
 *                 Maldonado started first and holds the pole.
 *   2021 Turkey   fastest, then a ten-place engine penalty; Bottas started
 *                 first and holds the pole.
 *
 * formula1.com's driver page prints the same figure twice — "Pole Positions"
 * and "Highest Grid Position: 1 (x N)" — which is this rule stated outright.
 *
 * The grid also covers 2021's sprint weekends, where the sprint set the grid
 * and its winner was credited with pole. It does NOT cover 2022's: the sprint
 * still set the grid, but pole went to the fastest in qualifying (Magnussen's
 * 2022 São Paulo pole, from which he started the Grand Prix eighth). From 2023
 * the Grand Prix grid comes from Grand Prix qualifying again, so the grid rule
 * applies unchanged.
 *
 * `qualifyingWins` is still emitted, raw, because it answers a different
 * question — who topped the session — and neither is a correction of the other.
 */
const QUALIFYING_POLE_SPRINT_SEASONS = new Set([2022]);
const POLES_DEFINITION =
  'Pole = started the Grand Prix from the front of the grid, as the record books ' +
  'count it, so grid penalties and qualifying exclusions move the pole with them. ' +
  'On 2022 sprint weekends, pole went to the fastest qualifier instead.';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'src', 'content', 'generated', 'career.json');

/** Jolpica allows a burst of a few requests a second. Stay well under it. */
const THROTTLE_MS = 260;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let requests = 0;

async function get(pathname, params = {}) {
  const url = new URL(`${API}/${pathname}.json`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  if (requests++) await sleep(THROTTLE_MS);
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} from ${url}`);
  }
  const body = await res.json();
  if (!body?.MRData) throw new Error(`Response from ${url} has no MRData envelope`);
  return body.MRData;
}

/**
 * Walk every page of a paginated collection.
 *
 * Ergast caps `limit` at 100, and the driver has more than 100 races, so a
 * single request silently truncates. `total` is authoritative; we keep going
 * until we have it and then assert we did, rather than trusting the loop.
 */
async function getAll(pathname, extract, params = {}) {
  const limit = 100;
  const out = [];
  let total = null;

  for (let offset = 0; total === null || offset < total; offset += limit) {
    const data = await get(pathname, { ...params, limit, offset });
    total = Number(data.total);
    if (!Number.isFinite(total)) throw new Error(`No usable total for ${pathname}`);
    out.push(...extract(data));
    if (total === 0) break;
  }

  if (out.length !== total) {
    throw new Error(`Paged ${pathname}: collected ${out.length}, API reported ${total}`);
  }
  return out;
}

const races = (d) => d.RaceTable.Races;

/** Ergast marks non-classified finishes with a letter, e.g. "R" (retired), "D". */
const finishedPosition = (positionText) => {
  const n = Number(positionText);
  return Number.isInteger(n) ? n : null;
};

/**
 * A Grand Prix result's classified finishing position, or null.
 *
 * `positionText` alone is not enough: the source is inconsistent about
 * disqualifications. 2009 Australia and 2025 China carry "D", but 2023 United
 * States — disqualified from second for plank wear — carries "19" with status
 * "Disqualified". Read literally that is a classified 19th, which is not what
 * happened. A disqualified driver is not classified, whatever the text says.
 */
const DISQUALIFIED = 'Disqualified';
const classifiedPosition = (result) =>
  result.status === DISQUALIFIED ? null : finishedPosition(result.positionText);

async function main() {
  console.log('Fetching Hamilton career record from Jolpica-F1…');

  // --- the race-by-race record ------------------------------------------
  const results = await getAll(`drivers/${DRIVER}/results`, races);
  const qualiAll = await getAll(`drivers/${DRIVER}/qualifying`, races);
  const sprintsAll = await getAll(`drivers/${DRIVER}/sprint`, races);

  // Only weekends whose Grand Prix is already in the record. Qualifying and the
  // sprint run a day or two before the race, so mid-weekend the source holds
  // sessions for a round that has no result yet. Folding them in would make the
  // totals current through half a weekend while `latestRace` says otherwise,
  // and a season opener's Saturday would bucket a season with no standing.
  const raceKey = (r) => `${r.season}-${r.round}`;
  const racedKeys = new Set(results.map(raceKey));
  const quali = qualiAll.filter((r) => racedKeys.has(raceKey(r)));
  const sprints = sprintsAll.filter((r) => racedKeys.has(raceKey(r)));
  const pending = qualiAll.length - quali.length + (sprintsAll.length - sprints.length);
  console.log(
    `  ${results.length} entries, ${quali.length} qualifying, ${sprints.length} sprints` +
      (pending ? ` (${pending} session(s) from a weekend not yet raced, held back)` : ''),
  );

  const latest = results[results.length - 1];
  const latestSeason = Number(latest.season);

  // --- per-season standings ---------------------------------------------
  const standings = new Map();
  for (let year = DEBUT; year <= latestSeason; year++) {
    const data = await get(`${year}/drivers/${DRIVER}/driverstandings`);
    const list = data.StandingsTable?.StandingsLists?.[0];
    const row = list?.DriverStandings?.[0];
    if (!row) throw new Error(`No ${year} standing for ${DRIVER} — cannot derive that season`);
    const team = row.Constructors[row.Constructors.length - 1];
    standings.set(year, {
      position: finishedPosition(row.positionText),
      points: Number(row.points),
      constructor: team.name,
      constructorId: team.constructorId,
      throughRound: Number(list.round),
    });
  }
  console.log(`  ${standings.size} seasons of standings, ${DEBUT}–${latestSeason}`);

  // --- fold the record into per-season buckets --------------------------
  const seasons = new Map();
  const bucket = (year) => {
    if (!seasons.has(year)) {
      seasons.set(year, {
        year,
        entries: 0, wins: 0, podiums: 0, poles: 0, qualifyingWins: 0,
        fastestLaps: 0, sprintWins: 0,
        // Not classified, split the way the sport splits it: a DNF did not
        // finish; a disqualification may have finished and been struck out.
        dnfs: 0, disqualifications: 0,
        // Classified finishes and the sum of their positions: the two halves of
        // the average finish, kept per season so the average can be re-derived.
        finishes: 0, finishPositionSum: 0,
      });
    }
    return seasons.get(year);
  };

  // The pole rule (see POLES_DEFINITION) needs two facts per weekend: whether a
  // sprint ran, and whether he topped qualifying.
  const sprintWeekends = new Set(sprints.map(raceKey));
  const qualifiedFirst = new Set(
    quali
      .filter((race) => finishedPosition(race.QualifyingResults[0].position) === 1)
      .map(raceKey),
  );
  const isQualifyingPoleWeekend = (race) =>
    QUALIFYING_POLE_SPRINT_SEASONS.has(Number(race.season)) && sprintWeekends.has(raceKey(race));
  const tookPole = (race) =>
    isQualifyingPoleWeekend(race)
      ? qualifiedFirst.has(raceKey(race))
      : Number(race.Results[0].grid) === 1;

  for (const race of results) {
    const r = race.Results[0];
    const b = bucket(Number(race.season));
    const pos = classifiedPosition(r);
    b.entries++;
    if (pos === 1) b.wins++;
    if (pos !== null && pos <= 3) b.podiums++;
    if (tookPole(race)) b.poles++;
    if (r.status === DISQUALIFIED) b.disqualifications++;
    else if (pos === null) b.dnfs++;
    if (pos !== null) {
      b.finishes++;
      b.finishPositionSum += pos;
    }
    // `rank` is the fastest-lap rank across the field; "1" is the fastest lap.
    if (r.FastestLap?.rank === '1') b.fastestLaps++;
  }

  for (const race of sprints) {
    if (finishedPosition(race.SprintResults[0].positionText) !== 1) continue;
    bucket(Number(race.season)).sprintWins++;
  }

  for (const race of quali) {
    if (qualifiedFirst.has(raceKey(race))) bucket(Number(race.season)).qualifyingWins++;
  }

  // --- merge, and sanity-check every season ------------------------------
  const seasonRows = [...seasons.values()]
    .sort((a, b) => a.year - b.year)
    .map((s) => {
      const st = standings.get(s.year);
      if (!st) throw new Error(`Season ${s.year} has results but no standing`);
      return {
        ...s,
        position: st.position,
        points: st.points,
        team: st.constructor,
        teamId: st.constructorId,
      };
    });

  const expectedSeasons = latestSeason - DEBUT + 1;
  if (seasonRows.length !== expectedSeasons) {
    throw new Error(
      `Expected ${expectedSeasons} seasons (${DEBUT}–${latestSeason}), derived ${seasonRows.length}`,
    );
  }

  const sum = (key) => seasonRows.reduce((n, s) => n + s[key], 0);

  const totals = {
    starts: results.length,
    wins: sum('wins'),
    podiums: sum('podiums'),
    poles: sum('poles'),
    qualifyingWins: sum('qualifyingWins'),
    fastestLaps: sum('fastestLaps'),
    points: Number(sum('points').toFixed(2)),
    sprintWins: sum('sprintWins'),
    dnfs: sum('dnfs'),
    disqualifications: sum('disqualifications'),
    // Mean finishing position over the Grands Prix he was classified in. An
    // unclassified result ("R", "D" and the rest) has no position to average,
    // so it is left out rather than counted as last.
    averageFinish: Number((sum('finishPositionSum') / sum('finishes')).toFixed(2)),
    championships: seasonRows.filter((s) => s.position === 1).length,
    seasonsContested: seasonRows.length,
  };

  // The per-season fold and the API's own filtered counts are two independent
  // routes to the same number. If they disagree, one of them is wrong and the
  // build should stop rather than pick a winner.
  //
  // Not `drivers/hamilton/qualifying/1`: it looks like a qualifying-position
  // filter but is not one — it returned the 2023 Mexico City GP, where the
  // payload's own `QualifyingResults[0].position` is "6".
  //
  // Poles go through the grid filter, which is the record books' rule less the
  // one place they part from the grid: 2022's sprint weekends, taken back out
  // of the API's count and replaced with the qualifying result.
  const exceptionWeekends = results.filter(isQualifyingPoleWeekend);
  const polesAdjustment =
    exceptionWeekends.filter((race) => qualifiedFirst.has(raceKey(race))).length -
    exceptionWeekends.filter((race) => Number(race.Results[0].grid) === 1).length;

  const crossChecks = [
    ['wins', `drivers/${DRIVER}/results/1`, 0],
    ['fastestLaps', `drivers/${DRIVER}/fastest/1/results`, 0],
    ['poles', `drivers/${DRIVER}/grid/1/results`, polesAdjustment],
  ];
  for (const [key, endpoint, adjustment] of crossChecks) {
    const remote = Number((await get(endpoint, { limit: 1 })).total) + adjustment;
    if (remote !== totals[key]) {
      throw new Error(
        `Cross-check failed for ${key}: counted ${totals[key]} from the season fold, ` +
          `API filter ${endpoint} reports ${remote}` +
          (adjustment ? ` (after a ${adjustment} adjustment for 2022 sprint weekends)` : ''),
      );
    }
  }
  console.log('  cross-checks passed: wins, fastest laps, poles');

  // A career total can only ever go up. A drop means the source changed shape
  // or lost data, and shipping it would quietly understate the record.
  //
  // The one legitimate exception is a figure whose DEFINITION changed in this
  // script — the record-book pole rule took the count from 105 to 104, and that
  // is a correction, not lost data. It is exempted only when the definition
  // text recorded in the previous file differs from the one in force now, so
  // the guard stays armed on every ordinary run.
  try {
    const prev = JSON.parse(await readFile(OUT, 'utf8'));
    const polesRedefined = prev.source?.polesDefinition !== POLES_DEFINITION;
    if (polesRedefined) {
      console.log(
        `  pole definition changed since the last fetch: ${prev.totals.poles} -> ${totals.poles}, ` +
          'not held to the never-decreases rule this once',
      );
    }
    for (const key of ['starts', 'wins', 'podiums', 'poles', 'fastestLaps', 'championships']) {
      if (key === 'poles' && polesRedefined) continue;
      if (totals[key] < prev.totals[key]) {
        throw new Error(
          `${key} went backwards: ${prev.totals[key]} -> ${totals[key]}. ` +
            `Refusing to overwrite. Investigate the source before re-running.`,
        );
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err; // first run: nothing to compare against
  }

  /* ------------------------------------------------------------------ *
   * Every win, in full
   *
   * Section 2 of the page. No extra requests — these are the same result
   * objects already paged above, filtered and projected.
   * ------------------------------------------------------------------ */

  const wins = results
    .filter((race) => classifiedPosition(race.Results[0]) === 1)
    .map((race) => {
      const r = race.Results[0];
      return {
        season: Number(race.season),
        round: Number(race.round),
        raceName: race.raceName,
        date: race.date,
        circuitId: race.Circuit.circuitId,
        circuitName: race.Circuit.circuitName,
        country: race.Circuit.Location.country,
        locality: race.Circuit.Location.locality,
        team: r.Constructor.name,
        teamId: r.Constructor.constructorId,
        grid: Number(r.grid),
        laps: Number(r.laps),
        // Winner's race time. Ergast gives it only for the classified winner,
        // which is exactly who this is.
        raceTime: r.Time?.time ?? null,
        fastestLap: r.FastestLap?.Time?.time ?? null,
        // A win from pole is a different kind of win to one from row three, and
        // it is the one extra fact that makes a long list readable at a glance.
        // Pole by the same rule as the career total, so the two cannot disagree.
        fromPole: tookPole(race),
      };
    });

  /* ------------------------------------------------------------------ *
   * His record at every circuit he has raced
   *
   * Also free: folded from the same result records. This is
   * what the calendar rows carry instead of the reference's lap-length and
   * distance fields, which Ergast does not publish — a driver's history at a
   * circuit is both traceable and more use on a driver's own site.
   * ------------------------------------------------------------------ */

  const circuits = new Map();
  const circuitBucket = (race) => {
    const c = race.Circuit;
    if (!circuits.has(c.circuitId)) {
      circuits.set(c.circuitId, {
        id: c.circuitId,
        name: c.circuitName,
        country: c.Location.country,
        locality: c.Location.locality,
        starts: 0, wins: 0, podiums: 0, poles: 0,
        bestFinish: null,
        firstRaced: Number(race.season),
        lastRaced: Number(race.season),
        // Laps of the longest race he has completed here. Ergast has no circuit
        // table, so the scheduled distance is inferred from a real result rather
        // than typed in from somewhere else.
        laps: 0,
      });
    }
    return circuits.get(c.circuitId);
  };

  for (const race of results) {
    const b = circuitBucket(race);
    const pos = classifiedPosition(race.Results[0]);
    const season = Number(race.season);
    b.starts++;
    b.firstRaced = Math.min(b.firstRaced, season);
    b.lastRaced = Math.max(b.lastRaced, season);
    b.laps = Math.max(b.laps, Number(race.Results[0].laps) || 0);
    if (pos === 1) b.wins++;
    if (pos !== null && pos <= 3) b.podiums++;
    if (tookPole(race)) b.poles++;
    if (pos !== null) b.bestFinish = b.bestFinish === null ? pos : Math.min(b.bestFinish, pos);
  }

  /* ------------------------------------------------------------------ *
   * The current season's calendar
   *
   * One request. Carries the practice and qualifying session times — the same
   * payload the reference hangs off each schedule row — and the race datetime
   * the countdown targets.
   *
   * The round count is whatever the season actually is, never the reference's.
   * 2026 has 23, not the 24 first announced: the Bahrain (10-12 Apr) and Saudi
   * Arabian (17-19 Apr) Grands Prix were called off on 14 March 2026 "due to
   * the ongoing situation in the Middle East region", and Bahrain's round was
   * later restaged at Sepang on 2-4 October as the "Bahrain Grand Prix in
   * Malaysia". Checked 2026-09-30, all 23 rounds and dates, against
   *   formula1.com/en/racing/2026 (the official calendar: 23 rounds)
   *   formula1.com/en/latest/article/bahrain-and-saudi-arabian-grands-prix-will-not-take-place-in-april.1hnqllVG85RSt8pbFc5Ivx
   *   formula1.com/en/racing/2026/bahrain ("Formula 1 Gulf Air Bahrain Grand
   *   Prix in Malaysia 2026", Sepang International Circuit)
   * Dates here are UTC instants; the pages print them in UK time, so Las
   * Vegas (race Sat 21 Nov local) reads 20-22 Nov where formula1.com's
   * local-time listing reads 19-21 Nov. Same instants, different clock.
   * ------------------------------------------------------------------ */

  const calendarData = await get(`${latestSeason}/races`, { limit: 100 });
  const rounds = calendarData.RaceTable?.Races ?? [];
  if (!rounds.length) throw new Error(`No ${latestSeason} calendar returned`);

  const session = (node) => (node?.date ? { date: node.date, time: node.time ?? null } : null);

  const raced = new Map(results.map((r) => [`${r.season}-${r.round}`, r]));
  const qualified = new Map(quali.map((r) => [`${r.season}-${r.round}`, r]));
  const sprinted = new Map(sprints.map((r) => [`${r.season}-${r.round}`, r]));

  /* His qualifying classification and his best lap of the session: the last of
     Q3, Q2, Q1 he set a time in. Null where the source has no qualifying for
     the round yet. */
  const qualifyingOf = (key) => {
    const q = qualified.get(key)?.QualifyingResults?.[0];
    if (!q) return null;
    return {
      position: finishedPosition(q.position),
      time: q.Q3 || q.Q2 || q.Q1 || null,
    };
  };

  /* His sprint result: place, and the sprint winner's time or his gap to it. */
  const sprintOf = (key) => {
    const s = sprinted.get(key)?.SprintResults?.[0];
    if (!s) return null;
    return {
      position: finishedPosition(s.positionText),
      positionText: s.positionText,
      time: s.Time?.time ?? null,
    };
  };

  const calendar = rounds.map((race) => {
    const key = `${race.season}-${race.round}`;
    const result = raced.get(key);
    const r = result?.Results?.[0];
    return {
      season: Number(race.season),
      round: Number(race.round),
      raceName: race.raceName,
      circuitId: race.Circuit.circuitId,
      circuitName: race.Circuit.circuitName,
      country: race.Circuit.Location.country,
      locality: race.Circuit.Location.locality,
      date: race.date,
      time: race.time ?? null,
      sessions: {
        practice1: session(race.FirstPractice),
        practice2: session(race.SecondPractice),
        practice3: session(race.ThirdPractice),
        // Sprint weekends only. Called Sprint Qualifying from 2024 (the 2023
        // Sprint Shootout never reaches this: only the current season is read).
        sprintQualifying: session(race.SprintQualifying),
        qualifying: session(race.Qualifying),
        sprint: session(race.Sprint),
      },
      // Present only once the round has been run. Its absence is what marks a
      // round upcoming — the page derives that from the clock rather than
      // storing a state that goes stale between the fetch and the visit.
      result: r
        ? {
            position: classifiedPosition(r),
            positionText: r.positionText,
            points: Number(r.points),
            grid: Number(r.grid),
            status: r.status,
            // The winner's race time for a win, his gap to the winner
            // otherwise; null for a non-finish or a lapped finish.
            time: r.Time?.time ?? null,
            // His own fastest lap of the race, whatever its rank in the field.
            fastestLap: r.FastestLap?.Time?.time ?? null,
            qualifying: qualifyingOf(key),
            sprint: sprintOf(key),
          }
        : null,
    };
  });

  /* ------------------------------------------------------------------ *
   * Every Grand Prix he has started, in order
   *
   * The calendar page's season-by-season results list. No extra requests --
   * the same result objects paged above, projected.
   * ------------------------------------------------------------------ */

  const raceRecord = results.map((race) => {
    const r = race.Results[0];
    return {
      season: Number(race.season),
      round: Number(race.round),
      raceName: race.raceName,
      date: race.date,
      circuitId: race.Circuit.circuitId,
      country: race.Circuit.Location.country,
      locality: race.Circuit.Location.locality,
      position: finishedPosition(r.positionText),
      positionText: r.positionText,
      status: r.status,
      fastestLap: r.FastestLap?.Time?.time ?? null,
    };
  });

  console.log(
    `  ${wins.length} wins, ${circuits.size} circuits, ${calendar.length} rounds in ` +
      `${latestSeason} (${calendar.filter((c) => c.result).length} run)`,
  );

  const payload = {
    $comment:
      'GENERATED by tools/fetch-stats.mjs. Do not edit by hand — run `npm run fetch-stats`.',
    source: {
      api: API,
      driver: DRIVER,
      fetchedAt: new Date().toISOString(),
      requests,
      polesDefinition: POLES_DEFINITION,
      latestRace: {
        season: latest.season,
        round: latest.round,
        name: latest.raceName,
        date: latest.date,
      },
    },
    totals,
    seasons: seasonRows,
    wins,
    circuits: [...circuits.values()].sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name)),
    calendar,
    races: raceRecord,
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`\nWrote ${path.relative(process.cwd(), OUT)}`);
  console.log(
    `  ${totals.starts} starts · ${totals.wins} wins · ${totals.podiums} podiums · ` +
      `${totals.poles} poles · ${totals.fastestLaps} FL · ${totals.championships} titles`,
  );
  console.log(
    `  current through ${latest.raceName} (${latest.date}), ${requests} API requests`,
  );
}

main().catch((err) => {
  console.error(`\nfetch-stats FAILED: ${err.message}`);
  process.exit(1);
});
