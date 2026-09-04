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
 * Seasons in which pole position was awarded to the SPRINT winner rather than
 * to the winner of the qualifying session.
 *
 * F1 changed this rule twice. In 2021 and 2022 the sprint set the Grand Prix
 * grid, so its winner took pole; from 2023 pole reverted to the qualifying
 * session. Counting raw qualifying wins across all eras gives a number no
 * published source agrees with, so the rule is encoded rather than ignored.
 *
 * Both figures are emitted — `poles` under this rule, `qualifyingWins` raw —
 * because they answer genuinely different questions and neither is a correction
 * of the other.
 */
const SPRINT_POLE_SEASONS = new Set([2021, 2022]);
const POLES_DEFINITION =
  'Pole = winner of the qualifying session, except in 2021 and 2022 sprint ' +
  'weekends where F1 awarded pole to the sprint winner.';

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

async function main() {
  console.log('Fetching Hamilton career record from Jolpica-F1…');

  // --- the race-by-race record ------------------------------------------
  const results = await getAll(`drivers/${DRIVER}/results`, races);
  const quali = await getAll(`drivers/${DRIVER}/qualifying`, races);
  const sprints = await getAll(`drivers/${DRIVER}/sprint`, races);
  console.log(`  ${results.length} entries, ${quali.length} qualifying, ${sprints.length} sprints`);

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
        fastestLaps: 0, sprintWins: 0, dnfs: 0,
      });
    }
    return seasons.get(year);
  };

  for (const race of results) {
    const r = race.Results[0];
    const b = bucket(Number(race.season));
    const pos = finishedPosition(r.positionText);
    b.entries++;
    if (pos === 1) b.wins++;
    if (pos !== null && pos <= 3) b.podiums++;
    if (pos === null) b.dnfs++;
    // `rank` is the fastest-lap rank across the field; "1" is the fastest lap.
    if (r.FastestLap?.rank === '1') b.fastestLaps++;
  }

  // Which weekends ran a sprint at all — needed to apply the 2021/22 pole rule.
  const raceKey = (r) => `${r.season}-${r.round}`;
  const sprintWeekends = new Set(sprints.map(raceKey));

  for (const race of sprints) {
    const year = Number(race.season);
    const won = finishedPosition(race.SprintResults[0].positionText) === 1;
    if (!won) continue;
    bucket(year).sprintWins++;
    if (SPRINT_POLE_SEASONS.has(year)) bucket(year).poles++;
  }

  for (const race of quali) {
    if (finishedPosition(race.QualifyingResults[0].position) !== 1) continue;
    const year = Number(race.season);
    const b = bucket(year);
    b.qualifyingWins++;
    // In a sprint-pole season the sprint has already decided this weekend's
    // pole above, so topping qualifying does not add one.
    if (SPRINT_POLE_SEASONS.has(year) && sprintWeekends.has(raceKey(race))) continue;
    b.poles++;
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
    championships: seasonRows.filter((s) => s.position === 1).length,
    seasonsContested: seasonRows.length,
  };

  // The per-season fold and the API's own filtered counts are two independent
  // routes to the same number. If they disagree, one of them is wrong and the
  // build should stop rather than pick a winner.
  //
  // Poles have no entry here on purpose. `drivers/hamilton/qualifying/1` looks
  // like a qualifying-position filter but is not one — it returned the 2023
  // Mexico City GP, where the payload's own `QualifyingResults[0].position` is
  // "6". Ergast's documented position filter is `/grid/{n}`, and grid position
  // is not pole either (penalties reorder the grid after qualifying). So the
  // season fold is the only route to poles, and it is unchecked by design
  // rather than by omission.
  const crossChecks = [
    ['wins', `drivers/${DRIVER}/results/1`],
    ['fastestLaps', `drivers/${DRIVER}/fastest/1/results`],
  ];
  for (const [key, endpoint] of crossChecks) {
    const remote = Number((await get(endpoint, { limit: 1 })).total);
    if (remote !== totals[key]) {
      throw new Error(
        `Cross-check failed for ${key}: counted ${totals[key]} from the season fold, ` +
          `API filter ${endpoint} reports ${remote}`,
      );
    }
  }
  console.log('  cross-checks passed: wins, fastest laps');

  // A career total can only ever go up. A drop means the source changed shape
  // or lost data, and shipping it would quietly understate the record.
  try {
    const prev = JSON.parse(await readFile(OUT, 'utf8'));
    for (const key of ['starts', 'wins', 'podiums', 'poles', 'fastestLaps', 'championships']) {
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
