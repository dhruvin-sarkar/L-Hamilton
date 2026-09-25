/* Helmet Hall of Fame — the data behind the grid.
 *
 * One entry per helmet, in the order they are displayed. Both images for an
 * entry are keyed off `id` alone:
 *
 *   /assets/helmets-hof/helmet-NN.webp   the helmet, studio side-on
 *   /assets/helmets-hof/reveal-NN.webp   Hamilton wearing it, shown on hover
 *
 * NN is the id zero-padded to two digits. There is no id 22: the source set had
 * a `22.webp` that turned out to be the helmet for id 2 rather than a helmet of
 * its own, and no reveal ever existed for it. Ids therefore run 1-21 and 23-27,
 * 26 entries. Do not "fix" the gap by renumbering — the asset filenames are the
 * record, and renumbering would silently repoint every pair.
 *
 * `name` and `year` are sourced, entry by entry, or left null. They cannot be
 * recovered from the images without guessing, and a guessed year attached to a
 * real helmet is exactly the invented stat the brief forbids. So every filled
 * value carries the `source` it was checked against, and a value goes in only
 * when BOTH photographs of the entry agree with that source — the reveal is
 * often the stronger evidence, because the car, the kit and the sponsor patches
 * date it. pendingHelmets() surfaces what is still null, loudly, in dev; the
 * card renders NOTHING in the label notch for a null rather than a lone
 * em-dash, because dashes down the wall read as a rendering fault rather than
 * as a queue of data still to come.
 *
 * Names follow the reference's own labels ("Season", "Silverstone", "Las
 * Vegas", "Japan"): the Grand Prix a one-off was raced at, or "Season" for the
 * lid a whole year was raced in. Title case, and short enough for the notch —
 * the reference's longest is "Dark Glitter". */

export interface Helmet {
  /** Asset index; also the filename stem. See the note about the missing 22. */
  id: number;
  /** The livery's name, or the Grand Prix it was raced at. Null until sourced. */
  name: string | null;
  /** The season it was raced. Null until sourced. */
  year: number | null;
  /** The page `name` and `year` were checked against. Absent while both are null. */
  source?: string;
}

/** Zero-padded asset stem for an id — `1` becomes `01`. */
function stem(id: number): string {
  return String(id).padStart(2, '0');
}

export function helmetSrc(helmet: Helmet): string {
  return `/assets/helmets-hof/helmet-${stem(helmet.id)}.webp`;
}

export function revealSrc(helmet: Helmet): string {
  return `/assets/helmets-hof/reveal-${stem(helmet.id)}.webp`;
}

/**
 * Alt text for the helmet shot.
 *
 * Built from the data rather than written out per entry, so filling in `name`
 * and `year` improves the screen-reader experience at the same time as the
 * visible label. Until then it says what is actually knowable from the image.
 */
export function helmetAlt(helmet: Helmet): string {
  if (helmet.name && helmet.year) return `${helmet.name} helmet, ${helmet.year}`;
  if (helmet.year) return `Lewis Hamilton's race helmet, ${helmet.year}`;
  return "One of Lewis Hamilton's race helmets";
}

/** Alt for the wearing shot. Same reasoning as helmetAlt. */
export function revealAlt(helmet: Helmet): string {
  return helmet.year
    ? `Lewis Hamilton wearing the ${helmet.year} helmet`
    : 'Lewis Hamilton wearing this helmet';
}

/* Most entries trace to one page: formula1.com's walk through Hamilton's
   helmets, which prints the very photographs used as reveals 01-12 and
   describes the Ferrari one-offs closely enough to match on detail (the Monza
   lid's "NIKI LAUDA", the Singapore lid's lion, the Las Vegas glitter). */
const F1_HELMETS =
  'https://www.formula1.com/en/latest/article/lewis-hamiltons-best-helmets-through-the-years.4ouvU4h5ACxxHU4g6uhvZW';

/* Mercedes' own round-up of his São Paulo lids, which prints the 2023 one and
   describes the 2022 season's return to fluorescent yellow. */
const MERCEDES_BRAZIL = 'https://www.mercedesamgf1.com/news/our-favourite-lewis-brasil-helmets';

/* formula1.com on the 2021 Silverstone lid, and on the 2025 Ferrari one, which
   dates the yellow, purple and black design it replaced to 2024. */
const F1_MAD_DOG_JONES =
  'https://www.formula1.com/en/latest/article/hamilton-unveils-new-helmet-by-artist-mad-dog-jones-as-leclercs-design-marks.371Uk08SWPcIcJi9syf2Jo';
const F1_FERRARI_FIRST_LOOK =
  'https://www.formula1.com/en/latest/article/hamilton-shares-first-look-at-striking-helmet-design-for-new-ferrari-chapter.11rtWRLdH3qTzNXfMu8Orh';

/* OLDEST FIRST, one record per asset id, in asset order except where noted.

   Ids 1-3 stay null because their two photographs disagree with each other,
   not for want of a source. Reveal 01 is the 2010 Monaco "casino" lid and
   reveal 02 the 2009 British GP one — formula1.com prints both photographs —
   but helmet 02 is the roulette-topped 2010 Monaco lid and helmet 01 a
   Steinmetz-branded yellow lid with a plain crown, so the two reveals look
   swapped. Reveal 03 is the 2007 Australian GP practice debut, while helmet
   03 carries the "LH" stripe logo that the 2007 lid lacks. Any label would be
   wrong for one picture of the pair, so none is given; the files, not this
   table, are what needs fixing. */
