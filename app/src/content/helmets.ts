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
 * `name` and `year` are deliberately null. They are the one part of this
 * section that cannot be recovered from the images without guessing, and a
 * guessed year attached to a real helmet is exactly the invented stat the brief
 * forbids. pendingHelmets() surfaces the gap loudly in dev; the card itself
 * renders NOTHING in the label notch rather than a lone em-dash, because
 * twenty-six dashes down the wall read as a rendering fault rather than as a
 * queue of data still to come. Fill them in and the labels, the alt text and
 * the ordering all follow with no other change. */

export interface Helmet {
  /** Asset index; also the filename stem. See the note about the missing 22. */
  id: number;
  /** The livery's name, or the Grand Prix it was raced at. Null until sourced. */
  name: string | null;
  /** The season it was raced. Null until sourced. */
  year: number | null;
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

/* Ordered oldest to newest, which is the order the assets were numbered in:
   id 1 is a Vodafone-era McLaren lid and id 27 is a gold Ferrari one. That
   ordering is the only claim made here, and it comes from the liveries visible
   in the photographs rather than from a date attached to any single helmet. */
export const helmets: Helmet[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 24, 25,
  26, 27,
].map((id) => ({ id, name: null, year: null }));

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
