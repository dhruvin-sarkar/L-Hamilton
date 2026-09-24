/**
 * Circuit facts: lap length, race laps and race distance, per circuit.
 *
 * Figures checked 2026-09-24, each against the official Formula 1 page for its
 * 2026 round (formula1.com/en/racing/2026/<race>), which lists "Circuit
 * Length", "Number of Laps" and "Race Distance". The URL is on every entry.
 *
 * The reference prints all three for every round (Length, Distance and Laps in
 * its panel; Laps and Distance in its table). They describe the circuit and the
 * race, not the driver, and the Jolpica feed behind the rest of the calendar
 * does not carry them, so they are typed here instead.
 *
 * Distance is the published figure, not laps x length. The two differ because
 * the start line and the finish line are not always at the same point: Baku is
 * 51 x 6.003 = 306.153 km, and its published race distance is 306.049 km. (The
 * reference shows 306.153, the product. We use the published figure.)
 *
 * Keyed by the Jolpica `circuitId` the calendar rounds carry. Watch the two
 * Spanish rounds: `catalunya` is the Barcelona Grand Prix and `madring`, new
 * for 2026, is the Spanish Grand Prix in Madrid. Round 16, the "Bahrain Grand
 * Prix in Malaysia", is run at Sepang (`sepang`). Both Jolpica and
 * formula1.com say so. Its figures are Sepang's.
 *
 * Layouts and lap counts change between seasons, so these figures hold for
 * the season they were checked for and no other. `circuitFacts` throws rather
 * than print them against a different year's calendar.
 */

import type { CalendarRound } from './live-stats';

export interface CircuitFacts {
  /** One lap, in km, as published. */
  lengthKm: number;
  /** Scheduled race laps. */
  laps: number;
  /** Race distance, in km, as published. Not laps x length. */
  raceDistanceKm: number;
  /** The page all three figures were read from. */
  source: string;
}

/** The season the figures below were checked for. */
const CHECKED_SEASON = 2026;

const F1 = 'https://www.formula1.com/en/racing/2026';

const FACTS: Readonly<Record<string, CircuitFacts>> = {
  albert_park: { lengthKm: 5.278, laps: 58, raceDistanceKm: 306.124, source: `${F1}/australia` },
  shanghai: { lengthKm: 5.451, laps: 56, raceDistanceKm: 305.066, source: `${F1}/china` },
  suzuka: { lengthKm: 5.807, laps: 53, raceDistanceKm: 307.471, source: `${F1}/japan` },
  miami: { lengthKm: 5.412, laps: 57, raceDistanceKm: 308.326, source: `${F1}/miami` },
  villeneuve: { lengthKm: 4.361, laps: 70, raceDistanceKm: 305.27, source: `${F1}/canada` },
  monaco: { lengthKm: 3.337, laps: 78, raceDistanceKm: 260.286, source: `${F1}/monaco` },
  catalunya: { lengthKm: 4.657, laps: 66, raceDistanceKm: 307.236, source: `${F1}/barcelona-catalunya` },
  red_bull_ring: { lengthKm: 4.326, laps: 71, raceDistanceKm: 307.026, source: `${F1}/austria` },
  silverstone: { lengthKm: 5.891, laps: 52, raceDistanceKm: 306.198, source: `${F1}/great-britain` },
  spa: { lengthKm: 7.004, laps: 44, raceDistanceKm: 308.054, source: `${F1}/belgium` },
  hungaroring: { lengthKm: 4.381, laps: 70, raceDistanceKm: 306.63, source: `${F1}/hungary` },
  zandvoort: { lengthKm: 4.259, laps: 72, raceDistanceKm: 306.592, source: `${F1}/netherlands` },
  monza: { lengthKm: 5.793, laps: 53, raceDistanceKm: 306.72, source: `${F1}/italy` },
  madring: { lengthKm: 5.414, laps: 57, raceDistanceKm: 308.399, source: `${F1}/spain` },
  baku: { lengthKm: 6.003, laps: 51, raceDistanceKm: 306.049, source: `${F1}/azerbaijan` },
  sepang: { lengthKm: 5.543, laps: 56, raceDistanceKm: 310.418, source: `${F1}/bahrain` },
  marina_bay: { lengthKm: 4.927, laps: 62, raceDistanceKm: 305.337, source: `${F1}/singapore` },
  americas: { lengthKm: 5.513, laps: 56, raceDistanceKm: 308.432, source: `${F1}/united-states` },
  rodriguez: { lengthKm: 4.304, laps: 71, raceDistanceKm: 305.354, source: `${F1}/mexico` },
  interlagos: { lengthKm: 4.309, laps: 71, raceDistanceKm: 305.879, source: `${F1}/brazil` },
  vegas: { lengthKm: 6.201, laps: 50, raceDistanceKm: 309.958, source: `${F1}/las-vegas` },
  losail: { lengthKm: 5.419, laps: 57, raceDistanceKm: 308.611, source: `${F1}/qatar` },
  yas_marina: { lengthKm: 5.281, laps: 58, raceDistanceKm: 306.188, source: `${F1}/united-arab-emirates` },
};

/**
 * A round's circuit facts, or a thrown error.
 *
 * Fails fast (CLAUDE.md, design principle 5). A calendar that gains a circuit
 * this table lacks, or moves on to a season it was not checked for, stops the
 * schedule. The alternative is printing a blank or another year's figure.
 */
export function circuitFacts(round: CalendarRound): CircuitFacts {
  if (round.season !== CHECKED_SEASON) {
    throw new Error(
      `[calendar] circuit facts were checked for ${CHECKED_SEASON}, not ${round.season}. ` +
        'Recheck every entry in circuit-facts.ts against that season on formula1.com.',
    );
  }
  const facts = FACTS[round.circuitId];
  if (!facts) {
    throw new Error(
      `[calendar] no circuit facts for "${round.circuitId}" (round ${round.round}, ${round.raceName}). ` +
        'Add them to circuit-facts.ts from its formula1.com race page.',
    );
  }
  return facts;
}

/**
 * A figure as the reference prints it, and as formula1.com does: the shortest
 * form of the number, so 6.003 and 306.63 rather than 306.630.
 */
export function formatKm(km: number): string {
  return String(km);
}