const byId: readonly Helmet[] = [
  { id: 1, name: null, year: null },
  { id: 2, name: null, year: null },
  { id: 3, name: null, year: null },
  // Bob Marley on the crown, "One Love"; worn at the Marley family's request.
  { id: 4, name: 'India', year: 2011, source: F1_HELMETS },
  // Singapore's lion on the crown, the flag's crescent and stars on the side.
  { id: 5, name: 'Singapore', year: 2012, source: F1_HELMETS },
  // Stars and stripes, Verizon on the brow: he won the first race at COTA in it.
  { id: 6, name: 'USA', year: 2012, source: F1_HELMETS },
  // Nicole Scherzinger and Roscoe in a convertible, "MONACO" across the back.
  { id: 7, name: 'Monaco', year: 2013, source: F1_HELMETS },
  // Red and white, "Still I Rise" on the back, no stars yet.
  { id: 8, name: 'Season', year: 2014, source: F1_HELMETS },
  // The 2014 design with two stars for two titles.
  { id: 9, name: 'Season', year: 2015, source: F1_HELMETS },
  // Candy-apple red, three stars.
  { id: 10, name: 'Season', year: 2016, source: F1_HELMETS },
  // The fan-designed lid, Brazilian blue, green and yellow over the red.
  { id: 11, name: 'Season', year: 2017, source: F1_HELMETS },
  // The red-heavy last of the red-and-white designs.
  { id: 12, name: 'Season', year: 2019, source: F1_HELMETS },
  // The Niki Lauda tribute, in Lauda's red and white; he took pole and won.
  { id: 13, name: 'Monaco', year: 2019, source: F1_HELMETS },
  // Purple and black, "Black Lives Matter" on the crown.
  { id: 14, name: 'Season', year: 2020, source: F1_HELMETS },
  /* 16 before 15, the one place the ids run against the calendar. 16 is the
     Silverstone lid of July 2021; 15 is the Progress Pride lid, first raced in
     Qatar that November. Both sources below date them, so the display follows
     the races rather than the filenames. */
  // Mad Dog Jones: a recycling sign, a BLM fist, the corners round the base.
  { id: 16, name: 'Silverstone', year: 2021, source: F1_MAD_DOG_JONES },
  // The Progress Pride flag over the purple 2021 lid, "love is love" on the side.
  { id: 15, name: 'Pride', year: 2021, source: F1_HELMETS },
  /* Year only. The helmet is the fluorescent-yellow 2022 season lid; the reveal
     is the flag-covered one he wore in São Paulo that November. Both are 2022,
     but no one name fits both pictures. */
  { id: 17, name: null, year: 2022, source: MERCEDES_BRAZIL },
  // Hajime Sorayama's chrome lid with the illuminated visor.
  { id: 18, name: 'Japan', year: 2023, source: F1_HELMETS },
  /* Yellow, purple and black: his last Mercedes lid. Not the similar 2023 one,
     which carried Monster across the brow where this has Solera, and the reveal
     wears WhatsApp, a team partner only from November 2023. */
  { id: 19, name: 'Season', year: 2024, source: F1_FERRARI_FIRST_LOOK },
  /* Name only. Both pictures are his São Paulo lid, but from different years:
     the reveal is the 2023 one Mercedes prints, flag on the crown; the helmet
     is the 2024 one, which carries Signify, a team partner only from July 2024. */
  { id: 20, name: 'Brazil', year: null, source: MERCEDES_BRAZIL },
  // Back to the yellow of his karting days, for his first Ferrari season.
  { id: 21, name: 'Season', year: 2025, source: F1_HELMETS },
  // Blue lines for red, worn with the blue-and-white HP suit to a Sprint podium.
  { id: 23, name: 'Miami', year: 2025, source: F1_HELMETS },
  // White and yellow, "NIKI LAUDA" on the side: his first Monza for Ferrari.
  { id: 24, name: 'Monza', year: 2025, source: F1_HELMETS },
  // The gold lid, with the lion on the side.
  { id: 25, name: 'Singapore', year: 2025, source: F1_HELMETS },
  // Covered in silver glitter.
  { id: 26, name: 'Las Vegas', year: 2025, source: F1_HELMETS },
  // Metallic, with seven stars and sparkling yellow streaks: the season finale.
  { id: 27, name: 'Abu Dhabi', year: 2025, source: F1_HELMETS },
];

/* NEWEST FIRST, which is the order the reference presents its own wall in: its
   year labels run 2025, 2025, 2025, 2024, 2024... down the grid, measured on
   the running site. The asset numbering is the opposite, so the list is
   reversed here rather than renumbered, because the filenames are the record
   (see the note about the missing 22 above). Reversing it is presentation, not
   a new claim. */
export const helmets: Helmet[] = [...byId].reverse();

/**
 * Which entries are still missing their name or year.
 *
 * Reported rather than thrown. A thrown error here would take the whole page
 * down over content that is known to be outstanding, but leaving it silent is
 * how a placeholder ships — so it warns once, in dev only.
 */
export function pendingHelmets(): Helmet[] {
  return helmets.filter((h) => h.name === null || h.year === null);
}
